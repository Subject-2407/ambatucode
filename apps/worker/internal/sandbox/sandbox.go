// Package sandbox owns every interaction with the Docker daemon.
//
// This is the only package in the entire system permitted to talk to Docker.
// That privilege is the reason every control here is mandatory and none may be
// relaxed for convenience: `apps/web` and `apps/realtime` have no socket, and
// untrusted participant code reaches a container only through this package.
package sandbox

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/strslice"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
	units "github.com/docker/go-units"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/observability"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/seccomp"
)

const (
	// LabelWorker marks every container this worker creates, so the startup
	// sweep and the reaper can find them without tracking state across a crash.
	LabelWorker = "ambatucode.worker"
	// LabelJob records which job a container belongs to. Diagnostic only.
	LabelJob = "ambatucode.job"
	// LabelDeadline is the Unix second after which the container's keeper has
	// exited, so no job can still be using it. The reaper removes by it.
	LabelDeadline = "ambatucode.deadline"

	// sandboxUser is nobody:nogroup. It owns nothing and has no shell account.
	sandboxUser = "65534:65534"
	sandboxUID  = 65534
	// sandboxHostname is the same for every container, so it identifies none.
	sandboxHostname = "sandbox"
	workspaceDir    = "/workspace"
	workspaceSize   = "64m"

	// tmpfsTmp caps the general scratch path. noexec stops a program from
	// writing a payload and executing it; the size cap stops it from filling
	// host memory through the tmpfs.
	tmpfsTmp = "rw,noexec,nosuid,size=64m"

	// nofileLimit is deliberately small. Nothing legitimate in a graded
	// exercise needs many descriptors, and a low ceiling blunts fd exhaustion.
	nofileLimit = 64

	// keeperMargin is how much longer the container's own process lives than
	// the job's wall clock, so our deadline is always the one that fires.
	keeperMargin = 30 * time.Second
)

// File is one workspace entry written into the container before a run.
type File struct {
	Name    string
	Content []byte
}

// SessionSpec describes the container one job runs in. There is no field here
// that can turn off a security control — those are not configurable.
type SessionSpec struct {
	JobID string
	Image string

	// WallTimeout is the budget for the entire job: the compile step plus
	// every test case. The keeper process outlives it by a fixed margin.
	WallTimeout    time.Duration
	MemoryLimitMb  int64
	MaxProcesses   int64
	MaxOutputBytes int64

	// DeniedSyscalls narrows the seccomp profile further. Leaving it empty
	// still applies the full base profile; nothing here can loosen it.
	DeniedSyscalls []string
}

// ExecSpec is one command inside an open session.
type ExecSpec struct {
	// Cmd is an argument vector. Participant source code is never part of it,
	// and it is never handed to a shell.
	Cmd     []string
	Stdin   string
	Timeout time.Duration
	// Env adds KEY=value entries on top of the image's environment. Only the
	// worker's own fixed values go here; nothing from the job payload does.
	Env []string
}

// RunOutcome is the raw result of one execution. Classifying it into a
// submission status is the runner's job, not the sandbox's.
type RunOutcome struct {
	ExitCode        int
	Stdout          string
	Stderr          string
	StdoutTruncated bool
	StderrTruncated bool
	// OOMKilled comes from the daemon's own accounting. An exit code alone
	// cannot distinguish a memory kill from an ordinary crash.
	OOMKilled bool
	// TimedOut means the exec's own deadline fired before the program exited.
	// Cancellation of the caller's context is an error from Run, never this.
	TimedOut bool
	Duration time.Duration
}

type Sandbox struct {
	client  *client.Client
	logger  *slog.Logger
	metrics *observability.Metrics
}

// New connects to the Docker daemon and negotiates an API version. metrics may
// be nil.
func New(logger *slog.Logger, metrics *observability.Metrics) (*Sandbox, error) {
	docker, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("create docker client: %w", err)
	}
	return &Sandbox{client: docker, logger: logger, metrics: metrics}, nil
}

