package runner

import (
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/language"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/sandbox"
)

func TestClassifyFollowsDocumentedPrecedence(t *testing.T) {
	cases := []struct {
		name    string
		outcome sandbox.RunOutcome
		want    contract.Status
	}{
		{"clean exit", sandbox.RunOutcome{ExitCode: 0}, contract.StatusGraded},
		{"non-zero exit", sandbox.RunOutcome{ExitCode: 1}, contract.StatusRuntimeError},
		{"oom", sandbox.RunOutcome{ExitCode: 137, OOMKilled: true}, contract.StatusMemoryLimitExceeded},
		{"timeout", sandbox.RunOutcome{ExitCode: 137, TimedOut: true}, contract.StatusTimeLimitExceeded},
		// A memory kill and a timeout kill both surface as 137. Timeout wins
		// because our deadline fired first; OOM is read from the daemon flag.
		{"timeout outranks oom", sandbox.RunOutcome{TimedOut: true, OOMKilled: true}, contract.StatusTimeLimitExceeded},
		{"oom outranks a plain crash", sandbox.RunOutcome{ExitCode: 137, OOMKilled: true}, contract.StatusMemoryLimitExceeded},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := classify(testCase.outcome); got != testCase.want {
				t.Fatalf("classify = %s, want %s", got, testCase.want)
			}
		})
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
