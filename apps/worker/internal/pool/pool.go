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
// it is retried; nil completes it.
type Processor interface {
	Process(ctx context.Context, job *queue.Job) error
}

type Pool struct {
	// consumers are polled in order, so the first is drained with priority.
	// Formal submissions come first: a flood of practice runs must never
	// starve grading.
	consumers []*queue.Consumer
	client    redis.UniversalClient
	processor Processor
	logger    *slog.Logger

	// containers caps concurrently running containers independently of the
	// goroutine count, because a container costs far more than a goroutine.
	containers chan struct{}

	concurrency int
	active      atomic.Int64

	// inFlight tracks claimed-but-unfinished jobs so shutdown can hand them
	// back rather than leaving them to the stalled check.
	inFlightMu sync.Mutex
	inFlight   map[*queue.Job]*queue.Consumer
}

func New(
	client redis.UniversalClient,
	consumers []*queue.Consumer,
	processor Processor,
	concurrency, maxContainers int,
	logger *slog.Logger,
) *Pool {
	return &Pool{
		consumers:   consumers,
		client:      client,
		processor:   processor,
		logger:      logger,
		containers:  make(chan struct{}, maxContainers),
		concurrency: concurrency,
		inFlight:    make(map[*queue.Job]*queue.Consumer),
	}
}

// ActiveJobs reports how many jobs are executing right now.
func (p *Pool) ActiveJobs() int64 { return p.active.Load() }

// Saturated reports whether every container slot is taken.
func (p *Pool) Saturated() bool { return len(p.containers) == cap(p.containers) }

// Run blocks until ctx is cancelled and every goroutine has stopped.
func (p *Pool) Run(ctx context.Context) {
	var wg sync.WaitGroup
	for i := 0; i < p.concurrency; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			p.loop(ctx, index)
		}(i)
	}
	wg.Wait()
}

func (p *Pool) loop(ctx context.Context, index int) {
	markers := make([]string, 0, len(p.consumers))
	for _, consumer := range p.consumers {
		markers = append(markers, consumer.MarkerKey())
	}

	for {
		if ctx.Err() != nil {
			return
		}

		// Take a container slot before touching Redis. Claiming first would
		// mean holding a locked job we have no capacity to start, which is
		// exactly the backpressure failure the design forbids.
		select {
		case p.containers <- struct{}{}:
		case <-ctx.Done():
			return
		}

		consumer, job := p.claim(ctx)
		if job == nil {
			<-p.containers
			if ctx.Err() != nil {
				return
			}
			// Nothing to do: sleep on the markers rather than spinning.
			if err := queue.AwaitAny(ctx, p.client, awaitTimeout, markers...); err != nil &&
				ctx.Err() == nil {
				p.logger.Warn("await queues failed",
					slog.Int("worker", index),
					slog.String("error", err.Error()))
			}
			continue
		}

		p.execute(ctx, consumer, job)
		<-p.containers
	}
}

// claim tries each queue in priority order.
func (p *Pool) claim(ctx context.Context) (*queue.Consumer, *queue.Job) {
	for _, consumer := range p.consumers {
		job, err := consumer.Claim(ctx)
		if err != nil {
			if errors.Is(err, queue.ErrNoJob) || ctx.Err() != nil {
				continue
			}
			p.logger.Error("claim failed",
				slog.String("queue", consumer.QueueName()),
				slog.String("error", err.Error()))
			continue
		}
		if job != nil {
			return consumer, job
		}
	}
	return nil, nil
}

func (p *Pool) execute(ctx context.Context, consumer *queue.Consumer, job *queue.Job) {
	p.active.Add(1)
	p.track(job, consumer)
	defer func() {
		p.untrack(job)
		p.active.Add(-1)
	}()

	err := p.processGuarded(ctx, job)

	// Finish against a context that outlives cancellation. The work is done;
	// failing to record that would hand the job to another worker to redo.
	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()

	if err != nil {
		p.logger.Error("job failed",
			slog.String("jobId", job.ID),
			slog.String("queue", job.Queue),
			slog.String("error", err.Error()))
		if failErr := consumer.Fail(finishCtx, job, err.Error()); failErr != nil {
			p.logger.Error("marking job failed did not stick",
				slog.String("jobId", job.ID),
				slog.String("error", failErr.Error()))
		}
		return
	}

	if err := consumer.Complete(finishCtx, job, ""); err != nil {
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

func (p *Pool) track(job *queue.Job, consumer *queue.Consumer) {
	p.inFlightMu.Lock()
	defer p.inFlightMu.Unlock()
	p.inFlight[job] = consumer
}

func (p *Pool) untrack(job *queue.Job) {
	p.inFlightMu.Lock()
	defer p.inFlightMu.Unlock()
	delete(p.inFlight, job)
}

// ReleaseInFlight hands every still-running job back to its wait list.
//
// Called after the shutdown grace period has elapsed. Without it those jobs
// sit in the active list until BullMQ's stalled check notices, which delays a
// formal submission by far longer than a redelivery would.
func (p *Pool) ReleaseInFlight(ctx context.Context) {
	p.inFlightMu.Lock()
	pending := make(map[*queue.Job]*queue.Consumer, len(p.inFlight))
	for job, consumer := range p.inFlight {
		pending[job] = consumer
	}
	p.inFlightMu.Unlock()

	for job, consumer := range pending {
		if err := consumer.Release(ctx, job); err != nil {
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
