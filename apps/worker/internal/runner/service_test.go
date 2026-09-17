package runner

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/queue"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/report"
)

// newCallback records how many results reached it and answers with status.
func newCallback(t *testing.T, status int) (*httptest.Server, *atomic.Int64) {
	t.Helper()
	var hits atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(status)
	}))
	t.Cleanup(server.Close)
	return server, &hits
}

// newServiceWithoutDocker builds a Service whose runner never reaches the
// sandbox: every job below names a language with no registry entry, which the
// runner turns into SYSTEM_ERROR before it would open a container.
func newServiceWithoutDocker(callbackURL string) *Service {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewService(New(nil, logger), report.New(callbackURL, logger), logger, nil)
}

func queueJob(t *testing.T, kind contract.Kind) *queue.Job {
	t.Helper()
	submissionID := "submission-1"
	payload, err := json.Marshal(contract.Job{
		ContractVersion: contract.Version,
		JobID:           "job-1",
		Kind:            kind,
		SubmissionID:    &submissionID,
		Language:        contract.Language("cobol"),
		SourceCode:      "DISPLAY 'HI'.",
		Limits: contract.Limits{
			CompileTimeoutMs: 1, RunTimeoutMs: 1, WallTimeoutMs: 1,
			MemoryLimitMb: 1, MaxOutputBytes: 1, MaxProcesses: 1,
		},
		TestCases:     []contract.TestCase{},
		CallbackToken: "token",
	})
	if err != nil {
		t.Fatalf("marshal job: %v", err)
	}
	return &queue.Job{ID: "job-1", Queue: "execution-submit", Data: payload}
}

// A job interrupted by shutdown must not report: ingest treats the first
// terminal result as final, so a report here would grade the submission on the
// worker's lifecycle and ignore the real result a retry later produces.
func TestProcessDoesNotReportAnInterruptedJob(t *testing.T) {
	callback, hits := newCallback(t, http.StatusOK)
	service := newServiceWithoutDocker(callback.URL)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := service.Process(ctx, queueJob(t, contract.KindSubmit))

	if err == nil {
		t.Fatal("an interrupted job must return an error so the pool hands it back")
	}
	if errors.Is(err, queue.ErrUnrecoverable) {
		t.Fatal("an interruption is not a reason to give up on the job")
	}
	if hits.Load() != 0 {
		t.Fatalf("the interrupted job reported %d result(s)", hits.Load())
	}
}

// A 4xx means the payload shape is wrong. Retrying sends the same payload, so
// the job must skip its retries rather than spend them.
func TestProcessMarksARejectedResultUnrecoverable(t *testing.T) {
	callback, hits := newCallback(t, http.StatusBadRequest)
	service := newServiceWithoutDocker(callback.URL)

	err := service.Process(context.Background(), queueJob(t, contract.KindSubmit))

	if !errors.Is(err, queue.ErrUnrecoverable) {
		t.Fatalf("error = %v, want it marked unrecoverable", err)
	}
	if hits.Load() != 1 {
		t.Fatalf("callback hit %d times, want exactly 1 with no retry on 4xx", hits.Load())
	}
}

func TestProcessCompletesWhenTheResultIsDelivered(t *testing.T) {
	callback, hits := newCallback(t, http.StatusOK)
	service := newServiceWithoutDocker(callback.URL)

	if err := service.Process(context.Background(), queueJob(t, contract.KindSubmit)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if hits.Load() != 1 {
		t.Fatalf("callback hit %d times, want 1", hits.Load())
	}
}

// A job the stalled check gave up on is not run again, but the Coder still
// hears about it: failing the queue job silently would leave the Submission
// QUEUED forever.
func TestProcessReportsAnAbandonedJobAndFailsItWithoutRunning(t *testing.T) {
	var received atomic.Value
	var hits atomic.Int64
	callback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		var result contract.Result
		_ = json.NewDecoder(r.Body).Decode(&result)
		received.Store(result)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(callback.Close)
	service := newServiceWithoutDocker(callback.URL)

	job := queueJob(t, contract.KindSubmit)
	job.DeferredFailure = "job stalled more than allowable limit"

	err := service.Process(context.Background(), job)

	if !errors.Is(err, queue.ErrUnrecoverable) {
		t.Fatalf("error = %v, want the abandoned job failed without retries", err)
	}
	if hits.Load() != 1 {
		t.Fatalf("callback hit %d times, want 1", hits.Load())
	}
	result, _ := received.Load().(contract.Result)
	if result.Status != contract.StatusSystemError || result.SystemError == nil {
		t.Fatalf("reported %+v, want SYSTEM_ERROR with a reason", result)
	}
	if strings.Contains(*result.SystemError, "stalled more than allowable limit") {
		t.Fatal("BullMQ's internal failure reason leaked into the Coder-visible message")
	}
}

// flakySender fails its first failures sends, then delivers.
type flakySender struct {
	failures int
	sends    atomic.Int64
}

func (f *flakySender) Send(context.Context, contract.Result, string) error {
	if int(f.sends.Add(1)) <= f.failures {
		return errors.New("post result: connection refused")
	}
	return nil
}

// parsedJob passes contract validation and still never reaches a container:
// its language has no registry entry, which the runner reports as SYSTEM_ERROR.
func parsedJob(t *testing.T, kind contract.Kind) *queue.Job {
	t.Helper()
	job := queueJob(t, kind)
	var payload map[string]any
	if err := json.Unmarshal(job.Data, &payload); err != nil {
		t.Fatalf("unmarshal job: %v", err)
	}
	payload["testScripts"] = []any{}
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal job: %v", err)
	}
	if _, err := contract.ParseJob(data); err != nil {
		t.Fatalf("the fixture must parse: %v", err)
	}
	job.Data = data
	return job
}

