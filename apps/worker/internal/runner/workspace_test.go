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

func script(entrypoint string, paths ...string) *contract.TestScript {
	files := make([]contract.TestScriptFile, 0, len(paths))
	for _, name := range paths {
		files = append(files, contract.TestScriptFile{Path: name, Content: "x"})
	}
	return &contract.TestScript{Framework: contract.FrameworkPytest, Entrypoint: entrypoint, Files: files, Weight: 1}
}

func TestValidateScriptPathsProtectsTheSubmission(t *testing.T) {
	python, _ := language.Lookup(contract.LanguagePython)
	cpp, _ := language.Lookup(contract.LanguageCPP)

	cases := []struct {
		name   string
		spec   language.Spec
		script *contract.TestScript
	}{
		{"overwrites the Coder's source", python, script("main.py", "main.py")},
		{"overwrites the compiled program", cpp, script("check.cpp", "check.cpp", "program")},
		{"declares a file twice", python, script("t.py", "t.py", "t.py")},
		{"entrypoint is not a file", python, script("other.py", "t.py")},
		{"entrypoint escapes", python, script("../t.py", "t.py")},
		{"a file inside another file", python, script("t.py", "t.py", "t.py/inner.py")},
		{"no files", python, &contract.TestScript{Entrypoint: "t.py"}},
		{"a file escapes", python, script("t.py", "t.py", "../../etc/cron.d/x")},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := validateScriptPaths(testCase.script, testCase.spec); err == nil {
				t.Fatal("accepted")
			}
		})
	}

	paths, err := validateScriptPaths(script("tests/test_main.py", "tests/test_main.py", "tests/conftest.py"), python)
	if err != nil || len(paths) != 2 {
		t.Fatalf("a valid script was refused: %v %v", paths, err)
	}
}
