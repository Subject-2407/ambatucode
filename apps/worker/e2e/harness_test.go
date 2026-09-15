//go:build load || chaos || daemonrestart

// Package e2e drives the real worker binary against real Redis and Docker.
//
// Unlike the package tests, nothing here is wired in-process: the worker is
// built and started as its own process, exactly as an operator runs it, so a
// test can kill it, starve it of Redis, or take its LMS away and observe what a
// lab would observe. The LMS is a stub that records every result the worker
// delivers and can be made to fail or to vanish.
//
// Every test runs under a random BullMQ key prefix, so it never touches the
// `bull:` keys a running dev stack is using.
//
//	docker compose -f docker/compose/dev.yml up -d
//	docker compose -f docker/compose/sandbox.yml build
//	go test -tags load  -timeout 30m -v ./e2e/
//	go test -tags chaos -timeout 30m -v ./e2e/
//	go test -tags daemonrestart -timeout 30m -v ./e2e/   (restarts the daemon)
//
// Stop any other worker first: each worker's startup sweep removes every
// sandbox container on the daemon, including another worker's live ones.
package e2e

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/language"
	"github.com/Subject-2407/ambatucode/apps/worker/internal/sandbox"
)

// Queue names and the producer's retry policies, as packages/shared defines
// them. The worker honours whatever the job hash says, so these are what make
// a test job behave like a real one.
const (
	submitQueue = "execution-submit"
	runQueue    = "execution-run"

	submitOpts = `{"attempts":3,"backoff":{"type":"exponential","delay":2000},"removeOnComplete":false,"removeOnFail":false}`
	runOpts    = `{"attempts":1,"removeOnComplete":{"age":300},"removeOnFail":{"age":300}}`
)

// defaultLimits mirrors DEFAULT_EXECUTION_LIMITS in packages/shared.
var defaultLimits = contract.Limits{
	CompileTimeoutMs: 15_000,
	RunTimeoutMs:     5_000,
	WallTimeoutMs:    30_000,
	MemoryLimitMb:    256,
	MaxOutputBytes:   65_536,
	MaxProcesses:     64,
}

var workerBinary string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "ambatucode-e2e-")
	if err != nil {
		fmt.Fprintln(os.Stderr, "create temp dir:", err)
		os.Exit(1)
	}
	workerBinary = filepath.Join(dir, "worker")
	if runtime.GOOS == "windows" {
		workerBinary += ".exe"
	}
	build := exec.Command("go", "build", "-o", workerBinary, "./cmd/worker")
	build.Dir = ".."
	build.Stdout, build.Stderr = os.Stdout, os.Stderr
	if err := build.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "build worker:", err)
		os.Exit(1)
	}

	code := m.Run()
	_ = os.RemoveAll(dir)
	os.Exit(code)
}

// ---------------------------------------------------------------------------
// Redis

type queues struct {
	client *redis.Client
	prefix string
}

func newQueues(t *testing.T) *queues {
	t.Helper()
	url := os.Getenv("REDIS_URL")
	if url == "" {
		url = "redis://localhost:6379"
	}
	options, err := redis.ParseURL(url)
	if err != nil {
		t.Fatalf("parse REDIS_URL: %v", err)
	}
	// A restarted Redis drops every connection; the harness has to ride that
	// out as the worker does.
	options.MaxRetries = 10
	options.MinRetryBackoff = 100 * time.Millisecond
	options.MaxRetryBackoff = time.Second
	client := redis.NewClient(options)
	t.Cleanup(func() { _ = client.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Skipf("redis is not reachable: %v", err)
	}

	suffix := make([]byte, 6)
	_, _ = rand.Read(suffix)
	q := &queues{client: client, prefix: "ambatucode-e2e-" + hex.EncodeToString(suffix)}

	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		iter := client.Scan(cleanupCtx, 0, q.prefix+":*", 1000).Iterator()
		for iter.Next(cleanupCtx) {
			client.Del(cleanupCtx, iter.Val())
		}
	})
	return q
}

func (q *queues) key(queue, suffix string) string {
	return q.prefix + ":" + queue + ":" + suffix
}

