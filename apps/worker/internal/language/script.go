package language

import (
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"strings"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/grader"
)

// ReportEnv names the environment variable that tells a CUSTOM test script
// where to write its JSON report.
const ReportEnv = "AMBATUCODE_REPORT"

// ProgramEnv names the environment variable holding the compiled program's
// path, for CUSTOM scripts in a language whose harness cannot link the
// Coder's program into itself.
const ProgramEnv = "AMBATUCODE_PROGRAM"

// junitConsole is baked into the Java image. See java.Dockerfile.
const junitConsole = "/opt/junit/junit-platform-console-standalone.jar"

// ScriptPlan is how one test script runs in one language.
type ScriptPlan struct {
	// Compile builds the script's own sources; nil when it needs no build.
	Compile []string
	Run     []string
	Env     []string
	Format  grader.ReportFormat
	// Reports are the files the framework writes its results to.
	Reports []string
}

// ScriptInput is what a planner is given. Paths are already validated and
// relative to the workspace.
type ScriptInput struct {
	Entrypoint string
	Files      []string
	// ReportDir is a fresh private directory for the framework's report.
	ReportDir string
}

type scriptPlanner func(ScriptInput) (ScriptPlan, error)

// PlanScript returns how a framework's script runs in this language, or an
// error when the language cannot run that framework.
func (s Spec) PlanScript(framework contract.TestScriptFramework, input ScriptInput) (ScriptPlan, error) {
	planner, ok := s.scripts[framework]
	if !ok {
		return ScriptPlan{}, fmt.Errorf("%s test scripts cannot run in %s", framework, s.ID)
	}
	return planner(input)
}

// ReservedPaths are workspace paths a script file may not take, because the
// Coder's program or its build output lives there.
func (s Spec) ReservedPaths() []string {
	return append([]string{s.SourceFile}, s.artifacts...)
}

func workspacePath(relative string) string { return WorkspaceDir + "/" + relative }

func reportEnv(input ScriptInput) string { return ReportEnv + "=" + input.ReportDir + "/report.json" }

func planPytest(input ScriptInput) (ScriptPlan, error) {
	report := input.ReportDir + "/report.xml"
	return ScriptPlan{
		Run: []string{
			"python3", "-m", "pytest", "-q",
			// No cache directory: the root is read-only, and nothing should
			// persist between runs anyway.
			"-p", "no:cacheprovider",
			"--rootdir=" + WorkspaceDir,
			"--junit-xml=" + report,
			workspacePath(input.Entrypoint),
		},
		// Tests in a subdirectory still import the Coder's main.py by name.
		Env:     []string{"PYTHONPATH=" + WorkspaceDir},
		Format:  grader.ReportJUnitXML,
		Reports: []string{report},
	}, nil
}

func planPythonCustom(input ScriptInput) (ScriptPlan, error) {
	return ScriptPlan{
		Run:     []string{"python3", workspacePath(input.Entrypoint)},
		Env:     []string{"PYTHONPATH=" + WorkspaceDir, reportEnv(input)},
		Format:  grader.ReportCustomJSON,
		Reports: []string{input.ReportDir + "/report.json"},
	}, nil
}

// jestConfig is passed inline. Jest otherwise searches upward for a config
// file and fails outright when none exists, and an inline config also means
// nothing written into the workspace can reconfigure the run.
var jestConfig = func() string {
	encoded, _ := json.Marshal(map[string]any{
		"rootDir":        WorkspaceDir,
		"testMatch":      []string{"**/*"},
		"cacheDirectory": "/tmp/jest-cache",
		"watchman":       false,
	})
	return string(encoded)
}()

func planJest(input ScriptInput) (ScriptPlan, error) {
	report := input.ReportDir + "/report.json"
	return ScriptPlan{
		Run: []string{
			"jest", "--ci", "--json",
			"--outputFile=" + report,
			"--config", jestConfig,
			"--no-cache",
			"--runTestsByPath", workspacePath(input.Entrypoint),
		},
		Format:  grader.ReportJestJSON,
		Reports: []string{report},
	}, nil
}

func planNodeCustom(input ScriptInput) (ScriptPlan, error) {
	return ScriptPlan{
		Run:     []string{"node", workspacePath(input.Entrypoint)},
		Env:     []string{reportEnv(input)},
		Format:  grader.ReportCustomJSON,
		Reports: []string{input.ReportDir + "/report.json"},
	}, nil
}

