// Command worker consumes execution jobs and runs them in Docker sandboxes.
//
// It is the only component permitted to talk to the Docker daemon. It holds no
// database credentials: everything it knows arrives in a job payload, and
// everything it reports leaves through the LMS result callback.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/config"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/language"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/observability"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/pool"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/queue"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/report"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/runner"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/sandbox"
)

// Queue names must match QUEUE_NAMES in packages/shared. They use a hyphen
// because BullMQ reserves the colon as its own key separator.
const (
	runQueue    = "execution-run"
	submitQueue = "execution-submit"
)

func main() {
	if err := run(); err != nil {
		// The logger may not exist yet, so this one failure path uses stderr.
		fmt.Fprintf(os.Stderr, "worker failed to start: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := observability.NewLogger(cfg.LogLevel)
	hostname, _ := os.Hostname()
	workerName := fmt.Sprintf("ambatucode-worker@%s", hostname)

	logger.Info("starting worker",
		slog.Int("contractVersion", contract.Version),
		slog.Int("concurrency", cfg.Concurrency),
		slog.Int("maxContainers", cfg.MaxContainers),
		slog.Any("languages", language.Supported()))

	redisOptions, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return fmt.Errorf("parse REDIS_URL: %w", err)
	}
	redisClient := redis.NewClient(redisOptions)
	defer redisClient.Close()

	startupCtx, cancelStartup := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelStartup()

	if err := redisClient.Ping(startupCtx).Err(); err != nil {
		return fmt.Errorf("connect to redis: %w", err)
	}

	box, err := sandbox.New(logger)
	if err != nil {
		return err
	}
	defer box.Close()

	if err := box.Ping(startupCtx); err != nil {
		return fmt.Errorf("docker daemon is not reachable: %w", err)
	}
	// Fail here rather than one submission at a time. The worker never pulls,
	// so a missing image would otherwise surface as every job erroring.
	if err := box.EnsureImages(startupCtx, language.Images()); err != nil {
		return err
	}

	// Sweep before consuming anything. A worker that crashed mid-job left
	// containers behind, and `defer` cannot help once the process is gone.
	swept, err := box.SweepOrphans(startupCtx)
	if err != nil {
		return fmt.Errorf("startup container sweep: %w", err)
	}
	logger.Info("startup container sweep complete", slog.Int("removed", swept))

	// Submissions are listed first so the pool drains them with priority — a
	// flood of practice runs must never starve formal grading.
	consumers := make([]*queue.Consumer, 0, 2)
	for _, name := range []string{submitQueue, runQueue} {
		consumer, err := queue.NewConsumer(
			redisClient, cfg.QueuePrefix, name, workerName, cfg.LockDuration,
		)
		if err != nil {
			return err
		}
		consumers = append(consumers, consumer)
	}

	service := runner.NewService(
		runner.New(box, logger),
		report.New(cfg.CallbackURL, logger),
		logger,
	)
	workerPool := pool.New(
		redisClient, consumers, service, cfg.Concurrency, cfg.MaxContainers, logger,
	)

	health := observability.NewHealthServer(
		cfg.HealthAddr,
		box.Ping,
		func(ctx context.Context) error { return redisClient.Ping(ctx).Err() },
		func() (int64, bool) { return workerPool.ActiveJobs(), workerPool.Saturated() },
		logger,
	)
	health.Start()
	logger.Info("health endpoint listening", slog.String("addr", cfg.HealthAddr))

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	done := make(chan struct{})
	go func() {
		workerPool.Run(ctx)
		close(done)
	}()

	<-ctx.Done()
	logger.Info("shutdown signal received; draining",
		slog.Duration("grace", cfg.ShutdownGrace))

	// Stop accepting work, then give in-flight jobs the grace period to finish
	// before their containers are killed and the jobs handed back.
	select {
	case <-done:
		logger.Info("all workers stopped cleanly")
	case <-time.After(cfg.ShutdownGrace):
		logger.Warn("grace period elapsed with jobs still running")
	}

	releaseCtx, cancelRelease := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelRelease()
	workerPool.ReleaseInFlight(releaseCtx)

	if err := health.Shutdown(releaseCtx); err != nil && !errors.Is(err, context.Canceled) {
		logger.Warn("health server shutdown failed", slog.String("error", err.Error()))
	}

	// Last line of defence: anything still labelled is removed on the way out.
	if swept, err := box.SweepOrphans(releaseCtx); err != nil {
		logger.Error("shutdown container sweep failed", slog.String("error", err.Error()))
	} else if swept > 0 {
		logger.Info("shutdown container sweep complete", slog.Int("removed", swept))
	}

	logger.Info("worker stopped")
	return nil
}
