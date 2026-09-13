//go:build docker

// Per-case limits and continuation, against the real sandbox.
//
//	docker compose -f docker/compose/sandbox.yml build
//	go test -tags docker -p 1 ./...
//
// A case that exceeds its limit or crashes fails that case alone: these prove
// the remaining cases still run — in the same container, next to what was
// compiled — and that the job's status is the most severe any case reached.
package runner

import (
	"testing"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
)

func int64Ptr(value int64) *int64 { return &value }

func statuses(result contract.Result) []contract.Status {
	out := make([]contract.Status, 0, len(result.TestResults))
	for _, testResult := range result.TestResults {
		out = append(out, testResult.Status)
	}
	return out
}

func assertCases(t *testing.T, result contract.Result, wantStatuses []contract.Status, wantPassed []bool) {
	t.Helper()
	if len(result.TestResults) != len(wantStatuses) {
		t.Fatalf("got %d case results %v, want %d (system error: %s)",
			len(result.TestResults), statuses(result), len(wantStatuses), deref(result.SystemError))
	}
	for i, testResult := range result.TestResults {
		if testResult.Status != wantStatuses[i] || testResult.Passed != wantPassed[i] {
			t.Fatalf("case %d (%s): status %s passed %v, want %s passed %v; stderr %q",
				i, testResult.Name, testResult.Status, testResult.Passed,
				wantStatuses[i], wantPassed[i], testResult.StderrExcerpt)
		}
	}
}

// The input decides how the program misbehaves, so one program covers every
// case in the job.
const behaviourByInput = `import sys, time
mode = sys.stdin.read().strip()
if mode == "hang":
    while True:
        pass
elif mode == "hog":
    hoard = []
    while True:
        hoard.append(bytearray(32 * 1024 * 1024))
elif mode == "crash":
    raise RuntimeError("boom")
elif mode.startswith("sleep:"):
    time.sleep(float(mode.split(":")[1]))
    print("slept")
else:
    print("ok")
`

func behaviourJob(cases ...contract.TestCase) contract.Job {
	j := job(contract.LanguagePython, behaviourByInput, cases...)
	j.Limits.RunTimeoutMs = 1_500
	j.Limits.MemoryLimitMb = 128
	return j
}

// A time limit, a memory kill, and a crash each fail one case; the cases after
// them still run and pass, and the job reports the most severe.
func TestLimitHitsFailOnlyTheirOwnCase(t *testing.T) {
	runner := newDockerRunner(t)

	result := execute(t, runner, behaviourJob(
		echoCase("hangs", "hang", ""),
		echoCase("after the hang", "fine", "ok"),
		echoCase("hogs memory", "hog", ""),
		echoCase("after the memory kill", "fine", "ok"),
		echoCase("crashes", "crash", ""),
		echoCase("after the crash", "fine", "ok"),
	))

	assertCases(t, result,
		[]contract.Status{
			contract.StatusTimeLimitExceeded, contract.StatusGraded,
			contract.StatusMemoryLimitExceeded, contract.StatusGraded,
			contract.StatusRuntimeError, contract.StatusGraded,
		},
		[]bool{false, true, false, true, false, true},
	)
	if result.Status != contract.StatusTimeLimitExceeded {
		t.Fatalf("job status = %s, want the most severe case status TIME_LIMIT_EXCEEDED", result.Status)
	}
}

// A compiled program is built once. A case that times out must not take the
// container — and the binary in it — down with it.
func TestCompiledProgramSurvivesATimedOutCase(t *testing.T) {
	runner := newDockerRunner(t)

	source := `#include <iostream>
#include <string>
int main() {
    std::string mode;
    std::cin >> mode;
    if (mode == "hang") { for (;;) {} }
    std::cout << "ok" << std::endl;
    return 0;
}
`
	j := job(contract.LanguageCPP, source,
		echoCase("hangs", "hang", ""),
		echoCase("still runs", "fine", "ok"),
	)
	j.Limits.RunTimeoutMs = 1_500

	result := execute(t, runner, j)

	assertCases(t, result,
		[]contract.Status{contract.StatusTimeLimitExceeded, contract.StatusGraded},
		[]bool{false, true},
	)
}

