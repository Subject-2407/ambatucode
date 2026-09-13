//go:build docker

// Integration tests against a real Docker daemon and a real sandbox image.
//
// Opt-in, mirroring the repo's *.int.test.ts convention, because they need
// infrastructure that a plain `go test ./...` must not require:
//
//	docker compose -f docker/compose/dev.yml up -d
//	docker compose -f docker/compose/sandbox.yml build
//	go test -tags docker ./internal/sandbox/
//
// Run the Docker-tagged packages one at a time:
//
//	go test -tags docker -p 1 ./...
//
// The -p 1 is not optional. Go runs packages in parallel by default, and the
// container sweep these tests rely on finds containers by label across the
// whole daemon — so a sweep in one package deletes the live containers of
// another, and the failure surfaces as a program that mysteriously died
// mid-run rather than as anything resembling its cause.
//
// These assert the controls that cannot be verified any other way. A unit test
// can check that NetworkMode is set to "none"; only a container can prove that
// a socket actually fails to open.
package sandbox

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"
)

const testImage = "ambatucode/sandbox-python:3.12"

func newTestSandbox(t *testing.T) *Sandbox {
	t.Helper()
	box, err := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("connect to docker: %v", err)
	}
	t.Cleanup(func() { _ = box.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := box.Ping(ctx); err != nil {
		t.Skipf("docker daemon is not reachable: %v", err)
	}
	if err := box.EnsureImages(ctx, []string{testImage}); err != nil {
		t.Skipf("sandbox image is not built: %v", err)
	}
	return box
}

// runSpec is one whole execution as these tests describe it: a container, a
// workspace, and a single command. Production opens a session and runs several
// commands in it — a compile then each test case — so this collapses that into
// the one-shot shape the assertions below are written against.
type runSpec struct {
	Image          string
	Cmd            []string
	Workspace      []File
	Stdin          string
	WallTimeout    time.Duration
	MemoryLimitMb  int64
	MaxProcesses   int64
	MaxOutputBytes int64
}

func pythonSpec(source string, stdin string) runSpec {
	return runSpec{
		Image:          testImage,
		Cmd:            []string{"python3", workspaceDir + "/main.py"},
		Workspace:      []File{{Name: "main.py", Content: []byte(source)}},
		Stdin:          stdin,
		WallTimeout:    30 * time.Second,
		MemoryLimitMb:  256,
		MaxProcesses:   64,
		MaxOutputBytes: 65536,
	}
}

func run(t *testing.T, box *Sandbox, spec runSpec) RunOutcome {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	session, err := box.Open(ctx, SessionSpec{
		JobID:          "integration",
		Image:          spec.Image,
		WallTimeout:    spec.WallTimeout,
		MemoryLimitMb:  spec.MemoryLimitMb,
		MaxProcesses:   spec.MaxProcesses,
		MaxOutputBytes: spec.MaxOutputBytes,
	})
	if err != nil {
		t.Fatalf("open session: %v", err)
	}
	defer session.Close()

	for _, file := range spec.Workspace {
		if err := session.Write(ctx, file); err != nil {
			t.Fatalf("write workspace: %v", err)
		}
	}

	outcome, err := session.Run(ctx, ExecSpec{
		Cmd:     spec.Cmd,
		Stdin:   spec.Stdin,
		Timeout: spec.WallTimeout,
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	return outcome
}

// The whole point of the exec-based workspace delivery: source has to reach a
// read-only-rootfs container and run, with stdin attached.
func TestRunExecutesSourceWithStdin(t *testing.T) {
	box := newTestSandbox(t)

	outcome := run(t, box, pythonSpec("name = input()\nprint(f\"hello {name}\")\n", "world"))

	if outcome.ExitCode != 0 {
		t.Fatalf("exit %d, stderr: %s", outcome.ExitCode, outcome.Stderr)
	}
	if strings.TrimSpace(outcome.Stdout) != "hello world" {
		t.Fatalf("stdout = %q, want %q", outcome.Stdout, "hello world")
	}
	if outcome.TimedOut || outcome.OOMKilled {
		t.Fatalf("unexpected limit hit: %+v", outcome)
	}
}

// Network is off with no configuration that turns it on.
func TestRunHasNoNetwork(t *testing.T) {
	box := newTestSandbox(t)

	source := `import socket
try:
    socket.create_connection(("1.1.1.1", 53), timeout=3)
    print("REACHABLE")
except Exception:
    print("blocked")
`
	outcome := run(t, box, pythonSpec(source, ""))

	if strings.TrimSpace(outcome.Stdout) != "blocked" {
		t.Fatalf("network was reachable from the sandbox: %q", outcome.Stdout)
	}
}

// The root filesystem is read-only; only the scratch mounts accept writes.
func TestRunRootFilesystemIsReadOnly(t *testing.T) {
	box := newTestSandbox(t)

	source := `results = []
try:
    open("/etc/passwd", "w")
    results.append("ROOT_WRITABLE")
except Exception:
    results.append("root_readonly")
try:
    open("/tmp/scratch", "w").write("ok")
    results.append("tmp_writable")
except Exception:
    results.append("TMP_UNWRITABLE")
print(",".join(results))
`
	outcome := run(t, box, pythonSpec(source, ""))

	if got := strings.TrimSpace(outcome.Stdout); got != "root_readonly,tmp_writable" {
		t.Fatalf("filesystem controls wrong: %q (stderr: %s)", got, outcome.Stderr)
	}
}

func TestRunUsesTheUnprivilegedUser(t *testing.T) {
	box := newTestSandbox(t)

	outcome := run(t, box, pythonSpec("import os\nprint(os.getuid())\n", ""))

	if strings.TrimSpace(outcome.Stdout) != "65534" {
		t.Fatalf("running as uid %q, want 65534", strings.TrimSpace(outcome.Stdout))
	}
}

// An infinite loop is killed by our wall clock, not left to run.
func TestRunEnforcesTheWallTimeout(t *testing.T) {
	box := newTestSandbox(t)

	spec := pythonSpec("while True:\n    pass\n", "")
	spec.WallTimeout = 3 * time.Second

	outcome := run(t, box, spec)

	if !outcome.TimedOut {
		t.Fatalf("expected a timeout, got %+v", outcome)
	}
	if outcome.Duration > 20*time.Second {
		t.Fatalf("timeout took %s to fire", outcome.Duration)
	}
}

// OOM has to be distinguishable from an ordinary crash, because both surface
// as exit 137. It is read from the daemon's flag rather than the exit code.
func TestRunReportsOOMSeparatelyFromACrash(t *testing.T) {
	box := newTestSandbox(t)

	spec := pythonSpec("x = bytearray(400 * 1024 * 1024)\nprint(len(x))\n", "")
	spec.MemoryLimitMb = 64

	outcome := run(t, box, spec)

	if !outcome.OOMKilled {
		t.Fatalf("expected OOMKilled, got %+v", outcome)
	}

	// A plain non-zero exit must not be mistaken for a memory kill.
	crash := run(t, box, pythonSpec("raise SystemExit(3)\n", ""))
	if crash.OOMKilled {
		t.Fatal("an ordinary non-zero exit was reported as an OOM kill")
	}
	if crash.ExitCode != 3 {
		t.Fatalf("exit code = %d, want 3", crash.ExitCode)
	}
}

// A fork bomb is contained by the pid limit rather than taking the host with it.
func TestRunContainsAForkBomb(t *testing.T) {
	box := newTestSandbox(t)

	source := `import os
try:
    while True:
        os.fork()
except Exception:
    pass
`
	spec := pythonSpec(source, "")
	spec.MaxProcesses = 16
	spec.WallTimeout = 15 * time.Second

	// Reaching this assertion at all is the point: the call returned rather
	// than hanging, and the worker is still alive to report it.
	outcome := run(t, box, spec)
	if outcome.Duration > 20*time.Second {
		t.Fatalf("fork bomb was not contained promptly: %s", outcome.Duration)
	}
}

// Unbounded output is truncated at the source instead of exhausting the worker.
func TestRunCapsRunawayOutput(t *testing.T) {
	box := newTestSandbox(t)

	spec := pythonSpec("import sys\nfor _ in range(200000):\n    sys.stdout.write('x' * 100)\n", "")
	spec.MaxOutputBytes = 4096

	outcome := run(t, box, spec)

	if int64(len(outcome.Stdout)) > spec.MaxOutputBytes {
		t.Fatalf("captured %d bytes, cap is %d", len(outcome.Stdout), spec.MaxOutputBytes)
	}
	if !outcome.StdoutTruncated {
		t.Fatal("expected truncation to be reported")
	}
}

// Every container is single-use and removed, including after a timeout.
func TestRunLeavesNoContainersBehind(t *testing.T) {
	box := newTestSandbox(t)

	run(t, box, pythonSpec("print('ok')\n", ""))

	timeoutSpec := pythonSpec("while True:\n    pass\n", "")
	timeoutSpec.WallTimeout = 2 * time.Second
	run(t, box, timeoutSpec)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// SweepOrphans reports what it had to clean up. Anything above zero means
	// the defer in Run did not do its job.
	remaining, err := box.SweepOrphans(ctx)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("%d containers survived their run", remaining)
	}
}
