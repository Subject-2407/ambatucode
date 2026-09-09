// Package config loads and validates the worker's environment.
//
// Everything is resolved and checked once, at startup, before a Redis
// connection is opened or a container is created. A worker that starts with a
// bad callback URL or an absurd concurrency value would fail later, one job at
// a time, with participant submissions already in flight.
package config

import (
	"fmt"
	"net/url"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	RedisURL    string
	QueuePrefix string

	// CallbackURL is the LMS result endpoint. The worker holds no database
	// credentials — this is the only way a result reaches PostgreSQL.
	CallbackURL string

	// Concurrency is the size of the goroutine pool.
	Concurrency int
	// MaxContainers caps concurrently running containers independently of the
	// pool, because a container costs far more than a goroutine.
	MaxContainers int

	HealthAddr string

	// LockDuration is how long a claimed job stays owned by this worker before
	// BullMQ considers it stalled and lets another worker take it.
	LockDuration time.Duration
	// ShutdownGrace is how long in-flight jobs get to finish on SIGTERM.
	ShutdownGrace time.Duration

	LogLevel string
}

const (
	defaultQueuePrefix   = "bull"
	defaultCallbackURL   = "http://localhost:3000/api/internal/execution/result"
	defaultRedisURL      = "redis://localhost:6379"
	defaultHealthAddr    = ":3002"
	defaultLockDuration  = 30 * time.Second
	defaultShutdownGrace = 30 * time.Second
)

// Load reads the environment and returns a validated config.
func Load() (Config, error) {
	cfg := Config{
		RedisURL:      envOr("REDIS_URL", defaultRedisURL),
		QueuePrefix:   envOr("WORKER_QUEUE_PREFIX", defaultQueuePrefix),
		CallbackURL:   envOr("EXECUTION_CALLBACK_URL", defaultCallbackURL),
		HealthAddr:    envOr("WORKER_HEALTH_ADDR", defaultHealthAddr),
		LogLevel:      strings.ToLower(envOr("WORKER_LOG_LEVEL", "info")),
		LockDuration:  defaultLockDuration,
		ShutdownGrace: defaultShutdownGrace,
	}

	// numCPU*2 balances the goroutine pool against a workload that is almost
	// entirely spent waiting on Docker, capped at 16 so a large host does not
	// try to hold a hundred containers open at once.
	defaultConcurrency := runtime.NumCPU() * 2
	if defaultConcurrency > 16 {
		defaultConcurrency = 16
	}

	var err error
	if cfg.Concurrency, err = intEnv("WORKER_CONCURRENCY", defaultConcurrency); err != nil {
		return Config{}, err
	}
	if cfg.MaxContainers, err = intEnv("WORKER_MAX_CONTAINERS", cfg.Concurrency); err != nil {
		return Config{}, err
	}
	if cfg.LockDuration, err = durationEnv("WORKER_LOCK_DURATION_MS", defaultLockDuration); err != nil {
		return Config{}, err
	}
	if cfg.ShutdownGrace, err = durationEnv("WORKER_SHUTDOWN_GRACE_MS", defaultShutdownGrace); err != nil {
		return Config{}, err
	}

	return cfg, cfg.validate()
}

func (c Config) validate() error {
	if c.Concurrency < 1 {
		return fmt.Errorf("WORKER_CONCURRENCY must be at least 1, got %d", c.Concurrency)
	}
	if c.MaxContainers < 1 {
		return fmt.Errorf("WORKER_MAX_CONTAINERS must be at least 1, got %d", c.MaxContainers)
	}
	// More goroutines than containers is fine — they queue on the semaphore.
	// The reverse is not: container slots nothing can claim are dead capacity
	// and hide a misconfiguration behind apparently healthy behaviour.
	if c.MaxContainers > c.Concurrency {
		return fmt.Errorf(
			"WORKER_MAX_CONTAINERS (%d) exceeds WORKER_CONCURRENCY (%d); the extra container slots can never be used",
			c.MaxContainers, c.Concurrency,
		)
	}
	if c.QueuePrefix == "" {
		return fmt.Errorf("WORKER_QUEUE_PREFIX must not be empty")
	}
	parsed, err := url.Parse(c.CallbackURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("EXECUTION_CALLBACK_URL must be an absolute URL, got %q", c.CallbackURL)
	}
	if _, err := url.Parse(c.RedisURL); err != nil {
		return fmt.Errorf("REDIS_URL is not a valid URL: %w", err)
	}
	if c.LockDuration < time.Second {
		return fmt.Errorf("WORKER_LOCK_DURATION_MS must be at least 1000ms, got %s", c.LockDuration)
	}
	switch c.LogLevel {
	case "debug", "info", "warn", "error":
	default:
		return fmt.Errorf("WORKER_LOG_LEVEL must be debug, info, warn or error, got %q", c.LogLevel)
	}
	return nil
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func intEnv(key string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer, got %q", key, raw)
	}
	return value, nil
}

func durationEnv(key string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	ms, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer number of milliseconds, got %q", key, raw)
	}
	if ms <= 0 {
		return 0, fmt.Errorf("%s must be positive, got %d", key, ms)
	}
	return time.Duration(ms) * time.Millisecond, nil
}