func (s *Sandbox) Close() error { return s.client.Close() }

// Ping reports whether the Docker daemon is reachable.
func (s *Sandbox) Ping(ctx context.Context) error {
	if _, err := s.client.Ping(ctx); err != nil {
		return fmt.Errorf("ping docker: %w", err)
	}
	return nil
}

// EnsureImages verifies every sandbox image is already present locally.
//
// The platform has to run fully offline, so the worker never pulls. Checking
// at startup turns a missing image into one loud failure instead of a stream
// of participants whose submissions fail to grade.
func (s *Sandbox) EnsureImages(ctx context.Context, images []string) error {
	for _, ref := range images {
		if _, _, err := s.client.ImageInspectWithRaw(ctx, ref); err != nil {
			return fmt.Errorf(
				"sandbox image %q is not present locally and the worker never pulls; build it with `docker compose -f docker/compose/sandbox.yml build`: %w",
				ref, err,
			)
		}
	}
	return nil
}

// EnsureSeccomp verifies the daemon can enforce a seccomp profile and that
// every profile the worker will use builds.
//
// A daemon without seccomp support accepts the option and silently ignores
// it, so the only honest check is to ask it — and a worker that cannot filter
// syscalls must not run participant code at all.
func (s *Sandbox) EnsureSeccomp(ctx context.Context, deniedSets map[string][]string) error {
	info, err := s.client.Info(ctx)
	if err != nil {
		return fmt.Errorf("read docker daemon security options: %w", err)
	}
	if !hasSeccomp(info.SecurityOptions) {
		return fmt.Errorf(
			"docker daemon does not support seccomp (security options %v); refusing to run participant code without a syscall filter",
			info.SecurityOptions,
		)
	}
	for language, denied := range deniedSets {
		if _, err := seccomp.Build(denied); err != nil {
			return fmt.Errorf("seccomp profile for %s: %w", language, err)
		}
	}
	return nil
}

// hasSeccomp reads the daemon's `name=seccomp,profile=...` security option.
func hasSeccomp(options []string) bool {
	for _, option := range options {
		for _, field := range strings.Split(option, ",") {
			if field == "name=seccomp" {
				return true
			}
		}
	}
	return false
}

// Session is one container, held open for the duration of one job.
//
// One container per *execution* rather than per test case is a deliberate
// choice and the only shape in which a compile step can exist: a compiled
// artifact lives in the container's scratch mount, so compiling in one
// container and running in another would mean carrying binaries between them.
// Reuse is confined to a single submission's own cases, so nothing can travel
// from one participant to another — which is the isolation that matters.
//
// The container is created fresh here and destroyed in Close, on every path
// out including panic and timeout. The reaper is the safety net for a crashed
// worker, not the primary mechanism.
type Session struct {
	box            *Sandbox
	id             string
	jobID          string
	maxOutputBytes int64
	memoryLimitMb  int64
	// killed is set once a deadline forced the whole container down. Nothing
	// further can run in the session after that.
	killed bool
}

// Open creates the container and starts its keeper process.
func (s *Sandbox) Open(ctx context.Context, spec SessionSpec) (*Session, error) {
	id, err := s.create(ctx, spec)
	if err != nil {
		s.countCreateFailure(ctx)
		return nil, err
	}

	if err := s.client.ContainerStart(ctx, id, container.StartOptions{}); err != nil {
		s.remove(id, spec.JobID)
		s.countCreateFailure(ctx)
		return nil, fmt.Errorf("start container: %w", err)
	}
	s.metrics.ContainerOpened()

	return &Session{
		box:            s,
		id:             id,
		jobID:          spec.JobID,
		maxOutputBytes: spec.MaxOutputBytes,
		memoryLimitMb:  spec.MemoryLimitMb,
	}, nil
}

