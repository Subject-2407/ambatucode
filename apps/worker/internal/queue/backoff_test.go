package queue

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

// The delays must match BullMQ's Backoffs.calculate, or a job retried by this
// worker is scheduled differently from one retried by a Node worker.
func TestRetryDelayMirrorsBullMQStrategies(t *testing.T) {
	cases := []struct {
		name         string
		raw          string
		attemptsMade int
		want         time.Duration
	}{
		{"no backoff retries immediately", "", 1, 0},
		{"null backoff retries immediately", "null", 1, 0},
		{"a bare number is a fixed delay", "1500", 3, 1500 * time.Millisecond},
		{"fixed ignores the attempt count", `{"type":"fixed","delay":700}`, 2, 700 * time.Millisecond},
		// The producer's SUBMIT policy: exponential from 2s.
		{"exponential first retry", `{"type":"exponential","delay":2000}`, 1, 2 * time.Second},
		{"exponential second retry", `{"type":"exponential","delay":2000}`, 2, 4 * time.Second},
		{"exponential third retry", `{"type":"exponential","delay":2000}`, 3, 8 * time.Second},
		{"a custom strategy retries immediately", `{"type":"custom","delay":2000}`, 1, 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := retryDelay([]byte(tc.raw), tc.attemptsMade); got != tc.want {
				t.Fatalf("delay = %s, want %s", got, tc.want)
			}
		})
	}
}

func TestRetryDelayJitterStaysWithinItsBand(t *testing.T) {
	raw := []byte(`{"type":"exponential","delay":1000,"jitter":0.5}`)
	for i := 0; i < 200; i++ {
		// Third attempt: a 4s ceiling, and jitter 0.5 keeps it at or above 2s.
		got := retryDelay(raw, 3)
		if got < 2*time.Second || got > 4*time.Second {
			t.Fatalf("jittered delay %s outside [2s, 4s]", got)
		}
	}
}

func TestUnrecoverableIsDetectableAndKeepsItsCause(t *testing.T) {
	cause := errors.New("callback rejected")
	wrapped := fmt.Errorf("deliver: %w", Unrecoverable(cause))

	if !errors.Is(wrapped, ErrUnrecoverable) {
		t.Fatal("a wrapped unrecoverable error was not detected")
	}
	if !errors.Is(wrapped, cause) {
		t.Fatal("the original cause was lost")
	}
	if errors.Is(cause, ErrUnrecoverable) {
		t.Fatal("an ordinary error must not read as unrecoverable")
	}
}

func TestRequeueIsDetectableAndDistinctFromUnrecoverable(t *testing.T) {
	cause := errors.New("docker daemon unreachable")
	wrapped := fmt.Errorf("run job: %w", Requeue(cause))

	if !errors.Is(wrapped, ErrRequeue) {
		t.Fatal("a wrapped requeue was not detected")
	}
	if !errors.Is(wrapped, cause) {
		t.Fatal("the original cause was lost")
	}
	if errors.Is(wrapped, ErrUnrecoverable) {
		t.Fatal("a requeue must never read as unrecoverable")
	}
}