// A case's own time limit replaces the job's for that case alone.
func TestPerCaseTimeLimitOverridesTheJobLimit(t *testing.T) {
	runner := newDockerRunner(t)

	generous := echoCase("given four seconds", "sleep:2.5", "slept")
	generous.TimeLimitMs = int64Ptr(4_000)
	strict := echoCase("held to the job limit", "sleep:2.5", "slept")

	j := behaviourJob(generous, strict)
	j.Limits.RunTimeoutMs = 1_000

	result := execute(t, runner, j)

	assertCases(t, result,
		[]contract.Status{contract.StatusGraded, contract.StatusTimeLimitExceeded},
		[]bool{true, false},
	)
}

// A case's own memory limit replaces the job's for that case alone, in both
// directions.
func TestPerCaseMemoryLimitOverridesTheJobLimit(t *testing.T) {
	runner := newDockerRunner(t)

	source := `import sys
size = int(sys.stdin.read().strip())
block = bytearray(size * 1024 * 1024)
print("allocated")
`
	roomy := echoCase("allowed 512 MB", "300", "allocated")
	roomy.MemoryLimitMb = int64Ptr(512)
	tight := echoCase("held to the job's 128 MB", "300", "")
	cramped := echoCase("allowed only 32 MB", "64", "")
	cramped.MemoryLimitMb = int64Ptr(32)
	fits := echoCase("fits the job limit", "16", "allocated")

	j := job(contract.LanguagePython, source, roomy, tight, cramped, fits)
	j.Limits.MemoryLimitMb = 128

	result := execute(t, runner, j)

	assertCases(t, result,
		[]contract.Status{
			contract.StatusGraded, contract.StatusMemoryLimitExceeded,
			contract.StatusMemoryLimitExceeded, contract.StatusGraded,
		},
		[]bool{true, false, false, true},
	)
}

// When the job's wall clock runs out, the cases it never reached are reported
// as failed on time rather than left out of the score.
func TestCasesPastTheWallBudgetAreReportedNotDropped(t *testing.T) {
	runner := newDockerRunner(t)

	j := behaviourJob(
		echoCase("first sleeper", "sleep:1.2", "slept"),
		echoCase("second sleeper", "sleep:1.2", "slept"),
		echoCase("never reached", "fine", "ok"),
		echoCase("also never reached", "fine", "ok"),
	)
	j.Limits.RunTimeoutMs = 5_000
	j.Limits.WallTimeoutMs = 2_000

	result := execute(t, runner, j)

	if len(result.TestResults) != 4 {
		t.Fatalf("got %d results %v; every case must be reported", len(result.TestResults), statuses(result))
	}
	last := result.TestResults[3]
	if last.Passed || last.Status != contract.StatusTimeLimitExceeded || last.StderrExcerpt != notRunExcerpt {
		t.Fatalf("an unreached case was reported as %+v", last)
	}
	if result.Status != contract.StatusTimeLimitExceeded {
		t.Fatalf("job status = %s, want TIME_LIMIT_EXCEEDED", result.Status)
	}
}

// A process that leaves the case's process group and holds its output open
// escapes timeout. The backstop kills the container; every later case is then
// reported as not run, never as a platform failure.
func TestEscapedProcessIsCaughtByTheBackstop(t *testing.T) {
	runner := newDockerRunner(t)

	source := `import os, sys, time
mode = sys.stdin.read().strip()
if mode == "escape":
    if os.fork() == 0:
        os.setsid()
        time.sleep(3600)
    print("parent exited")
    sys.stdout.flush()
    os.wait()
else:
    print("ok")
`
	j := job(contract.LanguagePython, source,
		echoCase("escapes its group", "escape", ""),
		echoCase("after the container died", "fine", "ok"),
	)
	j.Limits.RunTimeoutMs = 1_000

	result := execute(t, runner, j)

	if result.Status == contract.StatusSystemError {
		t.Fatalf("an escaped process surfaced as a platform failure: %s", deref(result.SystemError))
	}
	assertCases(t, result,
		[]contract.Status{contract.StatusTimeLimitExceeded, contract.StatusTimeLimitExceeded},
		[]bool{false, false},
	)
}
