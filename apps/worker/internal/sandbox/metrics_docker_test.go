//go:build docker

package sandbox

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/observability"
)

func containersActive(t *testing.T, metrics *observability.Metrics) string {
	t.Helper()
	recorder := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	for _, line := range strings.Split(recorder.Body.String(), "\n") {
		if strings.HasPrefix(line, "containers_active ") {
			return strings.TrimPrefix(line, "containers_active ")
		}
	}
	t.Fatal("containers_active is not exposed")
	return ""
}

// The gauge is what an operator watches to spot a leak, so it has to follow
// real containers: up while one exists, back to zero once it is removed — and
// not below zero when Close runs twice.
func TestContainersActiveFollowsTheSessionLifecycle(t *testing.T) {
	newTestSandbox(t)
	metrics := observability.NewMetrics()
	box, err := New(slog.New(slog.NewTextHandler(io.Discard, nil)), metrics)
	if err != nil {
		t.Fatalf("connect to docker: %v", err)
	}
	t.Cleanup(func() { _ = box.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	session, err := box.Open(ctx, SessionSpec{
		JobID:          "metrics",
		Image:          testImage,
		WallTimeout:    10 * time.Second,
		MemoryLimitMb:  128,
		MaxProcesses:   16,
		MaxOutputBytes: 4096,
	})
	if err != nil {
		t.Fatalf("open session: %v", err)
	}
	if got := containersActive(t, metrics); got != "1" {
		session.Close()
		t.Fatalf("containers_active with one open session = %s, want 1", got)
	}

	session.Close()
	session.Close()
	if got := containersActive(t, metrics); got != "0" {
		t.Fatalf("containers_active after close = %s, want 0", got)
	}
}
