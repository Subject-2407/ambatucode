package pool

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/queue"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

type stubProcessor struct {
	calls atomic.Int64
	fn    func(ctx context.Context, job *queue.Job) error
}

func (s *stubProcessor) Process(ctx context.Context, job *queue.Job) error {
	s.calls.Add(1)
	return s.fn(ctx, job)
}

// fakeQueue stands in for a BullMQ consumer and records how each job finished.
type fakeQueue struct {
	name string

	mu        sync.Mutex
	pending   []*queue.Job
	completed []string
	failed    map[string]error
	released  []string
	processed []string

	markedAfterComplete bool

	extensions      atomic.Int64
	lockLost        atomic.Bool
	stalledChecks   atomic.Int64
	extensionsAfter atomic.Int64 // extensions seen after the job finished
	finished        atomic.Bool
}

func newFakeQueue(name string) *fakeQueue {
	return &fakeQueue{name: name, failed: map[string]error{}}
}

func (q *fakeQueue) push(ids ...string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, id := range ids {
		q.pending = append(q.pending, &queue.Job{ID: id, Queue: q.name})
	}
}

func (q *fakeQueue) QueueName() string { return q.name }
func (q *fakeQueue) MarkerKey() string { return q.name + ":marker" }

func (q *fakeQueue) Claim(context.Context) (*queue.Job, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.pending) == 0 {
		return nil, queue.ErrNoJob
	}
	job := q.pending[0]
	q.pending = q.pending[1:]
	return job, nil
}

func (q *fakeQueue) Complete(_ context.Context, job *queue.Job, _ string) error {
	q.finished.Store(true)
	q.mu.Lock()
	defer q.mu.Unlock()
	q.completed = append(q.completed, job.ID)
	return nil
}

func (q *fakeQueue) ExtendLock(context.Context, *queue.Job) (bool, error) {
	q.extensions.Add(1)
	if q.finished.Load() {
		q.extensionsAfter.Add(1)
	}
	return !q.lockLost.Load(), nil
}

func (q *fakeQueue) MarkProcessed(_ context.Context, job *queue.Job) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.processed = append(q.processed, job.ID)
	// The mark has to land before Complete for a crash in between to be safe.
	if len(q.completed) > 0 && q.completed[len(q.completed)-1] == job.ID {
		q.markedAfterComplete = true
	}
	return nil
}

func (q *fakeQueue) RecoverStalled(context.Context) ([]string, error) {
	q.stalledChecks.Add(1)
	return nil, nil
}

func (q *fakeQueue) Fail(_ context.Context, job *queue.Job, cause error) (queue.FailOutcome, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.failed[job.ID] = cause
	return queue.FailOutcome{Retrying: true}, nil
}

func (q *fakeQueue) Release(_ context.Context, job *queue.Job) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.released = append(q.released, job.ID)
	return nil
}

func (q *fakeQueue) snapshot() (completed []string, failed map[string]error, released []string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	failedCopy := make(map[string]error, len(q.failed))
	for id, cause := range q.failed {
		failedCopy[id] = cause
	}
	return append([]string(nil), q.completed...), failedCopy, append([]string(nil), q.released...)
}

// newTestPool builds a pool whose idle wait is a short sleep instead of a
// blocking pop on Redis.
func newTestPool(submit, run Queue, processor Processor, opts Options) *Pool {
	p := New(nil, submit, run, processor, opts, discardLogger())
	p.await = func(ctx context.Context, _ []string) error {
		select {
		case <-ctx.Done():
		case <-time.After(5 * time.Millisecond):
		}
		return nil
	}
	return p
}

// start runs the pool and returns a function that waits for Run to return.
func start(p *Pool, accept, work context.Context) (wait func(t *testing.T)) {
	stopped := make(chan struct{})
	go func() {
		p.Run(accept, work)
		close(stopped)
	}()
	return func(t *testing.T) {
		t.Helper()
		select {
		case <-stopped:
		case <-time.After(10 * time.Second):
			t.Fatal("Run did not return")
		}
	}
}

