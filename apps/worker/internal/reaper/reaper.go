// Package reaper removes sandbox containers that outlived their job.
//
// Every job removes its own container on every path out, including panic and
// timeout, and the startup sweep clears whatever a crashed worker left. The
// reaper covers the gap between the two: a removal that failed while the
// worker kept running — a daemon hiccup, a context that expired mid-call —
// would otherwise leak a container until the next restart.
//
// There are no host workspace directories to reap alongside them. Source and
// test files are streamed into a tmpfs inside the container and never touch
// the host filesystem, so removing the container removes the workspace.
package reaper

import (
	"context"
	"log/slog"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/sandbox"
)

const (
	// Interval is how often the reaper looks.
	Interval = 30 * time.Second
	// grace is how long past its deadline a container is left alone. The
	// deadline already covers the job's whole wall clock plus the keeper's
	// margin; this absorbs clock skew between the worker and the daemon.
	grace = 30 * time.Second
	// fallbackMaxAge bounds a container with no readable deadline label, which
	// only a worker version predating the label would have created.
	fallbackMaxAge = time.Hour
)

// Docker is the part of the sandbox the reaper needs.
type Docker interface {
	ListManaged(ctx context.Context) ([]sandbox.Managed, error)
	Remove(ctx context.Context, id string) error
}

type Reaper struct {
	docker Docker
	logger *slog.Logger
	now    func() time.Time
}

func New(docker Docker, logger *slog.Logger) *Reaper {
	return &Reaper{docker: docker, logger: logger, now: time.Now}
}

// Run reaps on every Interval until ctx is cancelled.
func (r *Reaper) Run(ctx context.Context) {
	ticker := time.NewTicker(Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.Reap(ctx)
		}
	}
}

// Reap removes every managed container past its deadline and returns how many
// it removed.
//
// It never touches a container whose deadline is still ahead, so it is safe
// while jobs are running — and safe when several workers share one daemon,
// where a label-only sweep would destroy another worker's live containers.
func (r *Reaper) Reap(ctx context.Context) int {
	managed, err := r.docker.ListManaged(ctx)
	if err != nil {
		if ctx.Err() == nil {
			r.logger.Warn("reaper could not list containers", slog.String("error", err.Error()))
		}
		return 0
	}

	now := r.now()
	removed := 0
	for _, entry := range managed {
		if !r.expired(entry, now) {
			continue
		}
		if err := r.docker.Remove(ctx, entry.ID); err != nil {
			r.logger.Error("reaper could not remove an expired container",
				slog.String("containerId", entry.ID),
				slog.String("jobId", entry.JobID),
				slog.String("error", err.Error()))
			continue
		}
		// A reaped container is a cleanup the job's own defer missed. Worth a
		// warning every time: a steady trickle means something upstream leaks.
		r.logger.Warn("reaped a container that outlived its job",
			slog.String("containerId", entry.ID),
			slog.String("jobId", entry.JobID))
		removed++
	}
	return removed
}

func (r *Reaper) expired(entry sandbox.Managed, now time.Time) bool {
	if entry.Deadline.IsZero() {
		return now.Sub(entry.Created) > fallbackMaxAge
	}
	return now.After(entry.Deadline.Add(grace))
}
