// Package queue is a BullMQ-compatible consumer.
//
// The producer is BullMQ on Node. Rather than reimplement its queue state
// machine — which spans the wait list, active list, marker key, events stream,
// stalled set and per-job lock keys, and is mutated atomically — this package
// executes BullMQ's own Lua scripts, vendored in lua/. See lua/README.md.
package queue

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/vmihailenco/msgpack/v5"
)

// ErrNoJob is returned when a non-blocking claim finds nothing to do.
var ErrNoJob = errors.New("no job available")

// Job is one claimed unit of work, still locked by this worker.
type Job struct {
	ID    string
	Name  string
	Queue string
	// Data is the raw `data` field of the job hash, parsed by the contract
	// package rather than here — this layer stays agnostic about payloads.
	Data []byte
	// Token proves ownership. Every finishing call must present it or the
	// script refuses with "missing lock".
	Token string

	opts jobOpts
}

// jobOpts is the subset of BullMQ's per-job options the worker has to honour
// when finishing a job. Retention policy lives on the job, not the worker, so
// it has to be read back out of the hash rather than assumed.
type jobOpts struct {
	Attempts         int             `json:"attempts"`
	RemoveOnComplete json.RawMessage `json:"removeOnComplete"`
	RemoveOnFail     json.RawMessage `json:"removeOnFail"`
}

// Consumer claims and finishes jobs on one BullMQ queue.
type Consumer struct {
	client    redis.UniversalClient
	keys      keys
	queueName string
	// workerName is recorded on the job as `pb` (processed by), which is what
	// BullMQ's UI shows. Purely diagnostic.
	workerName   string
	lockDuration time.Duration

	moveToActive     script
	moveToFinished   script
	moveActiveToWait script
}

// NewConsumer loads the vendored scripts and binds them to one queue.
func NewConsumer(
	client redis.UniversalClient,
	prefix, queueName, workerName string,
	lockDuration time.Duration,
) (*Consumer, error) {
	moveToActive, err := loadScript("moveToActive-11.lua")
	if err != nil {
		return nil, err
	}
	moveToFinished, err := loadScript("moveToFinished-14.lua")
	if err != nil {
		return nil, err
	}
	moveActiveToWait, err := loadScript("moveJobFromActiveToWait-9.lua")
	if err != nil {
		return nil, err
	}

	return &Consumer{
		client:           client,
		keys:             newKeys(prefix, queueName),
		queueName:        queueName,
		workerName:       workerName,
		lockDuration:     lockDuration,
		moveToActive:     moveToActive,
		moveToFinished:   moveToFinished,
		moveActiveToWait: moveActiveToWait,
	}, nil
}

func (c *Consumer) QueueName() string { return c.queueName }

// MarkerKey is the sorted set BullMQ pushes to when work becomes available.
func (c *Consumer) MarkerKey() string { return c.keys.marker() }

// AwaitAny blocks until any of the given queues signals that work may be
// available, the timeout elapses, or ctx is cancelled.
//
// BullMQ publishes availability by pushing to a marker sorted set, so a
// blocking pop across the markers is how a worker sleeps instead of polling.
// A marker is a hint, not a claim: a claim can still come back empty because
// another worker got there first, which is why this never returns a job.
func AwaitAny(
	ctx context.Context,
	client redis.UniversalClient,
	timeout time.Duration,
	markers ...string,
) error {
	if len(markers) == 0 {
		return nil
	}
	err := client.BZPopMin(ctx, timeout, markers...).Err()
	if err != nil && !errors.Is(err, redis.Nil) {
		return fmt.Errorf("await queue markers: %w", err)
	}
	return nil
}

