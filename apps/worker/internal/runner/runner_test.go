package runner

import (
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/language"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/sandbox"
)

func TestClassifyCaseFollowsDocumentedPrecedence(t *testing.T) {
	budget := 2 * time.Second
	cases := []struct {
		name    string
		outcome sandbox.RunOutcome
		oom     bool
		want    contract.Status
	}{
		{"clean exit", sandbox.RunOutcome{ExitCode: 0, Duration: time.Second}, false, contract.StatusGraded},
		{"non-zero exit", sandbox.RunOutcome{ExitCode: 1, Duration: time.Second}, false, contract.StatusRuntimeError},
		// timeout's SIGKILL: exit 137, having used the whole budget.
		{"killed by timeout", sandbox.RunOutcome{ExitCode: 137, Duration: budget + 10*time.Millisecond}, false, contract.StatusTimeLimitExceeded},
		// The worker's own backstop fired and took the container.
		{"killed by the backstop", sandbox.RunOutcome{TimedOut: true}, false, contract.StatusTimeLimitExceeded},
		// 137 from the OOM killer, well inside the budget.
		{"memory kill", sandbox.RunOutcome{ExitCode: 137, Duration: 300 * time.Millisecond}, true, contract.StatusMemoryLimitExceeded},
		// A memory kill that happens to land at the limit is still memory: the
		// kernel's counter is the evidence, the clock only a heuristic.
		{"memory kill at the limit", sandbox.RunOutcome{ExitCode: 137, Duration: budget}, true, contract.StatusMemoryLimitExceeded},
		// A program that SIGKILLs itself early is its own crash, not a timeout.
		{"early self-kill", sandbox.RunOutcome{ExitCode: 137, Duration: 100 * time.Millisecond}, false, contract.StatusRuntimeError},
		{"backstop outranks oom", sandbox.RunOutcome{TimedOut: true}, true, contract.StatusTimeLimitExceeded},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := classifyCase(testCase.outcome, testCase.oom, budget); got != testCase.want {
				t.Fatalf("classifyCase = %s, want %s", got, testCase.want)
			}
		})
	}
}

// The limit is enforced inside the container by an argument vector, never a
// shell string, and the program's own vector is passed through untouched.
func TestWithTimeoutPrefixesTheCommandWithoutAShell(t *testing.T) {
	got := withTimeout(2500*time.Millisecond, []string{"python3", "/workspace/main.py"})
	want := []string{"timeout", "--signal=KILL", "2.500s", "python3", "/workspace/main.py"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("command = %q, want %q", got, want)
	}
}

// A case never gets more time than the job has left.
func TestCapToDeadlineShrinksToTheRemainingBudget(t *testing.T) {
	if got := capToDeadline(5*time.Second, time.Now().Add(time.Minute)); got != 5*time.Second {
		t.Fatalf("budget with time to spare = %s, want 5s", got)
	}
	if got := capToDeadline(5*time.Second, time.Now().Add(time.Second)); got > time.Second {
		t.Fatalf("budget near the deadline = %s, want at most 1s", got)
	}
	if got := capToDeadline(5*time.Second, time.Now().Add(-time.Second)); got <= 0 {
		t.Fatalf("budget past the deadline = %s, want a small positive value", got)
	}
}

// A case that never started is still reported, failed, so the submission is
// scored on every case it was given.
func TestNotRunReportsTheCaseAsFailed(t *testing.T) {
	testCase := contract.TestCase{ID: "case-9", Name: "late", Weight: 3}
	got := notRun(testCase, contract.StatusTimeLimitExceeded)

	if got.Passed || got.Status != contract.StatusTimeLimitExceeded || got.Weight != 3 {
		t.Fatalf("not-run result = %+v", got)
	}
	if got.TestCaseID == nil || *got.TestCaseID != "case-9" {
		t.Fatal("a not-run result lost its case id, so it could not be scored")
	}
}

// GRADED is the floor: it means every case ran, not that any passed. One bad
// case has to pull the whole submission's status up to the worst seen.
func TestEscalateKeepsTheMostSevereStatus(t *testing.T) {
	if got := escalate(contract.StatusGraded, contract.StatusRuntimeError); got != contract.StatusRuntimeError {
		t.Fatalf("got %s, want RUNTIME_ERROR", got)
	}
	if got := escalate(contract.StatusTimeLimitExceeded, contract.StatusRuntimeError); got != contract.StatusTimeLimitExceeded {
		t.Fatalf("a later mild failure must not mask a timeout, got %s", got)
	}
	if got := escalate(contract.StatusGraded, contract.StatusGraded); got != contract.StatusGraded {
		t.Fatalf("got %s, want GRADED", got)
	}
	if got := escalate(contract.StatusRuntimeError, contract.StatusSystemError); got != contract.StatusSystemError {
		t.Fatalf("got %s, want SYSTEM_ERROR", got)
	}
}

// A traceback naming the container's filesystem layout tells a Coder exactly
// where the sandbox keeps things.
func TestSanitizeStripsTheWorkspacePath(t *testing.T) {
	traceback := `Traceback (most recent call last):
  File "` + language.WorkspaceDir + `/main.py", line 3, in <module>
    raise ValueError("boom")`

	cleaned := sanitize(traceback)
	if strings.Contains(cleaned, language.WorkspaceDir) {
		t.Fatalf("workspace path survived sanitizing: %q", cleaned)
	}
	// The file name itself is what makes a traceback readable, so it stays.
	if !strings.Contains(cleaned, "main.py") {
		t.Fatalf("expected the file name to be kept: %q", cleaned)
	}
}

