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
	// AttemptsMade counts finished attempts before this one, from the hash's
	// `atm` field. It is what decides whether a failure is retried.
	AttemptsMade int
	// DeferredFailure is set when the stalled check gave up on this job — it
	// stalled more often than the limit allows, usually because it keeps
	// taking its worker down. BullMQ leaves failing it to whoever claims it
	// next, and the job must not be processed again.
	DeferredFailure string

	opts jobOpts
}

// jobOpts is the subset of BullMQ's per-job options the worker has to honour
// when finishing a job. Retention and retry policy live on the job, not the
// worker, so they have to be read back out of the hash rather than assumed.
type jobOpts struct {
	Attempts         int             `json:"attempts"`
	Backoff          json.RawMessage `json:"backoff"`
	LIFO             bool            `json:"lifo"`
	RemoveOnComplete json.RawMessage `json:"removeOnComplete"`
	RemoveOnFail     json.RawMessage `json:"removeOnFail"`
}

// FailOutcome says what Fail did with a job.
type FailOutcome struct {
	// Retrying is true when the job went back to be attempted again rather
	// than to the failed set.
	Retrying bool
	// Delay is the backoff before the retry becomes claimable. Zero with
	// Retrying means it went straight back to the wait list.
	Delay time.Duration
}

// Settings are the BullMQ worker options this consumer honours.
type Settings struct {
	// LockDuration is how long a claim or a renewal keeps a job owned.
	LockDuration time.Duration
	// StalledInterval is both how often the stalled check may run and how long
	// the queue-wide guard stops another worker repeating it sooner.
	StalledInterval time.Duration
	// MaxStalledCount is how many times a job may be recovered from a dead
	// worker before it is failed instead. BullMQ's default is 1.
	MaxStalledCount int
}

// Consumer claims and finishes jobs on one BullMQ queue.
type Consumer struct {
	client    redis.UniversalClient
	keys      keys
	queueName string
	// workerName is recorded on the job as `pb` (processed by), which is what
	// BullMQ's UI shows. Purely diagnostic.
	workerName string
	settings   Settings

	moveToActive     script
	moveToFinished   script
	moveActiveToWait script
	moveToDelayed    script
	retryJob         script
	extendLock       script
	moveStalled      script
}

// NewConsumer loads the vendored scripts and binds them to one queue.
func NewConsumer(
	client redis.UniversalClient,
	prefix, queueName, workerName string,
	settings Settings,
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
	moveToDelayed, err := loadScript("moveToDelayed-12.lua")
	if err != nil {
		return nil, err
	}
	retryJob, err := loadScript("retryJob-11.lua")
	if err != nil {
		return nil, err
	}
	extendLock, err := loadScript("extendLock-2.lua")
	if err != nil {
		return nil, err
	}
	moveStalled, err := loadScript("moveStalledJobsToWait-9.lua")
	if err != nil {
		return nil, err
	}

	return &Consumer{
		client:           client,
		keys:             newKeys(prefix, queueName),
		queueName:        queueName,
		workerName:       workerName,
		settings:         settings,
		moveToActive:     moveToActive,
		moveToFinished:   moveToFinished,
		moveActiveToWait: moveActiveToWait,
		moveToDelayed:    moveToDelayed,
		retryJob:         retryJob,
		extendLock:       extendLock,
		moveStalled:      moveStalled,
	}, nil
}

// ExtendLock renews this worker's ownership of a running job.
//
// It returns false, without an error, when the lock is no longer ours: it
// expired and another worker may already have reclaimed the job. That is the
// failure mode renewal exists to prevent — a long compile outliving its lock
// and the same submission graded twice.
func (c *Consumer) ExtendLock(ctx context.Context, job *Job) (bool, error) {
	result, err := c.eval(ctx, c.extendLock, []string{
		c.keys.lock(job.ID),
		c.keys.stalled(),
	}, job.Token, c.settings.LockDuration.Milliseconds(), job.ID)
	if err != nil {
		return false, fmt.Errorf("extend lock for job %s on %s: %w", job.ID, c.queueName, err)
	}
	extended, _ := result.(int64)
	return extended == 1, nil
}

