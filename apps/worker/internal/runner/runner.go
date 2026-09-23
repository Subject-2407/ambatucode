// Package runner orchestrates one job: workspace, containers, comparison, and
// the result that goes back to the LMS.
package runner

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
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

// backstopMargin is how much longer than a case's own limit the worker waits
// before killing the whole container.
//
// A case's limit is enforced inside the container by `timeout`, which kills the
// case alone and leaves the container for the next case. The worker's deadline
// only fires when that fails — typically a process that escaped the case's
// process group and holds its output open — and then the container goes too.
const backstopMargin = 2 * time.Second

// notRunExcerpt explains a case that never started because the job's time ran
// out first. It is reported rather than omitted: leaving it out would score
// the submission on only the cases that happened to fit.
const notRunExcerpt = "not run: the submission's time budget was spent before this case"

type Runner struct {
	sandbox *sandbox.Sandbox
	logger  *slog.Logger
}

func New(box *sandbox.Sandbox, logger *slog.Logger) *Runner {
	return &Runner{sandbox: box, logger: logger}
}

// SandboxReachable reports whether the Docker daemon answers. A runner built
// without a sandbox, as in unit tests, is always reachable.
func (r *Runner) SandboxReachable(ctx context.Context) error {
	if r.sandbox == nil {
		return nil
	}
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return r.sandbox.Ping(probeCtx)
}

// Run executes a job and always returns a reportable result.
//
// An infrastructure failure becomes a SYSTEM_ERROR result rather than an error
// return: a submission with no result at all is worse than one marked as
// having failed inside the platform.
func (r *Runner) Run(ctx context.Context, job contract.Job) contract.Result {
	result, _ := r.Execute(ctx, job)
	return result
}

// Execute is Run that also says why a SYSTEM_ERROR happened. The error is
// non-nil only when the Docker daemon failed underneath the job — wrapping
// sandbox.ErrDaemonUnavailable — in which case the result describes the outage
// rather than the program, and must not be reported as its grade.
func (r *Runner) Execute(ctx context.Context, job contract.Job) (contract.Result, error) {
	base, err := language.Lookup(job.Language)
	if err != nil {
		return r.fail(job, err)
	}
	// Java needs the file named after the public class the program declares.
	// Every other language ignores its source here.
	spec := base.For(job.SourceCode)

	// The whole job — compile, every case, the script — shares one wall clock.
	// The container's keeper outlives it by a margin, so running out of this
	// budget is a time limit, never a container that vanished mid-case.
	deadline := time.Now().Add(time.Duration(job.Limits.WallTimeoutMs) * time.Millisecond)

	// A script with a bad path is refused before anything runs, rather than
	// after every case has already spent its time.
	for _, script := range job.TestScripts {
		if err := validateScriptPath(script, spec); err != nil {
			return r.fail(job, err)
		}
	}

	result, compiled, infra := r.runProgram(ctx, job, spec, deadline)
	if !compiled || len(job.TestScripts) == 0 || result.Status == contract.StatusSystemError {
		return result, infra
	}

	// Scripts run one after another, each in a fresh container, so one
	// script's leftovers — a conftest.py, compiled classes — cannot change
	// what the next one sees.
	scriptStarted := time.Now()
	for _, script := range job.TestScripts {
		scriptResults, scriptStatus, err := r.runScript(ctx, job, script, spec, deadline)
		if err != nil {
			return r.fail(job, err)
		}
		result.TestResults = append(result.TestResults, scriptResults...)
		result.Status = escalate(result.Status, scriptStatus)
	}
	result.ExecutionTimeMs += float64(time.Since(scriptStarted).Milliseconds())
	return result, nil
}

