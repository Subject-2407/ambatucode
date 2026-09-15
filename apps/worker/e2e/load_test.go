//go:build load

package e2e

import (
	"fmt"
	"math"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
)

// loadMix is the share of a burst per language. Python dominates a typical
// lab; Java and C++ are fewer but each costs a compile.
var loadMix = []struct {
	Language contract.Language
	Percent  int
}{
	{contract.LanguagePython, 40},
	{contract.LanguageJavaScript, 25},
	{contract.LanguageJava, 20},
	{contract.LanguageCPP, 15},
}

const casesPerSubmission = 3

// 100 formal submissions land at once — a lab submitting at the deadline —
// and every one must be graded, delivered exactly once, and cleaned up.
//
// "Bounded latency" is measured rather than guessed. Before the burst, one
// submission per language runs alone, which is what that language costs on
// this host with nothing competing. With N container slots the best possible
// makespan is the sum of those costs over N; the burst passes when it finishes
// within LOAD_BOUND_FACTOR (default 3) times that, plus a fixed allowance for
// container creation contending in the Docker daemon. A worker that serialised
// work, starved on a lock, or retried its way through the burst would blow
// through that bound; one that is merely slower on a busy laptop would not.
//
//	LOAD_SUBMISSIONS    submissions in the burst (default 100)
//	LOAD_CONTAINERS     container slots and goroutines (default min(2*CPU, 16))
//	LOAD_BOUND_FACTOR   multiple of the ideal makespan allowed (default 3)
func TestLoadConcurrentSubmissionsAllGradeWithinBound(t *testing.T) {
	box := newSandbox(t)
	q := newQueues(t)
	lms := newStubLMS(t)

	total := envInt(t, "LOAD_SUBMISSIONS", 100)
	slots := envInt(t, "LOAD_CONTAINERS", min(runtime.NumCPU()*2, 16))
	factor := envFloat(t, "LOAD_BOUND_FACTOR", 3)
	const allowance = 30 * time.Second

	worker := startWorker(t, q, lms, workerOptions{Concurrency: slots, MaxContainers: slots})

	// Baseline: each language alone, which also warms the image cache so the
	// burst does not pay first-use costs.
	baseline := map[contract.Language]time.Duration{}
	for _, mix := range loadMix {
		job := submission(jobID("baseline-"+string(mix.Language), 0), mix.Language, casesPerSubmission)
		enqueued := q.enqueue(t, job)
		if missing := lms.awaitAll([]string{job.JobID}, 2*time.Minute); len(missing) > 0 {
			t.Fatalf("baseline %s never delivered a result", mix.Language)
		}
		delivered := lms.delivered(job.JobID)
		assertFullyGraded(t, delivered[0].Result)
		baseline[mix.Language] = delivered[0].At.Sub(enqueued)
	}
	if t.Failed() {
		t.FailNow()
	}

	jobs := make([]contract.Job, 0, total)
	for _, mix := range loadMix {
		count := int(math.Round(float64(total*mix.Percent) / 100))
		for i := 0; i < count && len(jobs) < total; i++ {
			jobs = append(jobs, submission(jobID("load-"+string(mix.Language), i), mix.Language, casesPerSubmission))
		}
	}
	for len(jobs) < total {
		jobs = append(jobs, submission(jobID("load-python-extra", len(jobs)), contract.LanguagePython, casesPerSubmission))
	}
	// Interleaved, so the claim order is not one language after another.
	sort.Slice(jobs, func(i, j int) bool {
		return jobs[i].JobID[len(jobs[i].JobID)-8:] < jobs[j].JobID[len(jobs[j].JobID)-8:]
	})

	var ideal time.Duration
	for _, job := range jobs {
		ideal += baseline[job.Language]
	}
	ideal /= time.Duration(slots)
	bound := time.Duration(factor*float64(ideal)) + allowance

	enqueuedAt := make(map[string]time.Time, total)
	ids := make([]string, 0, total)
	burstStart := time.Now()
	for _, job := range jobs {
		enqueuedAt[job.JobID] = q.enqueue(t, job)
		ids = append(ids, job.JobID)
	}

	missing := lms.awaitAll(ids, bound+2*time.Minute)
	makespan := time.Since(burstStart)
	if len(missing) > 0 {
		t.Fatalf("%d of %d submissions never delivered a result within %s (first: %s)",
			len(missing), total, bound+2*time.Minute, missing[0])
	}

	latencies := make([]time.Duration, 0, total)
	var lastDelivery time.Time
	duplicates := 0
	perLanguage := map[contract.Language][]time.Duration{}
	for _, job := range jobs {
		delivered := lms.delivered(job.JobID)
		if len(delivered) > 1 {
			duplicates++
		}
		assertFullyGraded(t, delivered[0].Result)
		latency := delivered[0].At.Sub(enqueuedAt[job.JobID])
		latencies = append(latencies, latency)
		perLanguage[job.Language] = append(perLanguage[job.Language], latency)
		if delivered[0].At.After(lastDelivery) {
			lastDelivery = delivered[0].At
		}
	}
	makespan = lastDelivery.Sub(burstStart)

	// Completing a job trails its delivery by a Redis round trip.
	var queue backlog
	deadline := time.Now().Add(30 * time.Second)
	for {
		queue = q.backlog(t, submitQueue)
		if queue == (backlog{}) || time.Now().After(deadline) {
			break
		}
		time.Sleep(250 * time.Millisecond)
	}
	awaitNoContainers(t, box, 60*time.Second)

	report := strings.Builder{}
	fmt.Fprintf(&report, "\nload test: %d submissions, %d container slots, %d cases each\n", total, slots, casesPerSubmission)
	fmt.Fprintf(&report, "  baseline (alone):   python %s, javascript %s, java %s, cpp %s\n",
		round(baseline[contract.LanguagePython]), round(baseline[contract.LanguageJavaScript]),
		round(baseline[contract.LanguageJava]), round(baseline[contract.LanguageCPP]))
	fmt.Fprintf(&report, "  makespan:           %s (ideal %s, bound %s)\n", round(makespan), round(ideal), round(bound))
	fmt.Fprintf(&report, "  throughput:         %.1f submissions/min\n", float64(total)/makespan.Minutes())
	fmt.Fprintf(&report, "  latency (enqueue to result): p50 %s, p95 %s, p99 %s, max %s\n",
		round(percentile(latencies, 50)), round(percentile(latencies, 95)),
		round(percentile(latencies, 99)), round(percentile(latencies, 100)))
	for _, mix := range loadMix {
		fmt.Fprintf(&report, "    %-11s n=%-3d p50 %s, p95 %s\n", mix.Language, len(perLanguage[mix.Language]),
			round(percentile(perLanguage[mix.Language], 50)), round(percentile(perLanguage[mix.Language], 95)))
	}
	fmt.Fprintf(&report, "  duplicate deliveries: %d, submit backlog after: %+v\n", duplicates, queue)
	fmt.Fprintf(&report, "  worker metrics: create failures %.0f, undelivered results %.0f, containers active %.0f\n",
		worker.metric("container_create_failures_total"),
		worker.metric(`result_delivery_failures_total{kind="SUBMIT"}`),
		worker.metric("containers_active"))
	t.Log(report.String())

	if duplicates > 0 {
		t.Errorf("%d submissions were delivered more than once: a lock was lost under load", duplicates)
	}
	if queue != (backlog{}) {
		t.Errorf("the submit queue did not drain: %+v", queue)
	}
	if failures := worker.metric("container_create_failures_total"); failures > 0 {
		t.Errorf("the daemon failed to create %.0f container(s) under load", failures)
	}
	if undelivered := worker.metric(`result_delivery_failures_total{kind="SUBMIT"}`); undelivered > 0 {
		t.Errorf("%.0f result(s) failed delivery under load", undelivered)
	}
	if makespan > bound {
		t.Errorf("the burst took %s, beyond its bound of %s", round(makespan), round(bound))
	}
	if !worker.Alive() {
		t.Error("the worker exited during the burst")
	}
}

func percentile(values []time.Duration, p float64) time.Duration {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]time.Duration(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	index := int(math.Ceil(p/100*float64(len(sorted)))) - 1
	return sorted[max(0, min(index, len(sorted)-1))]
}

func round(d time.Duration) time.Duration { return d.Round(10 * time.Millisecond) }

func envInt(t *testing.T, key string, fallback int) int {
	t.Helper()
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		t.Fatalf("%s must be a positive integer, got %q", key, raw)
	}
	return value
}

func envFloat(t *testing.T, key string, fallback float64) float64 {
	t.Helper()
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || value <= 0 {
		t.Fatalf("%s must be a positive number, got %q", key, raw)
	}
	return value
}
