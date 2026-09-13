package runner

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

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
	return NewService(New(nil, logger), report.New(callbackURL, logger), logger)
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
