//go:build daemonrestart

package e2e

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/sandbox"
)

// The Docker daemon restart check, verified against a real restart.
//
// It is kept out of the chaos suite because it restarts the daemon every
// container on the host depends on — on Docker Desktop, the whole VM, with the
// dev Redis and PostgreSQL inside it. Run it on purpose, with nothing else on
// the daemon that matters:
//
//	CHAOS_DOCKER_RESTART_COMMAND="docker desktop restart" \
//	  go test -tags daemonrestart -timeout 30m -v -run TestDockerDaemonRestart ./e2e/
//
// On a Linux host the command is typically `sudo systemctl restart docker`.
// Without the variable the test asks for the restart and waits for it, so an
// operator can restart the daemon by whatever means the host uses.
//
// Redis is expected to come back with the daemon (restart: unless-stopped in
// docker/compose/dev.yml). The submissions enqueued before the restart were
// persisted by its append-only file, so the worker must still grade them all.
func TestDockerDaemonRestartLosesNoSubmission(t *testing.T) {
	box := newSandbox(t)
	q := newQueues(t)
	lms := newStubLMS(t)
	worker := startWorker(t, q, lms, workerOptions{Concurrency: 4, MaxContainers: 4})

	ids := submitDaemonBatch(t, q, 12)
	// Past Redis's once-a-second append-only fsync.
	time.Sleep(2 * time.Second)

	deadline := time.Now().Add(time.Minute)
	for worker.metric("containers_active") < 1 {
		if time.Now().After(deadline) {
			t.Fatal("no container started before the restart")
		}
		time.Sleep(50 * time.Millisecond)
	}

	if command := strings.TrimSpace(os.Getenv("CHAOS_DOCKER_RESTART_COMMAND")); command != "" {
		fields := strings.Fields(command)
		t.Logf("restarting the daemon: %s", command)
		restart := exec.Command(fields[0], fields[1:]...)
		restart.Stdout, restart.Stderr = os.Stdout, os.Stderr
		if err := restart.Start(); err != nil {
			t.Fatalf("start restart command: %v", err)
		}
		// The command may return before or after the daemon is back; the
		// probes below are what the test trusts.
		go func() { _ = restart.Wait() }()
	} else {
		t.Log("restart the Docker daemon now; waiting up to 5 minutes for it to go down")
	}

	awaitDaemon(t, box, false, 5*time.Minute)
	t.Log("the daemon is down")
	awaitDaemon(t, box, true, 5*time.Minute)
	t.Log("the daemon is back")
	q.awaitRedis(t, 3*time.Minute)

	if !worker.Alive() {
		t.Fatal("the worker exited while the daemon restarted")
	}
	if err := worker.awaitHealthy(3 * time.Minute); err != nil {
		t.Fatalf("the worker did not report healthy after the restart: %v", err)
	}

	ids = append(ids, submitDaemonBatch(t, q, 3)...)
	assertNothingLost(t, q, lms, ids, 6*time.Minute)
	// A restart stops every container without removing it; the reaper removes
	// the ones whose job was cut off once their deadline has passed.
	awaitNoContainers(t, box, 5*time.Minute)
}

func submitDaemonBatch(t *testing.T, q *queues, n int) []string {
	t.Helper()
	ids := make([]string, 0, n)
	languages := []contract.Language{contract.LanguageJava, contract.LanguageCPP, contract.LanguagePython}
	for i := 0; i < n; i++ {
		job := submission(jobID("daemon-restart", i), languages[i%len(languages)], 3)
		q.enqueue(t, job)
		ids = append(ids, job.JobID)
	}
	return ids
}

// awaitDaemon waits until the daemon's reachability matches up.
func awaitDaemon(t *testing.T, box *sandbox.Sandbox, up bool, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		reachable := box.Ping(ctx) == nil
		cancel()
		if reachable == up {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("the daemon did not become reachable=%v within %s", up, timeout)
		}
		time.Sleep(500 * time.Millisecond)
	}
}
