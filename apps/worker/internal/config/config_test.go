package config

import (
	"strings"
	"testing"
)

func TestLoadAppliesDefaults(t *testing.T) {
	t.Setenv("REDIS_URL", "")
	t.Setenv("EXECUTION_CALLBACK_URL", "")
	t.Setenv("WORKER_CONCURRENCY", "")
	t.Setenv("WORKER_MAX_CONTAINERS", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.QueuePrefix != defaultQueuePrefix {
		t.Fatalf("queue prefix = %q, want %q", cfg.QueuePrefix, defaultQueuePrefix)
	}
	if cfg.Concurrency < 1 || cfg.Concurrency > 16 {
		t.Fatalf("default concurrency %d outside the documented bound", cfg.Concurrency)
	}
	if cfg.MaxContainers != cfg.Concurrency {
		t.Fatalf("containers default %d should match concurrency %d", cfg.MaxContainers, cfg.Concurrency)
	}
}

// Container slots nothing can claim are dead capacity that hides a
// misconfiguration behind apparently healthy behaviour.
func TestLoadRejectsMoreContainersThanGoroutines(t *testing.T) {
	t.Setenv("WORKER_CONCURRENCY", "2")
	t.Setenv("WORKER_MAX_CONTAINERS", "8")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "WORKER_MAX_CONTAINERS") {
		t.Fatalf("expected a container/concurrency mismatch error, got %v", err)
	}
}

func TestLoadRejectsRelativeCallbackURL(t *testing.T) {
	t.Setenv("EXECUTION_CALLBACK_URL", "/api/internal/execution/result")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "EXECUTION_CALLBACK_URL") {
		t.Fatalf("expected an absolute-URL error, got %v", err)
	}
}

func TestLoadRejectsNonNumericConcurrency(t *testing.T) {
	t.Setenv("WORKER_CONCURRENCY", "plenty")

	if _, err := Load(); err == nil {
		t.Fatal("expected an error for a non-numeric concurrency")
	}
}

func TestLoadRejectsZeroConcurrency(t *testing.T) {
	t.Setenv("WORKER_CONCURRENCY", "0")
	t.Setenv("WORKER_MAX_CONTAINERS", "0")

	if _, err := Load(); err == nil {
		t.Fatal("expected an error for zero concurrency")
	}
}

func TestLoadRejectsUnknownLogLevel(t *testing.T) {
	t.Setenv("WORKER_LOG_LEVEL", "chatty")

	if _, err := Load(); err == nil {
		t.Fatal("expected an error for an unknown log level")
	}
}

func TestLoadRejectsAnUnusablyShortLockDuration(t *testing.T) {
	t.Setenv("WORKER_LOCK_DURATION_MS", "100")

	if _, err := Load(); err == nil {
		t.Fatal("expected an error for a sub-second lock duration")
	}
}
