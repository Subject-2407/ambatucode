package queue

import "testing"

// These strings are not ours to choose: they are the layout apps/web writes
// through BullMQ. A rename here silently detaches the worker from the producer,
// and nothing would error — the worker would just never see a job.
func TestKeyLayoutMatchesBullMQ(t *testing.T) {
	k := newKeys("bull", "execution-submit")

	cases := map[string]string{
		"prefix":      "bull:execution-submit:",
		"wait":        "bull:execution-submit:wait",
		"active":      "bull:execution-submit:active",
		"prioritized": "bull:execution-submit:prioritized",
		"events":      "bull:execution-submit:events",
		"stalled":     "bull:execution-submit:stalled",
		"limiter":     "bull:execution-submit:limiter",
		"delayed":     "bull:execution-submit:delayed",
		"paused":      "bull:execution-submit:paused",
		"meta":        "bull:execution-submit:meta",
		"pc":          "bull:execution-submit:pc",
		"marker":      "bull:execution-submit:marker",
		"completed":   "bull:execution-submit:completed",
		"failed":      "bull:execution-submit:failed",
	}

	got := map[string]string{
		"prefix":      k.prefix(),
		"wait":        k.wait(),
		"active":      k.active(),
		"prioritized": k.prioritized(),
		"events":      k.events(),
		"stalled":     k.stalled(),
		"limiter":     k.limiter(),
		"delayed":     k.delayed(),
		"paused":      k.paused(),
		"meta":        k.meta(),
		"pc":          k.priorityCounter(),
		"marker":      k.marker(),
		"completed":   k.completed(),
		"failed":      k.failed(),
	}

	for name, want := range cases {
		if got[name] != want {
			t.Errorf("%s key = %q, want %q", name, got[name], want)
		}
	}

	if k.job("abc123") != "bull:execution-submit:abc123" {
		t.Errorf("job key = %q", k.job("abc123"))
	}
	// Metrics are split per outcome, matching toKey('metrics:' + target).
	if k.metrics("completed") != "bull:execution-submit:metrics:completed" {
		t.Errorf("metrics key = %q", k.metrics("completed"))
	}
}

func TestKeepJobsMirrorsBullMQRetentionRules(t *testing.T) {
	// An object option passes straight through.
	object := keepJobs([]byte(`{"age":300}`))
	asMap, ok := object.(map[string]any)
	if !ok || asMap["age"] != float64(300) {
		t.Fatalf("object retention not preserved: %#v", object)
	}

	// `false` and a missing value both mean keep everything, which BullMQ
	// encodes as count -1. Getting this wrong would delete graded submissions
	// from the queue's completed set earlier than configured.
	for _, raw := range [][]byte{[]byte(`false`), nil, []byte(`null`)} {
		result, ok := keepJobs(raw).(map[string]any)
		if !ok || result["count"] != -1 {
			t.Fatalf("expected count -1 for %q, got %#v", raw, result)
		}
	}

	// `true` means keep none.
	if result, ok := keepJobs([]byte(`true`)).(map[string]any); !ok || result["count"] != 0 {
		t.Fatalf("expected count 0 for true, got %#v", result)
	}

	if result, ok := keepJobs([]byte(`25`)).(map[string]any); !ok || result["count"] != int64(25) {
		t.Fatalf("expected count 25, got %#v", result)
	}
}

func TestFinishErrorExplainsEveryDocumentedCode(t *testing.T) {
	for _, code := range []int64{-1, -2, -3, -4, -6, -9} {
		if message := finishError(code); message == "" {
			t.Errorf("code %d has no explanation", code)
		}
	}
}