// runProgram compiles the submission and runs its stdin/stdout cases in one
// container, closed before any script phase opens its own. The second return
// is false when the program never built, so there is nothing left to test;
// the third is the daemon failure behind a SYSTEM_ERROR, if that is what it was.
func (r *Runner) runProgram(
	ctx context.Context,
	job contract.Job,
	spec language.Spec,
	deadline time.Time,
) (contract.Result, bool, error) {
	session, err := r.sandbox.Open(ctx, sandbox.SessionSpec{
		JobID:          job.JobID,
		Image:          spec.Image,
		WallTimeout:    time.Duration(job.Limits.WallTimeoutMs) * time.Millisecond,
		MemoryLimitMb:  job.Limits.MemoryLimitMb,
		MaxProcesses:   job.Limits.MaxProcesses,
		MaxOutputBytes: job.Limits.MaxOutputBytes,
		DeniedSyscalls: spec.DeniedSyscalls,
	})
	if err != nil {
		result, infra := r.fail(job, err)
		return result, false, infra
	}
	defer session.Close()

	if err := session.Write(ctx, sandbox.File{
		Name:    spec.SourceFile,
		Content: []byte(job.SourceCode),
	}); err != nil {
		result, infra := r.fail(job, err)
		return result, false, infra
	}

	result := baseResult(job)

	if spec.Compiled() {
		outcome, err := session.Run(ctx, sandbox.ExecSpec{
			Cmd:     spec.CompileCmd,
			Timeout: capToDeadline(time.Duration(job.Limits.CompileTimeoutMs)*time.Millisecond, deadline),
		})
		if err != nil {
			result, infra := r.fail(job, err)
			return result, false, infra
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
			return result, false, nil
		}
	}

	result, infra := r.runCases(ctx, job, spec, session, deadline, result)
	return result, true, infra
}

// caseRun is one case's execution, classified.
type caseRun struct {
	status   contract.Status
	outcome  sandbox.RunOutcome
	duration time.Duration
}

// runCases executes every test case in the already-prepared session.
//
// A case that crashes, runs out of time, or runs out of memory fails that case
// alone. The remaining cases still run, and the job's status is the most
// severe any case reached — so a submission is scored on every case it was
// given, not cut off at the first slow one.
func (r *Runner) runCases(
	ctx context.Context,
	job contract.Job,
	spec language.Spec,
	session *sandbox.Session,
	deadline time.Time,
	result contract.Result,
) (contract.Result, error) {
	meter := newOOMMeter(ctx, session)

	// A job with only scripts has nothing to run here: the scripts exercise
	// the program themselves.
	if len(job.TestCases) == 0 && len(job.TestScripts) > 0 {
		return result, nil
	}

	// A job with no cases still runs once, so a program that cannot start is
	// reported as a runtime failure instead of a silent pass.
	if len(job.TestCases) == 0 {
		run, err := r.runCase(ctx, session, spec, meter, "", job.Limits.RunTimeoutMs, job.Limits.MemoryLimitMb, deadline)
		if err != nil {
			return r.fail(job, err)
		}
		result.Status = run.status
		result.ExecutionTimeMs = float64(run.duration.Milliseconds())
		// A Run has no case to carry the output, so it gets a row of its own. A
		// submission never does: an extra row there would be graded.
		if job.Kind == contract.KindRun {
			result.TestResults = append(result.TestResults, freeRunRow(run))
		}
		return result, nil
	}

	worst := contract.StatusGraded
	var totalDuration time.Duration
	// Set when a case's outcome made every later one unknowable: the container
	// was killed, or a memory kill could not be attributed to one case.
	var stoppedBy contract.Status

	for _, testCase := range job.TestCases {
		if stoppedBy == "" && (!session.Alive() || !time.Now().Before(deadline)) {
			stoppedBy = contract.StatusTimeLimitExceeded
		}
		if stoppedBy != "" {
			result.TestResults = append(result.TestResults, notRun(testCase, stoppedBy))
			worst = escalate(worst, stoppedBy)
			continue
		}

		run, err := r.runCase(ctx, session, spec, meter, testCase.Input,
			testCase.RunTimeout(job.Limits), testCase.MemoryLimit(job.Limits), deadline)
		if err != nil {
			return r.fail(job, err)
		}
		totalDuration += run.duration
		worst = escalate(worst, run.status)

		passed := false
		if run.status == contract.StatusGraded {
			matched, compareErr := grader.Compare(testCase.Comparison, testCase.ExpectedOutput, run.outcome.Stdout)
			if compareErr != nil {
				return r.fail(job, compareErr)
			}
			passed = matched
		}

		result.TestResults = append(result.TestResults, contract.TestResult{
			TestCaseID:      stringPtr(testCase.ID),
			Name:            testCase.Name,
			Status:          run.status,
			Passed:          passed,
			Weight:          testCase.Weight,
			ExecutionTimeMs: float64(run.duration.Milliseconds()),
			MemoryUsedKb:    nil,
			StdoutExcerpt:   excerpt(run.outcome.Stdout, run.outcome.StdoutTruncated),
			StderrExcerpt:   excerpt(run.outcome.Stderr, run.outcome.StderrTruncated),
		})

		// Without a readable kill counter, the daemon's memory flag stays set
		// once raised, so no later case's memory verdict could be trusted.
		if run.status == contract.StatusMemoryLimitExceeded && !meter.attributable() {
			stoppedBy = contract.StatusMemoryLimitExceeded
		}
	}

	result.Status = worst
	result.ExecutionTimeMs = float64(totalDuration.Milliseconds())
	return result, nil
}

