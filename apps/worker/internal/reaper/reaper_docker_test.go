//go:build docker

// Integration test for the reaper against a real Docker daemon.
//
//	docker compose -f docker/compose/sandbox.yml build
//	go test -tags docker -p 1 ./...
package reaper

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/sandbox"
)

const testImage = "ambatucode/sandbox-python:3.12"

// A container whose job never cleaned it up is found by its labels and
// removed once past its deadline — and left alone while its job may still run.
func TestReaperRemovesAnAbandonedContainerOnlyAfterItsDeadline(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	box, err := sandbox.New(logger, nil)
	if err != nil {
		t.Fatalf("connect to docker: %v", err)
	}
	defer box.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := box.Ping(ctx); err != nil {
		t.Skipf("docker daemon is not reachable: %v", err)
	}
	if err := box.EnsureImages(ctx, []string{testImage}); err != nil {
		t.Skipf("sandbox image is not built: %v", err)
	}

	// Opened and deliberately never closed: the leak the reaper exists for.
	session, err := box.Open(ctx, sandbox.SessionSpec{
		JobID:          "reaper-integration",
		Image:          testImage,
		WallTimeout:    5 * time.Second,
		MemoryLimitMb:  64,
		MaxProcesses:   16,
		MaxOutputBytes: 1024,
	})
	if err != nil {
		t.Fatalf("open session: %v", err)
	}
	t.Cleanup(session.Close)

	exists := func() bool {
		managed, err := box.ListManaged(ctx)
		if err != nil {
			t.Fatalf("list managed: %v", err)
		}
		for _, entry := range managed {
			if entry.ID == session.ContainerID() {
				if entry.Deadline.IsZero() {
					t.Fatal("the container carries no readable deadline label")
				}
				return true
			}
		}
		return false
	}

	r := New(box, logger)
	r.Reap(ctx)
	if !exists() {
		t.Fatal("the reaper removed a container whose job could still be running")
	}

	// Jump past the deadline rather than sleeping out the keeper's margin.
	r.now = func() time.Time { return time.Now().Add(10 * time.Minute) }
	r.Reap(ctx)
	if exists() {
		t.Fatal("the reaper left an expired container behind")
	}
}
