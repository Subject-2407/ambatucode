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

	concurrency int
	active      atomic.Int64

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
		containers:  make(chan struct{}, opts.MaxContainers),
		runSlots:    make(chan struct{}, runCapacity),
		concurrency: opts.Concurrency,
		inFlight:    make(map[*queue.Job]Queue),
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

	err := p.processGuarded(ctx, job)

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

	if err := lane.Complete(finishCtx, job, ""); err != nil {
		// The result already reached the LMS, so this is a bookkeeping loss
		// rather than a grading one. Ingest is idempotent, so a redelivery is
		// harmless.
		p.logger.Error("marking job complete did not stick",
			slog.String("jobId", job.ID),
			slog.String("error", err.Error()))
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
