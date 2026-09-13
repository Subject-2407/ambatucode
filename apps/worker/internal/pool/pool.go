// Package pool runs the worker's goroutines and decides when work is claimed.
package pool

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/queue"
)

// awaitTimeout bounds a blocking wait so shutdown is never more than this far
// away, even on a queue that has been idle for hours.
const awaitTimeout = 5 * time.Second

// Processor executes one claimed job. A non-nil error fails the BullMQ job so
// its retry policy applies; nil completes it.
type Processor interface {
	Process(ctx context.Context, job *queue.Job) error
}

// Queue is the part of a BullMQ consumer the pool drives. *queue.Consumer is
// the only production implementation; the interface exists so claim order,
// capacity, and shutdown behaviour can be tested without Redis.
type Queue interface {
	QueueName() string
	MarkerKey() string
	Claim(ctx context.Context) (*queue.Job, error)
	Complete(ctx context.Context, job *queue.Job, returnValue string) error
	Fail(ctx context.Context, job *queue.Job, cause error) (queue.FailOutcome, error)
	Release(ctx context.Context, job *queue.Job) error
	ExtendLock(ctx context.Context, job *queue.Job) (bool, error)
	RecoverStalled(ctx context.Context) ([]string, error)
	MarkProcessed(ctx context.Context, job *queue.Job) error
}

type Options struct {
	// Concurrency is the number of goroutines.
	Concurrency int
	// MaxContainers caps concurrently running containers independently of the
	// goroutine count, because a container costs far more than a goroutine.
	MaxContainers int
	// ReservedForSubmit is how many container slots practice runs may never
	// occupy. Claim order alone does not protect submissions: once every slot
	// holds a long run, a submission waits behind all of them.
	ReservedForSubmit int
	// LockRenewInterval is how often a running job's lock is extended. It must
	// be well inside the lock duration; BullMQ uses half of it.
	LockRenewInterval time.Duration
	// StalledInterval is how often jobs abandoned by a dead worker are moved
	// back to their wait list.
	StalledInterval time.Duration
}

type Pool struct {
	submit    Queue
	run       Queue
	processor Processor
	logger    *slog.Logger

	// await sleeps until a queue marker fires or the timeout passes.
	await func(ctx context.Context, markers []string) error

	containers chan struct{}
	// runSlots holds the container slots runs are allowed; its capacity is
	// MaxContainers minus the submission reserve.
	runSlots chan struct{}

	concurrency       int
	lockRenewInterval time.Duration
	stalledInterval   time.Duration
	active            atomic.Int64

	// inFlight tracks claimed-but-unfinished jobs so shutdown can hand back any
	// whose goroutine never returned.
	inFlightMu sync.Mutex
	inFlight   map[*queue.Job]Queue
}

// New builds a pool. Either queue may be nil, which leaves that lane empty.
func New(
	client redis.UniversalClient,
	submit, run Queue,
	processor Processor,
	opts Options,
	logger *slog.Logger,
) *Pool {
	runCapacity := opts.MaxContainers - opts.ReservedForSubmit
	if runCapacity < 0 {
		runCapacity = 0
	}
	return &Pool{
		submit:    submit,
		run:       run,
		processor: processor,
		logger:    logger,
		await: func(ctx context.Context, markers []string) error {
			return queue.AwaitAny(ctx, client, awaitTimeout, markers...)
		},
		containers:        make(chan struct{}, opts.MaxContainers),
		runSlots:          make(chan struct{}, runCapacity),
		concurrency:       opts.Concurrency,
		lockRenewInterval: opts.LockRenewInterval,
		stalledInterval:   opts.StalledInterval,
		inFlight:          make(map[*queue.Job]Queue),
	}
}

// ActiveJobs reports how many jobs are executing right now.
func (p *Pool) ActiveJobs() int64 { return p.active.Load() }

// Saturated reports whether every container slot is taken.
func (p *Pool) Saturated() bool { return len(p.containers) == cap(p.containers) }

// Run blocks until accept is cancelled and every goroutine has stopped.
//
// Two contexts because shutdown has two stages. Cancelling accept stops new
// claims while in-flight jobs keep running; cancelling work interrupts those
// jobs, which are then handed back to their wait list rather than reported.
// A single context would make every SIGTERM kill running submissions at once.
func (p *Pool) Run(accept, work context.Context) {
	var wg sync.WaitGroup
	if p.stalledInterval > 0 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p.recoverStalledLoop(accept)
		}()
	}
	for i := 0; i < p.concurrency; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			p.loop(accept, work, index)
		}(i)
	}
	wg.Wait()
}

