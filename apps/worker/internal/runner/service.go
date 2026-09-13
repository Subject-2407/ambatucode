package runner

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
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
}

func NewService(r *Runner, reporter *report.Client, logger *slog.Logger) *Service {
	return &Service{runner: r, reporter: reporter, logger: logger}
}

func (s *Service) Process(ctx context.Context, queueJob *queue.Job) error {
	startedAt := time.Now()

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

	logger.Info("job executed",
		slog.String("status", string(result.Status)),
		slog.Int("passed", passed),
		slog.Int("cases", len(result.TestResults)),
		slog.Int64("durationMs", time.Since(startedAt).Milliseconds()))

	if err := s.reporter.Send(ctx, result, job.CallbackToken); err != nil {
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

// reportUnparseable turns a contract violation into a SYSTEM_ERROR the Coder
// can see, when enough of the payload survives to address the callback.
func (s *Service) reportUnparseable(ctx context.Context, queueJob *queue.Job, cause error) error {
	s.logger.Error("job payload rejected by the contract",
		slog.String("jobId", queueJob.ID),
		slog.String("queue", queueJob.Queue),
		slog.String("error", cause.Error()))

	identity, ok := contract.ProbeIdentity(queueJob.Data)
	if !ok {
		// Nothing to report to and nothing to retry — a redelivery would fail
		// identically. Fail the job so it lands in BullMQ's failed set where
		// an operator can see it.
		return queue.Unrecoverable(fmt.Errorf("unparseable job payload: %w", cause))
	}

	message := "execution failed inside the platform: the job payload did not match the execution contract"
	result := contract.Result{
		ContractVersion: contract.Version,
		JobID:           identity.JobID,
		SubmissionID:    identity.SubmissionID,
		Status:          contract.StatusSystemError,
		SystemError:     &message,
		TestResults:     []contract.TestResult{},
	}
	if err := s.reporter.Send(ctx, result, identity.CallbackToken); err != nil {
		if errors.Is(err, report.ErrRejected) {
			return queue.Unrecoverable(fmt.Errorf("report unparseable job: %w", err))
		}
		return fmt.Errorf("report unparseable job: %w", err)
	}

	// The result was delivered, so the queue job is done. Retrying would only
	// re-derive the same contract error.
	return nil
}