func eventually(t *testing.T, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// A panicking job must become a failed job, never a dead worker. Recovery
// happens at the pool boundary so the guarantee lives in one place.
func TestProcessGuardedTurnsAPanicIntoAnError(t *testing.T) {
	processor := &stubProcessor{fn: func(context.Context, *queue.Job) error {
		panic("participant code broke the runner")
	}}
	p := newTestPool(nil, nil, processor, Options{Concurrency: 1, MaxContainers: 1})

	err := p.processGuarded(context.Background(), &queue.Job{ID: "job-1"})

	if err == nil {
		t.Fatal("expected the panic to be surfaced as an error")
	}
	if !strings.Contains(err.Error(), "panicked") || !strings.Contains(err.Error(), "job-1") {
		t.Fatalf("error should name the panic and the job, got %q", err)
	}
}

func TestProcessGuardedPassesThroughOrdinaryResults(t *testing.T) {
	processor := &stubProcessor{fn: func(context.Context, *queue.Job) error { return nil }}
	p := newTestPool(nil, nil, processor, Options{Concurrency: 1, MaxContainers: 1})

	if err := p.processGuarded(context.Background(), &queue.Job{ID: "job-1"}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if processor.calls.Load() != 1 {
		t.Fatalf("processor called %d times, want 1", processor.calls.Load())
	}
}

// Cancelling accept stops every goroutine; a worker that outlived it would keep
// claiming jobs through shutdown.
func TestRunStopsEveryGoroutineWhenAcceptIsCancelled(t *testing.T) {
	processor := &stubProcessor{fn: func(context.Context, *queue.Job) error { return nil }}
	p := newTestPool(newFakeQueue("submit"), newFakeQueue("run"), processor,
		Options{Concurrency: 4, MaxContainers: 4, ReservedForSubmit: 1})

	accept, stopAccepting := context.WithCancel(context.Background())
	wait := start(p, accept, context.Background())

	stopAccepting()
	wait(t)
}

// The semaphore, not the goroutine count, is what bounds containers. Reporting
// saturation lets the health endpoint distinguish "busy" from "wedged".
func TestSaturationTracksTheContainerSemaphore(t *testing.T) {
	p := newTestPool(nil, nil, &stubProcessor{}, Options{Concurrency: 2, MaxContainers: 2})

	if p.Saturated() {
		t.Fatal("a fresh pool must not report saturation")
	}
	if p.ActiveJobs() != 0 {
		t.Fatalf("active jobs = %d, want 0", p.ActiveJobs())
	}

	p.containers <- struct{}{}
	if p.Saturated() {
		t.Fatal("one of two slots taken is not saturated")
	}
	p.containers <- struct{}{}
	if !p.Saturated() {
		t.Fatal("both slots taken should report saturated")
	}

	<-p.containers
	if p.Saturated() {
		t.Fatal("releasing a slot should clear saturation")
	}
}

// Claim order alone lets long practice runs fill every slot. The reserve keeps
// capacity free so a submission starts while the runs are still going.
func TestRunsNeverTakeTheSlotsReservedForSubmissions(t *testing.T) {
	submit := newFakeQueue("submit")
	run := newFakeQueue("run")
	run.push("run-1", "run-2", "run-3", "run-4", "run-5")

	unblockRuns := make(chan struct{})
	var runningRuns, peakRuns atomic.Int64
	var submissionDone atomic.Bool

	processor := &stubProcessor{fn: func(ctx context.Context, job *queue.Job) error {
		if job.Queue == "submit" {
			submissionDone.Store(true)
			return nil
		}
		current := runningRuns.Add(1)
		defer runningRuns.Add(-1)
		for {
			peak := peakRuns.Load()
			if current <= peak || peakRuns.CompareAndSwap(peak, current) {
				break
			}
		}
		<-unblockRuns
		return nil
	}}

	p := newTestPool(submit, run, processor,
		Options{Concurrency: 3, MaxContainers: 3, ReservedForSubmit: 1})
	accept, stopAccepting := context.WithCancel(context.Background())
	wait := start(p, accept, context.Background())

	eventually(t, "two runs to start", func() bool { return runningRuns.Load() == 2 })
	// Give an idle goroutine every chance to wrongly take a third run.
	time.Sleep(50 * time.Millisecond)
	if peak := peakRuns.Load(); peak != 2 {
		t.Fatalf("%d runs held containers at once, want 2 with one slot reserved", peak)
	}

	submit.push("submission-1")
	eventually(t, "the submission to be processed while runs hold their slots",
		submissionDone.Load)

	close(unblockRuns)
	stopAccepting()
	wait(t)
}

// SIGTERM stops new claims but lets a running submission finish and report.
func TestShutdownLetsARunningJobFinish(t *testing.T) {
	submit := newFakeQueue("submit")
	submit.push("submission-1")

	started := make(chan struct{})
	processor := &stubProcessor{fn: func(ctx context.Context, _ *queue.Job) error {
		close(started)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
			return nil
		}
	}}

	p := newTestPool(submit, nil, processor, Options{Concurrency: 1, MaxContainers: 1})
	accept, stopAccepting := context.WithCancel(context.Background())
	wait := start(p, accept, context.Background())

	<-started
	stopAccepting()
	wait(t)

	completed, failed, released := submit.snapshot()
	if len(completed) != 1 || len(failed) != 0 || len(released) != 0 {
		t.Fatalf("completed=%v failed=%v released=%v; want the job completed",
			completed, failed, released)
	}
}

// Past the grace period a job is interrupted. That is not an attempt it made:
// it goes back to waiting instead of spending a retry or being reported.
func TestInterruptedJobIsReleasedNotFailed(t *testing.T) {
	submit := newFakeQueue("submit")
	submit.push("submission-1")

	started := make(chan struct{})
	processor := &stubProcessor{fn: func(ctx context.Context, _ *queue.Job) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}}

	p := newTestPool(submit, nil, processor, Options{Concurrency: 1, MaxContainers: 1})
	accept, stopAccepting := context.WithCancel(context.Background())
	work, interrupt := context.WithCancel(context.Background())
	wait := start(p, accept, work)

	<-started
	stopAccepting()
	interrupt()
	wait(t)

	completed, failed, released := submit.snapshot()
	if len(released) != 1 || len(failed) != 0 || len(completed) != 0 {
		t.Fatalf("completed=%v failed=%v released=%v; want the job released",
			completed, failed, released)
	}
	if p.ActiveJobs() != 0 {
		t.Fatalf("active jobs = %d after shutdown", p.ActiveJobs())
	}
}

