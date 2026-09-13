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
// An infrastructure failure becomes a SYSTEM_ERROR result rather than an error
// return: a submission with no result at all is worse than one marked as
// having failed inside the platform.
func (r *Runner) Run(ctx context.Context, job contract.Job) contract.Result {
	base, err := language.Lookup(job.Language)
	if err != nil {
		return r.systemError(job, err)
	}
	// Java needs the file named after the public class the program declares.
	// Every other language ignores its source here.
	spec := base.For(job.SourceCode)

	session, err := r.sandbox.Open(ctx, sandbox.SessionSpec{
		JobID:          job.JobID,
		Image:          spec.Image,
		WallTimeout:    time.Duration(job.Limits.WallTimeoutMs) * time.Millisecond,
		MemoryLimitMb:  job.Limits.MemoryLimitMb,
		MaxProcesses:   job.Limits.MaxProcesses,
		MaxOutputBytes: job.Limits.MaxOutputBytes,
	})
	if err != nil {
		return r.systemError(job, err)
	}
	defer session.Close()

	if err := session.Write(ctx, sandbox.File{
		Name:    spec.SourceFile,
		Content: []byte(job.SourceCode),
	}); err != nil {
		return r.systemError(job, err)
	}

	result := baseResult(job)

	if spec.Compiled() {
		outcome, err := session.Run(ctx, sandbox.ExecSpec{
			Cmd:     spec.CompileCmd,
			Timeout: time.Duration(job.Limits.CompileTimeoutMs) * time.Millisecond,
		})
		if err != nil {
			return r.systemError(job, err)
		}

		// A compiler writes its diagnostics to stderr and says nothing useful
		// on stdout, so both are folded into one field the Coder can read.
		compilerOutput := strings.TrimSpace(outcome.Stderr + outcome.Stdout)
		if compilerOutput != "" {
			sanitized := excerpt(compilerOutput, outcome.StderrTruncated || outcome.StdoutTruncated)
			result.CompilerOutput = &sanitized
		}

		if status, failed := classifyCompile(outcome); failed {
			// Nothing ran, so there are no test results to report — only why
			// the program never got as far as running.
			result.Status = status
			result.ExecutionTimeMs = float64(outcome.Duration.Milliseconds())
			return result
		}
	}

	return r.runCases(ctx, job, spec, session, result)
}

// runCases executes every test case in the already-prepared session.
func (r *Runner) runCases(
	ctx context.Context,
	job contract.Job,
	spec language.Spec,
	session *sandbox.Session,
	result contract.Result,
) contract.Result {
	caseTimeout := time.Duration(job.Limits.RunTimeoutMs) * time.Millisecond

	// A job with no cases still runs once, so a program that cannot start is
	// reported as a runtime failure instead of a silent pass.
	if len(job.TestCases) == 0 {
		outcome, err := session.Run(ctx, sandbox.ExecSpec{Cmd: spec.RunCmd, Timeout: caseTimeout})
		if err != nil {
			return r.systemError(job, err)
		}
		result.Status = classify(outcome)
		result.ExecutionTimeMs = float64(outcome.Duration.Milliseconds())
		return result
	}

	worst := contract.StatusGraded
	var totalDuration time.Duration

	for _, testCase := range job.TestCases {
		outcome, err := session.Run(ctx, sandbox.ExecSpec{
			Cmd:     spec.RunCmd,
			Stdin:   testCase.Input,
			Timeout: caseTimeout,
		})
		if err != nil {
			return r.systemError(job, err)
		}
		totalDuration += outcome.Duration

		status := classify(outcome)
		worst = escalate(worst, status)

		passed := false
		if status == contract.StatusGraded {
			matched, compareErr := grader.Compare(
				testCase.Comparison, testCase.ExpectedOutput, outcome.Stdout,
			)
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

		// A memory kill or a timeout ends the job rather than rolling on to the
		// next case. The container's OOM state is sticky once its cgroup has
		// fired, so every later case would inherit a verdict that is no longer
		// about it — and a wall-clock kill has already destroyed the container
		// the remaining cases would need.
		if status == contract.StatusMemoryLimitExceeded || status == contract.StatusTimeLimitExceeded {
			break
		}
	}

	result.Status = worst
	result.ExecutionTimeMs = float64(totalDuration.Milliseconds())
	return result
}

// classifyCompile maps a build step's outcome, and reports whether it failed.
//
// A compiler that exceeds the wall clock or the memory limit is not a
// COMPILE_ERROR: the program was never judged, and telling a Coder their code
// does not compile when the platform ran out of time would be a lie.
func classifyCompile(outcome sandbox.RunOutcome) (contract.Status, bool) {
	switch {
	case outcome.TimedOut:
		return contract.StatusTimeLimitExceeded, true
	case outcome.OOMKilled:
		return contract.StatusMemoryLimitExceeded, true
	case outcome.ExitCode != 0:
		return contract.StatusCompileError, true
	default:
		return contract.StatusGraded, false
	}
}

// classify maps one execution outcome to a status, in the documented
// precedence. OOM is read from the daemon's state rather than guessed from an
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
// A Python traceback names `/workspace/main.py` and a g++ diagnostic names
// `/workspace/main.cpp`; leaking the container filesystem layout to a Coder
// tells them where to aim. The file name itself is kept because it is the only
// thing that makes a traceback or a compiler error readable.
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
