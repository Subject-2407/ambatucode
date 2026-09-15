//go:build docker

// The threat cases EXECUTION.md section 4.3 requires, one test each, run
// against the real sandbox through the full runner path.
//
//	docker compose -f docker/compose/sandbox.yml build
//	go test -tags docker -p 1 ./...
//
// Each goes through Runner.Run rather than the sandbox directly, because a
// control that holds but is then reported as the wrong status is still a
// defect: a blocked network call surfacing as SYSTEM_ERROR tells a Coder the
// platform broke when their program did something it may not.
//
// Every test also checks the one outcome that matters most for the worker
// itself: it survived, reported, and left no container behind.
package runner

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/sandbox"
)

// threatJob runs one Python program as a single-case job and returns the
// result plus that case's stdout excerpt.
func threatJob(t *testing.T, runner *Runner, source string, tune func(*contract.Limits)) (contract.Result, string) {
	t.Helper()
	j := job(contract.LanguagePython, source, echoCase("threat", "", ""))
	j.Limits.RunTimeoutMs = 10_000
	j.Limits.WallTimeoutMs = 60_000
	j.Limits.MemoryLimitMb = 256
	j.Limits.MaxProcesses = 64
	if tune != nil {
		tune(&j.Limits)
	}

	result := execute(t, runner, j)
	if result.Status == contract.StatusSystemError {
		t.Fatalf("the threat surfaced as a platform failure: %s", deref(result.SystemError))
	}
	assertNoContainersLeft(t)

	stdout := ""
	if len(result.TestResults) > 0 {
		stdout = strings.TrimSpace(result.TestResults[0].StdoutExcerpt)
	}
	return result, stdout
}

func assertNoContainersLeft(t *testing.T) {
	t.Helper()
	box, err := sandbox.New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	if err != nil {
		t.Fatalf("connect to docker: %v", err)
	}
	defer box.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	managed, err := box.ListManaged(ctx)
	if err != nil {
		t.Fatalf("list managed containers: %v", err)
	}
	if len(managed) != 0 {
		t.Fatalf("%d container(s) outlived the job", len(managed))
	}
}

// 4.3: Fork bomb — contained by --pids-limit.
func TestThreatForkBombIsContainedByThePidLimit(t *testing.T) {
	runner := newDockerRunner(t)

	source := `import os
while True:
    os.fork()
`
	started := time.Now()
	result, _ := threatJob(t, runner, source, func(l *contract.Limits) {
		l.MaxProcesses = 16
		l.RunTimeoutMs = 5_000
	})

	// It fails however the bomb dies — BlockingIOError once the pid limit
	// bites, or the clock — but it must fail as the program's own fault.
	if result.Status == contract.StatusGraded {
		t.Fatal("a fork bomb was graded as a program that ran to completion")
	}
	if elapsed := time.Since(started); elapsed > 45*time.Second {
		t.Fatalf("the fork bomb took %s to contain", elapsed)
	}

	// The worker is still able to grade the next job normally.
	next := execute(t, runner, job(contract.LanguagePython, "print('alive')\n", echoCase("after", "", "alive")))
	if next.Status != contract.StatusGraded || !next.TestResults[0].Passed {
		t.Fatalf("the job after a fork bomb did not grade: %+v", next)
	}
}

// 4.3: Infinite loop — killed by the time limit.
func TestThreatInfiniteLoopIsKilledByTheTimeLimit(t *testing.T) {
	runner := newDockerRunner(t)

	started := time.Now()
	result, _ := threatJob(t, runner, "while True:\n    pass\n", func(l *contract.Limits) {
		l.RunTimeoutMs = 2_000
	})

	if result.Status != contract.StatusTimeLimitExceeded {
		t.Fatalf("status = %s, want TIME_LIMIT_EXCEEDED", result.Status)
	}
	if elapsed := time.Since(started); elapsed > 30*time.Second {
		t.Fatalf("a 2s limit took %s to enforce", elapsed)
	}
}

