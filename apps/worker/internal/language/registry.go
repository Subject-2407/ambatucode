// Package language maps a job's language id to everything needed to run it.
//
// Adding a language must mean adding a Dockerfile under docker/sandbox and one
// entry here — nothing else in the worker may need to change. If it does, the
// abstraction is wrong and should be fixed rather than worked around.
package language

import (
	"fmt"
	"sort"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
)

// WorkspaceDir is where the runner materializes a job inside the container.
// It is read-only at runtime; anything the program writes goes to /tmp.
const WorkspaceDir = "/workspace"

type Spec struct {
	ID contract.Language
	// Image is a locally built tag. The sandbox never pulls, so an image that
	// is not present is a startup-time failure rather than a silent download.
	Image string
	// SourceFile is the name participant code is written to. It is fixed per
	// language and never derived from participant input.
	SourceFile string
	// CompileCmd is nil for interpreted languages.
	CompileCmd []string
	// RunCmd is an argument vector, never a shell string.
	RunCmd []string
	// TestFramework is the runner used when a job carries a test script.
	// Empty until test script support lands.
	TestFramework string
}

// registry holds the languages this worker can execute. Python is the only
// entry for now; the remaining three arrive with their images.
var registry = map[contract.Language]Spec{
	contract.LanguagePython: {
		ID:         contract.LanguagePython,
		Image:      "ambatucode/sandbox-python:3.12",
		SourceFile: "main.py",
		CompileCmd: nil,
		RunCmd:     []string{"python3", WorkspaceDir + "/main.py"},
	},
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
