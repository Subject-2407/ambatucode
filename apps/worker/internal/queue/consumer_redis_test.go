//go:build redis

// Integration tests for retries, lock renewal, and stalled recovery against a
// real Redis, running the vendored BullMQ scripts rather than asserting on
// argument lists.
//
// Opt-in, like the Docker-tagged tests, because a plain `go test ./...` must
// not need infrastructure:
//
//	docker compose -f docker/compose/dev.yml up -d
//	go test -tags redis ./internal/queue/
//
// Every test works under a random key prefix and deletes it afterwards, so it
// never touches the `bull:` keys a running dev stack is using. REDIS_URL
// overrides the default localhost address.
package queue

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

const testQueue = "execution-submit"

type redisFixture struct {
	client   *redis.Client
	prefix   string
	consumer *Consumer
	keys     keys
}

func newRedisFixture(t *testing.T) *redisFixture {
	t.Helper()
	url := os.Getenv("REDIS_URL")
	if url == "" {
		url = "redis://localhost:6379"
	}
	options, err := redis.ParseURL(url)
	if err != nil {
		t.Fatalf("parse REDIS_URL: %v", err)
	}
	client := redis.NewClient(options)
	t.Cleanup(func() { _ = client.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Skipf("redis is not reachable: %v", err)
	}

	suffix := make([]byte, 6)
	_, _ = rand.Read(suffix)
	prefix := "ambatucode-test-" + hex.EncodeToString(suffix)

	consumer, err := NewConsumer(client, prefix, testQueue, "redis-test", Settings{
		LockDuration:    30 * time.Second,
		StalledInterval: 30 * time.Second,
		MaxStalledCount: 1,
	})
	if err != nil {
		t.Fatalf("new consumer: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		iter := client.Scan(cleanupCtx, 0, prefix+":*", 500).Iterator()
		for iter.Next(cleanupCtx) {
			client.Del(cleanupCtx, iter.Val())
		}
	})

	return &redisFixture{client: client, prefix: prefix, consumer: consumer, keys: newKeys(prefix, testQueue)}
}

// add writes a job the way BullMQ's addStandardJob leaves it: a hash, an entry
// on the wait list, and a marker so workers wake.
func (f *redisFixture) add(t *testing.T, jobID, opts string) {
	t.Helper()
	ctx := context.Background()
	err := f.client.HSet(ctx, f.keys.job(jobID),
		"name", testQueue,
		"data", `{}`,
		"opts", opts,
		"timestamp", strconv.FormatInt(time.Now().UnixMilli(), 10),
		"delay", "0",
		"priority", "0",
	).Err()
	if err != nil {
		t.Fatalf("write job hash: %v", err)
	}
	if err := f.client.LPush(ctx, f.keys.wait(), jobID).Err(); err != nil {
		t.Fatalf("push to wait: %v", err)
	}
	if err := f.client.ZAdd(ctx, f.keys.marker(), redis.Z{Score: 0, Member: "0"}).Err(); err != nil {
		t.Fatalf("add marker: %v", err)
	}
}

func (f *redisFixture) claim(t *testing.T, wantID string) *Job {
	t.Helper()
	job, err := f.consumer.Claim(context.Background())
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if job.ID != wantID {
		t.Fatalf("claimed %q, want %q", job.ID, wantID)
	}
	return job
}

// makeDelayedDue rewinds a delayed job's score so the next claim promotes it,
// instead of the test sleeping out a real backoff.
func (f *redisFixture) makeDelayedDue(t *testing.T, jobID string) {
	t.Helper()
	if err := f.client.ZAdd(context.Background(), f.keys.delayed(),
		redis.Z{Score: 0, Member: jobID}).Err(); err != nil {
		t.Fatalf("rewind delayed job: %v", err)
	}
}

func (f *redisFixture) attemptsMade(t *testing.T, jobID string) int {
	t.Helper()
	raw, err := f.client.HGet(context.Background(), f.keys.job(jobID), "atm").Result()
	if err != nil {
		t.Fatalf("read atm: %v", err)
	}
	value, _ := strconv.Atoi(raw)
	return value
}

func (f *redisFixture) inSortedSet(t *testing.T, key, member string) bool {
	t.Helper()
	err := f.client.ZScore(context.Background(), key, member).Err()
	if errors.Is(err, redis.Nil) {
		return false
	}
	if err != nil {
		t.Fatalf("zscore %s: %v", key, err)
	}
	return true
}

// The producer's SUBMIT policy — three attempts, exponential backoff from 2s —
// must be honoured end to end: two delayed retries, then the failed set.
func TestFailRetriesASubmissionThroughItsBackoffThenGivesUp(t *testing.T) {
	f := newRedisFixture(t)
	ctx := context.Background()
	f.add(t, "sub-1", `{"attempts":3,"backoff":{"type":"exponential","delay":2000},"removeOnFail":false}`)

	cause := errors.New("callback unreachable")

	for attempt, wantDelay := range []time.Duration{2 * time.Second, 4 * time.Second} {
		job := f.claim(t, "sub-1")
		if job.AttemptsMade != attempt {
			t.Fatalf("attempt %d: AttemptsMade = %d", attempt+1, job.AttemptsMade)
		}

		outcome, err := f.consumer.Fail(ctx, job, cause)
		if err != nil {
			t.Fatalf("attempt %d: fail: %v", attempt+1, err)
		}
		if !outcome.Retrying || outcome.Delay != wantDelay {
			t.Fatalf("attempt %d: outcome %+v, want a retry after %s", attempt+1, outcome, wantDelay)
		}
		if !f.inSortedSet(t, f.keys.delayed(), "sub-1") {
			t.Fatalf("attempt %d: job is not in the delayed set", attempt+1)
		}
		if f.inSortedSet(t, f.keys.failed(), "sub-1") {
			t.Fatalf("attempt %d: job reached the failed set with attempts left", attempt+1)
		}
		if got := f.attemptsMade(t, "sub-1"); got != attempt+1 {
			t.Fatalf("attempt %d: atm = %d", attempt+1, got)
		}
		reason, _ := f.client.HGet(ctx, f.keys.job("sub-1"), "failedReason").Result()
		if reason != cause.Error() {
			t.Fatalf("attempt %d: failedReason = %q", attempt+1, reason)
		}
		f.makeDelayedDue(t, "sub-1")
	}

	last := f.claim(t, "sub-1")
	outcome, err := f.consumer.Fail(ctx, last, cause)
	if err != nil {
		t.Fatalf("final fail: %v", err)
	}
	if outcome.Retrying {
		t.Fatal("the third attempt must not be retried")
	}
	if !f.inSortedSet(t, f.keys.failed(), "sub-1") {
		t.Fatal("exhausted job is not in the failed set")
	}
	if got := f.attemptsMade(t, "sub-1"); got != 3 {
		t.Fatalf("atm = %d, want 3", got)
	}
}

// With no backoff the retry goes straight back to wait, via retryJob.
func TestFailWithoutBackoffRequeuesImmediately(t *testing.T) {
	f := newRedisFixture(t)
	f.add(t, "sub-2", `{"attempts":2}`)

	job := f.claim(t, "sub-2")
	outcome, err := f.consumer.Fail(context.Background(), job, errors.New("boom"))
	if err != nil {
		t.Fatalf("fail: %v", err)
	}
	if !outcome.Retrying || outcome.Delay != 0 {
		t.Fatalf("outcome %+v, want an immediate retry", outcome)
	}

	again := f.claim(t, "sub-2")
	if again.AttemptsMade != 1 {
		t.Fatalf("AttemptsMade = %d on the retry, want 1", again.AttemptsMade)
	}
}

// A contract rejection spends no retries: it would fail identically each time.
func TestFailSkipsRetriesForAnUnrecoverableCause(t *testing.T) {
	f := newRedisFixture(t)
	f.add(t, "sub-3", `{"attempts":3,"backoff":{"type":"exponential","delay":2000}}`)

	job := f.claim(t, "sub-3")
	outcome, err := f.consumer.Fail(context.Background(), job, Unrecoverable(errors.New("rejected")))
	if err != nil {
		t.Fatalf("fail: %v", err)
	}
	if outcome.Retrying {
		t.Fatal("an unrecoverable failure was retried")
	}
	if !f.inSortedSet(t, f.keys.failed(), "sub-3") {
		t.Fatal("unrecoverable job is not in the failed set")
	}
}

// runStalledCheck runs one pass of the stalled check. The script refuses to run
// twice inside StalledInterval across the whole queue, so the guard key is
// cleared first to let a test drive consecutive passes.
func (f *redisFixture) runStalledCheck(t *testing.T) []string {
	t.Helper()
	ctx := context.Background()
	if err := f.client.Del(ctx, f.keys.stalledCheck()).Err(); err != nil {
		t.Fatalf("clear stalled-check guard: %v", err)
	}
	recovered, err := f.consumer.RecoverStalled(ctx)
	if err != nil {
		t.Fatalf("recover stalled: %v", err)
	}
	return recovered
}

// dropLock simulates a worker that died: its lock simply expires.
func (f *redisFixture) dropLock(t *testing.T, jobID string) {
	t.Helper()
	if err := f.client.Del(context.Background(), f.keys.lock(jobID)).Err(); err != nil {
		t.Fatalf("drop lock: %v", err)
	}
}

func (f *redisFixture) inList(t *testing.T, key, member string) bool {
	t.Helper()
	members, err := f.client.LRange(context.Background(), key, 0, -1).Result()
	if err != nil {
		t.Fatalf("lrange %s: %v", key, err)
	}
	for _, candidate := range members {
		if candidate == member {
			return true
		}
	}
	return false
}

// A renewing worker keeps its job through any number of stalled checks.
func TestExtendedLockSurvivesTheStalledCheck(t *testing.T) {
	f := newRedisFixture(t)
	f.add(t, "long-1", `{"attempts":3}`)
	job := f.claim(t, "long-1")

	for pass := 0; pass < 3; pass++ {
		if recovered := f.runStalledCheck(t); len(recovered) != 0 {
			t.Fatalf("pass %d recovered %v from a live worker", pass, recovered)
		}
		extended, err := f.consumer.ExtendLock(context.Background(), job)
		if err != nil || !extended {
			t.Fatalf("pass %d: extend = %v, %v", pass, extended, err)
		}
	}
	if !f.inList(t, f.keys.active(), "long-1") {
		t.Fatal("a renewed job left the active list")
	}

	ttl, err := f.client.PTTL(context.Background(), f.keys.lock("long-1")).Result()
	if err != nil || ttl <= 0 {
		t.Fatalf("lock TTL = %v, %v; renewal did not set an expiry", ttl, err)
	}
}

// A dead worker's job goes back to wait after two passes: marked, then moved.
func TestStalledCheckRecoversAJobWhoseWorkerDied(t *testing.T) {
	f := newRedisFixture(t)
	f.add(t, "orphan-1", `{"attempts":3}`)
	job := f.claim(t, "orphan-1")

	if recovered := f.runStalledCheck(t); len(recovered) != 0 {
		t.Fatalf("first pass only marks, but recovered %v", recovered)
	}
	f.dropLock(t, "orphan-1")

	recovered := f.runStalledCheck(t)
	if len(recovered) != 1 || recovered[0] != "orphan-1" {
		t.Fatalf("recovered %v, want [orphan-1]", recovered)
	}
	if !f.inList(t, f.keys.wait(), "orphan-1") || f.inList(t, f.keys.active(), "orphan-1") {
		t.Fatal("recovered job is not back on the wait list")
	}

	// The dead worker's lock is gone, so renewing it must report the loss.
	extended, err := f.consumer.ExtendLock(context.Background(), job)
	if err != nil || extended {
		t.Fatalf("extend on a reclaimed job = %v, %v; want false", extended, err)
	}

	again := f.claim(t, "orphan-1")
	if again.DeferredFailure != "" {
		t.Fatalf("a first stall must not defer failure, got %q", again.DeferredFailure)
	}
}

// Past MaxStalledCount the job is still moved back, but marked so whoever
// claims it fails it instead of running it again.
func TestRepeatedStallsDeferFailureToTheNextClaim(t *testing.T) {
	f := newRedisFixture(t)
	f.add(t, "poison-1", `{"attempts":3}`)

	for stall := 1; stall <= 2; stall++ {
		f.claim(t, "poison-1")
		f.runStalledCheck(t)
		f.dropLock(t, "poison-1")
		if recovered := f.runStalledCheck(t); len(recovered) != 1 {
			t.Fatalf("stall %d: recovered %v", stall, recovered)
		}
	}

	job := f.claim(t, "poison-1")
	if job.DeferredFailure == "" {
		t.Fatal("a job stalled past the limit was not marked for failure")
	}
}

// A worker that reported and then died before completing leaves a mark the
// redelivered claim can see.
func TestProcessedMarkSurvivesRedelivery(t *testing.T) {
	f := newRedisFixture(t)
	f.add(t, "done-1", `{"attempts":3}`)

	job := f.claim(t, "done-1")
	if job.ProcessedAt != "" {
		t.Fatalf("a fresh job already carries a processed mark: %q", job.ProcessedAt)
	}
	if err := f.consumer.MarkProcessed(context.Background(), job); err != nil {
		t.Fatalf("mark processed: %v", err)
	}

	// The worker dies before Complete.
	f.runStalledCheck(t)
	f.dropLock(t, "done-1")
	f.runStalledCheck(t)

	redelivered := f.claim(t, "done-1")
	if redelivered.ProcessedAt == "" {
		t.Fatal("the redelivered job lost its processed mark")
	}
	if err := f.consumer.Complete(context.Background(), redelivered, ""); err != nil {
		t.Fatalf("complete the redelivered job: %v", err)
	}
	if !f.inSortedSet(t, f.keys.completed(), "done-1") {
		t.Fatal("the redelivered job did not complete")
	}
}

// Marking a job that was removed meanwhile must not resurrect its hash.
func TestMarkProcessedDoesNotRecreateARemovedJob(t *testing.T) {
	f := newRedisFixture(t)
	ghost := &Job{ID: "removed-1", Queue: testQueue}

	if err := f.consumer.MarkProcessed(context.Background(), ghost); err != nil {
		t.Fatalf("mark processed: %v", err)
	}
	exists, err := f.client.Exists(context.Background(), f.keys.job("removed-1")).Result()
	if err != nil {
		t.Fatalf("exists: %v", err)
	}
	if exists != 0 {
		t.Fatal("marking a removed job recreated its hash")
	}
}

// A run job has a single attempt, so one failure is final.
func TestFailOnASingleAttemptJobIsFinal(t *testing.T) {
	f := newRedisFixture(t)
	f.add(t, "run-1", `{"attempts":1,"removeOnFail":{"age":300}}`)

	job := f.claim(t, "run-1")
	outcome, err := f.consumer.Fail(context.Background(), job, errors.New("boom"))
	if err != nil {
		t.Fatalf("fail: %v", err)
	}
	if outcome.Retrying {
		t.Fatal("a single-attempt job was retried")
	}
}