func (p *Pool) loop(accept, work context.Context, index int) {
	markers := make([]string, 0, 2)
	for _, lane := range []Queue{p.submit, p.run} {
		if lane != nil {
			markers = append(markers, lane.MarkerKey())
		}
	}

	for {
		if accept.Err() != nil {
			return
		}

		// Take a container slot before touching Redis. Claiming first would
		// mean holding a locked job we have no capacity to start, which is
		// exactly the backpressure failure the design forbids.
		select {
		case p.containers <- struct{}{}:
		case <-accept.Done():
			return
		}

		lane, job, heldRunSlot := p.claim(accept)
		if job == nil {
			<-p.containers
			if accept.Err() != nil {
				return
			}
			// Nothing to do: sleep on the markers rather than spinning.
			if err := p.await(accept, markers); err != nil && accept.Err() == nil {
				p.logger.Warn("await queues failed",
					slog.Int("worker", index),
					slog.String("error", err.Error()))
			}
			continue
		}

		p.execute(work, lane, job)
		if heldRunSlot {
			<-p.runSlots
		}
		<-p.containers
	}
}

// claim takes a submission if one is waiting, and otherwise a run if the run
// lane has a slot left. The third return reports whether a run slot is held.
func (p *Pool) claim(ctx context.Context) (Queue, *queue.Job, bool) {
	if job := p.claimFrom(ctx, p.submit); job != nil {
		return p.submit, job, false
	}
	if p.run == nil {
		return nil, nil, false
	}

	select {
	case p.runSlots <- struct{}{}:
	default:
		// Every slot runs may use is taken; the rest are held for submissions.
		return nil, nil, false
	}
	if job := p.claimFrom(ctx, p.run); job != nil {
		return p.run, job, true
	}
	<-p.runSlots
	return nil, nil, false
}

func (p *Pool) claimFrom(ctx context.Context, lane Queue) *queue.Job {
	if lane == nil {
		return nil
	}
	job, err := lane.Claim(ctx)
	if err != nil {
		if !errors.Is(err, queue.ErrNoJob) && ctx.Err() == nil {
			p.logger.Error("claim failed",
				slog.String("queue", lane.QueueName()),
				slog.String("error", err.Error()))
		}
		return nil
	}
	return job
}

func (p *Pool) execute(ctx context.Context, lane Queue, job *queue.Job) {
	p.active.Add(1)
	p.track(job, lane)
	defer func() {
		p.untrack(job)
		p.active.Add(-1)
	}()

	if job.ProcessedAt != "" {
		p.completeProcessed(ctx, lane, job)
		return
	}

	renewCtx, stopRenewing := context.WithCancel(ctx)
	renewed := make(chan struct{})
	go func() {
		defer close(renewed)
		p.keepLocked(renewCtx, lane, job)
	}()

	err := p.processGuarded(ctx, job)

	// Stop renewing before finishing: a renewal racing the finish script could
	// recreate the lock the finish just removed.
	stopRenewing()
	<-renewed

	// Finish against a context that outlives cancellation. The work is done;
	// failing to record that would hand the job to another worker to redo.
	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()

	if err != nil && ctx.Err() != nil {
		// Interrupted by shutdown. This is not an attempt the job made, so it
		// goes back to waiting untouched instead of spending a retry.
		if releaseErr := lane.Release(finishCtx, job); releaseErr != nil {
			p.logger.Error("returning interrupted job to the wait list failed",
				slog.String("jobId", job.ID),
				slog.String("queue", job.Queue),
				slog.String("error", releaseErr.Error()))
			return
		}
		p.logger.Info("returned interrupted job to the wait list",
			slog.String("jobId", job.ID),
			slog.String("queue", job.Queue))
		return
	}

	if err != nil {
		outcome, failErr := lane.Fail(finishCtx, job, err)
		if failErr != nil {
			p.logger.Error("marking job failed did not stick",
				slog.String("jobId", job.ID),
				slog.String("error", failErr.Error()))
			return
		}
		p.logger.Error("job failed",
			slog.String("jobId", job.ID),
			slog.String("queue", job.Queue),
			slog.Bool("retrying", outcome.Retrying),
			slog.Duration("retryDelay", outcome.Delay),
			slog.String("error", err.Error()))
		return
	}

	// Recorded before Complete, so a worker dying between the two leaves a job
	// the next claim completes rather than reruns.
	if err := lane.MarkProcessed(finishCtx, job); err != nil {
		p.logger.Warn("recording the job as processed failed; a redelivery would rerun it",
			slog.String("jobId", job.ID),
			slog.String("error", err.Error()))
	}

	if err := lane.Complete(finishCtx, job, ""); err != nil {
		// The result already reached the LMS, so this is a bookkeeping loss
		// rather than a grading one. The processed mark keeps a redelivery
		// from rerunning it, and ingest is idempotent if the mark was lost too.
		p.logger.Error("marking job complete did not stick",
			slog.String("jobId", job.ID),
			slog.String("error", err.Error()))
	}
}