// javaIdentifier is one package or class name segment.
var javaIdentifier = regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*$`)

// javaClassName maps a source path to the class it must declare, following
// Java's own convention that directories are packages: tests/SumTest.java is
// tests.SumTest.
func javaClassName(entrypoint string) (string, error) {
	if !strings.HasSuffix(entrypoint, ".java") {
		return "", fmt.Errorf("the Java test script entrypoint %q is not a .java file", entrypoint)
	}
	segments := strings.Split(strings.TrimSuffix(entrypoint, ".java"), "/")
	for _, segment := range segments {
		if !javaIdentifier.MatchString(segment) {
			return "", fmt.Errorf("the Java test script entrypoint %q is not a valid class path", entrypoint)
		}
	}
	return strings.Join(segments, "."), nil
}

// javaSources compiles every script .java file against the Coder's classes,
// already built into the workspace root.
func javaSources(input ScriptInput, classPath string) ([]string, error) {
	cmd := []string{"javac", "-encoding", "UTF-8", "-d", WorkspaceDir, "-cp", classPath}
	sources := 0
	for _, file := range input.Files {
		if strings.HasSuffix(file, ".java") {
			cmd = append(cmd, workspacePath(file))
			sources++
		}
	}
	if sources == 0 {
		return nil, fmt.Errorf("the Java test script has no .java files")
	}
	return cmd, nil
}

func planJUnit(input ScriptInput) (ScriptPlan, error) {
	className, err := javaClassName(input.Entrypoint)
	if err != nil {
		return ScriptPlan{}, err
	}
	compile, err := javaSources(input, WorkspaceDir+":"+junitConsole)
	if err != nil {
		return ScriptPlan{}, err
	}
	return ScriptPlan{
		Compile: compile,
		Run: []string{
			"java", "-XX:-UsePerfData", "-jar", junitConsole, "execute",
			"--class-path", WorkspaceDir,
			"--select-class", className,
			"--reports-dir", input.ReportDir,
			"--disable-banner", "--details=none", "--disable-ansi-colors",
		},
		Format:  grader.ReportJUnitXML,
		Reports: []string{input.ReportDir + "/TEST-junit-jupiter.xml"},
	}, nil
}

func planJavaCustom(input ScriptInput) (ScriptPlan, error) {
	className, err := javaClassName(input.Entrypoint)
	if err != nil {
		return ScriptPlan{}, err
	}
	compile, err := javaSources(input, WorkspaceDir)
	if err != nil {
		return ScriptPlan{}, err
	}
	return ScriptPlan{
		Compile: compile,
		Run:     []string{"java", "-XX:-UsePerfData", "-cp", WorkspaceDir, className},
		Env:     []string{reportEnv(input)},
		Format:  grader.ReportCustomJSON,
		Reports: []string{input.ReportDir + "/report.json"},
	}, nil
}

// cppHarness is where a CUSTOM C++ script is built. The leading dot keeps it
// out of the way of anything a script declares.
const cppHarness = WorkspaceDir + "/.ambatucode-harness"

// planCppCustom builds the script as its own program. It cannot link the
// Coder's source, which has its own main, so it receives the Coder's compiled
// program's path instead and runs it.
func planCppCustom(input ScriptInput) (ScriptPlan, error) {
	if !isCppSource(input.Entrypoint) {
		return ScriptPlan{}, fmt.Errorf("the C++ test script entrypoint %q is not a C++ source file", input.Entrypoint)
	}
	compile := []string{"g++", "-std=c++20", "-O2", "-w", "-o", cppHarness}
	for _, file := range input.Files {
		if isCppSource(file) {
			compile = append(compile, workspacePath(file))
		}
	}
	return ScriptPlan{
		Compile: compile,
		Run:     []string{cppHarness},
		Env:     []string{reportEnv(input), ProgramEnv + "=" + WorkspaceDir + "/program"},
		Format:  grader.ReportCustomJSON,
		Reports: []string{input.ReportDir + "/report.json"},
	}, nil
}

func isCppSource(file string) bool {
	switch path.Ext(file) {
	case ".cpp", ".cc", ".cxx":
		return true
	default:
		return false
	}
}
