package observability

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

// Prober reports on one dependency. A nil error means healthy.
type Prober func(ctx context.Context) error

// PoolStats exposes saturation without the health server reaching into the pool.
type PoolStats func() (active int64, saturated bool)

// HealthServer answers GET /healthz.
//
// It reports Docker daemon reachability, Redis connectivity, and pool
// saturation, because those are the three ways this worker stops being able to
// grade anything while its process is still alive.
type HealthServer struct {
	server *http.Server
	logger *slog.Logger
}

func NewHealthServer(addr string, docker, redis Prober, stats PoolStats, logger *slog.Logger) *HealthServer {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		active, saturated := stats()
		body := map[string]any{
			"status":     "ok",
			"activeJobs": active,
			// Saturation is reported, not failed on: a fully busy worker is
			// working correctly. A load balancer that drains on saturation
			// would remove exactly the capacity that is being used.
			"saturated": saturated,
			"docker":    "ok",
			"redis":     "ok",
		}

		healthy := true
		if err := docker(ctx); err != nil {
			body["docker"] = err.Error()
			healthy = false
		}
		if err := redis(ctx); err != nil {
			body["redis"] = err.Error()
			healthy = false
		}
		if !healthy {
			body["status"] = "degraded"
		}

		w.Header().Set("content-type", "application/json")
		if healthy {
			w.WriteHeader(http.StatusOK)
		} else {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_ = json.NewEncoder(w).Encode(body)
	})

	return &HealthServer{
		server: &http.Server{
			Addr:              addr,
			Handler:           mux,
			ReadHeaderTimeout: 5 * time.Second,
		},
		logger: logger,
	}
}

// Start serves in the background. A failure to bind is logged rather than
// fatal: losing the health endpoint must not stop the worker from grading.
func (h *HealthServer) Start() {
	go func() {
		if err := h.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			h.logger.Error("health server stopped", slog.String("error", err.Error()))
		}
	}()
}

func (h *HealthServer) Shutdown(ctx context.Context) error {
	return h.server.Shutdown(ctx)
}
