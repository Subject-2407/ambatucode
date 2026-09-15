package observability

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func scrape(t *testing.T, handler http.Handler) string {
	t.Helper()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("metrics answered %d", recorder.Code)
	}
	return recorder.Body.String()
}

// The names are the operator-facing contract: dashboards and alerts are
// written against them, so renaming one silently breaks monitoring.
func TestMetricsExposeTheDocumentedSeries(t *testing.T) {
	m := NewMetrics()
	m.JobProcessed("SUBMIT", "python", "GRADED", 1500*time.Millisecond)
	m.JobRejected("UNKNOWN", "SYSTEM_ERROR")
	m.ContainerOpened()
	m.ContainerOpened()
	m.ContainerClosed()
	m.ContainerCreateFailed()
	m.QueueWait("execution-submit", 2*time.Second)
	m.ResultDeliveryFailed("SUBMIT")

	body := scrape(t, m.Handler())

	for _, want := range []string{
		`jobs_processed_total{kind="SUBMIT",status="GRADED"} 1`,
		`jobs_processed_total{kind="UNKNOWN",status="SYSTEM_ERROR"} 1`,
		`job_duration_seconds_count{kind="SUBMIT",language="python"} 1`,
		`containers_active 1`,
		`container_create_failures_total 1`,
		`queue_wait_seconds_count{queue="execution-submit"} 1`,
		`result_delivery_failures_total{kind="SUBMIT"} 1`,
		`go_goroutines`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics output is missing %q", want)
		}
	}
}

// Packages record metrics unconditionally, and their unit tests pass no
// registry at all.
func TestNilMetricsRecordNothingAndDoNotPanic(t *testing.T) {
	var m *Metrics
	m.JobProcessed("RUN", "cpp", "GRADED", time.Second)
	m.JobRejected("RUN", "SYSTEM_ERROR")
	m.ContainerOpened()
	m.ContainerClosed()
	m.ContainerCreateFailed()
	m.QueueWait("execution-run", time.Second)
	m.ResultDeliveryFailed("RUN")

	recorder := httptest.NewRecorder()
	m.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("a nil registry answered %d, want 404", recorder.Code)
	}
}

// A job whose clock is ahead of the worker's must not record a negative wait,
// which a histogram would file under its smallest bucket as if it were fast.
func TestQueueWaitIgnoresNegativeDurations(t *testing.T) {
	m := NewMetrics()
	m.QueueWait("execution-run", -time.Second)
	if strings.Contains(scrape(t, m.Handler()), `queue_wait_seconds_count{queue="execution-run"}`) {
		t.Fatal("a negative wait was recorded")
	}
}

func TestHealthServerServesMetrics(t *testing.T) {
	m := NewMetrics()
	m.ContainerCreateFailed()
	ok := func(context.Context) error { return nil }
	server := NewHealthServer(":0", ok, ok, func() (int64, bool) { return 0, false }, m,
		slog.New(slog.NewTextHandler(io.Discard, nil)))

	if body := scrape(t, server.server.Handler); !strings.Contains(body, "container_create_failures_total 1") {
		t.Fatal("the health port does not serve the worker's metrics")
	}
}
