package pool

import (
	"context"
	"io"
	"log/slog"
	"strings"
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

// A panicking job must become a failed job, never a dead worker. Recovery
// happens at the pool boundary so the guarantee lives in one place.
func TestProcessGuardedTurnsAPanicIntoAnError(t *testing.T) {
	processor := &stubProcessor{fn: func(context.Context, *queue.Job) error {
		panic("participant code broke the runner")
	}}
	p := New(nil, nil, processor, 1, 1, discardLogger())

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
	p := New(nil, nil, processor, 1, 1, discardLogger())

	if err := p.processGuarded(context.Background(), &queue.Job{ID: "job-1"}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if processor.calls.Load() != 1 {
		t.Fatalf("processor called %d times, want 1", processor.calls.Load())
	}
}

// Every goroutine takes the root context and exits on cancellation; a worker
// that outlived its context would keep holding jobs through shutdown.
func TestRunStopsEveryGoroutineOnCancellation(t *testing.T) {
	processor := &stubProcessor{fn: func(context.Context, *queue.Job) error { return nil }}
	// No consumers: the loop takes a container slot, finds nothing to claim,
	// releases it, and waits — which is the path that has to notice the
	// cancellation.
	p := New(nil, nil, processor, 4, 4, discardLogger())

	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		p.Run(ctx)
		close(stopped)
	}()

	cancel()

	select {
	case <-stopped:
	case <-time.After(10 * time.Second):
		t.Fatal("Run did not return after its context was cancelled")
	}
}

// The semaphore, not the goroutine count, is what bounds containers. Reporting
// saturation lets the health endpoint distinguish "busy" from "wedged".
func TestSaturationTracksTheContainerSemaphore(t *testing.T) {
	p := New(nil, nil, &stubProcessor{}, 2, 2, discardLogger())

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

// ReleaseInFlight is what keeps a shutdown from stranding claimed jobs in the
// active list until BullMQ's stalled check eventually rescues them.
func TestReleaseInFlightIsSafeWithNothingRunning(t *testing.T) {
	p := New(nil, nil, &stubProcessor{}, 1, 1, discardLogger())

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
