package runner

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/observability"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/queue"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/report"
)

// callbackTokenTTL is how long the LMS accepts a job's callback token, counted
// from when the job was enqueued (EXECUTION.md section 7). A result held past
// it would be refused anyway.
const callbackTokenTTL = 30 * time.Minute

const (
	holdBackoffBase = time.Second
	holdBackoffMax  = 30 * time.Second
)

// resultSender delivers one result to the LMS. *report.Client is the
// production implementation.
type resultSender interface {
	Send(ctx context.Context, result contract.Result, callbackToken string) error
}

// Service is the full per-job flow: parse, execute, report.
//
// Its error return answers one question only — what should happen to the
// BullMQ job? Nil completes it. An error fails it so its retry policy applies;
// queue.ErrUnrecoverable fails it for good; queue.ErrRequeue hands it back
// untouched. A participant's program crashing is not an error here; losing a
// graded result is.
type Service struct {
	runner   *Runner
	reporter resultSender
	logger   *slog.Logger
	metrics  *observability.Metrics

	// sandboxReachable tells a SYSTEM_ERROR the job caused from one the
	// Docker daemon's absence caused.
	sandboxReachable func(ctx context.Context) error
	holdBackoff      time.Duration
	now              func() time.Time
}

// NewService builds the per-job flow. metrics may be nil.
func NewService(
	r *Runner, reporter *report.Client, logger *slog.Logger, metrics *observability.Metrics,
) *Service {
	return &Service{
		runner:           r,
		reporter:         reporter,
		logger:           logger,
		metrics:          metrics,
		sandboxReachable: r.SandboxReachable,
		holdBackoff:      holdBackoffBase,
		now:              time.Now,
	}
}

func (s *Service) Process(ctx context.Context, queueJob *queue.Job) error {
	startedAt := time.Now()

	if queueJob.DeferredFailure != "" {
		return s.reportAbandoned(ctx, queueJob)
	}

	job, err := contract.ParseJob(queueJob.Data)
	if err != nil {
		return s.reportUnparseable(ctx, queueJob, err)
	}

	logger := s.logger.With(
		slog.String("jobId", job.JobID),
		slog.String("kind", string(job.Kind)),
		slog.String("language", string(job.Language)),
		slog.String("queue", queueJob.Queue),
	)

	result, daemonErr := s.runner.Execute(ctx, job)

	// A cancelled context means the worker is shutting down, and whatever the
	// runner produced describes the interruption rather than the program.
	// Reporting it would make that verdict final — ingest ignores a second
	// result for a submission already in a terminal status. The error hands
	// the job back so another worker grades it from scratch.
	if ctx.Err() != nil {
		logger.Warn("job interrupted before its result was reported")
		return fmt.Errorf("job interrupted by shutdown: %w", ctx.Err())
	}

	// A platform failure with the daemon gone is the daemon's doing, not the
	// program's. Reporting it would grade a Coder on an outage; the job goes
	// back to wait for Docker instead. The runner names a daemon failure it
	// saw directly; the probe catches one it could only see as a generic error,
	// and the runner's word stands even if the daemon is already back by now.
	if result.Status == contract.StatusSystemError {
		cause := daemonErr
		if cause == nil {
			cause = s.sandboxReachable(ctx)
		}
		if cause != nil {
			logger.Warn("job could not run because the docker daemon failed; requeueing",
				slog.String("error", cause.Error()))
			return queue.Requeue(fmt.Errorf("docker daemon unavailable: %w", cause))
		}
	}

	// The pass count is the one thing a GRADED status does not tell you, and
	// without it a submission that ran perfectly and failed every case looks
	// identical in the logs to one that passed.
	passed := 0
	for _, testResult := range result.TestResults {
		if testResult.Passed {
			passed++
		}
	}

	duration := time.Since(startedAt)
	logger.Info("job executed",
		slog.String("status", string(result.Status)),
		slog.Int("passed", passed),
		slog.Int("cases", len(result.TestResults)),
		slog.Int64("durationMs", duration.Milliseconds()))
	s.metrics.JobProcessed(string(job.Kind), string(job.Language), string(result.Status), duration)

	return s.deliver(ctx, logger, queueJob, job.Kind, result, job.CallbackToken)
}

