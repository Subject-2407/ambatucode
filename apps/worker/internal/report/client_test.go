package report

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
)

func newTestClient(url string) *Client {
	c := New(url, slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.backoff = time.Millisecond
	return c
}

func sampleResult() contract.Result {
	submissionID := "submission-1"
	return contract.Result{
		ContractVersion: contract.Version,
		JobID:           "job-1",
		SubmissionID:    &submissionID,
		Status:          contract.StatusGraded,
		TestResults:     []contract.TestResult{},
	}
}

// statusSequence answers each request with the next status, repeating the last.
func statusSequence(t *testing.T, statuses ...int) (*httptest.Server, *atomic.Int64) {
	t.Helper()
	var hits atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		index := int(hits.Add(1)) - 1
		if index >= len(statuses) {
			index = len(statuses) - 1
		}
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(statuses[index])
	}))
	t.Cleanup(server.Close)
	return server, &hits
}

func TestSendDeliversTheResultWithTheCallbackToken(t *testing.T) {
	var gotToken, gotContentType string
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotToken = r.Header.Get(tokenHeader)
		gotContentType = r.Header.Get("content-type")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	if err := newTestClient(server.URL).Send(context.Background(), sampleResult(), "secret-token"); err != nil {
		t.Fatalf("send: %v", err)
	}

	if gotToken != "secret-token" {
		t.Fatalf("token header = %q", gotToken)
	}
	if gotContentType != "application/json" {
		t.Fatalf("content-type = %q", gotContentType)
	}
	if gotBody["jobId"] != "job-1" || gotBody["status"] != "GRADED" {
		t.Fatalf("body = %v", gotBody)
	}
	// The backend already has the source; the result must never carry it back.
	if _, present := gotBody["sourceCode"]; present {
		t.Fatal("the result payload carried source code")
	}
}

// Transient failures are retried until one gets through.
func TestSendRetriesServerErrorsUntilDelivered(t *testing.T) {
	server, hits := statusSequence(t, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusOK)

	if err := newTestClient(server.URL).Send(context.Background(), sampleResult(), "token"); err != nil {
		t.Fatalf("send: %v", err)
	}
	if hits.Load() != 3 {
		t.Fatalf("callback hit %d times, want 3", hits.Load())
	}
}

// After the last attempt the error surfaces, so the job is failed and retried
// by the queue rather than the result being dropped silently.
func TestSendGivesUpAfterMaxAttempts(t *testing.T) {
	server, hits := statusSequence(t, http.StatusInternalServerError)

	err := newTestClient(server.URL).Send(context.Background(), sampleResult(), "token")

	if err == nil {
		t.Fatal("expected an error once every attempt failed")
	}
	if errors.Is(err, ErrRejected) {
		t.Fatal("a 5xx must not be reported as a rejection")
	}
	if hits.Load() != maxAttempts {
		t.Fatalf("callback hit %d times, want %d", hits.Load(), maxAttempts)
	}
}

// A 4xx is a contract bug: retrying would resend a payload already refused.
func TestSendDoesNotRetryARejection(t *testing.T) {
	server, hits := statusSequence(t, http.StatusUnprocessableEntity)

	err := newTestClient(server.URL).Send(context.Background(), sampleResult(), "token")

	if !errors.Is(err, ErrRejected) {
		t.Fatalf("error = %v, want ErrRejected", err)
	}
	if hits.Load() != 1 {
		t.Fatalf("callback hit %d times, want 1", hits.Load())
	}
}

// An unreachable LMS is retried like a 5xx.
func TestSendRetriesNetworkErrors(t *testing.T) {
	server, _ := statusSequence(t, http.StatusOK)
	url := server.URL
	server.Close()

	err := newTestClient(url).Send(context.Background(), sampleResult(), "token")

	if err == nil || errors.Is(err, ErrRejected) {
		t.Fatalf("error = %v, want a delivery failure", err)
	}
	if !strings.Contains(err.Error(), "after 5 attempts") {
		t.Fatalf("error %q does not say the attempts were exhausted", err)
	}
}

// Shutdown must not sit out the whole backoff schedule.
func TestSendStopsRetryingWhenTheContextIsCancelled(t *testing.T) {
	server, hits := statusSequence(t, http.StatusServiceUnavailable)
	client := newTestClient(server.URL)
	client.backoff = time.Hour

	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(50*time.Millisecond, cancel)

	started := time.Now()
	err := client.Send(ctx, sampleResult(), "token")

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		t.Fatalf("send took %s after cancellation", elapsed)
	}
	if hits.Load() != 1 {
		t.Fatalf("callback hit %d times, want 1 before the cancelled backoff", hits.Load())
	}
}
