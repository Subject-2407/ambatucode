// Package language maps a job's language id to everything needed to run it.
//
// Adding a language must mean adding a Dockerfile under docker/sandbox and one
// entry here — nothing else in the worker may need to change. If it does, the
// abstraction is wrong and should be fixed rather than worked around.
package language

import (
	"fmt"
	"regexp"
	"sort"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
)

// WorkspaceDir is where the runner materializes a job inside the container.
// It is writable and executable — a compiled language builds its binary here
// and then has to run it — and capped by the tmpfs size.
const WorkspaceDir = "/workspace"

type Spec struct {
	ID contract.Language
	// Image is a locally built tag. The sandbox never pulls, so an image that
	// is not present is a startup-time failure rather than a silent download.
	Image string
	// SourceFile is the name participant code is written to.
	SourceFile string
	// CompileCmd is nil for interpreted languages.
	CompileCmd []string
	// RunCmd is an argument vector, never a shell string.
	RunCmd []string
	// TestFramework is the runner used when a job carries a test script.
	// Empty until test script support lands.
	TestFramework string

	// adapt tailors the fixed spec to one program's source, for the languages
	// whose toolchain refuses to be told where things are. Nil for the rest.
	adapt func(Spec, string) Spec
}

// Compiled reports whether this language needs a build step before it runs.
func (s Spec) Compiled() bool { return len(s.CompileCmd) > 0 }

// For returns the spec as it applies to one particular program.
func (s Spec) For(source string) Spec {
	if s.adapt == nil {
		return s
	}
	return s.adapt(s, source)
}

var registry = map[contract.Language]Spec{
	contract.LanguagePython: {
		ID:         contract.LanguagePython,
		Image:      "ambatucode/sandbox-python:3.12",
		SourceFile: "main.py",
		CompileCmd: nil,
		RunCmd:     []string{"python3", WorkspaceDir + "/main.py"},
	},

	contract.LanguageJavaScript: {
		ID:         contract.LanguageJavaScript,
		Image:      "ambatucode/sandbox-javascript:22",
		SourceFile: "main.js",
		CompileCmd: nil,
		RunCmd:     []string{"node", WorkspaceDir + "/main.js"},
	},

	contract.LanguageJava: {
		ID:         contract.LanguageJava,
		Image:      "ambatucode/sandbox-java:21",
		SourceFile: "Main.java",
		CompileCmd: []string{"javac", "-encoding", "UTF-8", "-d", WorkspaceDir, WorkspaceDir + "/Main.java"},
		RunCmd:     []string{"java", "-XX:-UsePerfData", "-cp", WorkspaceDir, "Main"},
		adapt:      adaptJava,
	},

	contract.LanguageCPP: {
		ID:         contract.LanguageCPP,
		Image:      "ambatucode/sandbox-cpp:12",
		SourceFile: "main.cpp",
		CompileCmd: []string{
			"g++", "-std=c++20", "-O2", "-w",
			"-o", WorkspaceDir + "/program", WorkspaceDir + "/main.cpp",
		},
		RunCmd: []string{WorkspaceDir + "/program"},
	},
}

// javaPublicClass finds the public class a source file declares.
//
// The character class is the point, not the convenience. This is the one place
// participant source influences a filename and an argument vector, so the name
// is not extracted and trusted — it is *matched* against the shape of a Java
// identifier, and anything that does not match that shape cannot come out of
// here at all. No separator, no path component, no shell metacharacter, and no
// leading dash survives the pattern. The result still only ever reaches an
// argument vector; nothing here is ever handed to a shell.
var javaPublicClass = regexp.MustCompile(
	`(?m)^[\t ]*public[\t ]+(?:final[\t ]+|abstract[\t ]+|strictfp[\t ]+)*class[\t ]+([A-Za-z_$][A-Za-z0-9_$]*)`,
)

// adaptJava points the compiler and the launcher at whatever the program
// actually called its public class.
//
// The JVM requires a public class to live in a file of the same name, so a
// Coder who writes `public class Solution` into Main.java gets
// "class Solution is public, should be declared in a file named Solution.java"
// — a compiler error about the platform's own file naming, which tells them
// nothing about their program. Renaming the file to match is the whole fix.
func adaptJava(spec Spec, source string) Spec {
	match := javaPublicClass.FindStringSubmatch(source)
	// No public class is legal Java: a package-private `class Main` runs fine,
	// and the fixed default is correct for it.
	if match == nil || len(match[1]) > 128 {
		return spec
	}

	name := match[1]
	spec.SourceFile = name + ".java"
	spec.CompileCmd = []string{
		"javac", "-encoding", "UTF-8", "-d", WorkspaceDir, WorkspaceDir + "/" + spec.SourceFile,
	}
	spec.RunCmd = []string{"java", "-XX:-UsePerfData", "-cp", WorkspaceDir, name}
	return spec
}

// Lookup resolves a language spec.
//
// An unknown language is a configuration error the backend allowed through,
// not a participant mistake, so it is reported as such rather than being
// treated as a failed program.
func Lookup(id contract.Language) (Spec, error) {
	spec, ok := registry[id]
	if !ok {
		return Spec{}, fmt.Errorf("unsupported language %q (supported: %v)", id, Supported())
	}
	return spec, nil
}

// Supported lists the registered language ids, sorted for stable messages.
func Supported() []string {
	ids := make([]string, 0, len(registry))
	for id := range registry {
		ids = append(ids, string(id))
	}
	sort.Strings(ids)
	return ids
}

// Images lists every image the worker needs present locally. The startup check
// uses this so a missing image fails the whole worker instead of failing one
// participant's submission at grading time.
func Images() []string {
	images := make([]string, 0, len(registry))
	for _, spec := range registry {
		images = append(images, spec.Image)
	}
	sort.Strings(images)
	return images
}