// An ordinary failure goes through the queue's retry policy with its cause.
func TestFailedJobIsHandedToTheRetryPolicy(t *testing.T) {
	submit := newFakeQueue("submit")
	submit.push("submission-1")

	cause := errors.New("callback unreachable")
	processed := make(chan struct{})
	processor := &stubProcessor{fn: func(context.Context, *queue.Job) error {
		defer close(processed)
		return cause
	}}

	p := newTestPool(submit, nil, processor, Options{Concurrency: 1, MaxContainers: 1})
	accept, stopAccepting := context.WithCancel(context.Background())
	wait := start(p, accept, context.Background())

	<-processed
	eventually(t, "the failure to be recorded", func() bool {
		_, failed, _ := submit.snapshot()
		return len(failed) == 1
	})
	stopAccepting()
	wait(t)

	_, failed, released := submit.snapshot()
	if !errors.Is(failed["submission-1"], cause) {
		t.Fatalf("Fail got cause %v, want %v", failed["submission-1"], cause)
	}
	if len(released) != 0 {
		t.Fatalf("a failed job was released: %v", released)
	}
}

// A job outliving the lock duration must keep its lock, or the stalled check
// hands it to another worker and the submission is graded twice. Renewal must
// also stop before the finish, or it could recreate the lock the finish removed.
func TestRunningJobKeepsItsLockAndStopsRenewingWhenDone(t *testing.T) {
	submit := newFakeQueue("submit")
	submit.push("slow-compile")

	processor := &stubProcessor{fn: func(context.Context, *queue.Job) error {
		time.Sleep(120 * time.Millisecond)
		return nil
	}}

	p := newTestPool(submit, nil, processor,
		Options{Concurrency: 1, MaxContainers: 1, LockRenewInterval: 20 * time.Millisecond})
	accept, stopAccepting := context.WithCancel(context.Background())
	wait := start(p, accept, context.Background())

	eventually(t, "the job to complete", submit.finished.Load)
	time.Sleep(60 * time.Millisecond)
	stopAccepting()
	wait(t)

	if got := submit.extensions.Load(); got < 3 {
		t.Fatalf("lock extended %d times during a 120ms job at a 20ms interval", got)
	}
	if got := submit.extensionsAfter.Load(); got != 0 {
		t.Fatalf("lock extended %d times after the job finished", got)
	}
}