// 4.3: Memory bomb — killed by the memory limit, reported as
// MEMORY_LIMIT_EXCEEDED.
func TestThreatMemoryBombIsReportedAsMemoryLimitExceeded(t *testing.T) {
	runner := newDockerRunner(t)

	source := `chunks = []
while True:
    chunks.append(bytearray(16 * 1024 * 1024))
`
	result, _ := threatJob(t, runner, source, func(l *contract.Limits) {
		l.MemoryLimitMb = 64
	})

	if result.Status != contract.StatusMemoryLimitExceeded {
		t.Fatalf("status = %s, want MEMORY_LIMIT_EXCEEDED", result.Status)
	}
}

// 4.3: Infinite output — truncated, not fatal to the worker.
func TestThreatInfiniteOutputIsTruncated(t *testing.T) {
	runner := newDockerRunner(t)

	source := `import sys
while True:
    sys.stdout.write("x" * 65536)
`
	result, stdout := threatJob(t, runner, source, func(l *contract.Limits) {
		l.RunTimeoutMs = 3_000
		l.MaxOutputBytes = 32_768
	})

	if len(result.TestResults) != 1 {
		t.Fatalf("got %d case results, want 1", len(result.TestResults))
	}
	excerptSize := len(result.TestResults[0].StdoutExcerpt)
	if excerptSize > excerptLimit+len(truncationMarker) {
		t.Fatalf("stdout excerpt is %d bytes, over the reporting cap", excerptSize)
	}
	if !strings.HasSuffix(result.TestResults[0].StdoutExcerpt, truncationMarker) {
		t.Fatal("a truncated excerpt carries no truncation marker")
	}
	if stdout == "" {
		t.Fatal("the excerpt kept nothing of the output")
	}
}

// 4.3: Outbound network attempt — fails, and the failure is not misreported
// as a system error.
func TestThreatOutboundNetworkFailsAsTheProgramsOwnError(t *testing.T) {
	runner := newDockerRunner(t)

	// Every attempt is caught, so the program reports what it saw.
	probe := `import socket
verdicts = []
for label, target in [("public", ("1.1.1.1", 53)), ("docker-host", ("172.17.0.1", 80)),
                      ("desktop-host", ("192.168.65.254", 80))]:
    try:
        socket.create_connection(target, timeout=2).close()
        verdicts.append(label + ":REACHABLE")
    except OSError:
        verdicts.append(label + ":blocked")
try:
    socket.getaddrinfo("example.com", 80)
    verdicts.append("dns:RESOLVED")
except OSError:
    verdicts.append("dns:blocked")
print(" ".join(verdicts))
`
	_, stdout := threatJob(t, runner, probe, nil)
	if strings.Contains(stdout, "REACHABLE") || strings.Contains(stdout, "RESOLVED") {
		t.Fatalf("the sandbox reached the network: %q", stdout)
	}
	if !strings.Contains(stdout, "public:blocked") {
		t.Fatalf("probe did not run to completion: %q", stdout)
	}

	// An uncaught failure is the program crashing — RUNTIME_ERROR.
	uncaught := `import urllib.request
urllib.request.urlopen("http://1.1.1.1", timeout=2)
`
	result, _ := threatJob(t, runner, uncaught, nil)
	if result.Status != contract.StatusRuntimeError {
		t.Fatalf("status = %s, want RUNTIME_ERROR for an uncaught network failure", result.Status)
	}
}

// 4.3: Filesystem write outside /tmp — fails on the read-only root.
func TestThreatWritesOutsideTheScratchMountsFail(t *testing.T) {
	runner := newDockerRunner(t)

	source := `targets = ["/escape", "/etc/escape", "/usr/local/lib/escape", "/var/tmp/escape",
           "/home/escape", "/root/escape", "/bin/escape"]
leaks = []
for path in targets:
    try:
        with open(path, "w") as handle:
            handle.write("x")
        leaks.append(path)
    except OSError:
        pass
print("LEAKED " + ",".join(leaks) if leaks else "contained")
`
	_, stdout := threatJob(t, runner, source, nil)
	if stdout != "contained" {
		t.Fatalf("writes escaped the read-only root: %q", stdout)
	}
}

