// Package runner orchestrates one job: workspace, containers, comparison, and
// the result that goes back to the LMS.
package runner

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/grader"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/language"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/sandbox"
)

// excerptLimit caps what is reported per stream. The sandbox already capped
// what it read; this is the second, smaller cap on what travels onward.
const excerptLimit = 4096

const truncationMarker = "\n… output truncated …"

type Runner struct {
	sandbox *sandbox.Sandbox
	logger  *slog.Logger
}

func New(box *sandbox.Sandbox, logger *slog.Logger) *Runner {
	return &Runner{sandbox: box, logger: logger}
}

// Run executes a job and always returns a reportable result.
//
// An infrastructure failure becomes a SYSTEM_ERROR result rather than an
// error return: a submission with no result at all is worse than one marked
// as having failed inside the platform.
func (r *Runner) Run(ctx context.Context, job contract.Job) contract.Result {
	spec, err := language.Lookup(job.Language)
	if err != nil {
		return r.systemError(job, err)
	}

	workspace := []sandbox.File{{Name: spec.SourceFile, Content: []byte(job.SourceCode)}}

	// A job with no cases still runs once, so a program that cannot start is
	// reported as a runtime failure instead of a silent pass.
	cases := job.TestCases
	if len(cases) == 0 {
		outcome, err := r.runOnce(ctx, job, spec, workspace, "")
		if err != nil {
			return r.systemError(job, err)
		}
		result := baseResult(job)
		result.Status = classify(outcome)
		result.ExecutionTimeMs = float64(outcome.Duration.Milliseconds())
		return result
	}

	result := baseResult(job)
	var worst contract.Status = contract.StatusGraded
	var totalDuration time.Duration

	for _, testCase := range cases {
		outcome, err := r.runOnce(ctx, job, spec, workspace, testCase.Input)
		if err != nil {
			return r.systemError(job, err)
		}
		totalDuration += outcome.Duration

		status := classify(outcome)
		worst = escalate(worst, status)

		passed := false
		if status == contract.StatusGraded {
			matched, compareErr := grader.Compare(testCase.Comparison, testCase.ExpectedOutput, outcome.Stdout)
			if compareErr != nil {
				return r.systemError(job, compareErr)
			}
			passed = matched
		}

		result.TestResults = append(result.TestResults, contract.TestResult{
			TestCaseID:      stringPtr(testCase.ID),
			Name:            testCase.Name,
			Passed:          passed,
			Weight:          testCase.Weight,
			ExecutionTimeMs: float64(outcome.Duration.Milliseconds()),
			MemoryUsedKb:    nil, // per-case memory accounting arrives with the limits work
			StdoutExcerpt:   excerpt(outcome.Stdout, outcome.StdoutTruncated),
			StderrExcerpt:   excerpt(outcome.Stderr, outcome.StderrTruncated),
		})
	}

	result.Status = worst
	result.ExecutionTimeMs = float64(totalDuration.Milliseconds())
	return result
}

// runOnce executes one container. A fresh container per test case keeps the
// "one container per execution" rule trivially true — no state can survive
// from one case to the next.
func (r *Runner) runOnce(
	ctx context.Context,
	job contract.Job,
	spec language.Spec,
	workspace []sandbox.File,
	stdin string,
) (sandbox.RunOutcome, error) {
	return r.sandbox.Run(ctx, sandbox.RunSpec{
		JobID:          job.JobID,
		Image:          spec.Image,
		Cmd:            spec.RunCmd,
		Workspace:      workspace,
		Stdin:          stdin,
		WallTimeout:    time.Duration(job.Limits.WallTimeoutMs) * time.Millisecond,
		MemoryLimitMb:  job.Limits.MemoryLimitMb,
		MaxProcesses:   job.Limits.MaxProcesses,
		MaxOutputBytes: job.Limits.MaxOutputBytes,
	})
}

// classify maps one container outcome to a status, in the documented
// precedence. OOM is read from the daemon's flag rather than guessed from an
// exit code, because a memory kill and an ordinary SIGKILL both surface as 137.
func classify(outcome sandbox.RunOutcome) contract.Status {
	switch {
	case outcome.TimedOut:
		return contract.StatusTimeLimitExceeded
	case outcome.OOMKilled:
		return contract.StatusMemoryLimitExceeded
	case outcome.ExitCode != 0:
		return contract.StatusRuntimeError
	default:
		return contract.StatusGraded
	}
}

// escalate keeps the most severe status seen across test cases, following the
// same precedence. GRADED is the floor: it means every case ran to completion,
// not that any of them passed.
func escalate(current, candidate contract.Status) contract.Status {
	if severity(candidate) > severity(current) {
		return candidate
	}
	return current
}

func severity(status contract.Status) int {
	switch status {
	case contract.StatusGraded:
		return 0
	case contract.StatusRuntimeError:
		return 1
	case contract.StatusMemoryLimitExceeded:
		return 2
	case contract.StatusTimeLimitExceeded:
		return 3
	case contract.StatusCompileError:
		return 4
	case contract.StatusSystemError:
		return 5
	default:
		return 0
	}
}

// excerpt sanitizes and truncates one stream for reporting.
func excerpt(value string, alreadyTruncated bool) string {
	value = sanitize(value)
	if len(value) > excerptLimit {
		return value[:excerptLimit] + truncationMarker
	}
	if alreadyTruncated {
		return value + truncationMarker
	}
	return value
}

// sanitize strips paths that describe the sandbox's insides.
//
// A Python traceback names `/workspace/main.py`; leaking the container
// filesystem layout to a Coder tells them where to aim. The file name itself
// is kept because it is the only thing that makes a traceback readable.
func sanitize(value string) string {
	return strings.ReplaceAll(value, language.WorkspaceDir+"/", "")
}

func baseResult(job contract.Job) contract.Result {
	return contract.Result{
		ContractVersion: contract.Version,
		JobID:           job.JobID,
		SubmissionID:    job.SubmissionID,
		Status:          contract.StatusGraded,
		CompilerOutput:  nil,
		SystemError:     nil,
		TestResults:     []contract.TestResult{},
	}
}

// systemError builds a result for a failure inside the platform.
//
// The cause is logged in full here, where it may name images, paths and daemon
// internals, and only a sanitized form travels onward. A SYSTEM_ERROR whose
// reason appears nowhere is undiagnosable, so the logging is not optional.
func (r *Runner) systemError(job contract.Job, err error) contract.Result {
	r.logger.Error("execution failed inside the platform",
		slog.String("jobId", job.JobID),
		slog.String("language", string(job.Language)),
		slog.String("error", err.Error()))

	result := baseResult(job)
	result.Status = contract.StatusSystemError
	message := fmt.Sprintf("execution failed inside the platform: %s", sanitize(err.Error()))
	result.SystemError = &message
	return result
}

func stringPtr(value string) *string { return &value }