// deliver sends a result, holding a submission's result through an LMS outage.
//
// A run is discardable — the Coder can press Run again — so one failed round
// drops it. A formal submission is not. Failing its queue job would spend one
// of its few attempts on regrading a program that was already graded, and an
// outage longer than those attempts would fail it for good, leaving the
// Submission QUEUED with nothing on the way. So the graded result is kept and
// retried, with the job's lock renewed the whole time, until the LMS takes it
// or its callback token expires. While results are held, their container slots
// stay taken and the worker claims nothing new: unclaimed work waits safely in
// Redis rather than being graded into a result nobody can receive.
func (s *Service) deliver(
	ctx context.Context,
	logger *slog.Logger,
	queueJob *queue.Job,
	kind contract.Kind,
	result contract.Result,
	callbackToken string,
) error {
	enqueued := queueJob.EnqueuedAt
	if enqueued.IsZero() {
		enqueued = s.now()
	}
	holdUntil := enqueued.Add(callbackTokenTTL)

	for round := 1; ; round++ {
		err := s.reporter.Send(ctx, result, callbackToken)
		if err == nil {
			if round > 1 {
				logger.Info("held result delivered", slog.Int("rounds", round))
			}
			return nil
		}
		if errors.Is(err, report.ErrRejected) {
			// The LMS refused the shape, or the token has expired. A retry
			// would send the same payload and be refused the same way.
			return queue.Unrecoverable(fmt.Errorf("deliver result: %w", err))
		}
		if ctx.Err() != nil {
			return fmt.Errorf("job interrupted by shutdown while reporting: %w", err)
		}
		s.metrics.ResultDeliveryFailed(metricKind(kind))

		if kind == contract.KindRun {
			logger.Warn("run result not delivered; dropping", slog.String("error", err.Error()))
			return nil
		}
		if !s.now().Before(holdUntil) {
			// The LMS would now refuse the token. Failing the job leaves it in
			// BullMQ's hands, and the backend closes out an expired job itself.
			logger.Error("result not delivered before its callback token expired",
				slog.Int("rounds", round),
				slog.String("error", err.Error()))
			return fmt.Errorf("deliver result: %w", err)
		}

		wait := holdWait(s.holdBackoff, round)
		logger.Warn("LMS unreachable; holding the result and retrying",
			slog.Int("round", round),
			slog.Duration("retryIn", wait),
			slog.Time("holdUntil", holdUntil),
			slog.String("error", err.Error()))
		select {
		case <-ctx.Done():
			return fmt.Errorf("job interrupted by shutdown while holding its result: %w", ctx.Err())
		case <-time.After(wait):
		}
	}
}

// holdWait doubles from base per round, capped so a recovered LMS is noticed
// within half a minute.
func holdWait(base time.Duration, round int) time.Duration {
	wait := base
	for i := 1; i < round && wait < holdBackoffMax; i++ {
		wait *= 2
	}
	return min(wait, holdBackoffMax)
}

// reportAbandoned closes out a job the stalled check gave up on.
//
// It stalled more times than allowed — its worker kept dying under it — so it
// is not run again: a job that takes workers down would take this one down
// too. It is reported as SYSTEM_ERROR first, because failing the queue job
// alone would leave the Submission in QUEUED with nothing ever arriving.
func (s *Service) reportAbandoned(ctx context.Context, queueJob *queue.Job) error {
	cause := fmt.Errorf("job abandoned by the stalled check: %s", queueJob.DeferredFailure)
	s.logger.Error("refusing to run a job that repeatedly stalled its worker",
		slog.String("jobId", queueJob.ID),
		slog.String("queue", queueJob.Queue),
		slog.String("reason", queueJob.DeferredFailure))

	if err := s.reportSystemError(ctx, queueJob, cause,
		"execution failed inside the platform: grading was interrupted too many times"); err != nil {
		return err
	}
	// Delivered, but the queue job still belongs in the failed set, where an
	// operator looking for poisonous jobs will find it.
	return queue.Unrecoverable(cause)
}

// reportUnparseable turns a contract violation into a SYSTEM_ERROR the Coder
// can see, when enough of the payload survives to address the callback.
func (s *Service) reportUnparseable(ctx context.Context, queueJob *queue.Job, cause error) error {
	s.logger.Error("job payload rejected by the contract",
		slog.String("jobId", queueJob.ID),
		slog.String("queue", queueJob.Queue),
		slog.String("error", cause.Error()))

	// Once delivered the queue job is done; retrying would only re-derive the
	// same contract error.
	return s.reportSystemError(ctx, queueJob, fmt.Errorf("unparseable job payload: %w", cause),
		"execution failed inside the platform: the job payload did not match the execution contract")
}

// reportSystemError reports a job that will never run as SYSTEM_ERROR.
//
// It works from the leniently probed identity, so it still reaches the
// callback when the payload itself is what is wrong. With no identity at all
// there is nothing to report to, and the job is failed without retries — a
// redelivery would reach the same verdict.
func (s *Service) reportSystemError(
	ctx context.Context, queueJob *queue.Job, cause error, message string,
) error {
	identity, ok := contract.ProbeIdentity(queueJob.Data)
	s.metrics.JobRejected(metricKind(identity.Kind), string(contract.StatusSystemError))
	if !ok {
		// Nothing to report to. Fail the job so it lands in BullMQ's failed
		// set where an operator can see it.
		return queue.Unrecoverable(cause)
	}

	result := contract.Result{
		ContractVersion: contract.Version,
		JobID:           identity.JobID,
		SubmissionID:    identity.SubmissionID,
		Status:          contract.StatusSystemError,
		SystemError:     &message,
		TestResults:     []contract.TestResult{},
	}
	logger := s.logger.With(slog.String("jobId", identity.JobID), slog.String("queue", queueJob.Queue))
	// An unvalidated kind is only trusted to relax holding for a run; anything
	// else is held like a submission.
	if err := s.deliver(ctx, logger, queueJob, identity.Kind, result, identity.CallbackToken); err != nil {
		return fmt.Errorf("report system error: %w", err)
	}
	return nil
}

// metricKind confines an unvalidated kind to the values metrics may carry, so a
// malformed payload cannot mint a new label value.
func metricKind(kind contract.Kind) string {
	switch kind {
	case contract.KindRun, contract.KindSubmit:
		return string(kind)
	default:
		return "UNKNOWN"
	}
}
