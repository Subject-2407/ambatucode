//go:build docker

// Test scripts against the real sandbox images and frameworks.
//
//	docker compose -f docker/compose/sandbox.yml build
//	go test -tags docker -p 1 ./...
package runner

import (
	"strings"
	"testing"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
)

func scriptJob(lang contract.Language, source string, framework contract.TestScriptFramework,
	path, content string, cases ...contract.TestCase) contract.Job {
	j := job(lang, source, cases...)
	j.Kind = contract.KindSubmit
	j.TestScripts = []contract.TestScript{{ID: "script-1", Framework: framework, Path: path, Content: content, Weight: 2}}
	return j
}

type wantTest struct {
	name   string
	passed bool
}

func assertScriptTests(t *testing.T, result contract.Result, want []wantTest) {
	t.Helper()
	if result.Status == contract.StatusSystemError {
		t.Fatalf("system error: %s", deref(result.SystemError))
	}
	var scripts []contract.TestResult
	for _, testResult := range result.TestResults {
		if testResult.TestCaseID == nil {
			scripts = append(scripts, testResult)
		}
	}
	if len(scripts) != len(want) {
		t.Fatalf("got %d script results %+v, want %d", len(scripts), scripts, len(want))
	}
	// Matched by name, not position: frameworks do not promise to run or
	// report tests in the order they were written.
	for _, expected := range want {
		var got *contract.TestResult
		for i := range scripts {
			if strings.Contains(scripts[i].Name, expected.name) {
				got = &scripts[i]
				break
			}
		}
		if got == nil {
			t.Fatalf("no script test named like %q in %+v", expected.name, scripts)
		}
		if got.Passed != expected.passed {
			t.Fatalf("script test %q passed %v, want %v", got.Name, got.Passed, expected.passed)
		}
		if got.TestScriptID == nil || *got.TestScriptID == "" {
			t.Fatalf("script test %q does not name its script", got.Name)
		}
		if got.Weight != 2 {
			t.Fatalf("script test %q has weight %v, want the script's weight 2", got.Name, got.Weight)
		}
		// A framework's output quotes the assertions and the values they
		// expected; none of it may travel in an excerpt.
		if got.StdoutExcerpt != "" || got.StderrExcerpt != "" {
			t.Fatalf("script test %q carries excerpts: %q / %q", got.Name, got.StdoutExcerpt, got.StderrExcerpt)
		}
	}
}

func TestPytestScriptGradesTheSubmission(t *testing.T) {
	runner := newDockerRunner(t)

	result := execute(t, runner, scriptJob(contract.LanguagePython,
		"def add(a, b):\n    return a + b\n",
		contract.FrameworkPytest, "tests/test_main.py",
		"from main import add\n\ndef test_adds():\n    assert add(2, 3) == 5\n\ndef test_wrong():\n    assert add(2, 2) == 5\n",
	))

	assertScriptTests(t, result, []wantTest{{"test_adds", true}, {"test_wrong", false}})
	if result.Status != contract.StatusGraded {
		t.Fatalf("status = %s; failing tests leave the submission GRADED", result.Status)
	}
}

// F: stdin/stdout cases and a script both run, cases first.
func TestCasesAndScriptBothRun(t *testing.T) {
	runner := newDockerRunner(t)

	source := "import sys\n\ndef add(a, b):\n    return a + b\n\nif __name__ == '__main__':\n    a, b = map(int, sys.stdin.read().split())\n    print(add(a, b))\n"
	result := execute(t, runner, scriptJob(contract.LanguagePython, source,
		contract.FrameworkPytest, "test_add.py",
		"from main import add\n\ndef test_adds():\n    assert add(1, 1) == 2\n",
		echoCase("sums stdin", "2 3", "5"),
	))

	if len(result.TestResults) != 2 || result.TestResults[0].TestCaseID == nil || !result.TestResults[0].Passed {
		t.Fatalf("results = %+v; want the passing case first, then the script", result.TestResults)
	}
	assertScriptTests(t, result, []wantTest{{"test_adds", true}})
}

// The Coder's program cannot read the script during its own cases: the script
// runs in a container that did not exist yet.
func TestCaseCannotReadTheScriptFiles(t *testing.T) {
	runner := newDockerRunner(t)

	source := `import os
found = []
for root, _, files in os.walk("/workspace"):
    for name in files:
        if name.startswith("test_"):
            found.append(open(os.path.join(root, name)).read())
print("LEAK " + " ".join(found) if found else "nothing")
`
	result := execute(t, runner, scriptJob(contract.LanguagePython, source,
		contract.FrameworkPytest, "test_secret.py",
		"def test_secret():\n    assert 'EXPECTED_SECRET' == 'EXPECTED_SECRET'\n",
		echoCase("snoops", "", "nothing"),
	))

	if strings.Contains(result.TestResults[0].StdoutExcerpt, "EXPECTED_SECRET") {
		t.Fatalf("a case read the script: %q", result.TestResults[0].StdoutExcerpt)
	}
	if !result.TestResults[0].Passed {
		t.Fatalf("case output = %q", result.TestResults[0].StdoutExcerpt)
	}
}