func TestExcerptTruncatesAndMarks(t *testing.T) {
	long := strings.Repeat("x", excerptLimit+500)

	got := excerpt(long, false)
	if !strings.HasSuffix(got, truncationMarker) {
		t.Fatal("expected an explicit truncation marker")
	}
	if len(got) != excerptLimit+len(truncationMarker) {
		t.Fatalf("excerpt length %d, want %d", len(got), excerptLimit+len(truncationMarker))
	}

	// Output the sandbox already capped is marked even when it fits here.
	if got := excerpt("short", true); !strings.HasSuffix(got, truncationMarker) {
		t.Fatalf("expected sandbox-level truncation to be surfaced, got %q", got)
	}
	if got := excerpt("short", false); got != "short" {
		t.Fatalf("expected untouched output, got %q", got)
	}
}

// The detailed cause belongs in the logs, where it may name images and daemon
// internals; what reaches a Coder says only that the platform failed.
func TestSystemErrorResultDoesNotLeakInternals(t *testing.T) {
	job := contract.Job{JobID: "job-1"}
	result := newTestRunner().systemError(job, errorWithWorkspacePath())

	if result.Status != contract.StatusSystemError {
		t.Fatalf("status = %s", result.Status)
	}
	if result.SystemError == nil {
		t.Fatal("expected a system error message")
	}
	if strings.Contains(*result.SystemError, language.WorkspaceDir) {
		t.Fatalf("system error leaked the workspace path: %q", *result.SystemError)
	}
	if result.TestResults == nil {
		t.Fatal("test results must be an empty slice, not null")
	}
}

type pathError struct{}

func (pathError) Error() string { return "open " + language.WorkspaceDir + "/main.py: denied" }

func errorWithWorkspacePath() error { return pathError{} }

// newTestRunner builds a Runner with a discarding logger for the pure helpers.
func newTestRunner() *Runner {
	return New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

// A build step fails differently from a program that ran and crashed, and the
// difference matters to the person reading the result: COMPILE_ERROR means
// "your code does not build", while a timeout or a memory kill during
// compilation means the platform never got far enough to judge it. Telling a
// Coder their code does not compile when the compiler ran out of time would be
// a lie about their work.
func TestClassifyCompileSeparatesBuildFailureFromPlatformLimits(t *testing.T) {
	cases := []struct {
		name       string
		outcome    sandbox.RunOutcome
		wantStatus contract.Status
		wantFailed bool
	}{
		{"clean build", sandbox.RunOutcome{ExitCode: 0}, contract.StatusGraded, false},
		{"syntax error", sandbox.RunOutcome{ExitCode: 1}, contract.StatusCompileError, true},
		{
			"compiler ran out of time",
			sandbox.RunOutcome{TimedOut: true, ExitCode: 137},
			contract.StatusTimeLimitExceeded,
			true,
		},
		{
			"compiler ran out of memory",
			sandbox.RunOutcome{OOMKilled: true, ExitCode: 137},
			contract.StatusMemoryLimitExceeded,
			true,
		},
		{
			// Both kills surface as 137; ours fired first, so it wins.
			"timeout outranks oom",
			sandbox.RunOutcome{TimedOut: true, OOMKilled: true},
			contract.StatusTimeLimitExceeded,
			true,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			status, failed := classifyCompile(testCase.outcome)
			if status != testCase.wantStatus || failed != testCase.wantFailed {
				t.Fatalf(
					"classifyCompile = (%s, %v), want (%s, %v)",
					status, failed, testCase.wantStatus, testCase.wantFailed,
				)
			}
		})
	}
}

// COMPILE_ERROR outranks every ordinary run failure: a program that never
// built cannot also have crashed, and the compiler's message is the only thing
// worth reporting.
func TestCompileErrorOutranksRunFailures(t *testing.T) {
	for _, lesser := range []contract.Status{
		contract.StatusGraded,
		contract.StatusRuntimeError,
		contract.StatusMemoryLimitExceeded,
		contract.StatusTimeLimitExceeded,
	} {
		if got := escalate(lesser, contract.StatusCompileError); got != contract.StatusCompileError {
			t.Fatalf("escalate(%s, COMPILE_ERROR) = %s", lesser, got)
		}
	}
}

// A g++ diagnostic names the source file by its full path inside the sandbox.
// The name is what makes the error readable; the directory tells a Coder where
// the container keeps things.
func TestCompilerOutputIsSanitizedBeforeItReachesACoder(t *testing.T) {
	diagnostic := language.WorkspaceDir + "/main.cpp:4:5: error: 'x' was not declared in this scope"

	cleaned := excerpt(diagnostic, false)
	if strings.Contains(cleaned, language.WorkspaceDir) {
		t.Fatalf("workspace path survived: %q", cleaned)
	}
	if !strings.Contains(cleaned, "main.cpp:4:5") {
		t.Fatalf("expected the file and line to be kept: %q", cleaned)
	}
}