// freeRunRow reports what a program printed when there was no case to compare
// it with. Passed means only that it ran to completion, and the weight is zero
// because nothing here is ever scored.
func freeRunRow(run caseRun) contract.TestResult {
	return contract.TestResult{
		Name:            contract.FreeRunResultName,
		Status:          run.status,
		Passed:          run.status == contract.StatusGraded,
		ExecutionTimeMs: float64(run.duration.Milliseconds()),
		StdoutExcerpt:   excerpt(run.outcome.Stdout, run.outcome.StdoutTruncated),
		StderrExcerpt:   excerpt(run.outcome.Stderr, run.outcome.StderrTruncated),
	}
}

// runCase runs the program once under one case's limits and classifies it.
func (r *Runner) runCase(
	ctx context.Context,
	session *sandbox.Session,
	spec language.Spec,
	meter *oomMeter,
	stdin string,
	timeLimitMs, memoryLimitMb int64,
	deadline time.Time,
) (caseRun, error) {
	if err := session.SetMemoryLimit(ctx, memoryLimitMb); err != nil {
		return caseRun{}, err
	}

	budget := capToDeadline(time.Duration(timeLimitMs)*time.Millisecond, deadline)
	outcome, err := session.Run(ctx, sandbox.ExecSpec{
		Cmd:     withTimeout(budget, spec.RunCmd),
		Stdin:   stdin,
		Timeout: budget + backstopMargin,
	})
	if err != nil {
		return caseRun{}, err
	}

	return caseRun{
		status:   classifyCase(outcome, meter.killedDuring(ctx, outcome), budget),
		outcome:  outcome,
		duration: outcome.Duration,
	}, nil
}

// withTimeout bounds a command inside the container with GNU timeout.
//
// SIGKILL, because a program that traps SIGTERM must not get extra time.
// timeout signals its whole process group, so children the program forked die
// with it; only a process that deliberately left the group survives, and the
// worker's own deadline on the exec catches that one by killing the container.
func withTimeout(budget time.Duration, cmd []string) []string {
	seconds := strconv.FormatFloat(budget.Seconds(), 'f', 3, 64)
	return append([]string{"timeout", "--signal=KILL", seconds + "s"}, cmd...)
}

// capToDeadline shrinks a step's budget to what remains of the job's.
func capToDeadline(budget time.Duration, deadline time.Time) time.Duration {
	if remaining := time.Until(deadline); remaining < budget {
		if remaining < time.Millisecond {
			return time.Millisecond
		}
		return remaining
	}
	return budget
}

// timeoutKillExit is timeout's exit status when it had to SIGKILL the command:
// 128 plus the signal number.
const timeoutKillExit = 137

// classifyCase maps one case's outcome to a status, in the documented
// precedence.
//
// Exit 137 alone is ambiguous — the program killed by timeout, by the OOM
// killer, or by a signal of its own. The memory verdict comes from the kernel's
// counter, and a timeout kill is one that also lasted the whole budget.
func classifyCase(outcome sandbox.RunOutcome, oomKilled bool, budget time.Duration) contract.Status {
	switch {
	case outcome.TimedOut:
		return contract.StatusTimeLimitExceeded
	case outcome.ExitCode == timeoutKillExit && !oomKilled && outcome.Duration >= budget:
		return contract.StatusTimeLimitExceeded
	case oomKilled:
		return contract.StatusMemoryLimitExceeded
	case outcome.ExitCode != 0:
		return contract.StatusRuntimeError
	default:
		return contract.StatusGraded
	}
}