// A syntax error in the submission is the Coder's failure, not the platform's.
func TestPytestImportFailureIsAFailedTest(t *testing.T) {
	runner := newDockerRunner(t)

	result := execute(t, runner, scriptJob(contract.LanguagePython, "def add(a, b)\n",
		contract.FrameworkPytest, "test_main.py",
		"from main import add\n\ndef test_adds():\n    assert add(1, 1) == 2\n",
	))

	assertScriptTests(t, result, []wantTest{{"test_main", false}})
}

func TestJestScriptGradesTheSubmission(t *testing.T) {
	runner := newDockerRunner(t)

	result := execute(t, runner, scriptJob(contract.LanguageJavaScript,
		"module.exports = { add: (a, b) => a + b };\n",
		contract.FrameworkJest, "checks/add.check.js",
		`const { add } = require("../main");
test("adds", () => { expect(add(2, 3)).toBe(5); });
describe("group", () => { test("wrong", () => { expect(add(2, 2)).toBe(5); }); });
`,
	))

	assertScriptTests(t, result, []wantTest{{"adds", true}, {"group wrong", false}})
}

func TestJUnitScriptGradesTheSubmission(t *testing.T) {
	runner := newDockerRunner(t)

	result := execute(t, runner, scriptJob(contract.LanguageJava,
		"public class Solution {\n    public static int add(int a, int b) { return a + b; }\n}\n",
		contract.FrameworkJUnit, "tests/SolutionTest.java",
		`package tests;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

public class SolutionTest {
    @Test void adds() { assertEquals(5, Solution.add(2, 3)); }
    @Test void wrong() { assertEquals(5, Solution.add(2, 2)); }
}
`,
	))

	// A test in a package cannot see a class in the default package, so this
	// is a compile failure against the submission — a failed script, not a
	// platform error. The Architect's guidance says to keep tests in the
	// default package for exactly this reason.
	assertScriptTests(t, result, []wantTest{{"did not compile", false}})

	flat := execute(t, runner, scriptJob(contract.LanguageJava,
		"public class Solution {\n    public static int add(int a, int b) { return a + b; }\n}\n",
		contract.FrameworkJUnit, "SolutionTest.java",
		`import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

public class SolutionTest {
    @Test void adds() { assertEquals(5, Solution.add(2, 3)); }
    @Test void wrong() { assertEquals(5, Solution.add(2, 2)); }
}
`,
	))
	assertScriptTests(t, flat, []wantTest{{"adds()", true}, {"wrong()", false}})
}

// A JUnit test calling a method the submission does not have fails as a test.
func TestJUnitScriptAgainstAMissingMethodFailsAsATest(t *testing.T) {
	runner := newDockerRunner(t)

	result := execute(t, runner, scriptJob(contract.LanguageJava,
		"public class Solution {}\n",
		contract.FrameworkJUnit, "SolutionTest.java",
		`import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

public class SolutionTest {
    @Test void adds() { assertEquals(5, Solution.add(2, 3)); }
}
`,
	))

	assertScriptTests(t, result, []wantTest{{"did not compile", false}})
	if result.Status != contract.StatusRuntimeError {
		t.Fatalf("status = %s, want RUNTIME_ERROR", result.Status)
	}
}