// ContainerID is diagnostic only; it appears in structured logs.
func (sn *Session) ContainerID() string { return sn.id }

// Alive reports whether commands can still run in the session.
func (sn *Session) Alive() bool { return sn.id != "" && !sn.killed }

// SetMemoryLimit changes the container's memory ceiling for what runs next.
//
// Swap moves with it, equal to the limit, so it stays disabled: a limit raised
// on memory alone would let the difference spill into swap. A no-op when the
// limit is already in force, which is the common case of a job with no
// per-case overrides.
func (sn *Session) SetMemoryLimit(ctx context.Context, memoryLimitMb int64) error {
	if memoryLimitMb == sn.memoryLimitMb {
		return nil
	}
	bytes := memoryLimitMb * 1024 * 1024
	_, err := sn.box.client.ContainerUpdate(ctx, sn.id, container.UpdateConfig{
		Resources: container.Resources{Memory: bytes, MemorySwap: bytes},
	})
	if err != nil {
		return fmt.Errorf("set memory limit to %d MB: %w", memoryLimitMb, err)
	}
	sn.memoryLimitMb = memoryLimitMb
	return nil
}

// OOMKills returns how many processes the kernel has killed for exceeding the
// container's memory limit so far. The second return is false when the count
// cannot be read, which happens on a host without cgroup v2.
//
// Unlike the daemon's OOMKilled flag, which is set once and never cleared, the
// counter can be compared before and after each case — the only way to tell
// which case of several ran out of memory.
func (sn *Session) OOMKills(ctx context.Context) (int64, bool) {
	readCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	result, err := sn.box.exec(readCtx, sn.id, execRequest{
		cmd:       []string{"cat", "/sys/fs/cgroup/memory.events"},
		outputCap: 4096,
	})
	if err != nil || result.exitCode != 0 {
		return 0, false
	}
	return parseOOMKills(result.stdout)
}

// parseOOMKills reads the oom_kill counter from a cgroup v2 memory.events file.
func parseOOMKills(events string) (int64, bool) {
	for _, line := range strings.Split(events, "\n") {
		name, value, found := strings.Cut(strings.TrimSpace(line), " ")
		if !found || name != "oom_kill" {
			continue
		}
		count, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
		if err != nil {
			return 0, false
		}
		return count, true
	}
	return 0, false
}

// Close removes the container. Safe to call twice.
func (sn *Session) Close() {
	if sn.id == "" {
		return
	}
	sn.box.remove(sn.id, sn.jobID)
	sn.box.metrics.ContainerClosed()
	sn.id = ""
}

// countCreateFailure counts a container the daemon would not create or start.
// A job cancelled by shutdown mid-create is not the daemon failing.
func (s *Sandbox) countCreateFailure(ctx context.Context) {
	if ctx.Err() == nil {
		s.metrics.ContainerCreateFailed()
	}
}

func (s *Sandbox) remove(id, jobID string) {
	// A fresh context: the job's context may already be cancelled, and cleanup
	// must not be skipped because the job timed out.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err := s.client.ContainerRemove(ctx, id, container.RemoveOptions{
		Force:         true,
		RemoveVolumes: true,
	})
	if err != nil && !client.IsErrNotFound(err) {
		// Losing a container is a leak, not a grading failure — the job's
		// result still stands. Log it so the reaper's work is visible.
		s.logger.Error("remove container failed",
			slog.String("jobId", jobID),
			slog.String("containerId", id),
			slog.String("error", err.Error()))
	}
}

