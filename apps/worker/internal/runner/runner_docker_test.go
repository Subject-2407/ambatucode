//go:build docker

// Integration tests for the runner against a real Docker daemon and real
// sandbox images.
//
// Opt-in, mirroring the repo's *.int.test.ts convention, because they need
// infrastructure a plain `go test ./...` must not require:
//
//	docker compose -f docker/compose/sandbox.yml build
//	go test -tags docker ./internal/runner/
//
// Run the Docker-tagged packages one at a time:
//
//	go test -tags docker -p 1 ./...
//
// The -p 1 is not optional. Go runs packages in parallel by default, and the
// container sweep these tests rely on finds containers by label across the
// whole daemon — so a sweep in one package deletes the live containers of
// another, and the failure surfaces as a program that mysteriously died
// mid-run rather than as anything resembling its cause.
//
// What these prove that a unit test cannot: that each language's spec actually
// compiles and runs inside the sandbox, and that every non-GRADED status is
// produced by a program that genuinely causes it rather than by a hand-built
// outcome struct.
package runner

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/language"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/sandbox"
)

func newDockerRunner(t *testing.T) *Runner {
	t.Helper()
	box, err := sandbox.New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("connect to docker: %v", err)
	}
	t.Cleanup(func() { _ = box.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := box.Ping(ctx); err != nil {
		t.Skipf("docker daemon is not reachable: %v", err)
	}
	if err := box.EnsureImages(ctx, language.Images()); err != nil {
		t.Skipf("sandbox images are not built: %v", err)
	}
	return New(box, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func limits() contract.Limits {
	return contract.Limits{
		CompileTimeoutMs: 30_000,
		RunTimeoutMs:     10_000,
		WallTimeoutMs:    90_000,
		MemoryLimitMb:    512,
		MaxOutputBytes:   65_536,
		MaxProcesses:     128,
	}
}

func job(lang contract.Language, source string, cases ...contract.TestCase) contract.Job {
	return contract.Job{
		ContractVersion: contract.Version,
		JobID:           "runner-integration",
		Kind:            contract.KindRun,
		Language:        lang,
		SourceCode:      source,
		Limits:          limits(),
		TestCases:       cases,
	}
}

func echoCase(name, input, expected string) contract.TestCase {
	return contract.TestCase{
		ID:             name,
		Name:           name,
		Input:          input,
		ExpectedOutput: expected,
		Weight:         1,
		IsPublic:       true,
		Comparison:     contract.ComparisonTrimmed,
	}
}

func execute(t *testing.T, runner *Runner, j contract.Job) contract.Result {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	return runner.Run(ctx, j)
}

// Every language reads stdin, writes stdout, and grades — across several cases
// in one submission, which is the shape a real assessment takes.
func TestEveryLanguageRunsAndGrades(t *testing.T) {
	runner := newDockerRunner(t)

	programs := map[contract.Language]string{
		contract.LanguagePython: "n = int(input())\nprint(n * 2)\n",

		contract.LanguageJavaScript: `const data = require("fs").readFileSync(0, "utf8").trim();
console.log(Number(data) * 2);
`,

		contract.LanguageJava: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        System.out.println(in.nextInt() * 2);
    }
}
`,

		contract.LanguageCPP: `#include <iostream>

int main() {
    int n;
    std::cin >> n;
    std::cout << n * 2 << std::endl;
    return 0;
}
`,
	}

	for lang, source := range programs {
		t.Run(string(lang), func(t *testing.T) {
			result := execute(t, runner, job(lang, source,
				echoCase("doubles two", "2", "4"),
				echoCase("doubles twenty-one", "21", "42"),
				echoCase("deliberately wrong", "5", "999"),
			))

			if result.Status != contract.StatusGraded {
				t.Fatalf("status = %s, compiler: %v, system: %v",
					result.Status, deref(result.CompilerOutput), deref(result.SystemError))
			}
			if len(result.TestResults) != 3 {
				t.Fatalf("got %d test results, want 3", len(result.TestResults))
			}
			if !result.TestResults[0].Passed || !result.TestResults[1].Passed {
				t.Fatalf("correct cases did not pass: %+v", result.TestResults)
			}
			// GRADED means the program ran, not that it was right. A wrong
			// answer is a failed case inside a graded submission.
			if result.TestResults[2].Passed {
				t.Fatal("a wrong answer was reported as passing")
			}
		})
	}
}

// Java requires a public class to live in a file of its own name. A Coder who
// writes `public class Solution` must not meet a compiler error about the
// platform's file naming.
func TestJavaAcceptsAnyPublicClassName(t *testing.T) {
	runner := newDockerRunner(t)

	source := `public class Solution {
    public static void main(String[] args) {
        System.out.println("named freely");
    }
}
`
	result := execute(t, runner, job(contract.LanguageJava, source,
		echoCase("runs", "", "named freely"),
	))

	if result.Status != contract.StatusGraded {
		t.Fatalf("status = %s, compiler: %v", result.Status, deref(result.CompilerOutput))
	}
	if !result.TestResults[0].Passed {
		t.Fatalf("case failed: %+v", result.TestResults[0])
	}
}

// A build failure is COMPILE_ERROR with the compiler's own message, and no test
// results at all — nothing ran, so there is nothing to report about it.
func TestCompileErrorCarriesTheCompilerMessage(t *testing.T) {
	runner := newDockerRunner(t)

	broken := map[contract.Language]string{
		contract.LanguageJava: "public class Main { this is not java }",
		contract.LanguageCPP:  "int main() { this is not c++ }",
	}

	for lang, source := range broken {
		t.Run(string(lang), func(t *testing.T) {
			result := execute(t, runner, job(lang, source, echoCase("never runs", "", "")))

			if result.Status != contract.StatusCompileError {
				t.Fatalf("status = %s, want COMPILE_ERROR", result.Status)
			}
			if result.CompilerOutput == nil || *result.CompilerOutput == "" {
				t.Fatal("a compile error with no compiler output tells a Coder nothing")
			}
			if len(result.TestResults) != 0 {
				t.Fatalf("nothing ran, so there are no case results: %+v", result.TestResults)
			}
			// The sandbox's own layout is not a Coder's business.
			if strings.Contains(*result.CompilerOutput, language.WorkspaceDir) {
				t.Fatalf("compiler output leaked the workspace path: %q", *result.CompilerOutput)
			}
		})
	}
}

// An interpreted language has no build step, so a syntax error surfaces when
// the program runs — as a runtime failure, not a compile one.
func TestInterpretedSyntaxErrorIsARuntimeError(t *testing.T) {
	runner := newDockerRunner(t)

	result := execute(t, runner, job(contract.LanguagePython, "def (:\n", echoCase("x", "", "")))

	if result.Status != contract.StatusRuntimeError {
		t.Fatalf("status = %s, want RUNTIME_ERROR", result.Status)
	}
}

func TestTimeoutIsReportedAsTimeLimitExceeded(t *testing.T) {
	runner := newDockerRunner(t)

	j := job(contract.LanguagePython, "while True:\n    pass\n", echoCase("hangs", "", ""))
	j.Limits.RunTimeoutMs = 3_000
	j.Limits.WallTimeoutMs = 30_000

	result := execute(t, runner, j)

	if result.Status != contract.StatusTimeLimitExceeded {
		t.Fatalf("status = %s, want TIME_LIMIT_EXCEEDED", result.Status)
	}
}

func TestMemoryBombIsReportedAsMemoryLimitExceeded(t *testing.T) {
	runner := newDockerRunner(t)

	j := job(contract.LanguagePython,
		"x = bytearray(400 * 1024 * 1024)\nprint(len(x))\n",
		echoCase("allocates", "", ""),
	)
	j.Limits.MemoryLimitMb = 64

	result := execute(t, runner, j)

	if result.Status != contract.StatusMemoryLimitExceeded {
		t.Fatalf("status = %s, want MEMORY_LIMIT_EXCEEDED", result.Status)
	}
}

// A language with no image and no registry entry is a configuration error the
// backend let through, not a participant mistake.
func TestUnknownLanguageIsASystemError(t *testing.T) {
	runner := newDockerRunner(t)

	result := execute(t, runner, job(contract.Language("rust"), "fn main() {}"))

	if result.Status != contract.StatusSystemError {
		t.Fatalf("status = %s, want SYSTEM_ERROR", result.Status)
	}
}

// A program printing without end must be truncated rather than allowed to
// exhaust the worker's memory.
func TestUnboundedOutputIsTruncatedNotFatal(t *testing.T) {
	runner := newDockerRunner(t)

	j := job(contract.LanguagePython,
		"import sys\nwhile True:\n    sys.stdout.write('x' * 4096)\n",
		echoCase("floods", "", ""),
	)
	j.Limits.RunTimeoutMs = 5_000
	j.Limits.MaxOutputBytes = 16_384

	result := execute(t, runner, j)

	// However it ends — the cap reached or the clock — the worker survived and
	// reported, and the excerpt is bounded.
	if result.Status == contract.StatusSystemError {
		t.Fatalf("unbounded output took the worker down: %v", deref(result.SystemError))
	}
	if len(result.TestResults) == 1 {
		if size := len(result.TestResults[0].StdoutExcerpt); size > excerptLimit+len(truncationMarker) {
			t.Fatalf("excerpt was %d bytes, over the reporting cap", size)
		}
	}
}

// Containers are single-use and removed on every path out, including the ones
// that end in a kill.
func TestContainersDoNotSurviveAJob(t *testing.T) {
	runner := newDockerRunner(t)

	j := job(contract.LanguagePython, "while True:\n    pass\n", echoCase("hangs", "", ""))
	j.Limits.RunTimeoutMs = 2_000
	execute(t, runner, j)

	box, err := sandbox.New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("connect to docker: %v", err)
	}
	defer box.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Nothing labelled should be left for the sweep to find.
	swept, err := box.SweepOrphans(ctx)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if swept != 0 {
		t.Fatalf("the job left %d container(s) behind", swept)
	}
}

func deref(value *string) string {
	if value == nil {
		return "<nil>"
	}
	return *value
}