// oomMeter attributes memory kills to the case that caused them.
//
// The counter that can do that lives in the container's own cgroup, and
// reading it means starting a process in there — which on a loaded host takes
// longer than a short test case does to run, and would be paid by every case
// of every submission to answer "no" almost every time. So each run is first
// put to a screen built from what the daemon already handed back for free, and
// the counter is read only for a run the screen cannot clear.
type oomMeter struct {
	session *sandbox.Session

	// failures is the daemon's memory-failure count as of the last run
	// screened. It cannot miss a kill, so a count that has not moved is proof
	// that the run it covers was not killed for memory.
	failures      uint64
	failuresKnown bool

	// flagged records that the daemon's sticky OOM flag has already been seen
	// and accounted for, after which it says nothing about any later run.
	flagged bool

	// count is the cgroup counter as of the last authoritative read, and
	// available whether that counter can be read at all. resolved is false
	// until the first run the screen could not clear, since until then there
	// has been no reason to ask.
	resolved  bool
	available bool
	count     int64
}

func newOOMMeter(ctx context.Context, session *sandbox.Session) *oomMeter {
	meter := &oomMeter{session: session}
	meter.failures, meter.failuresKnown = session.MemoryFailures(ctx)
	if meter.failuresKnown && meter.failures == 0 {
		// Nothing in this container has reached its memory limit yet, and a
		// kill always reaches it — so the cgroup counter stands at zero too,
		// and the baseline is known without paying to read it.
		return meter
	}
	// Either there is no screen to start from, or something has already hit
	// the limit in here. Both leave the baseline unknown, and a run measured
	// against the wrong baseline would be blamed for a kill that predates it.
	meter.count, meter.available = session.OOMKills(ctx)
	meter.resolved = true
	return meter
}

// killedDuring reports whether a memory kill happened during the run that just
// produced outcome.
func (m *oomMeter) killedDuring(ctx context.Context, outcome sandbox.RunOutcome) bool {
	if !m.session.Alive() {
		// The daemon's flag: correct for the first kill, sticky afterwards —
		// the caller stops trusting later cases once it has fired.
		return outcome.OOMKilled
	}
	if !m.suspect(outcome) {
		return false
	}
	if m.resolved && !m.available {
		return outcome.OOMKilled
	}

	count, ok := m.session.OOMKills(ctx)
	m.resolved, m.available = true, ok
	if !ok {
		return outcome.OOMKilled
	}
	killed := count > m.count
	m.count = count
	return killed
}

// suspect reports whether the run that produced outcome could have involved a
// memory kill, from the two signals that cost nothing to obtain.
//
// Both are one-directional, which is the whole basis for screening on them: a
// kill always raises the failure count and always sets the daemon's flag, so a
// run that moved neither killed nothing. Either one moving means only that the
// cgroup counter is now worth reading.
func (m *oomMeter) suspect(outcome sandbox.RunOutcome) bool {
	// The count is carried forward first and unconditionally. Leaving it
	// behind on a run the flag screened in would leave every later run being
	// measured against a baseline the container has already passed, and each
	// of them paying for a counter read to find that out.
	moved := true
	if outcome.MemoryFailuresKnown {
		moved = outcome.MemoryFailures > m.failures
		m.failures = outcome.MemoryFailures
	}
	if outcome.OOMKilled && !m.flagged {
		m.flagged = true
		return true
	}
	return moved
}

// attributable reports whether a memory kill can still be pinned to the case
// that caused it. Once it cannot, no later case's memory verdict means
// anything, and the caller stops running them.
func (m *oomMeter) attributable() bool { return !m.resolved || m.available }

// notRun reports a case that never started.
func notRun(testCase contract.TestCase, status contract.Status) contract.TestResult {
	return contract.TestResult{
		TestCaseID:    stringPtr(testCase.ID),
		Name:          testCase.Name,
		Status:        status,
		Passed:        false,
		Weight:        testCase.Weight,
		StderrExcerpt: notRunExcerpt,
	}
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

// fail builds the SYSTEM_ERROR result for err, and passes err on when the
// Docker daemon is what failed.
func (r *Runner) fail(job contract.Job, err error) (contract.Result, error) {
	result := r.systemError(job, err)
	if errors.Is(err, sandbox.ErrDaemonUnavailable) {
		return result, err
	}
	return result, nil
}

func stringPtr(value string) *string { return &value }
