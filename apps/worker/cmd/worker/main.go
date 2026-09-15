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
	"github.com/Subject-2407/ambatucode/apps/worker/internal/reaper"
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

// interruptTimeout bounds how long shutdown waits for jobs to unwind after
// their context is cancelled. Unwinding removes a container and releases a
// job, each already capped at 30 seconds.
const interruptTimeout = 75 * time.Second

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
		slog.Int("reservedSubmitContainers", cfg.ReservedSubmitContainers),
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

	metrics := observability.NewMetrics()

	box, err := sandbox.New(logger, metrics)
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
	if err := box.EnsureSeccomp(startupCtx, language.DeniedSyscallSets()); err != nil {
		return err
	}

	// Sweep before consuming anything. A worker that crashed mid-job left
	// containers behind, and `defer` cannot help once the process is gone.
	swept, err := box.SweepOrphans(startupCtx)
	if err != nil {
		return fmt.Errorf("startup container sweep: %w", err)
	}
	logger.Info("startup container sweep complete", slog.Int("removed", swept))

	// The reaper outlives the pool's accept context: jobs still draining
	// through the grace period can leak a container too.
	reapCtx, stopReaping := context.WithCancel(context.Background())
	defer stopReaping()
	go reaper.New(box, logger).Run(reapCtx)

	queueSettings := queue.Settings{
		LockDuration:    cfg.LockDuration,
		StalledInterval: cfg.StalledInterval,
		MaxStalledCount: cfg.MaxStalledCount,
	}
	submitConsumer, err := queue.NewConsumer(
		redisClient, cfg.QueuePrefix, submitQueue, workerName, queueSettings,
	)
	if err != nil {
		return err
	}
	runConsumer, err := queue.NewConsumer(
		redisClient, cfg.QueuePrefix, runQueue, workerName, queueSettings,
	)
	if err != nil {
		return err
	}

	service := runner.NewService(
		runner.New(box, logger),
		report.New(cfg.CallbackURL, logger),
		logger,
		metrics,
	)
	// Submissions are claimed first and hold a reserve of container slots — a
	// flood of practice runs must never starve formal grading.
	workerPool := pool.New(redisClient, submitConsumer, runConsumer, service, pool.Options{
		Concurrency:       cfg.Concurrency,
		MaxContainers:     cfg.MaxContainers,
		ReservedForSubmit: cfg.ReservedSubmitContainers,
		// Half the lock duration, as BullMQ does: one missed renewal still
		// leaves the lock standing until the next.
		LockRenewInterval: cfg.LockDuration / 2,
		StalledInterval:   cfg.StalledInterval,
		Metrics:           metrics,
	}, logger)

	health := observability.NewHealthServer(
		cfg.HealthAddr,
		box.Ping,
		func(ctx context.Context) error { return redisClient.Ping(ctx).Err() },
		func() (int64, bool) { return workerPool.ActiveJobs(), workerPool.Saturated() },
		metrics,
		logger,
	)
	health.Start()
	logger.Info("health and metrics endpoints listening", slog.String("addr", cfg.HealthAddr))

	// The signal only stops new claims. Running jobs execute under work, which
	// is cancelled separately once the grace period is spent — tying jobs to
	// the signal would interrupt every in-flight submission the moment SIGTERM
	// arrived.
	accept, stopAccepting := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stopAccepting()
	work, interruptWork := context.WithCancel(context.Background())
	defer interruptWork()

	done := make(chan struct{})
	go func() {
		workerPool.Run(accept, work)
		close(done)
	}()

	<-accept.Done()
	// Restore default signal handling, so a second SIGINT from an operator who
	// will not wait out the grace period kills the process immediately.
	stopAccepting()
	logger.Info("shutdown signal received; draining",
		slog.Duration("grace", cfg.ShutdownGrace))

	select {
	case <-done:
		logger.Info("all workers stopped cleanly")
	case <-time.After(cfg.ShutdownGrace):
		// Interrupted jobs release themselves back to their wait list as their
		// goroutines unwind; nothing about them is reported to the LMS.
		logger.Warn("grace period elapsed; interrupting running jobs",
			slog.Int64("activeJobs", workerPool.ActiveJobs()))
		interruptWork()
		select {
		case <-done:
			logger.Info("interrupted jobs returned to their queues")
		case <-time.After(interruptTimeout):
			logger.Error("workers did not stop after interruption; releasing their jobs directly")
		}
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