// RecoverStalled moves jobs whose worker died back to the wait list.
//
// BullMQ's check is two-phase: each pass recovers jobs that were marked on the
// previous pass and still hold no lock, then marks every active job for the
// next pass. A live worker's renewal clears its mark in between. The script
// itself guards against running more than once per StalledInterval across all
// workers, so calling it from every worker is safe.
func (c *Consumer) RecoverStalled(ctx context.Context) ([]string, error) {
	result, err := c.eval(ctx, c.moveStalled, []string{
		c.keys.stalled(),
		c.keys.wait(),
		c.keys.active(),
		c.keys.stalledCheck(),
		c.keys.meta(),
		c.keys.paused(),
		c.keys.marker(),
		c.keys.events(),
		c.keys.repeat(),
	}, c.settings.MaxStalledCount, c.keys.prefix(), nowMillis(), c.settings.StalledInterval.Milliseconds())
	if err != nil {
		return nil, fmt.Errorf("recover stalled jobs on %s: %w", c.queueName, err)
	}

	raw, _ := result.([]any)
	recovered := make([]string, 0, len(raw))
	for _, entry := range raw {
		if id, ok := entry.(string); ok {
			recovered = append(recovered, id)
		}
	}
	return recovered, nil
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
		"lockDuration": c.settings.LockDuration.Milliseconds(),
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
	// Absent or unparseable opts are not fatal: they only drive retention and
	// retries, and defaulting to "keep, no retry" loses nothing already graded.
	if rawOpts, hasOpts := hash["opts"]; hasOpts {
		_ = json.Unmarshal([]byte(rawOpts), &job.opts)
	}
	if atm, err := strconv.Atoi(hash["atm"]); err == nil {
		job.AttemptsMade = atm
	}
	job.DeferredFailure = hash["defa"]
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

// Fail applies the job's retry policy to a failure, as BullMQ's own
// Job.moveToFailed does.
//
// With attempts left the job is moved to delayed (when its backoff yields a
// delay) or straight back to wait; only once attempts are exhausted, or the
// cause wraps ErrUnrecoverable, does it land in the failed set. Finishing to
// failed unconditionally would ignore the `attempts: 3` the producer sets on
// every formal submission and strand the Submission row in QUEUED.
func (c *Consumer) Fail(ctx context.Context, job *Job, cause error) (FailOutcome, error) {
	reason := cause.Error()
	attempt := job.AttemptsMade + 1

	if errors.Is(cause, ErrUnrecoverable) || attempt >= job.opts.Attempts {
		return FailOutcome{}, c.finish(ctx, job, "failed", "failedReason", reason)
	}

	// BullMQ records the reason on the job even when it is retried, so tooling
	// shows why an attempt was spent.
	fields, err := msgpack.Marshal([]string{"failedReason", reason})
	if err != nil {
		return FailOutcome{}, fmt.Errorf("pack failed job fields: %w", err)
	}

	delay := retryDelay(job.opts.Backoff, attempt)
	var result any
	if delay > 0 {
		// skipAttempt "0" counts this attempt. fetchNext "0" for the same
		// backpressure reason as in finish, which leaves the trailing opts unread.
		result, err = c.eval(ctx, c.moveToDelayed, []string{
			c.keys.marker(),
			c.keys.active(),
			c.keys.prioritized(),
			c.keys.delayed(),
			c.keys.job(job.ID),
			c.keys.events(),
			c.keys.meta(),
			c.keys.stalled(),
			c.keys.wait(),
			c.keys.limiter(),
			c.keys.paused(),
			c.keys.priorityCounter(),
		}, c.keys.prefix(), nowMillis(), job.ID, job.Token, delay.Milliseconds(), "0", fields, "0", "")
	} else {
		pushCmd := "LPUSH"
		if job.opts.LIFO {
			pushCmd = "RPUSH"
		}
		result, err = c.eval(ctx, c.retryJob, []string{
			c.keys.active(),
			c.keys.wait(),
			c.keys.paused(),
			c.keys.job(job.ID),
			c.keys.meta(),
			c.keys.events(),
			c.keys.delayed(),
			c.keys.prioritized(),
			c.keys.priorityCounter(),
			c.keys.marker(),
			c.keys.stalled(),
		}, c.keys.prefix(), nowMillis(), pushCmd, job.ID, job.Token, fields)
	}
	if err != nil {
		return FailOutcome{}, fmt.Errorf("retry job %s on %s: %w", job.ID, c.queueName, err)
	}
	if code, ok := result.(int64); ok && code < 0 {
		return FailOutcome{}, fmt.Errorf("retry rejected job %s: %s", job.ID, finishError(code))
	}
	return FailOutcome{Retrying: true, Delay: delay}, nil
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
		"lockDuration": c.settings.LockDuration.Milliseconds(),
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
