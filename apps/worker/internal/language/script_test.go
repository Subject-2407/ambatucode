package language

import (
	"strings"
	"testing"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
)

// Every framework the upload schema ties to a language must be runnable in
// that language, and CUSTOM in every language.
func TestEveryLanguageRunsItsFrameworks(t *testing.T) {
	supported := map[contract.Language][]contract.TestScriptFramework{
		contract.LanguagePython:     {contract.FrameworkPytest, contract.FrameworkCustom},
		contract.LanguageJavaScript: {contract.FrameworkJest, contract.FrameworkCustom},
		contract.LanguageJava:       {contract.FrameworkJUnit, contract.FrameworkCustom},
		contract.LanguageCPP:        {contract.FrameworkGoogleTest, contract.FrameworkCustom},
	}
	entrypoints := map[contract.Language]string{
		contract.LanguagePython:     "tests/test_main.py",
		contract.LanguageJavaScript: "checks/main.check.js",
		contract.LanguageJava:       "tests/SolutionTest.java",
		contract.LanguageCPP:        "checks/harness.cpp",
	}

	for lang, frameworks := range supported {
		spec, err := Lookup(lang)
		if err != nil {
			t.Fatalf("lookup %s: %v", lang, err)
		}
		for _, framework := range frameworks {
			plan, err := spec.PlanScript(framework, ScriptInput{
				Path:      entrypoints[lang],
				ReportDir: "/tmp/ambatucode-report-test",
			})
			if err != nil {
				t.Errorf("%s cannot run %s: %v", lang, framework, err)
				continue
			}
			if len(plan.Run) == 0 || len(plan.Reports) == 0 || plan.Format == "" {
				t.Errorf("%s %s plan is incomplete: %+v", lang, framework, plan)
			}
			for _, report := range plan.Reports {
				if !strings.HasPrefix(report, "/tmp/ambatucode-report-test/") {
					t.Errorf("%s %s report %q is outside the private report directory", lang, framework, report)
				}
			}
		}
	}
}

func TestFrameworkInTheWrongLanguageIsRefused(t *testing.T) {
	python, _ := Lookup(contract.LanguagePython)
	cpp, _ := Lookup(contract.LanguageCPP)

	if _, err := python.PlanScript(contract.FrameworkJest, ScriptInput{Path: "a.js"}); err == nil {
		t.Error("python accepted a Jest script")
	}
	if _, err := cpp.PlanScript(contract.FrameworkJUnit, ScriptInput{Path: "a.java"}); err == nil {
		t.Error("cpp accepted a JUnit script")
	}
}

// Directories are packages, so the class selected is the path's.
func TestJavaClassNameFollowsTheSourcePath(t *testing.T) {
	cases := map[string]string{
		"SolutionTest.java":          "SolutionTest",
		"tests/SolutionTest.java":    "tests.SolutionTest",
		"com/acme/SolutionTest.java": "com.acme.SolutionTest",
	}
	for entrypoint, want := range cases {
		if got, err := javaClassName(entrypoint); err != nil || got != want {
			t.Errorf("javaClassName(%q) = %q, %v; want %q", entrypoint, got, err, want)
		}
	}
	for _, bad := range []string{"SolutionTest.kt", "my-tests/SolutionTest.java", "1st/Test.java"} {
		if _, err := javaClassName(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
}

func TestJUnitCompilesTheScriptAgainstTheSubmission(t *testing.T) {
	java, _ := Lookup(contract.LanguageJava)
	plan, err := java.PlanScript(contract.FrameworkJUnit, ScriptInput{
		Path:      "SolutionTest.java",
		ReportDir: "/tmp/r",
	})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	joined := strings.Join(plan.Compile, " ")
	if !strings.Contains(joined, "/workspace/SolutionTest.java") || !strings.Contains(joined, "-cp /workspace:") {
		t.Fatalf("compile command = %q", joined)
	}
}

// A single script file has to be something its language can build.
func TestCompiledScriptsMustBeSources(t *testing.T) {
	java, _ := Lookup(contract.LanguageJava)
	cpp, _ := Lookup(contract.LanguageCPP)

	if _, err := java.PlanScript(contract.FrameworkJUnit, ScriptInput{Path: "fixtures/input.txt"}); err == nil {
		t.Error("JUnit accepted a non-Java file")
	}
	if _, err := cpp.PlanScript(contract.FrameworkCustom, ScriptInput{Path: "harness.h"}); err == nil {
		t.Error("C++ accepted a header as its harness")
	}
}

// A script file must never land on the submission or its build output.
func TestReservedPathsCoverSourceAndArtifacts(t *testing.T) {
	cpp, _ := Lookup(contract.LanguageCPP)
	reserved := strings.Join(cpp.ReservedPaths(), ",")
	if !strings.Contains(reserved, "main.cpp") || !strings.Contains(reserved, "program") {
		t.Fatalf("cpp reserved paths = %q", reserved)
	}

	java, _ := Lookup(contract.LanguageJava)
	adapted := java.For("public class Solution {}")
	if got := adapted.ReservedPaths()[0]; got != "Solution.java" {
		t.Fatalf("java reserves %q, want the adapted source file", got)
	}
}
