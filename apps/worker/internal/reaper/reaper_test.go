package reaper

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sort"
	"testing"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/sandbox"
)

type fakeDocker struct {
	containers []sandbox.Managed
	listErr    error
	removeErr  map[string]error
	removed    []string
}

func (f *fakeDocker) ListManaged(context.Context) ([]sandbox.Managed, error) {
	return f.containers, f.listErr
}

func (f *fakeDocker) Remove(_ context.Context, id string) error {
	if err := f.removeErr[id]; err != nil {
		return err
	}
	f.removed = append(f.removed, id)
	return nil
}

func newTestReaper(docker Docker, now time.Time) *Reaper {
	r := New(docker, slog.New(slog.NewTextHandler(io.Discard, nil)))
	r.now = func() time.Time { return now }
	return r
}

func TestReapRemovesOnlyContainersPastTheirDeadline(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	docker := &fakeDocker{containers: []sandbox.Managed{
		// Running job: deadline ahead. Must survive.
		{ID: "live", Created: now.Add(-10 * time.Second), Deadline: now.Add(time.Minute)},
		// Just past its deadline but inside the grace window. Must survive.
		{ID: "grace", Created: now.Add(-2 * time.Minute), Deadline: now.Add(-10 * time.Second)},
		// Well past deadline plus grace. Reaped.
		{ID: "leaked", Created: now.Add(-5 * time.Minute), Deadline: now.Add(-2 * time.Minute)},
		// No deadline label, young. Must survive.
		{ID: "unlabelled-young", Created: now.Add(-10 * time.Minute)},
		// No deadline label, past the fallback age. Reaped.
		{ID: "unlabelled-old", Created: now.Add(-2 * time.Hour)},
	}}

	removed := newTestReaper(docker, now).Reap(context.Background())

	sort.Strings(docker.removed)
	want := []string{"leaked", "unlabelled-old"}
	if removed != 2 || len(docker.removed) != 2 ||
		docker.removed[0] != want[0] || docker.removed[1] != want[1] {
		t.Fatalf("removed %d: %v, want %v", removed, docker.removed, want)
	}
}

// One stuck container must not stop the rest being reaped.
func TestReapContinuesPastAFailedRemoval(t *testing.T) {
	now := time.Now()
	expired := now.Add(-time.Hour)
	docker := &fakeDocker{
		containers: []sandbox.Managed{
			{ID: "stuck", Created: expired, Deadline: expired},
			{ID: "fine", Created: expired, Deadline: expired},
		},
		removeErr: map[string]error{"stuck": errors.New("device or resource busy")},
	}

	removed := newTestReaper(docker, now).Reap(context.Background())

	if removed != 1 || len(docker.removed) != 1 || docker.removed[0] != "fine" {
		t.Fatalf("removed %d: %v, want only [fine]", removed, docker.removed)
	}
}

func TestReapSurvivesAnUnreachableDaemon(t *testing.T) {
	docker := &fakeDocker{listErr: errors.New("daemon unreachable")}

	if removed := newTestReaper(docker, time.Now()).Reap(context.Background()); removed != 0 {
		t.Fatalf("removed %d with no container list", removed)
	}
}

func TestRunStopsWhenItsContextIsCancelled(t *testing.T) {
	r := newTestReaper(&fakeDocker{}, time.Now())
	ctx, cancel := context.WithCancel(context.Background())

	stopped := make(chan struct{})
	go func() {
		r.Run(ctx)
		close(stopped)
	}()
	cancel()

	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not stop after cancellation")
	}
}