func (s *Sandbox) create(ctx context.Context, spec SessionSpec) (string, error) {
	profile, err := seccomp.Build(spec.DeniedSyscalls)
	if err != nil {
		// Never fall back to Docker's default, and never to no profile.
		return "", fmt.Errorf("build seccomp profile for job %s: %w", spec.JobID, err)
	}

	pids := spec.MaxProcesses
	memoryBytes := spec.MemoryLimitMb * 1024 * 1024

	// The container's own process is a keeper that outlives the job's wall
	// clock, so the deadline that fires is always ours. Participant code runs
	// as an exec inside it, sharing the same cgroup — which is what keeps the
	// memory and pid limits meaningful.
	keeperSeconds := int64((spec.WallTimeout + keeperMargin).Seconds())
	// Stamped before create, so it can only be earlier than the keeper's real
	// exit is late — the reaper waits a further margin on top of it.
	deadline := time.Now().Add(spec.WallTimeout + keeperMargin)

	config := &container.Config{
		Image: spec.Image,
		Cmd:   strslice.StrSlice{"sleep", strconv.FormatInt(keeperSeconds, 10)},
		// Docker defaults the hostname to the container id, which a program can
		// print from its environment or /etc/hostname straight into a Coder-
		// visible excerpt.
		Hostname:        sandboxHostname,
		User:            sandboxUser,
		NetworkDisabled: true,
		WorkingDir:      workspaceDir,
		Labels: map[string]string{
			LabelWorker:   "1",
			LabelJob:      spec.JobID,
			LabelDeadline: strconv.FormatInt(deadline.Unix(), 10),
		},
	}

	hostConfig := &container.HostConfig{
		// No network, ever. There is no assessment setting that turns this on.
		NetworkMode: "none",
		// Read-only root: the only writable paths are the two tmpfs mounts.
		ReadonlyRootfs: true,
		Tmpfs: map[string]string{
			"/tmp": tmpfsTmp,
			// Owned by the sandbox user so the workspace can be written; the
			// mountpoint's own mode in the image would otherwise win and leave
			// this unwritable under the read-only root.
			//
			// `exec` is stated explicitly because Docker mounts a tmpfs noexec
			// by default, and a compiled language has to run the binary it just
			// produced. This is the one writable path in the container that can
			// execute, and it is a real narrowing of defence in depth — so /tmp,
			// where a running program naturally writes, keeps its noexec. What
			// it does not weaken is the boundary that matters: participant code
			// already runs arbitrary logic here by design, and the controls that
			// stop it going further — no network, no capabilities, non-root,
			// no-new-privileges, a read-only root, and the cgroup limits — are
			// all untouched by whether this mount can exec.
			workspaceDir: fmt.Sprintf(
				"rw,exec,nosuid,size=%s,uid=%d,gid=%d,mode=0700",
				workspaceSize, sandboxUID, sandboxUID,
			),
		},
		CapDrop: strslice.StrSlice{"ALL"},
		// The profile travels as JSON content, which is what the Engine API
		// expects; the CLI's `seccomp=<file>` is only the CLI reading the file.
		// What must never happen is seccomp=unconfined to make something work.
		SecurityOpt: []string{"no-new-privileges", "seccomp=" + profile},
		// AutoRemove is deliberately off. It would delete the container before
		// the OOMKilled state could be read, and that state is the only
		// reliable way to tell a memory kill from an ordinary crash.
		AutoRemove: false,
		Resources: container.Resources{
			Memory: memoryBytes,
			// Equal to Memory, which disables swap. Swap would let a memory
			// bomb thrash the host instead of being killed.
			MemorySwap: memoryBytes,
			NanoCPUs:   1_000_000_000, // 1.0 CPU
			PidsLimit:  &pids,
			Ulimits: []*units.Ulimit{
				{Name: "nofile", Soft: nofileLimit, Hard: nofileLimit},
				{Name: "fsize", Soft: maxFileSize(spec), Hard: maxFileSize(spec)},
			},
		},
	}

	// No name is supplied: containers are found by label, and an
	// auto-generated name keeps job ids out of the daemon's namespace.
	created, err := s.client.ContainerCreate(ctx, config, hostConfig, nil, nil, "")
	if err != nil {
		return "", fmt.Errorf("create container for job %s: %w", spec.JobID, err)
	}
	return created.ID, nil
}