// enqueue writes a job the way BullMQ's addStandardJob leaves it: a hash, an
// entry on the wait list, and a marker so a sleeping worker wakes.
func (q *queues) enqueue(t *testing.T, job contract.Job) time.Time {
	t.Helper()
	queue, opts := runQueue, runOpts
	if job.Kind == contract.KindSubmit {
		queue, opts = submitQueue, submitOpts
	}
	payload, err := json.Marshal(job)
	if err != nil {
		t.Fatalf("marshal job: %v", err)
	}

	ctx := context.Background()
	now := time.Now()
	// The transaction is all-or-nothing, so retrying it after a dropped
	// connection cannot enqueue a job twice.
	for attempt := 1; ; attempt++ {
		_, err = q.client.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			pipe.HSet(ctx, q.key(queue, job.JobID),
				"name", queue,
				"data", string(payload),
				"opts", opts,
				"timestamp", strconv.FormatInt(now.UnixMilli(), 10),
				"delay", "0",
				"priority", "0",
			)
			pipe.LPush(ctx, q.key(queue, "wait"), job.JobID)
			pipe.ZAdd(ctx, q.key(queue, "marker"), redis.Z{Score: 0, Member: "0"})
			return nil
		})
		if err == nil {
			return now
		}
		if attempt == 10 {
			t.Fatalf("enqueue %s: %v", job.JobID, err)
		}
		time.Sleep(time.Second)
	}
}

// awaitRedis waits until Redis answers again after a restart.
func (q *queues) awaitRedis(t *testing.T, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		err := q.client.Ping(ctx).Err()
		cancel()
		if err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("redis did not come back within %s: %v", timeout, err)
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// backlog counts what is still queued, running, or waiting to retry.
type backlog struct {
	Wait, Active, Delayed, Failed int64
}

func (q *queues) backlog(t *testing.T, queue string) backlog {
	t.Helper()
	ctx := context.Background()
	var b backlog
	var err error
	if b.Wait, err = q.client.LLen(ctx, q.key(queue, "wait")).Result(); err != nil {
		t.Fatalf("wait length: %v", err)
	}
	if b.Active, err = q.client.LLen(ctx, q.key(queue, "active")).Result(); err != nil {
		t.Fatalf("active length: %v", err)
	}
	if b.Delayed, err = q.client.ZCard(ctx, q.key(queue, "delayed")).Result(); err != nil {
		t.Fatalf("delayed size: %v", err)
	}
	if b.Failed, err = q.client.ZCard(ctx, q.key(queue, "failed")).Result(); err != nil {
		t.Fatalf("failed size: %v", err)
	}
	return b
}

// ---------------------------------------------------------------------------
// The LMS

type delivery struct {
	Result contract.Result
	At     time.Time
}

// stubLMS is the result callback. It can refuse results with a status code,
// or be taken down altogether so connections are refused, as a stopped
// apps/web would refuse them.
type stubLMS struct {
	t    *testing.T
	addr string

	mu         sync.Mutex
	deliveries map[string][]delivery
	status     int
	listener   net.Listener
	server     *http.Server
}

func newStubLMS(t *testing.T) *stubLMS {
	t.Helper()
	lms := &stubLMS{t: t, deliveries: map[string][]delivery{}, status: http.StatusOK}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for the stub LMS: %v", err)
	}
	lms.addr = listener.Addr().String()
	lms.serve(listener)
	t.Cleanup(lms.Down)
	return lms
}

func (l *stubLMS) URL() string { return "http://" + l.addr + "/api/internal/execution/result" }

func (l *stubLMS) serve(listener net.Listener) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/internal/execution/result", func(w http.ResponseWriter, r *http.Request) {
		var result contract.Result
		if err := json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(&result); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		l.mu.Lock()
		status := l.status
		if status == http.StatusOK {
			l.deliveries[result.JobID] = append(l.deliveries[result.JobID], delivery{Result: result, At: time.Now()})
		}
		l.mu.Unlock()
		w.WriteHeader(status)
	})
	l.mu.Lock()
	l.listener = listener
	l.server = &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	server := l.server
	l.mu.Unlock()
	go func() { _ = server.Serve(listener) }()
}

// Down stops accepting connections. Safe to call when already down.
func (l *stubLMS) Down() {
	l.mu.Lock()
	server := l.server
	l.server, l.listener = nil, nil
	l.mu.Unlock()
	if server != nil {
		_ = server.Close()
	}
}