// CUSTOM, in every language, reports through the JSON file it is pointed at.
func TestCustomScriptsReportInEveryLanguage(t *testing.T) {
	runner := newDockerRunner(t)

	cases := []struct {
		name   string
		job    contract.Job
		expect []wantTest
	}{
		{
			"python",
			scriptJob(contract.LanguagePython, "def double(n):\n    return n * 2\n",
				contract.FrameworkCustom, "check.py",
				`import json, os
from main import double
tests = [{"name": "doubles", "passed": double(4) == 8}, {"name": "wrong", "passed": double(1) == 3}]
json.dump({"tests": tests}, open(os.environ["AMBATUCODE_REPORT"], "w"))
`),
			[]wantTest{{"doubles", true}, {"wrong", false}},
		},
		{
			"javascript",
			scriptJob(contract.LanguageJavaScript, "module.exports = { double: (n) => n * 2 };\n",
				contract.FrameworkCustom, "check.js",
				`const fs = require("fs");
const { double } = require("./main");
fs.writeFileSync(process.env.AMBATUCODE_REPORT, JSON.stringify({ tests: [
  { name: "doubles", passed: double(4) === 8 },
] }));
`),
			[]wantTest{{"doubles", true}},
		},
		{
			"java",
			scriptJob(contract.LanguageJava, "public class Solution {\n    public static int twice(int n) { return n * 2; }\n}\n",
				contract.FrameworkCustom, "Check.java",
				`import java.nio.file.*;

public class Check {
    public static void main(String[] args) throws Exception {
        boolean ok = Solution.twice(4) == 8;
        String json = "{\"tests\":[{\"name\":\"doubles\",\"passed\":" + ok + "}]}";
        Files.writeString(Path.of(System.getenv("AMBATUCODE_REPORT")), json);
    }
}
`),
			[]wantTest{{"doubles", true}},
		},
		{
			"cpp",
			scriptJob(contract.LanguageCPP, "#include <iostream>\nint main() { int n; std::cin >> n; std::cout << n * 2; }\n",
				contract.FrameworkCustom, "harness.cpp",
				`#include <array>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>

int main() {
    std::string command = std::string("echo 4 | ") + std::getenv("AMBATUCODE_PROGRAM");
    FILE* pipe = popen(command.c_str(), "r");
    std::array<char, 64> buffer{};
    std::string out;
    while (fgets(buffer.data(), buffer.size(), pipe)) out += buffer.data();
    pclose(pipe);
    std::ofstream(std::getenv("AMBATUCODE_REPORT"))
        << "{\"tests\":[{\"name\":\"doubles\",\"passed\":" << (out == "8" ? "true" : "false") << "}]}";
}
`),
			[]wantTest{{"doubles", true}},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			assertScriptTests(t, execute(t, runner, testCase.job), testCase.expect)
		})
	}
}

// A framework that writes no report crashed: the platform's failure.
func TestScriptWithNoReportIsASystemError(t *testing.T) {
	runner := newDockerRunner(t)

	result := execute(t, runner, scriptJob(contract.LanguagePython, "x = 1\n",
		contract.FrameworkCustom, "check.py",
		"print('forgot to write the report')\n",
	))

	if result.Status != contract.StatusSystemError {
		t.Fatalf("status = %s, want SYSTEM_ERROR", result.Status)
	}
}

// A script that never finishes is a time limit, reported as one failed row.
func TestScriptThatHangsIsATimeLimit(t *testing.T) {
	runner := newDockerRunner(t)

	j := scriptJob(contract.LanguagePython, "x = 1\n",
		contract.FrameworkCustom, "check.py",
		"while True:\n    pass\n",
	)
	j.Limits.WallTimeoutMs = 6_000

	result := execute(t, runner, j)

	if result.Status != contract.StatusTimeLimitExceeded {
		t.Fatalf("status = %s, want TIME_LIMIT_EXCEEDED", result.Status)
	}
	assertScriptTests(t, result, []wantTest{{"stopped at a limit", false}})
}

// A script path that escapes the workspace is refused before anything runs.
func TestScriptPathTraversalIsRefused(t *testing.T) {
	runner := newDockerRunner(t)

	for _, escape := range []string{"../escape.py", "/etc/escape.py", "tests/../../escape.py", "main.py"} {
		t.Run(escape, func(t *testing.T) {
			result := execute(t, runner, scriptJob(contract.LanguagePython, "x = 1\n",
				contract.FrameworkCustom, escape, "print(1)\n",
				echoCase("never runs", "", ""),
			))
			if result.Status != contract.StatusSystemError {
				t.Fatalf("status = %s, want SYSTEM_ERROR", result.Status)
			}
			if len(result.TestResults) != 0 {
				t.Fatal("cases ran before the script's paths were checked")
			}
			assertNoContainersLeft(t)
		})
	}
}

// Several scripts each report under their own id, and each runs in a fresh
// container: a file one script leaves behind is not there for the next.
func TestEveryScriptRunsInItsOwnContainer(t *testing.T) {
	runner := newDockerRunner(t)

	j := scriptJob(contract.LanguagePython, "def add(a, b):\n    return a + b\n",
		contract.FrameworkCustom, "first.py", `import json, os
open("/tmp/planted", "w").write("from the first script")
json.dump({"tests": [{"name": "first adds", "passed": __import__("main").add(1, 2) == 3}]}, open(os.environ["AMBATUCODE_REPORT"], "w"))
`)
	j.TestScripts = append(j.TestScripts, contract.TestScript{
		ID: "script-2", Framework: contract.FrameworkCustom, Path: "second.py", Weight: 2,
		Content: `import json, os
json.dump({"tests": [{"name": "second sees a clean container", "passed": not os.path.exists("/tmp/planted")}]}, open(os.environ["AMBATUCODE_REPORT"], "w"))
`,
	})

	result := execute(t, runner, j)

	assertScriptTests(t, result, []wantTest{{"first adds", true}, {"second sees a clean container", true}})
	if *result.TestResults[0].TestScriptID != "script-1" || *result.TestResults[1].TestScriptID != "script-2" {
		t.Fatalf("results are not attributed to their scripts in order: %+v", result.TestResults)
	}
}
