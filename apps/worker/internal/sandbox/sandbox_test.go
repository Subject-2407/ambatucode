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
func TestParseOOMKillsReadsTheCgroupCounter(t *testing.T) {
	events := "low 0\nhigh 0\nmax 12\noom 3\noom_kill 2\noom_group_kill 0\n"
	if count, ok := parseOOMKills(events); !ok || count != 2 {
		t.Fatalf("parsed %d, %v; want 2, true", count, ok)
	}
	// oom_group_kill must not be mistaken for oom_kill.
	if _, ok := parseOOMKills("oom_group_kill 5\n"); ok {
		t.Fatal("read a count from a file with no oom_kill line")
	}
	if _, ok := parseOOMKills("oom_kill many\n"); ok {
		t.Fatal("read a count from an unparseable value")
	}
}

func TestWorkspaceDirMatchesTheLanguageRegistry(t *testing.T) {
	if workspaceDir != language.WorkspaceDir {
		t.Fatalf(
			"sandbox mounts the workspace at %q but the language registry expects %q",
			workspaceDir, language.WorkspaceDir,
		)
	}
}
