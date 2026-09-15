package sandbox

import (
	"errors"
	"fmt"
	"io"
	"net/url"
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

// Only a failure to reach the daemon may turn a job's failure into a requeue.
// A daemon that answered and refused — a full disk, a missing image — is a
// real platform failure, and requeueing it would retry forever.
func TestDaemonFailureMarksOnlyTransportErrors(t *testing.T) {
	transport := []error{
		&url.Error{Op: "Post", URL: "http://docker/containers/create", Err: errors.New("connection refused")},
		fmt.Errorf("attach: %w", io.ErrUnexpectedEOF),
	}
	for _, err := range transport {
		if !errors.Is(daemonFailure(err), ErrDaemonUnavailable) {
			t.Errorf("%v was not marked as the daemon being unavailable", err)
		}
		if !errors.Is(daemonFailure(err), err) {
			t.Errorf("marking %v lost the original error", err)
		}
	}

	refused := errors.New("Error response from daemon: no space left on device")
	if errors.Is(daemonFailure(refused), ErrDaemonUnavailable) {
		t.Error("a refusal from a reachable daemon was marked as an outage")
	}
	if daemonFailure(nil) != nil {
		t.Error("a nil error gained a cause")
	}
}

func TestHasSeccompReadsTheDaemonSecurityOptions(t *testing.T) {
	enforcing := []string{"name=apparmor", "name=seccomp,profile=builtin", "name=cgroupns"}
	if !hasSeccomp(enforcing) {
		t.Fatal("a daemon reporting name=seccomp was treated as unfiltered")
	}
	for _, options := range [][]string{
		nil,
		{"name=apparmor", "name=cgroupns"},
		// A profile name that merely mentions seccomp is not the option.
		{"name=selinux,profile=seccomp"},
	} {
		if hasSeccomp(options) {
			t.Errorf("security options %v were treated as seccomp support", options)
		}
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
