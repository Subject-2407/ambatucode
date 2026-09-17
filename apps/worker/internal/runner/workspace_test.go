package runner

import (
	"strings"
	"testing"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/language"
)

func TestValidateWorkspacePathRejectsEveryEscape(t *testing.T) {
	rejected := []string{
		"",
		"../etc/passwd",
		"tests/../../escape.py",
		"tests/../test_main.py", // resolves inside, but is not canonical
		"./test_main.py",
		"..",
		".",
		"/etc/passwd",
		"/workspace/test_main.py",
		"tests//test_main.py",
		"tests/",
		`tests\..\escape.py`,
		"C:/escape.py",
		"test\x00.py",
		"tests/\nname.py",
		"-rf",
		"tests/--select-class=Evil.java",
		strings.Repeat("a", maxScriptPathLength+1),
	}
	for _, name := range rejected {
		if err := validateWorkspacePath(name); err == nil {
			t.Errorf("accepted %q", name)
		}
	}
}

func TestValidateWorkspacePathAcceptsPlainRelativePaths(t *testing.T) {
	for _, name := range []string{
		"test_main.py",
		"tests/test_main.py",
		"com/acme/SolutionTest.java",
		"fixtures/data.v2.json",
		"checks/add.check.js",
	} {
		if err := validateWorkspacePath(name); err != nil {
			t.Errorf("rejected %q: %v", name, err)
		}
	}
}

func script(path string) contract.TestScript {
	return contract.TestScript{ID: "script-1", Framework: contract.FrameworkPytest, Path: path, Content: "x", Weight: 1}
}

func TestValidateScriptPathProtectsTheSubmission(t *testing.T) {
	python, _ := language.Lookup(contract.LanguagePython)
	cpp, _ := language.Lookup(contract.LanguageCPP)

	cases := []struct {
		name   string
		spec   language.Spec
		script contract.TestScript
	}{
		{"overwrites the Coder's source", python, script("main.py")},
		{"overwrites the compiled program", cpp, script("program")},
		{"sits beneath the compiled program", cpp, script("program/check.cpp")},
		{"escapes", python, script("../t.py")},
		{"escapes deeper", python, script("../../etc/cron.d/x")},
		{"is empty", python, script("")},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if err := validateScriptPath(testCase.script, testCase.spec); err == nil {
				t.Fatal("accepted")
			}
		})
	}

	if err := validateScriptPath(script("tests/test_main.py"), python); err != nil {
		t.Fatalf("a valid script was refused: %v", err)
	}
}