func newServiceWithSender(sender resultSender) *Service {
	service := newServiceWithoutDocker("http://unused.invalid")
	service.reporter = sender
	service.holdBackoff = time.Millisecond
	return service
}

// An LMS outage longer than the queue's retry budget must not fail a graded
// submission for good: its result is held and delivered when the LMS returns.
func TestProcessHoldsASubmissionResultUntilTheLMSAcceptsIt(t *testing.T) {
	sender := &flakySender{failures: 4}
	service := newServiceWithSender(sender)
	job := parsedJob(t, contract.KindSubmit)
	job.EnqueuedAt = time.Now()

	if err := service.Process(context.Background(), job); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sender.sends.Load() != 5 {
		t.Fatalf("sent %d times, want 4 failed rounds then a delivery", sender.sends.Load())
	}
}

// Past its callback token's lifetime the LMS would refuse the result, so
// holding it longer only ties up a slot.
func TestProcessStopsHoldingOnceTheCallbackTokenHasExpired(t *testing.T) {
	sender := &flakySender{failures: 1 << 30}
	service := newServiceWithSender(sender)
	job := parsedJob(t, contract.KindSubmit)
	job.EnqueuedAt = time.Now().Add(-callbackTokenTTL - time.Minute)

	err := service.Process(context.Background(), job)

	if err == nil {
		t.Fatal("a result that can no longer be delivered must fail the job")
	}
	if errors.Is(err, queue.ErrUnrecoverable) || errors.Is(err, queue.ErrRequeue) {
		t.Fatalf("error = %v, want an ordinary failure left to the retry policy", err)
	}
	if sender.sends.Load() != 1 {
		t.Fatalf("sent %d times after the token expired, want 1", sender.sends.Load())
	}
}

// A run is not worth holding a slot for: the Coder can press Run again.
func TestProcessDropsARunResultAfterOneFailedRound(t *testing.T) {
	sender := &flakySender{failures: 1 << 30}
	service := newServiceWithSender(sender)

	if err := service.Process(context.Background(), parsedJob(t, contract.KindRun)); err != nil {
		t.Fatalf("a dropped run result must complete the job, got %v", err)
	}
	if sender.sends.Load() != 1 {
		t.Fatalf("sent %d times, want 1", sender.sends.Load())
	}
}

// Shutdown must not wait out an LMS outage; the job goes back to be rerun.
func TestProcessStopsHoldingWhenTheWorkerShutsDown(t *testing.T) {
	sender := &flakySender{failures: 1 << 30}
	service := newServiceWithSender(sender)
	service.holdBackoff = time.Hour

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- service.Process(ctx, parsedJob(t, contract.KindSubmit)) }()

	deadline := time.Now().Add(5 * time.Second)
	for sender.sends.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	cancel()

	select {
	case err := <-done:
		if err == nil || errors.Is(err, queue.ErrUnrecoverable) {
			t.Fatalf("error = %v, want an interruption the pool hands back", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Process kept holding the result after shutdown began")
	}
}

// With the daemon gone, a SYSTEM_ERROR describes the outage, not the program:
// nothing is reported and the job is handed back to wait for Docker.
func TestProcessRequeuesWhenTheDockerDaemonIsUnreachable(t *testing.T) {
	callback, hits := newCallback(t, http.StatusOK)
	service := newServiceWithoutDocker(callback.URL)
	service.sandboxReachable = func(context.Context) error { return errors.New("cannot connect to the docker daemon") }

	err := service.Process(context.Background(), parsedJob(t, contract.KindSubmit))

	if !errors.Is(err, queue.ErrRequeue) {
		t.Fatalf("error = %v, want the job requeued", err)
	}
	if hits.Load() != 0 {
		t.Fatalf("reported %d result(s) for a job the outage prevented", hits.Load())
	}
}

func TestHoldWaitDoublesAndIsCapped(t *testing.T) {
	for round, want := range map[int]time.Duration{
		1: time.Second, 2: 2 * time.Second, 3: 4 * time.Second, 6: holdBackoffMax, 40: holdBackoffMax,
	} {
		if got := holdWait(time.Second, round); got != want {
			t.Errorf("holdWait(round %d) = %s, want %s", round, got, want)
		}
	}
}

// A payload with no identity to report under can never succeed on retry.
func TestProcessMarksAnUnreportablePayloadUnrecoverable(t *testing.T) {
	callback, hits := newCallback(t, http.StatusOK)
	service := newServiceWithoutDocker(callback.URL)

	err := service.Process(context.Background(),
		&queue.Job{ID: "job-1", Queue: "execution-submit", Data: []byte(`{"not":"a job"}`)})

	if !errors.Is(err, queue.ErrUnrecoverable) {
		t.Fatalf("error = %v, want it marked unrecoverable", err)
	}
	if hits.Load() != 0 {
		t.Fatalf("callback hit %d times with no identity to report under", hits.Load())
	}
}