// 4.3: Attempt to read /etc/shadow, /proc/1/environ, or the host mount table —
// yields nothing useful.
func TestThreatSensitiveReadsYieldNothingUseful(t *testing.T) {
	runner := newDockerRunner(t)

	// Planted in the worker's own environment: nothing of the worker's may be
	// visible from inside a sandbox, through any process's environment.
	const sentinel = "AMBATUCODE_THREAT_SENTINEL"
	t.Setenv(sentinel, "worker-secret-value")

	source := `import os
findings = []

try:
    open("/etc/shadow").read()
    findings.append("SHADOW_READABLE")
except OSError:
    pass

environ = b""
for path in ["/proc/1/environ", "/proc/self/environ"]:
    try:
        environ += open(path, "rb").read()
    except OSError:
        pass
for secret in [b"AMBATUCODE_THREAT_SENTINEL", b"REDIS_URL", b"EXECUTION_CALLBACK", b"DOCKER_HOST"]:
    if secret in environ:
        findings.append("ENV_LEAK:" + secret.decode())

# The only host-backed mounts may be the three files Docker itself manages.
allowed_host_files = {"/etc/resolv.conf", "/etc/hostname", "/etc/hosts"}
virtual = {"overlay", "proc", "tmpfs", "devpts", "sysfs", "cgroup2", "cgroup", "mqueue"}
for line in open("/proc/mounts"):
    source, target, fstype = line.split()[:3]
    if fstype not in virtual and target not in allowed_host_files:
        findings.append("HOST_MOUNT:" + target)
    if "rw" in line.split()[3].split(",") and target in allowed_host_files:
        findings.append("WRITABLE_HOST_FILE:" + target)

    # Overlay layer paths name host directories; they must not be reachable.
    if fstype == "overlay":
        for option in line.split()[3].split(","):
            if option.startswith("lowerdir="):
                layer = option[len("lowerdir="):].split(":")[0]
                if os.path.exists(layer):
                    findings.append("HOST_LAYER_REACHABLE")

for sock in ["/var/run/docker.sock", "/run/docker.sock", "/run/containerd/containerd.sock"]:
    if os.path.exists(sock):
        findings.append("SOCKET:" + sock)

status = open("/proc/self/status").read()
if status.split("CapEff:")[1].split()[0] != "0000000000000000":
    findings.append("CAPABILITIES")
if status.split("NoNewPrivs:")[1].split()[0] != "1":
    findings.append("NEW_PRIVS_ALLOWED")
if os.getuid() == 0:
    findings.append("ROOT")

# A hostname equal to the container id would leak it into Coder output. With
# no network Docker leaves /etc/hostname empty, so the name is checked where a
# program would actually find it.
import socket
if socket.gethostname() != "sandbox" or os.environ.get("HOSTNAME", "sandbox") != "sandbox":
    findings.append("HOSTNAME_IDENTIFIES_CONTAINER")
if open("/etc/hostname").read().strip() not in ("", "sandbox"):
    findings.append("HOSTNAME_FILE_IDENTIFIES_CONTAINER")

print(" ".join(findings) if findings else "nothing-useful")
`
	_, stdout := threatJob(t, runner, source, nil)
	if stdout != "nothing-useful" {
		t.Fatalf("sensitive reads found something: %q", stdout)
	}
	if os.Getenv(sentinel) == "" {
		t.Fatal("the sentinel was not set, so the environment check proved nothing")
	}
}

