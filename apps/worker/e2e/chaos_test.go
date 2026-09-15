//go:build chaos

package e2e

import (
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"testing"
	"time"

	"github.com/docker/docker/client"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
)

// The chaos checks from EXECUTION.md: the LMS unreachable, the Docker daemon
// unreachable, and Redis restarting. Each one enqueues formal submissions,
// takes a dependency away while they are in flight, gives it back, and then
// holds the worker to the exit criterion — no submission lost, none graded as
// a platform failure because of the outage, and nothing left running.
//
// A real Docker daemon restart is not automated: on Docker Desktop it restarts
// the whole VM, taking the dev Redis and PostgreSQL with it. The daemon check
// here puts a proxy in front of the Engine API and cuts it, which is what the
// worker experiences during a restart; the restart itself is in the operator
// runbook, with a script that verifies the same outcome.

// submitBatch enqueues n formal submissions and returns their ids.
func submitBatch(t *testing.T, q *queues, label string, n int, languages ...contract.Language) []string {
	t.Helper()
	ids := make([]string, 0, n)
	for i := 0; i < n; i++ {
		lang := languages[i%len(languages)]
		job := submission(jobID(label, i), lang, 3)
		q.enqueue(t, job)
		ids = append(ids, job.JobID)
	}
	return ids
}

// ---------------------------------------------------------------------------
// LMS unreachable

// apps/web stops answering while submissions are being graded. Results are
// held and delivered once it returns, rather than spent against the queue's
// retry budget and failed for good within seconds.
func TestChaosLMSUnreachableLosesNoSubmission(t *testing.T) {
	box := newSandbox(t)
	q := newQueues(t)
	lms := newStubLMS(t)
	worker := startWorker(t, q, lms, workerOptions{Concurrency: 4, MaxContainers: 4})

	lms.Down()
	ids := submitBatch(t, q, "lms-down", 6, contract.LanguagePython, contract.LanguageCPP)

	// Long past the worker's own quick retries and every BullMQ attempt the
	// producer allows a submission — a real outage, not a blip.
	outage := envDuration(t, "CHAOS_LMS_OUTAGE", 75*time.Second)
	time.Sleep(outage)
	if !worker.Alive() {
		t.Fatal("the worker exited while the LMS was unreachable")
	}
	if failed := q.backlog(t, submitQueue).Failed; failed > 0 {
		t.Fatalf("%d submission(s) were failed for good during the outage", failed)
	}

	lms.Up()
	assertNothingLost(t, q, lms, ids, 3*time.Minute)
	awaitNoContainers(t, box, time.Minute)

	// And it keeps grading normally afterwards.
	after := submitBatch(t, q, "lms-after", 2, contract.LanguagePython)
	assertNothingLost(t, q, lms, after, 2*time.Minute)
}

// ---------------------------------------------------------------------------
// Docker daemon unreachable

// dockerProxy forwards the Engine API over TCP and can be cut, so the worker
// loses the daemon exactly as it would during a restart — mid-exec included —
// without restarting anything real.
type dockerProxy struct {
	t    *testing.T
	addr string
	dial func(context.Context) (net.Conn, error)

	mu       sync.Mutex
	listener net.Listener
	conns    map[net.Conn]struct{}
}

func newDockerProxy(t *testing.T) *dockerProxy {
	t.Helper()
	docker, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatalf("docker client: %v", err)
	}
	t.Cleanup(func() { _ = docker.Close() })

	p := &dockerProxy{t: t, dial: docker.Dialer(), conns: map[net.Conn]struct{}{}}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for the docker proxy: %v", err)
	}
	p.addr = listener.Addr().String()
	p.serve(listener)
	t.Cleanup(p.Cut)
	return p
}

func (p *dockerProxy) Host() string { return "tcp://" + p.addr }

func (p *dockerProxy) serve(listener net.Listener) {
	p.mu.Lock()
	p.listener = listener
	p.mu.Unlock()
	go func() {
		for {
			downstream, err := listener.Accept()
			if err != nil {
				return
			}
			go p.pipe(downstream)
		}
	}()
}

func (p *dockerProxy) pipe(downstream net.Conn) {
	upstream, err := p.dial(context.Background())
	if err != nil {
		_ = downstream.Close()
		return
	}
	p.mu.Lock()
	if p.listener == nil {
		p.mu.Unlock()
		_ = downstream.Close()
		_ = upstream.Close()
		return
	}
	p.conns[downstream] = struct{}{}
	p.conns[upstream] = struct{}{}
	p.mu.Unlock()

	// Each direction is closed for writing on its own. An exec attach is
	// half-closed by the client once stdin is sent while output keeps flowing
	// back, so closing both ends when either finishes would cut off every
	// program's output — which is a proxy bug, not an outage.
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); forward(upstream, downstream) }()
	go func() { defer wg.Done(); forward(downstream, upstream) }()
	wg.Wait()
	_ = downstream.Close()
	_ = upstream.Close()
	p.mu.Lock()
	delete(p.conns, downstream)
	delete(p.conns, upstream)
	p.mu.Unlock()
}

// forward copies until src ends, then passes the end on as a half-close.
func forward(dst, src net.Conn) {
	_, _ = io.Copy(dst, src)
	if closer, ok := dst.(interface{ CloseWrite() error }); ok {
		_ = closer.CloseWrite()
		return
	}
	_ = dst.Close()
}

