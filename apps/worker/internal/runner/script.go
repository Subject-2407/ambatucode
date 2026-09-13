package runner

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/grader"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/language"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/sandbox"
)

// maxReportBytes caps a framework report read back out of the container.
// JUnit's report carries every JVM property; a megabyte is still generous.
const maxReportBytes = 1 << 20

// minScriptBudget is the least time worth starting a test framework with.
// Below it the JVM alone would not finish launching, and the honest report is
// that the budget was spent.
const minScriptBudget = time.Second

// Names of the single result a script reports when it never produced a
// per-test report. They are Architect-facing only: script rows never reach a
// Coder.
const (
	scriptNotRunName     = "test script (not run: the submission's time budget was spent)"
	scriptCompileName    = "test script (did not compile against the submission)"
	scriptLimitName      = "test script (stopped at a limit)"
	scriptResultTestName = "test script"
)

// errScriptPlatform marks a script failure the platform owns — a framework
// that crashed without a report — which becomes SYSTEM_ERROR for the job.
var errScriptPlatform = errors.New("test script failed inside the platform")

// runScript runs a job's test script and returns its tests as results.
//
// It runs in a container of its own, opened after the stdin/stdout cases have
// finished and their container is gone. Nothing the Coder's program did in
// those cases — reading files, planting a conftest.py or a forged report — can
// reach the script's run, and the script's files, which hold expected values,
// were never present where the program could print them into a case excerpt.
//
// The Coder's code still runs inside the framework's own process, which is
// what importing it for a test means. A script result is only as tamper-proof
// as the framework it runs in.
func (r *Runner) runScript(
	ctx context.Context,
	job contract.Job,
	spec language.Spec,
	deadline time.Time,
) ([]contract.TestResult, contract.Status, error) {
	script := job.TestScript
	notRun := func(name string, status contract.Status) ([]contract.TestResult, contract.Status, error) {
		return []contract.TestResult{scriptResult(name, false, status, script.Weight, 0)}, status, nil
	}

	remaining := time.Until(deadline)
	if remaining < minScriptBudget {
		return notRun(scriptNotRunName, contract.StatusTimeLimitExceeded)
	}

	paths, err := validateScriptPaths(script, spec)
	if err != nil {
		return nil, "", err
	}
	reportDir, err := newReportDir()
	if err != nil {
		return nil, "", err
	}
	plan, err := spec.PlanScript(script.Framework, language.ScriptInput{
		Entrypoint: script.Entrypoint,
		Files:      paths,
		ReportDir:  reportDir,
	})
	if err != nil {
		return nil, "", err
	}

	session, err := r.sandbox.Open(ctx, sandbox.SessionSpec{
		JobID:          job.JobID,
		Image:          spec.Image,
		WallTimeout:    remaining,
		MemoryLimitMb:  job.Limits.MemoryLimitMb,
		MaxProcesses:   job.Limits.MaxProcesses,
		MaxOutputBytes: job.Limits.MaxOutputBytes,
	})
	if err != nil {
		return nil, "", err
	}
	defer session.Close()

	if err := session.Write(ctx, sandbox.File{Name: spec.SourceFile, Content: []byte(job.SourceCode)}); err != nil {
		return nil, "", err
	}

	// The program is built again here rather than carried across: the first
	// container is gone. It already compiled once, so a failure now is the
	// platform's, not the Coder's.
	if spec.Compiled() {
		outcome, err := session.Run(ctx, sandbox.ExecSpec{
			Cmd:     spec.CompileCmd,
			Timeout: capToDeadline(time.Duration(job.Limits.CompileTimeoutMs)*time.Millisecond, deadline),
		})
		if err != nil {
			return nil, "", err
		}
		if status, failed := classifyCompile(outcome); failed {
			if status == contract.StatusCompileError {
				return nil, "", fmt.Errorf("%w: the submission compiled for its cases but not for its script", errScriptPlatform)
			}
			return notRun(scriptLimitName, status)
		}
	}

	for _, file := range script.Files {
		if err := session.Write(ctx, sandbox.File{Name: file.Path, Content: []byte(file.Content)}); err != nil {
			return nil, "", err
		}
	}
	if err := session.MakePrivateDir(ctx, reportDir); err != nil {
		return nil, "", err
	}

	meter := newOOMMeter(ctx, session)

	if plan.Compile != nil {
		budget := capToDeadline(time.Duration(job.Limits.CompileTimeoutMs)*time.Millisecond, deadline)
		outcome, err := session.Run(ctx, sandbox.ExecSpec{
			Cmd:     withTimeout(budget, plan.Compile),
			Env:     plan.Env,
			Timeout: budget + backstopMargin,
		})
		if err != nil {
			return nil, "", err
		}
		switch status := classifyCase(outcome, meter.killedDuring(ctx, outcome), budget); {
		case status != contract.StatusGraded && status != contract.StatusRuntimeError:
			return notRun(scriptLimitName, status)
		case outcome.ExitCode != 0:
			// Almost always a test calling something the submission does not
			// define. That is the Coder's shortfall, so the script fails as a
			// test; its compiler output stays out, since it quotes the script.
			return notRun(scriptCompileName, contract.StatusRuntimeError)
		}
	}

	budget := capToDeadline(time.Until(deadline), deadline)
	outcome, err := session.Run(ctx, sandbox.ExecSpec{
		Cmd:     withTimeout(budget, plan.Run),
		Env:     plan.Env,
		Timeout: budget + backstopMargin,
	})
	if err != nil {
		return nil, "", err
	}

	// A limit hit means the framework never finished, and a partial report is
	// not a verdict on the tests it did not reach.
	status := classifyCase(outcome, meter.killedDuring(ctx, outcome), budget)
	if status == contract.StatusTimeLimitExceeded || status == contract.StatusMemoryLimitExceeded {
		return notRun(scriptLimitName, status)
	}

	tests, err := readScriptReports(ctx, session, plan)
	if err != nil {
		return nil, "", err
	}

	results := make([]contract.TestResult, 0, len(tests))
	for _, test := range tests {
		results = append(results, scriptResult(test.Name, test.Passed, contract.StatusGraded, script.Weight, test.DurationMs))
	}
	// Failing tests leave the submission GRADED: the tests ran, and their
	// failures are what the score records.
	return results, contract.StatusGraded, nil
}

