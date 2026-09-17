package runner

import (
	"fmt"
	"path"
	"strings"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/language"
)

// maxScriptPathLength matches what the upload schema allows.
const maxScriptPathLength = 200

// validateScriptPath checks the path a test script declares before it is
// written.
//
// The producer validates it on upload, and it is validated again here because
// this is where it becomes a real file: a path that escapes the workspace, or
// that lands on the Coder's own source, would let a script overwrite what it
// is supposed to be grading.
func validateScriptPath(script contract.TestScript, spec language.Spec) error {
	if err := validateWorkspacePath(script.Path); err != nil {
		return err
	}
	for _, reserved := range spec.ReservedPaths() {
		// "program" and "program/x" both collide: one is the file, the other
		// cannot be created beneath it.
		if script.Path == reserved || strings.HasPrefix(script.Path, reserved+"/") {
			return fmt.Errorf("test script file %q would overwrite the submission", script.Path)
		}
	}
	return nil
}

// validateWorkspacePath accepts only a plain relative path that stays inside
// the workspace.
//
// Canonical form is required, not merely a safe result: "a/../b" resolves
// inside, but a path that needs resolving is either a mistake or a probe, and
// accepting it would make the check depend on resolving exactly as the
// filesystem does. The resolved form is still checked afterwards, against the
// workspace root, in case the rules above ever miss a spelling.
//
// A segment may not start with "-", because these paths also reach argument
// vectors — javac, g++, pytest — where a leading dash is read as an option.
func validateWorkspacePath(name string) error {
	switch {
	case name == "":
		return fmt.Errorf("a test script path is empty")
	case len(name) > maxScriptPathLength:
		return fmt.Errorf("test script path %q is longer than %d characters", name, maxScriptPathLength)
	case strings.ContainsAny(name, "\\\x00:"):
		return fmt.Errorf("test script path %q contains a disallowed character", name)
	case path.IsAbs(name):
		return fmt.Errorf("test script path %q is absolute", name)
	case path.Clean(name) != name:
		return fmt.Errorf("test script path %q is not in canonical form", name)
	}

	for _, segment := range strings.Split(name, "/") {
		switch {
		case segment == "." || segment == "..":
			return fmt.Errorf("test script path %q escapes the workspace", name)
		case strings.HasPrefix(segment, "-"):
			return fmt.Errorf("test script path %q has a segment starting with '-'", name)
		}
		for _, r := range segment {
			if r < 0x20 || r == 0x7f {
				return fmt.Errorf("test script path %q contains a control character", name)
			}
		}
	}

	resolved := path.Join(language.WorkspaceDir, name)
	if !strings.HasPrefix(resolved, language.WorkspaceDir+"/") {
		return fmt.Errorf("test script path %q escapes the workspace", name)
	}
	return nil
}