// completeProcessed finishes a redelivered job whose result already went out.
//
// Rerunning it would be the duplicate that idempotent reprocessing forbids:
// the program could land on a different verdict the second time — a timing-
// sensitive case passing where it had failed — and a Run would push a second
// result to a Coder who already has one.
func (p *Pool) completeProcessed(ctx context.Context, lane Queue, job *queue.Job) {
	p.logger.Info("job was already processed; completing without rerunning",
		slog.String("jobId", job.ID),
		slog.String("queue", job.Queue),
		slog.String("processedAt", job.ProcessedAt))

	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	if err := lane.Complete(finishCtx, job, ""); err != nil {
		p.logger.Error("completing an already-processed job did not stick",
			slog.String("jobId", job.ID),
			slog.String("error", err.Error()))
	}
}

// keepLocked extends a running job's lock until ctx is cancelled.
//
// Without it a job that runs longer than the lock duration — a slow compile, a
// submission with many cases — loses its lock mid-run: the stalled check hands
// it to another worker, the submission is graded twice, and this worker's own
// finish is refused.
func (p *Pool) keepLocked(ctx context.Context, lane Queue, job *queue.Job) {
	if p.lockRenewInterval <= 0 {
		return
	}
	ticker := time.NewTicker(p.lockRenewInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		extended, err := lane.ExtendLock(ctx, job)
		switch {
		case err != nil && ctx.Err() == nil:
			// Transient: the next tick tries again while the lock still holds.
			p.logger.Warn("lock renewal failed",
				slog.String("jobId", job.ID),
				slog.String("queue", job.Queue),
				slog.String("error", err.Error()))
		case err == nil && !extended:
			// Not retried: the lock is gone and cannot be won back, so the job
			// may already be running elsewhere. Ingest is idempotent, which is
			// what keeps a duplicate from doing harm.
			p.logger.Error("lock lost while the job was running; it may be processed twice",
				slog.String("jobId", job.ID),
				slog.String("queue", job.Queue))
			return
		}
	}
}

// recoverStalledLoop periodically returns jobs abandoned by a dead worker to
// their wait lists. It is the only thing that rescues a job whose worker was
// killed outright: nothing else ever moves it out of the active list.
func (p *Pool) recoverStalledLoop(ctx context.Context) {
	recoverAll := func() {
		for _, lane := range []Queue{p.submit, p.run} {
			if lane == nil {
				continue
			}
			recovered, err := lane.RecoverStalled(ctx)
			if err != nil {
				if ctx.Err() == nil {
					p.logger.Warn("stalled job check failed",
						slog.String("queue", lane.QueueName()),
						slog.String("error", err.Error()))
				}
				continue
			}
			for _, jobID := range recovered {
				p.logger.Warn("recovered a stalled job from a dead worker",
					slog.String("jobId", jobID),
					slog.String("queue", lane.QueueName()))
			}
		}
	}

	// Once at startup: a worker restarting after a crash is exactly when there
	// are stalled jobs, and the first mark-and-recover cycle takes two passes.
	recoverAll()

	ticker := time.NewTicker(p.stalledInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			recoverAll()
		}
	}
}

// processGuarded recovers from a panic in the job path.
//
// A panic becomes a failed job, never a dead worker. Recovering here rather
// than inside the processor keeps the guarantee in one place, at the boundary
// the design names.
func (p *Pool) processGuarded(ctx context.Context, job *queue.Job) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			p.logger.Error("panic in job path",
				slog.String("jobId", job.ID),
				slog.Any("panic", recovered))
			err = fmt.Errorf("worker panicked while processing job %s: %v", job.ID, recovered)
		}
	}()
	return p.processor.Process(ctx, job)
}

func (p *Pool) track(job *queue.Job, lane Queue) {
	p.inFlightMu.Lock()
	defer p.inFlightMu.Unlock()
	p.inFlight[job] = lane
}

func (p *Pool) untrack(job *queue.Job) {
	p.inFlightMu.Lock()
	defer p.inFlightMu.Unlock()
	delete(p.inFlight, job)
}

// ReleaseInFlight hands every still-tracked job back to its wait list.
//
// An interrupted job normally releases itself when its goroutine returns, so
// this only finds jobs whose goroutine is still stuck after the work context
// was cancelled. Without it those jobs sit in the active list until BullMQ's
// stalled check notices, which delays a formal submission far longer than a
// redelivery would.
func (p *Pool) ReleaseInFlight(ctx context.Context) {
	p.inFlightMu.Lock()
	pending := make(map[*queue.Job]Queue, len(p.inFlight))
	for job, lane := range p.inFlight {
		pending[job] = lane
	}
	p.inFlightMu.Unlock()

	for job, lane := range pending {
		if err := lane.Release(ctx, job); err != nil {
			p.logger.Error("returning job to the wait list failed",
				slog.String("jobId", job.ID),
				slog.String("error", err.Error()))
			continue
		}
		p.logger.Info("returned unfinished job to the wait list",
			slog.String("jobId", job.ID),
			slog.String("queue", job.Queue))
	}
}