// Up listens again on the same address.
func (l *stubLMS) Up() {
	l.t.Helper()
	var listener net.Listener
	var err error
	// The port was just released; on some platforms it takes a moment.
	for attempt := 0; attempt < 50; attempt++ {
		if listener, err = net.Listen("tcp", l.addr); err == nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err != nil {
		l.t.Fatalf("relisten on %s: %v", l.addr, err)
	}
	l.serve(listener)
}

// Respond makes every later callback answer with status and record nothing.
func (l *stubLMS) Respond(status int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.status = status
}

func (l *stubLMS) delivered(jobID string) []delivery {
	l.mu.Lock()
	defer l.mu.Unlock()
	return slices.Clone(l.deliveries[jobID])
}

// deliveredCount counts the jobs with at least one delivered result.
func (l *stubLMS) deliveredCount(jobIDs []string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	count := 0
	for _, id := range jobIDs {
		if len(l.deliveries[id]) > 0 {
			count++
		}
	}
	return count
}

// awaitAll waits until every job has at least one delivered result.
func (l *stubLMS) awaitAll(jobIDs []string, timeout time.Duration) (missing []string) {
	deadline := time.Now().Add(timeout)
	for {
		missing = missing[:0]
		l.mu.Lock()
		for _, id := range jobIDs {
			if len(l.deliveries[id]) == 0 {
				missing = append(missing, id)
			}
		}
		l.mu.Unlock()
		if len(missing) == 0 || time.Now().After(deadline) {
			return missing
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// ---------------------------------------------------------------------------
// The worker process

type workerProcess struct {
	t          *testing.T
	cmd        *exec.Cmd
	logPath    string
	healthAddr string
	exited     chan struct{}
}

type workerOptions struct {
	Concurrency   int
	MaxContainers int
	Env           []string
}

func startWorker(t *testing.T, q *queues, lms *stubLMS, opts workerOptions) *workerProcess {
	t.Helper()
	healthAddr := freeAddr(t)
	logPath := filepath.Join(t.TempDir(), "worker.log")
	logFile, err := os.Create(logPath)
	if err != nil {
		t.Fatalf("create worker log: %v", err)
	}

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}

	cmd := exec.Command(workerBinary)
	cmd.Env = append(os.Environ(),
		"REDIS_URL="+redisURL,
		"WORKER_QUEUE_PREFIX="+q.prefix,
		"EXECUTION_CALLBACK_URL="+lms.URL(),
		"WORKER_HEALTH_ADDR="+healthAddr,
		"WORKER_LOG_LEVEL=info",
	)
	if opts.Concurrency > 0 {
		cmd.Env = append(cmd.Env, "WORKER_CONCURRENCY="+strconv.Itoa(opts.Concurrency))
	}
	if opts.MaxContainers > 0 {
		cmd.Env = append(cmd.Env, "WORKER_MAX_CONTAINERS="+strconv.Itoa(opts.MaxContainers))
	}
	cmd.Env = append(cmd.Env, opts.Env...)
	cmd.Stdout, cmd.Stderr = logFile, logFile

	if err := cmd.Start(); err != nil {
		t.Fatalf("start worker: %v", err)
	}
	w := &workerProcess{t: t, cmd: cmd, logPath: logPath, healthAddr: healthAddr, exited: make(chan struct{})}
	go func() {
		_ = cmd.Wait()
		_ = logFile.Close()
		close(w.exited)
	}()

	t.Cleanup(func() {
		w.Kill()
		if t.Failed() {
			t.Logf("worker log tail:\n%s", w.logTail(60))
		}
	})

	if err := w.awaitHealthy(90 * time.Second); err != nil {
		t.Fatalf("worker did not become healthy: %v\n%s", err, w.logTail(40))
	}
	return w
}

func (w *workerProcess) awaitHealthy(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		select {
		case <-w.exited:
			return errors.New("worker exited during startup")
		default:
		}
		response, err := http.Get("http://" + w.healthAddr + "/healthz")
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("no healthy answer within %s", timeout)
}

// Kill ends the process outright. Safe to call twice.
func (w *workerProcess) Kill() {
	select {
	case <-w.exited:
		return
	default:
	}
	_ = w.cmd.Process.Kill()
	<-w.exited
}

func (w *workerProcess) Alive() bool {
	select {
	case <-w.exited:
		return false
	default:
		return true
	}
}

// metric returns the value of an unlabelled series or a series with exactly
// the given label set, as the worker exposes it; zero when absent.
func (w *workerProcess) metric(name string) float64 {
	w.t.Helper()
	response, err := http.Get("http://" + w.healthAddr + "/metrics")
	if err != nil {
		w.t.Fatalf("scrape metrics: %v", err)
	}
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 1<<20), 1<<20)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, name+" ") {
			value, _ := strconv.ParseFloat(strings.TrimSpace(strings.TrimPrefix(line, name+" ")), 64)
			return value
		}
	}
	return 0
}

// logLines returns the worker's structured log entries whose msg matches.
func (w *workerProcess) logLines(msg string) []map[string]any {
	raw, err := os.ReadFile(w.logPath)
	if err != nil {
		return nil
	}
	var matches []map[string]any
	for _, line := range strings.Split(string(raw), "\n") {
		var entry map[string]any
		if json.Unmarshal([]byte(line), &entry) == nil && entry["msg"] == msg {
			matches = append(matches, entry)
		}
	}
	return matches
}