// maxFileSize bounds any single file the job can write.
//
// It cannot simply be maxOutputBytes: a compiler writes an object file and a
// binary far larger than any program's stdout, and an fsize ulimit at the
// output cap would fail every C++ and Java compile with a truncated artifact.
// The tmpfs size cap is what bounds total disk use; this bounds one file.
func maxFileSize(spec SessionSpec) int64 {
	const compileArtifactCeiling = 64 * 1024 * 1024
	if spec.MaxOutputBytes > compileArtifactCeiling {
		return spec.MaxOutputBytes
	}
	return compileArtifactCeiling
}

// Write streams one file into the scratch mount.
//
// The content travels on an exec's stdin, never in the argument vector, so
// participant source is not exposed to any parsing on the way in. Docker
// refuses to copy into a container whose root filesystem is read-only, and
// that read-only root is not negotiable, so this is how a workspace gets in
// without ever bind-mounting a host path.
//
// Name is relative to the workspace and may name subdirectories, which are
// created first. It must already be validated: the sandbox confines where a
// file lands only by prefixing the workspace, and trusts the name itself.
func (sn *Session) Write(ctx context.Context, file File) error {
	writeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	if dir := path.Dir(file.Name); dir != "." {
		if err := sn.makeDir(writeCtx, workspaceDir+"/"+dir, true); err != nil {
			return fmt.Errorf("write workspace file %s: %w", file.Name, err)
		}
	}

	result, err := sn.box.exec(writeCtx, sn.id, execRequest{
		cmd:       []string{"tee", workspaceDir + "/" + file.Name},
		stdin:     string(file.Content),
		outputCap: 4096,
	})
	if err != nil {
		return fmt.Errorf("write workspace file %s: %w", file.Name, err)
	}
	if result.exitCode != 0 {
		return fmt.Errorf(
			"write workspace file %s: exit %d: %s", file.Name, result.exitCode, result.stderr,
		)
	}
	return nil
}

// MakePrivateDir creates a directory only the sandbox user can read, failing
// if it already exists — so a name chosen by the worker cannot have been
// prepared in advance by anything that ran earlier in the container.
func (sn *Session) MakePrivateDir(ctx context.Context, dir string) error {
	dirCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return sn.makeDir(dirCtx, dir, false)
}

func (sn *Session) makeDir(ctx context.Context, dir string, parents bool) error {
	cmd := []string{"mkdir", "-m", "0700", dir}
	if parents {
		cmd = []string{"mkdir", "-p", dir}
	}
	result, err := sn.box.exec(ctx, sn.id, execRequest{cmd: cmd, outputCap: 4096})
	if err != nil {
		return fmt.Errorf("create directory %s: %w", dir, err)
	}
	if result.exitCode != 0 {
		return fmt.Errorf("create directory %s: exit %d: %s", dir, result.exitCode, result.stderr)
	}
	return nil
}

// ErrFileTooLarge is returned by ReadFile for a file past its size cap.
var ErrFileTooLarge = errors.New("file exceeds the read cap")

// ReadFile returns a file from inside the container, at most maxBytes of it.
// The second return is false when the file does not exist or cannot be read.
func (sn *Session) ReadFile(ctx context.Context, name string, maxBytes int64) ([]byte, bool, error) {
	readCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	result, err := sn.box.exec(readCtx, sn.id, execRequest{
		cmd:       []string{"cat", name},
		outputCap: maxBytes,
	})
	if err != nil {
		return nil, false, fmt.Errorf("read %s: %w", name, err)
	}
	if result.exitCode != 0 {
		return nil, false, nil
	}
	if result.stdoutTruncated {
		return nil, true, fmt.Errorf("read %s: %w (%d bytes)", name, ErrFileTooLarge, maxBytes)
	}
	return []byte(result.stdout), true, nil
}