// Claim moves the next job to active and locks it, or returns ErrNoJob.
func (c *Consumer) Claim(ctx context.Context) (*Job, error) {
	token, err := newToken()
	if err != nil {
		return nil, err
	}

	opts, err := msgpack.Marshal(map[string]any{
		"token":        token,
		"lockDuration": c.lockDuration.Milliseconds(),
		"name":         c.workerName,
	})
	if err != nil {
		return nil, fmt.Errorf("pack moveToActive opts: %w", err)
	}

	result, err := c.eval(ctx, c.moveToActive, []string{
		c.keys.wait(),
		c.keys.active(),
		c.keys.prioritized(),
		c.keys.events(),
		c.keys.stalled(),
		c.keys.limiter(),
		c.keys.delayed(),
		c.keys.paused(),
		c.keys.meta(),
		c.keys.priorityCounter(),
		c.keys.marker(),
	}, c.keys.prefix(), nowMillis(), opts)
	if err != nil {
		return nil, fmt.Errorf("moveToActive on %s: %w", c.queueName, err)
	}

	return c.decodeClaim(result, token)
}

// decodeClaim reads moveToActive's `{jobHash, jobId, 0, 0}` reply. Anything
// else means "nothing to do" — rate limited, paused, or an empty queue.
func (c *Consumer) decodeClaim(result any, token string) (*Job, error) {
	reply, ok := result.([]any)
	if !ok || len(reply) < 2 {
		return nil, ErrNoJob
	}
	fields, ok := reply[0].([]any)
	if !ok || len(fields) == 0 {
		return nil, ErrNoJob
	}
	jobID, ok := reply[1].(string)
	if !ok || jobID == "" {
		return nil, ErrNoJob
	}

	hash := make(map[string]string, len(fields)/2)
	for i := 0; i+1 < len(fields); i += 2 {
		name, nameOK := fields[i].(string)
		value, valueOK := fields[i+1].(string)
		if nameOK && valueOK {
			hash[name] = value
		}
	}

	data, present := hash["data"]
	if !present {
		return nil, fmt.Errorf("job %s has no data field", jobID)
	}

	job := &Job{
		ID:    jobID,
		Name:  hash["name"],
		Queue: c.queueName,
		Data:  []byte(data),
		Token: token,
	}
	// Absent or unparseable opts are not fatal: they only drive retention, and
	// defaulting to "keep" is the safe direction for a graded submission.
	if rawOpts, hasOpts := hash["opts"]; hasOpts {
		_ = json.Unmarshal([]byte(rawOpts), &job.opts)
	}
	return job, nil
}

// Complete marks a job successfully processed.
//
// `returnValue` is stored on the job and shown by BullMQ tooling. It must not
// carry grading detail: the authoritative result travels over the HTTP
// callback, and the job hash is far more widely readable.
func (c *Consumer) Complete(ctx context.Context, job *Job, returnValue string) error {
	return c.finish(ctx, job, "completed", "returnvalue", returnValue)
}

// Fail marks a job failed so BullMQ applies its retry policy.
func (c *Consumer) Fail(ctx context.Context, job *Job, reason string) error {
	return c.finish(ctx, job, "failed", "failedReason", reason)
}

