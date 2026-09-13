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

// validateScriptPaths checks every path a test script declares before any of
// it is written.
//
// The producer validates these on upload, and they are validated again here
// because this is where they become real files: a path that escapes the
// workspace, or that lands on the Coder's own source, would let a script
// overwrite what it is supposed to be grading.
func validateScriptPaths(script *contract.TestScript, spec language.Spec) ([]string, error) {
	if len(script.Files) == 0 {
		return nil, fmt.Errorf("the test script has no files")
	}

	reserved := make(map[string]bool)
	for _, name := range spec.ReservedPaths() {
		reserved[name] = true
	}

	seen := make(map[string]bool, len(script.Files))
	paths := make([]string, 0, len(script.Files))
	for _, file := range script.Files {
		if err := validateWorkspacePath(file.Path); err != nil {
			return nil, err
		}
		if reserved[file.Path] {
			return nil, fmt.Errorf("test script file %q would overwrite the submission", file.Path)
		}
		if seen[file.Path] {
			return nil, fmt.Errorf("test script file %q is declared twice", file.Path)
		}
		seen[file.Path] = true
		paths = append(paths, file.Path)
	}

	// A declared file that is also a directory of another — "a" and "a/b" —
	// cannot both exist, and would fail midway through writing the workspace.
	for _, candidate := range paths {
		if seen[path.Dir(candidate)] {
			return nil, fmt.Errorf("test script file %q sits inside another declared file", candidate)
		}
	}

	if err := validateWorkspacePath(script.Entrypoint); err != nil {
		return nil, fmt.Errorf("test script entrypoint: %w", err)
	}
	if !seen[script.Entrypoint] {
		return nil, fmt.Errorf("the test script entrypoint %q is not one of its files", script.Entrypoint)
	}
	return paths, nil
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