// 4.3: Large file write into /tmp — bounded by the tmpfs size and the fsize
// ulimit. Every writable mount is checked, not only /tmp.
func TestThreatLargeFileWritesAreBounded(t *testing.T) {
	runner := newDockerRunner(t)

	source := `import os
chunk = b"x" * (1024 * 1024)
report = []
for directory in ["/tmp", "/workspace", "/dev/shm"]:
    written = 0
    try:
        with open(os.path.join(directory, "fill.bin"), "wb") as handle:
            while written < 512:
                handle.write(chunk)
                handle.flush()
                written += 1
    except OSError:
        pass
    try:
        os.remove(os.path.join(directory, "fill.bin"))
    except OSError:
        pass
    report.append("%s=%d" % (directory, written))
print(" ".join(report))
`
	result, stdout := threatJob(t, runner, source, func(l *contract.Limits) {
		l.MemoryLimitMb = 512
		l.RunTimeoutMs = 20_000
	})

	if result.Status != contract.StatusGraded {
		t.Fatalf("status = %s (stdout %q), want the program to observe its own write failures",
			result.Status, stdout)
	}
	entries := strings.Fields(stdout)
	if len(entries) != 3 {
		t.Fatalf("expected a report for three mounts, got %q", stdout)
	}
	for _, entry := range entries {
		directory, rawMiB, ok := strings.Cut(entry, "=")
		mib, err := strconv.Atoi(rawMiB)
		if !ok || err != nil {
			t.Fatalf("unexpected report %q", stdout)
		}
		// 64 MiB is both the tmpfs size and the fsize ceiling; the program
		// asked for 512. Reaching the ask means nothing bounded it.
		if mib > 64 {
			t.Fatalf("%s accepted %d MiB, beyond its 64 MiB bound (report %q)", directory, mib, stdout)
		}
		// And the bound is what stopped it: a mount refusing writes outright
		// would pass the ceiling check while proving nothing about it.
		if mib < 32 {
			t.Fatalf("%s stopped at %d MiB, far below its bound (report %q)", directory, mib, stdout)
		}
	}
}

// 4.3: Spawning a subprocess that outlives the parent — cleaned up with the
// container.
func TestThreatOrphanedSubprocessDiesWithItsContainer(t *testing.T) {
	runner := newDockerRunner(t)

	// Double fork into a new session with stdio detached, so the parent exits
	// at once and nothing holds the exec's output stream open.
	spawner := `import os, sys
if os.fork() == 0:
    os.setsid()
    if os.fork() == 0:
        devnull = os.open(os.devnull, os.O_RDWR)
        for fd in (0, 1, 2):
            os.dup2(devnull, fd)
        os.execvp("python3", ["python3", "-c", "import time\nwhile True: time.sleep(1)", "ambatucode-orphan"])
    os._exit(0)
os.wait()
print("parent exited")
`
	started := time.Now()
	result, stdout := threatJob(t, runner, spawner, nil)
	if result.Status != contract.StatusGraded || stdout != "parent exited" {
		t.Fatalf("status %s, stdout %q; the parent should exit normally", result.Status, stdout)
	}
	// The detached orphan must not have kept the case running to its limit.
	if elapsed := time.Since(started); elapsed > 20*time.Second {
		t.Fatalf("the case took %s; the orphan held the job open", elapsed)
	}
	// threatJob has already asserted no container survived. A fresh job must
	// also see no trace of the orphan: it lived and died with its container.
	check := `import os
orphans = []
for pid in os.listdir("/proc"):
    if pid.isdigit():
        try:
            if b"ambatucode-orphan" in open("/proc/%s/cmdline" % pid, "rb").read():
                orphans.append(pid)
        except OSError:
            pass
print("ORPHAN " + ",".join(orphans) if orphans else "clean")
`
	_, stdout = threatJob(t, runner, check, nil)
	if stdout != "clean" {
		t.Fatalf("an orphan from a previous job is visible: %q", stdout)
	}

	// An orphan that keeps the output stream open cannot stall the worker
	// either: the case hits its limit and the container goes with it.
	holder := `import os, time
if os.fork() == 0:
    time.sleep(3600)
print("parent exited")
`
	result, _ = threatJob(t, runner, holder, func(l *contract.Limits) {
		l.RunTimeoutMs = 3_000
	})
	if result.Status != contract.StatusTimeLimitExceeded && result.Status != contract.StatusGraded {
		t.Fatalf("status = %s for an orphan holding stdout open", result.Status)
	}
}
