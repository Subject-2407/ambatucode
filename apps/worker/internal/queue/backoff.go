package queue

import (
	"encoding/json"
	"errors"
	"math"
	"math/rand/v2"
	"time"
)

// ErrUnrecoverable marks a failure that no retry can fix. Wrap it into the
// error handed to Fail and the job goes straight to the failed set, the same
// way BullMQ treats an UnrecoverableError thrown from a Node processor.
var ErrUnrecoverable = errors.New("unrecoverable")

// Unrecoverable wraps cause so Fail skips the retry policy.
func Unrecoverable(cause error) error {
	return &unrecoverableError{cause: cause}
}

type unrecoverableError struct{ cause error }

func (e *unrecoverableError) Error() string        { return e.cause.Error() }
func (e *unrecoverableError) Unwrap() error        { return e.cause }
func (e *unrecoverableError) Is(target error) bool { return target == ErrUnrecoverable }

// ErrRequeue marks a job that could not run because something the worker
// depends on is unavailable — not because of anything in the job. Such a job
// is handed back to its wait list untouched: it spends no attempt, since no
// attempt was made, and nothing is reported for it.
var ErrRequeue = errors.New("requeue")

// Requeue wraps cause so the pool releases the job instead of failing it.
func Requeue(cause error) error {
	return &requeueError{cause: cause}
}

type requeueError struct{ cause error }

func (e *requeueError) Error() string        { return e.cause.Error() }
func (e *requeueError) Unwrap() error        { return e.cause }
func (e *requeueError) Is(target error) bool { return target == ErrRequeue }

// backoff is BullMQ's normalized backoff option.
type backoff struct {
	Type   string  `json:"type"`
	Delay  float64 `json:"delay"`
	Jitter float64 `json:"jitter"`
}

// retryDelay mirrors BullMQ's Backoffs.calculate for the built-in strategies.
//
// attemptsMade is the count *including* the attempt that just failed, which is
// what BullMQ passes. A zero result means "retry immediately".
//
// An unknown strategy type is a custom strategy registered on some Node
// worker, which this worker cannot run. BullMQ would throw and leave the job
// to the stalled check; retrying immediately instead is the direction that
// never strands a formal submission.
func retryDelay(raw json.RawMessage, attemptsMade int) time.Duration {
	if len(raw) == 0 || string(raw) == "null" {
		return 0
	}

	var spec backoff
	var fixed float64
	if err := json.Unmarshal(raw, &fixed); err == nil {
		spec = backoff{Type: "fixed", Delay: fixed}
	} else if err := json.Unmarshal(raw, &spec); err != nil {
		return 0
	}

	var ms float64
	switch spec.Type {
	case "fixed":
		ms = spec.Delay
		if spec.Jitter > 0 {
			ms = math.Floor(rand.Float64()*spec.Delay*spec.Jitter + spec.Delay*(1-spec.Jitter))
		}
	case "exponential":
		ceiling := math.Round(math.Pow(2, float64(attemptsMade-1)) * spec.Delay)
		ms = ceiling
		if spec.Jitter > 0 {
			ms = math.Floor(rand.Float64()*ceiling*spec.Jitter + ceiling*(1-spec.Jitter))
		}
	default:
		return 0
	}

	if ms <= 0 {
		return 0
	}
	return time.Duration(ms) * time.Millisecond
}