// A lost lock cannot be won back, so renewal gives up rather than hammering.
func TestLockRenewalStopsOnceTheLockIsLost(t *testing.T) {
	submit := newFakeQueue("submit")
	submit.lockLost.Store(true)
	submit.push("reclaimed")

	processor := &stubProcessor{fn: func(context.Context, *queue.Job) error {
		time.Sleep(150 * time.Millisecond)
		return nil
	}}

	p := newTestPool(submit, nil, processor,
		Options{Concurrency: 1, MaxContainers: 1, LockRenewInterval: 10 * time.Millisecond})
	accept, stopAccepting := context.WithCancel(context.Background())
	wait := start(p, accept, context.Background())

	eventually(t, "the job to complete", submit.finished.Load)
	stopAccepting()
	wait(t)

	if got := submit.extensions.Load(); got != 1 {
		t.Fatalf("renewal attempted %d times after the lock was lost, want 1", got)
	}
}

// The stalled check runs once immediately — a restart after a crash is when
// abandoned jobs exist — and then on its interval, on both queues.
func TestStalledCheckRunsAtStartupAndOnItsInterval(t *testing.T) {
	submit := newFakeQueue("submit")
	run := newFakeQueue("run")

	p := newTestPool(submit, run, &stubProcessor{fn: func(context.Context, *queue.Job) error { return nil }},
		Options{Concurrency: 1, MaxContainers: 2, ReservedForSubmit: 1, StalledInterval: 20 * time.Millisecond})
	accept, stopAccepting := context.WithCancel(context.Background())
	wait := start(p, accept, context.Background())

	eventually(t, "repeated stalled checks on both queues", func() bool {
		return submit.stalledChecks.Load() >= 3 && run.stalledChecks.Load() >= 3
	})
	stopAccepting()
	wait(t)
}

// A job redelivered after its result already went out is completed, not rerun.
func TestAlreadyProcessedJobIsCompletedWithoutRunning(t *testing.T) {
	submit := newFakeQueue("submit")
	submit.mu.Lock()
	submit.pending = append(submit.pending,
		&queue.Job{ID: "reported-1", Queue: "submit", ProcessedAt: "1757750400000"})
	submit.mu.Unlock()

	processor := &stubProcessor{fn: func(context.Context, *queue.Job) error {
		t.Error("an already-processed job was run again")
		return nil
	}}

	p := newTestPool(submit, nil, processor, Options{Concurrency: 1, MaxContainers: 1})
	accept, stopAccepting := context.WithCancel(context.Background())
	wait := start(p, accept, context.Background())

	eventually(t, "the job to be completed", submit.finished.Load)
	stopAccepting()
	wait(t)

	if processor.calls.Load() != 0 {
		t.Fatalf("processor called %d times", processor.calls.Load())
	}
}

