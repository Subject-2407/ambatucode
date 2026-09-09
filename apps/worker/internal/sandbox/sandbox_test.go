package sandbox

import (
	"testing"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/language"
)

// The workspace path is named in two places: here, where the scratch mount is
// created, and in the language registry, where run commands point at it and
// the runner strips it out of tracebacks. They are not wired together — a
// production import from sandbox to language would invert the layering — so
// the agreement is asserted instead. A silent drift would leave every job
// unable to find its own source file.
func TestWorkspaceDirMatchesTheLanguageRegistry(t *testing.T) {
	if workspaceDir != language.WorkspaceDir {
		t.Fatalf(
			"sandbox mounts the workspace at %q but the language registry expects %q",
			workspaceDir, language.WorkspaceDir,
		)
	}
}
