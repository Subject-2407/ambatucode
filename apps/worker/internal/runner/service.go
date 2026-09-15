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

// Service is the full per-job flow: parse, execute, report.
//
// Its error return answers one question only — should the BullMQ job be failed
// so another worker retries it? A participant's program crashing is not an
// error here; losing a graded result is.
type Service struct {
	runner   *Runner
	reporter *report.Client
	logger   *slog.Logger
	metrics  *observability.Metrics
}

// NewService builds the per-job flow. metrics may be nil.
func NewService(
	r *Runner, reporter *report.Client, logger *slog.Logger, metrics *observability.Metrics,
) *Service {
	return &Service{runner: r, reporter: reporter, logger: logger, metrics: metrics}
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

	result := s.runner.Run(ctx, job)

	// A cancelled context means the worker is shutting down, and whatever the
	// runner produced describes the interruption rather than the program.
	// Reporting it would make that verdict final — ingest ignores a second
	// result for a submission already in a terminal status. The error hands
	// the job back so another worker grades it from scratch.
	if ctx.Err() != nil {
		logger.Warn("job interrupted before its result was reported")
		return fmt.Errorf("job interrupted by shutdown: %w", ctx.Err())
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

	if err := s.reporter.Send(ctx, result, job.CallbackToken); err != nil {
		if ctx.Err() == nil {
			s.metrics.ResultDeliveryFailed(string(job.Kind))
		}
		if errors.Is(err, report.ErrRejected) {
			// The LMS refused the shape. A retry would send the same payload
			// and be refused the same way.
			return queue.Unrecoverable(fmt.Errorf("deliver result: %w", err))
		}
		if ctx.Err() != nil {
			return fmt.Errorf("job interrupted by shutdown while reporting: %w", err)
		}
		// A run is discardable — the Coder can press Run again. A formal
		// submission is not: fail the queue job so it is retried rather than
		// leaving a graded submission that never reached the database.
		if job.Kind == contract.KindRun {
			logger.Warn("run result not delivered; dropping", slog.String("error", err.Error()))
			return nil
		}
		return fmt.Errorf("deliver result: %w", err)
	}

	return nil
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
	if err := s.reporter.Send(ctx, result, identity.CallbackToken); err != nil {
		if ctx.Err() == nil {
			s.metrics.ResultDeliveryFailed(metricKind(identity.Kind))
		}
		if errors.Is(err, report.ErrRejected) {
			return queue.Unrecoverable(fmt.Errorf("report system error: %w", err))
		}
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