// Run executes one command in the session and reports its raw outcome.
func (sn *Session) Run(ctx context.Context, spec ExecSpec) (RunOutcome, error) {
	runCtx, cancel := context.WithTimeout(ctx, spec.Timeout)
	defer cancel()

	startedAt := time.Now()
	result, err := sn.box.exec(runCtx, sn.id, execRequest{
		cmd:       spec.Cmd,
		env:       spec.Env,
		stdin:     spec.Stdin,
		outputCap: sn.maxOutputBytes,
	})
	duration := time.Since(startedAt)

	outcome := RunOutcome{Duration: duration}

	if err != nil {
		if runCtx.Err() == nil {
			return RunOutcome{}, err
		}
		if ctx.Err() != nil {
			// The caller gave up, not the program's clock — a worker shutting
			// down. Reporting that as TIME_LIMIT_EXCEEDED would grade a
			// submission on the worker's lifecycle. Close removes the container.
			return RunOutcome{}, fmt.Errorf("run interrupted: %w", ctx.Err())
		}
		// Our deadline fired. Kill the container rather than stopping it: a
		// program that ignores signals must not get extra time, and the
		// container is being destroyed regardless.
		outcome.TimedOut = true
		sn.killed = true
		killCtx, killCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer killCancel()
		if killErr := sn.box.client.ContainerKill(killCtx, sn.id, "SIGKILL"); killErr != nil &&
			!client.IsErrNotFound(killErr) {
			sn.box.logger.Warn("kill timed-out container failed",
				slog.String("jobId", sn.jobID),
				slog.String("error", killErr.Error()))
		}
	} else {
		outcome.ExitCode = result.exitCode
	}

	outcome.Stdout, outcome.StdoutTruncated = result.stdout, result.stdoutTruncated
	outcome.Stderr, outcome.StderrTruncated = result.stderr, result.stderrTruncated
	outcome.OOMKilled = sn.oomKilled()

	return outcome, nil
}

// oomKilled reads the memory verdict from the daemon rather than inferring it.
//
// The flag is set on the container even when the OOM killer took an exec'd
// process and left the keeper running, and an exit code alone cannot tell a
// memory kill from an ordinary SIGKILL — both surface as 137.
//
// It is also sticky: once the cgroup has OOMed the flag stays set for the life
// of the container, so it describes a single step honestly only until the
// first memory kill. The runner attributes kills to cases with OOMKills and
// falls back to this flag only where that counter cannot be read.
func (sn *Session) oomKilled() bool {
	// A fresh context: the run context may already be past its deadline.
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	inspected, err := sn.box.client.ContainerInspect(ctx, sn.id)
	if err != nil || inspected.State == nil {
		return false
	}
	return inspected.State.OOMKilled
}

type execRequest struct {
	cmd       []string
	env       []string
	stdin     string
	outputCap int64
}

type execResult struct {
	exitCode        int
	stdout          string
	stderr          string
	stdoutTruncated bool
	stderrTruncated bool
}