func (w *workerProcess) logTail(n int) string {
	raw, err := os.ReadFile(w.logPath)
	if err != nil {
		return "(no log: " + err.Error() + ")"
	}
	lines := strings.Split(strings.TrimRight(string(raw), "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

func freeAddr(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("find a free port: %v", err)
	}
	defer listener.Close()
	return listener.Addr().String()
}

// ---------------------------------------------------------------------------
// Docker

func newSandbox(t *testing.T) *sandbox.Sandbox {
	t.Helper()
	box, err := sandbox.New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	if err != nil {
		t.Fatalf("connect to docker: %v", err)
	}
	t.Cleanup(func() { _ = box.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := box.Ping(ctx); err != nil {
		t.Skipf("docker daemon is not reachable: %v", err)
	}
	if err := box.EnsureImages(ctx, language.Images()); err != nil {
		t.Skipf("sandbox images are not built: %v", err)
	}
	return box
}

// awaitNoContainers waits for the worker's own cleanup to finish; a container
// removal can trail the result delivery by a moment.
func awaitNoContainers(t *testing.T, box *sandbox.Sandbox, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		managed, err := box.ListManaged(ctx)
		cancel()
		if err == nil && len(managed) == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d sandbox container(s) still exist (err %v)", len(managed), err)
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// ---------------------------------------------------------------------------
// Jobs

// doubler is the same program in every language: read an integer, print it
// doubled. It exercises compile, stdin, stdout, and comparison without making
// the load about any one program's cost.
var doubler = map[contract.Language]string{
	contract.LanguagePython: "print(int(input()) * 2)\n",
	contract.LanguageJavaScript: `const n = Number(require("fs").readFileSync(0, "utf8").trim());
console.log(n * 2);
`,
	contract.LanguageJava: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        System.out.println(new Scanner(System.in).nextLong() * 2);
    }
}
`,
	contract.LanguageCPP: `#include <iostream>
int main() { long long n; std::cin >> n; std::cout << n * 2 << "\n"; }
`,
}

func submission(id string, lang contract.Language, cases int) contract.Job {
	testCases := make([]contract.TestCase, 0, cases)
	for i := 1; i <= cases; i++ {
		testCases = append(testCases, contract.TestCase{
			ID:             fmt.Sprintf("%s-case-%d", id, i),
			Name:           fmt.Sprintf("case %d", i),
			Input:          strconv.Itoa(i * 21),
			ExpectedOutput: strconv.Itoa(i * 42),
			Weight:         1,
			IsPublic:       i == 1,
			Comparison:     contract.ComparisonTrimmed,
		})
	}
	submissionID := "submission-" + id
	return contract.Job{
		ContractVersion: contract.Version,
		JobID:           id,
		Kind:            contract.KindSubmit,
		SubmissionID:    &submissionID,
		Language:        lang,
		SourceCode:      doubler[lang],
		Limits:          defaultLimits,
		TestCases:       testCases,
		TestScripts:     []contract.TestScript{},
		CallbackToken:   "e2e-token",
	}
}

func jobID(label string, n int) string {
	suffix := make([]byte, 4)
	_, _ = rand.Read(suffix)
	return fmt.Sprintf("%s-%03d-%s", label, n, hex.EncodeToString(suffix))
}

// assertNothingLost is the outage exit criterion: every submission reached the
// LMS, graded on its own merits, and the queue holds nothing — least of all a
// failed job, which is a submission no worker will ever try again.
func assertNothingLost(t *testing.T, q *queues, lms *stubLMS, ids []string, within time.Duration) {
	t.Helper()
	if missing := lms.awaitAll(ids, within); len(missing) > 0 {
		t.Fatalf("%d of %d submissions never reached the LMS (first: %s)", len(missing), len(ids), missing[0])
	}
	for _, id := range ids {
		for _, d := range lms.delivered(id) {
			assertFullyGraded(t, d.Result)
		}
	}

	var queue backlog
	deadline := time.Now().Add(within)
	for {
		queue = q.backlog(t, submitQueue)
		if queue == (backlog{}) || time.Now().After(deadline) {
			break
		}
		time.Sleep(time.Second)
	}
	if queue != (backlog{}) {
		t.Fatalf("the submit queue did not drain after recovery: %+v", queue)
	}
}

// assertFullyGraded fails unless the result graded and passed every case.
func assertFullyGraded(t *testing.T, result contract.Result) {
	t.Helper()
	if result.Status != contract.StatusGraded {
		t.Errorf("job %s: status %s (system error %v)", result.JobID, result.Status, deref(result.SystemError))
		return
	}
	for _, testResult := range result.TestResults {
		if !testResult.Passed {
			t.Errorf("job %s: case %q failed: stdout %q stderr %q",
				result.JobID, testResult.Name, testResult.StdoutExcerpt, testResult.StderrExcerpt)
		}
	}
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