// A successful job is marked processed, and before it is completed.
func TestProcessedJobIsMarkedBeforeItIsCompleted(t *testing.T) {
	submit := newFakeQueue("submit")
	submit.push("graded-1")

	processor := &stubProcessor{fn: func(context.Context, *queue.Job) error { return nil }}
	p := newTestPool(submit, nil, processor, Options{Concurrency: 1, MaxContainers: 1})
	accept, stopAccepting := context.WithCancel(context.Background())
	wait := start(p, accept, context.Background())

	eventually(t, "the job to be completed", submit.finished.Load)
	stopAccepting()
	wait(t)

	submit.mu.Lock()
	defer submit.mu.Unlock()
	if len(submit.processed) != 1 || submit.processed[0] != "graded-1" {
		t.Fatalf("processed marks = %v, want [graded-1]", submit.processed)
	}
	if submit.markedAfterComplete {
		t.Fatal("the processed mark was written after Complete")
	}
}

// A failed job is not marked: its retry must actually run.
func TestFailedJobIsNotMarkedProcessed(t *testing.T) {
	submit := newFakeQueue("submit")
	submit.push("broken-1")

	processor := &stubProcessor{fn: func(context.Context, *queue.Job) error {
		return errors.New("callback unreachable")
	}}
	p := newTestPool(submit, nil, processor, Options{Concurrency: 1, MaxContainers: 1})
	accept, stopAccepting := context.WithCancel(context.Background())
	wait := start(p, accept, context.Background())

	eventually(t, "the failure to be recorded", func() bool {
		_, failed, _ := submit.snapshot()
		return len(failed) == 1
	})
	stopAccepting()
	wait(t)

	submit.mu.Lock()
	defer submit.mu.Unlock()
	if len(submit.processed) != 0 {
		t.Fatalf("a failed job was marked processed: %v", submit.processed)
	}
}

// A job that could not run for want of Docker goes back untouched — no attempt
// spent, nothing failed — and the pool claims nothing more until Docker
// answers, rather than cycling every waiting submission through the same
// outage.
func TestRequeuedJobIsReleasedAndClaimingPausesUntilReady(t *testing.T) {
	submit := newFakeQueue("submit")
	submit.push("job-1", "job-2", "job-3")

	var dockerUp atomic.Bool
	processor := &stubProcessor{fn: func(context.Context, *queue.Job) error {
		if !dockerUp.Load() {
			return queue.Requeue(errors.New("docker daemon unreachable"))
		}
		return nil
	}}
	var probes atomic.Int64
	p := newTestPool(submit, nil, processor, Options{
		Concurrency:   1,
		MaxContainers: 1,
		Ready: func(context.Context) error {
			probes.Add(1)
			if dockerUp.Load() {
				return nil
			}
			return errors.New("docker daemon unreachable")
		},
	})
	p.readyProbeInterval = 5 * time.Millisecond

	accept, stopAccepting := context.WithCancel(context.Background())
	wait := start(p, accept, context.Background())

	eventually(t, "the first job to be released", func() bool {
		_, _, released := submit.snapshot()
		return len(released) == 1
	})
	eventually(t, "the pool to probe while paused", func() bool { return probes.Load() >= 3 })
	if !p.Paused() {
		t.Fatal("the pool is not paused after a requeue")
	}
	if calls := processor.calls.Load(); calls != 1 {
		t.Fatalf("processed %d jobs while paused, want only the one that was requeued", calls)
	}

	dockerUp.Store(true)
	eventually(t, "the remaining jobs to complete", func() bool {
		completed, _, _ := submit.snapshot()
		return len(completed) == 2
	})
	stopAccepting()
	wait(t)

	_, failed, released := submit.snapshot()
	if len(failed) != 0 {
		t.Fatalf("a requeued job was failed, spending an attempt: %v", failed)
	}
	if len(released) != 1 || released[0] != "job-1" {
		t.Fatalf("released %v, want [job-1]", released)
	}
	if p.Paused() {
		t.Fatal("the pool stayed paused after Docker returned")
	}
}

func TestReleaseInFlightIsSafeWithNothingRunning(t *testing.T) {
	p := newTestPool(nil, nil, &stubProcessor{}, Options{Concurrency: 1, MaxContainers: 1})

	done := make(chan struct{})
	go func() {
		p.ReleaseInFlight(context.Background())
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("ReleaseInFlight blocked with an empty in-flight set")
	}
}