// exec runs one argument vector inside an already-running container.
func (s *Sandbox) exec(ctx context.Context, containerID string, request execRequest) (execResult, error) {
	created, err := s.client.ContainerExecCreate(ctx, containerID, container.ExecOptions{
		Cmd:          request.cmd,
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		// No TTY: a TTY merges stdout and stderr into one stream, and the two
		// have to stay separable for reporting.
		Tty:        false,
		WorkingDir: workspaceDir,
		User:       sandboxUser,
		Env:        request.env,
	})
	if err != nil {
		return execResult{}, fmt.Errorf("create exec: %w", err)
	}

	attached, err := s.client.ContainerExecAttach(ctx, created.ID, container.ExecStartOptions{})
	if err != nil {
		return execResult{}, fmt.Errorf("attach exec: %w", err)
	}
	defer attached.Close()

	// Feed stdin and close the write side, so a program reading to EOF is not
	// left blocking until the wall timeout.
	go func() {
		if request.stdin != "" {
			_, _ = io.Copy(attached.Conn, bytes.NewBufferString(request.stdin))
		}
		_ = attached.CloseWrite()
	}()

	stdout := &cappedBuffer{limit: request.outputCap}
	stderr := &cappedBuffer{limit: request.outputCap}
	copyDone := make(chan error, 1)
	go func() {
		// Demultiplexes Docker's framed stream. The caps are applied as bytes
		// arrive, not after buffering, so an infinite printer cannot exhaust
		// worker memory.
		_, copyErr := stdcopy.StdCopy(stdout, stderr, attached.Reader)
		copyDone <- copyErr
	}()

	result := execResult{}
	select {
	case <-copyDone:
	case <-ctx.Done():
		result.stdout, result.stdoutTruncated = stdout.result()
		result.stderr, result.stderrTruncated = stderr.result()
		return result, ctx.Err()
	}

	result.stdout, result.stdoutTruncated = stdout.result()
	result.stderr, result.stderrTruncated = stderr.result()

	inspected, err := s.client.ContainerExecInspect(ctx, created.ID)
	if err != nil {
		return result, fmt.Errorf("inspect exec: %w", err)
	}
	result.exitCode = inspected.ExitCode
	return result, nil
}

// Managed is one container this worker created, as the reaper sees it.
type Managed struct {
	ID    string
	JobID string
	// Created is when the daemon created the container.
	Created time.Time
	// Deadline is when its keeper exits; zero when the label is missing or
	// unreadable, which the reaper handles by age instead.
	Deadline time.Time
}

// ListManaged returns every container carrying the worker label.
func (s *Sandbox) ListManaged(ctx context.Context) ([]Managed, error) {
	args := filters.NewArgs()
	args.Add("label", LabelWorker+"=1")

	containers, err := s.client.ContainerList(ctx, container.ListOptions{All: true, Filters: args})
	if err != nil {
		return nil, fmt.Errorf("list managed containers: %w", err)
	}

	managed := make([]Managed, 0, len(containers))
	for _, existing := range containers {
		entry := Managed{
			ID:      existing.ID,
			JobID:   existing.Labels[LabelJob],
			Created: time.Unix(existing.Created, 0),
		}
		if seconds, err := strconv.ParseInt(existing.Labels[LabelDeadline], 10, 64); err == nil {
			entry.Deadline = time.Unix(seconds, 0)
		}
		managed = append(managed, entry)
	}
	return managed, nil
}

// Remove force-removes one managed container. A container that is already
// gone is not an error: the job's own cleanup may have won the race.
func (s *Sandbox) Remove(ctx context.Context, id string) error {
	err := s.client.ContainerRemove(ctx, id, container.RemoveOptions{Force: true, RemoveVolumes: true})
	if err != nil && !client.IsErrNotFound(err) {
		return fmt.Errorf("remove container %s: %w", id, err)
	}
	return nil
}

// SweepOrphans removes every container carrying this worker's label.
//
// Run at startup before any job is consumed: a worker that crashed mid-job
// leaves containers behind, and `defer` cannot help once the process is gone.
//
// Unlike the reaper it does not wait for a deadline, which assumes this worker
// is the only one using the daemon. Workers sharing a daemon would destroy
// each other's live containers on restart; give each its own daemon.
func (s *Sandbox) SweepOrphans(ctx context.Context) (int, error) {
	managed, err := s.ListManaged(ctx)
	if err != nil {
		return 0, fmt.Errorf("sweep orphaned containers: %w", err)
	}

	removed := 0
	for _, existing := range managed {
		if err := s.Remove(ctx, existing.ID); err != nil {
			s.logger.Error("remove orphaned container failed",
				slog.String("containerId", existing.ID),
				slog.String("error", err.Error()))
			continue
		}
		removed++
	}
	return removed, nil
}