// Cut refuses new connections and severs every open one.
func (p *dockerProxy) Cut() {
	p.mu.Lock()
	listener := p.listener
	p.listener = nil
	conns := p.conns
	p.conns = map[net.Conn]struct{}{}
	p.mu.Unlock()
	if listener != nil {
		_ = listener.Close()
	}
	for conn := range conns {
		_ = conn.Close()
	}
}

func (p *dockerProxy) Restore() {
	p.t.Helper()
	var listener net.Listener
	var err error
	for attempt := 0; attempt < 50; attempt++ {
		if listener, err = net.Listen("tcp", p.addr); err == nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err != nil {
		p.t.Fatalf("relisten on %s: %v", p.addr, err)
	}
	p.serve(listener)
}

// The daemon disappears with containers running and submissions waiting.
// Nothing may be reported as SYSTEM_ERROR because of it: interrupted jobs go
// back to the queue, claiming pauses, and grading resumes when it returns.
func TestChaosDockerUnreachableLosesNoSubmission(t *testing.T) {
	box := newSandbox(t)
	q := newQueues(t)
	lms := newStubLMS(t)
	proxy := newDockerProxy(t)
	worker := startWorker(t, q, lms, workerOptions{
		Concurrency:   4,
		MaxContainers: 4,
		Env:           []string{"DOCKER_HOST=" + proxy.Host()},
	})

	ids := submitBatch(t, q, "docker-down", 12, contract.LanguageJava, contract.LanguageCPP, contract.LanguagePython)

	// Cut while containers are actually running, so an exec is severed mid-stream.
	deadline := time.Now().Add(time.Minute)
	for worker.metric("containers_active") < 1 {
		if time.Now().After(deadline) {
			t.Fatal("no container started before the cut")
		}
		time.Sleep(50 * time.Millisecond)
	}
	proxy.Cut()

	outage := envDuration(t, "CHAOS_DOCKER_OUTAGE", 30*time.Second)
	time.Sleep(outage / 2)
	if response, err := http.Get("http://" + worker.healthAddr + "/healthz"); err == nil {
		_ = response.Body.Close()
		if response.StatusCode != http.StatusServiceUnavailable {
			t.Errorf("health answered %d while the daemon was unreachable, want 503", response.StatusCode)
		}
	}
	// Submitted during the outage: these must wait, not fail.
	ids = append(ids, submitBatch(t, q, "docker-during", 3, contract.LanguagePython)...)
	time.Sleep(outage / 2)
	if !worker.Alive() {
		t.Fatal("the worker exited while the daemon was unreachable")
	}

	proxy.Restore()
	assertNothingLost(t, q, lms, ids, 4*time.Minute)
	// Containers whose job was cut off are the reaper's to remove once their
	// deadline passes.
	awaitNoContainers(t, box, 4*time.Minute)
}

// ---------------------------------------------------------------------------
// Redis restart

// The queue's Redis restarts under a batch of submissions. The worker rides
// out the dropped connections and every submission is still graded; a job
// whose completion was lost in the restart may be delivered twice, which the
// LMS's idempotent ingest absorbs.
func TestChaosRedisRestartLosesNoSubmission(t *testing.T) {
	container := os.Getenv("CHAOS_REDIS_CONTAINER")
	if container == "" {
		container = "ambatucode-redis"
	}
	if err := exec.Command("docker", "inspect", container).Run(); err != nil {
		t.Skipf("redis container %q not found; set CHAOS_REDIS_CONTAINER: %v", container, err)
	}

	box := newSandbox(t)
	q := newQueues(t)
	lms := newStubLMS(t)
	worker := startWorker(t, q, lms, workerOptions{Concurrency: 4, MaxContainers: 4})

	ids := submitBatch(t, q, "redis-restart", 20, contract.LanguagePython, contract.LanguageJava)
	// Past Redis's once-a-second append-only fsync, so the enqueue itself is
	// durable; what the restart can lose is the worker's later bookkeeping.
	time.Sleep(2 * time.Second)
	if missing := lms.awaitAll(ids[:1], time.Minute); len(missing) > 0 {
		t.Fatal("nothing was graded before the restart")
	}

	restart := exec.Command("docker", "restart", container)
	if output, err := restart.CombinedOutput(); err != nil {
		t.Fatalf("restart redis: %v: %s", err, output)
	}
	// Counted after the restart, which returns once Redis is down and back: a
	// batch already finished by then would prove nothing about the restart.
	if done := lms.deliveredCount(ids); done == len(ids) {
		t.Fatal("every submission finished before Redis went down; nothing was in flight")
	} else {
		t.Logf("%d of %d submissions delivered when Redis came back", done, len(ids))
	}
	q.awaitRedis(t, time.Minute)
	if !worker.Alive() {
		t.Fatal("the worker exited when Redis restarted")
	}
	if err := worker.awaitHealthy(time.Minute); err != nil {
		t.Fatalf("the worker did not report healthy after Redis returned: %v", err)
	}

	ids = append(ids, submitBatch(t, q, "redis-after", 4, contract.LanguagePython)...)
	// A job whose lock lapsed during the restart waits for the stalled check,
	// which runs every 30 seconds and needs two passes.
	assertNothingLost(t, q, lms, ids, 4*time.Minute)
	awaitNoContainers(t, box, 2*time.Minute)
}

func envDuration(t *testing.T, key string, fallback time.Duration) time.Duration {
	t.Helper()
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value <= 0 {
		t.Fatalf("%s must be a positive duration such as 45s, got %q", key, raw)
	}
	return value
}