func (c *Consumer) finish(ctx context.Context, job *Job, target, propName, value string) error {
	retention := job.opts.RemoveOnComplete
	if target == "failed" {
		retention = job.opts.RemoveOnFail
	}

	opts, err := msgpack.Marshal(map[string]any{
		"token":        job.Token,
		"name":         c.workerName,
		"keepJobs":     keepJobs(retention),
		"lockDuration": c.lockDuration.Milliseconds(),
		"attempts":     job.opts.Attempts,
		// Metrics collection is off; an empty string is what BullMQ sends when
		// no maxDataPoints is configured.
		"maxMetricsSize": "",
		"fpof":           false,
		"cpof":           false,
		"idof":           false,
		"rdof":           false,
	})
	if err != nil {
		return fmt.Errorf("pack moveToFinished opts: %w", err)
	}

	// fetchNext is 0: this worker claims explicitly through Claim so that the
	// container semaphore decides when more work starts. Letting the finish
	// script hand back another job would bypass that backpressure entirely.
	result, err := c.eval(ctx, c.moveToFinished, []string{
		c.keys.wait(),
		c.keys.active(),
		c.keys.prioritized(),
		c.keys.events(),
		c.keys.stalled(),
		c.keys.limiter(),
		c.keys.delayed(),
		c.keys.paused(),
		c.keys.meta(),
		c.keys.priorityCounter(),
		c.keys.of(target),
		c.keys.job(job.ID),
		c.keys.metrics(target),
		c.keys.marker(),
	}, job.ID, nowMillis(), propName, value, target, "0", c.keys.prefix(), opts)
	if err != nil {
		return fmt.Errorf("moveToFinished %s on %s: %w", target, c.queueName, err)
	}
	if code, ok := result.(int64); ok && code < 0 {
		return fmt.Errorf("moveToFinished %s rejected job %s: %s", target, job.ID, finishError(code))
	}
	return nil
}

// Release returns a still-locked job to the wait list.
//
// Used on shutdown for work that did not finish inside the grace period: the
// job goes back to waiting so another worker picks it up, rather than sitting
// in active until the stalled check eventually rescues it.
func (c *Consumer) Release(ctx context.Context, job *Job) error {
	result, err := c.eval(ctx, c.moveActiveToWait, []string{
		c.keys.active(),
		c.keys.wait(),
		c.keys.stalled(),
		c.keys.paused(),
		c.keys.meta(),
		c.keys.limiter(),
		c.keys.prioritized(),
		c.keys.marker(),
		c.keys.events(),
	}, job.ID, job.Token, c.keys.job(job.ID))
	if err != nil {
		return fmt.Errorf("release job %s: %w", job.ID, err)
	}
	if code, ok := result.(int64); ok && code < 0 {
		return fmt.Errorf("release rejected job %s: %s", job.ID, finishError(code))
	}
	return nil
}

// eval runs a vendored script, preferring EVALSHA and falling back to EVAL the
// first time Redis has not seen it.
func (c *Consumer) eval(ctx context.Context, s script, keys []string, args ...any) (any, error) {
	if len(keys) != s.numKeys {
		return nil, fmt.Errorf("%s expects %d keys, got %d", s.name, s.numKeys, len(keys))
	}
	redisScript := redis.NewScript(s.source)
	return redisScript.Run(ctx, c.client, keys, args...).Result()
}

// keepJobs mirrors BullMQ's getKeepJobs. An object option passes through; a
// boolean or missing value becomes a count, where -1 means keep everything.
func keepJobs(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]any{"count": -1}
	}
	var asObject map[string]any
	if err := json.Unmarshal(raw, &asObject); err == nil {
		return asObject
	}
	var asNumber float64
	if err := json.Unmarshal(raw, &asNumber); err == nil {
		return map[string]any{"count": int64(asNumber)}
	}
	var asBool bool
	if err := json.Unmarshal(raw, &asBool); err == nil && asBool {
		return map[string]any{"count": 0}
	}
	return map[string]any{"count": -1}
}

// finishError translates moveToFinished's negative reply codes, documented in
// the script header, into something a log reader can act on.
func finishError(code int64) string {
	switch code {
	case -1:
		return "job key is missing; it was removed while running"
	case -2:
		return "lock is missing; the job was considered stalled and reclaimed"
	case -3:
		return "job is not in the active set"
	case -4:
		return "job has pending children"
	case -6:
		return "lock is held by another worker"
	case -9:
		return "job has failed children"
	default:
		return fmt.Sprintf("unknown error code %d", code)
	}
}

func nowMillis() string {
	return strconv.FormatInt(time.Now().UnixMilli(), 10)
}

// newToken mints the lock token proving this worker owns a job.
func newToken() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate lock token: %w", err)
	}
	return hex.EncodeToString(buf), nil
}