// readScriptReports collects every report the plan names. A framework that
// wrote none crashed, which is the platform's failure rather than a test's.
func readScriptReports(ctx context.Context, session *sandbox.Session, plan language.ScriptPlan) ([]grader.ScriptTest, error) {
	var tests []grader.ScriptTest
	found := false
	for _, report := range plan.Reports {
		data, exists, err := session.ReadFile(ctx, report, maxReportBytes)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", errScriptPlatform, err)
		}
		if !exists {
			continue
		}
		found = true
		parsed, err := grader.ParseReport(plan.Format, data)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", errScriptPlatform, err)
		}
		tests = append(tests, parsed...)
	}
	if !found {
		return nil, fmt.Errorf("%w: the test framework wrote no report", errScriptPlatform)
	}
	return tests, nil
}

// scriptResult is one script test as a result row.
//
// Its excerpts are always empty. A framework's output quotes assertions and
// the values they expected, and a script is grading data — script rows are
// never shown to a Coder, but the excerpt is simply not the place for it.
func scriptResult(name string, passed bool, status contract.Status, weight, durationMs float64) contract.TestResult {
	if name == "" {
		name = scriptResultTestName
	}
	return contract.TestResult{
		TestCaseID:      nil,
		Name:            name,
		Status:          status,
		Passed:          passed,
		Weight:          weight,
		ExecutionTimeMs: durationMs,
	}
}

// newReportDir picks a report directory nothing earlier could have guessed.
func newReportDir() (string, error) {
	suffix := make([]byte, 12)
	if _, err := rand.Read(suffix); err != nil {
		return "", fmt.Errorf("generate report directory name: %w", err)
	}
	return "/tmp/ambatucode-report-" + hex.EncodeToString(suffix), nil
}
