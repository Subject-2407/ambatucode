package contract

import (
	"encoding/json"
	"strings"
	"testing"
)

func validJobMap() map[string]any {
	return map[string]any{
		"contractVersion": Version,
		"jobId":           "job-1",
		"kind":            "RUN",
		"submissionId":    nil,
		"language":        "python",
		"sourceCode":      "print(1)",
		"limits": map[string]any{
			"compileTimeoutMs": 15000,
			"runTimeoutMs":     5000,
			"wallTimeoutMs":    30000,
			"memoryLimitMb":    256,
			"maxOutputBytes":   65536,
			"maxProcesses":     64,
		},
		"testCases":     []any{},
		"testScripts":   []any{},
		"callbackToken": "token",
	}
}

func encode(t *testing.T, payload map[string]any) []byte {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return raw
}

func TestParseJobAcceptsValidPayload(t *testing.T) {
	job, err := ParseJob(encode(t, validJobMap()))
	if err != nil {
		t.Fatalf("expected valid job, got %v", err)
	}
	if job.JobID != "job-1" || job.Kind != KindRun {
		t.Fatalf("unexpected job: %+v", job)
	}
}

func TestParseJobRejectsVersionMismatchWithActionableMessage(t *testing.T) {
	payload := validJobMap()
	payload["contractVersion"] = Version + 1

	_, err := ParseJob(encode(t, payload))
	if err == nil {
		t.Fatal("expected a version mismatch error")
	}
	// The version has to be checked before the strict decode, or the operator
	// is told "unknown field" when the real problem is a stale worker.
	if !strings.Contains(err.Error(), "contract version mismatch") {
		t.Fatalf("expected a version mismatch message, got %q", err)
	}
}

func TestParseJobRejectsMissingVersion(t *testing.T) {
	payload := validJobMap()
	delete(payload, "contractVersion")

	if _, err := ParseJob(encode(t, payload)); err == nil {
		t.Fatal("expected an error for a payload with no contractVersion")
	}
}

// A hidden case on a RUN job would leak expected output for a grading case
// into a Coder-visible response. The producer refuses it; so must the worker.
func TestParseJobRejectsHiddenTestCaseOnRunJob(t *testing.T) {
	payload := validJobMap()
	payload["testCases"] = []any{map[string]any{
		"id":             "case-1",
		"name":           "hidden",
		"input":          "",
		"expectedOutput": "42",
		"weight":         1,
		"isPublic":       false,
		"comparison":     "TRIMMED",
	}}

	_, err := ParseJob(encode(t, payload))
	if err == nil || !strings.Contains(err.Error(), "non-public test case") {
		t.Fatalf("expected a hidden-case rejection, got %v", err)
	}
}

func validScriptMap(id string) map[string]any {
	return map[string]any{
		"id":        id,
		"framework": "PYTEST",
		"path":      "test_main.py",
		"content":   "def test_ok():\n    pass\n",
		"weight":    1,
	}
}

// A Practice Activity's scripts ride on a RUN. Nothing of a script comes back
// in an excerpt, so there is nothing for the hidden-case check to protect.
func TestParseJobAcceptsTestScriptsOnRunJob(t *testing.T) {
	payload := validJobMap()
	payload["testScripts"] = []any{validScriptMap("script-1"), validScriptMap("script-2")}

	job, err := ParseJob(encode(t, payload))
	if err != nil {
		t.Fatalf("expected the scripts to be accepted, got %v", err)
	}
	if len(job.TestScripts) != 2 || job.TestScripts[1].ID != "script-2" {
		t.Fatalf("unexpected scripts: %+v", job.TestScripts)
	}
}

func TestParseJobRejectsMalformedTestScripts(t *testing.T) {
	cases := map[string]func(map[string]any){
		"missing list": func(payload map[string]any) { delete(payload, "testScripts") },
		"null list":    func(payload map[string]any) { payload["testScripts"] = nil },
		"empty id": func(payload map[string]any) {
			payload["testScripts"] = []any{validScriptMap("")}
		},
		"duplicate id": func(payload map[string]any) {
			payload["testScripts"] = []any{validScriptMap("same"), validScriptMap("same")}
		},
		"negative weight": func(payload map[string]any) {
			script := validScriptMap("script-1")
			script["weight"] = -1
			payload["testScripts"] = []any{script}
		},
		"unknown framework": func(payload map[string]any) {
			script := validScriptMap("script-1")
			script["framework"] = "MOCHA"
			payload["testScripts"] = []any{script}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			payload := validJobMap()
			mutate(payload)
			if _, err := ParseJob(encode(t, payload)); err == nil {
				t.Fatal("accepted")
			}
		})
	}
}

// The shared Zod schema allows a null submissionId on both kinds. This file
// mirrors that schema, so the worker must accept such a job rather than
// refusing work the producer considers valid.
func TestParseJobAcceptsSubmitWithoutSubmissionID(t *testing.T) {
	payload := validJobMap()
	payload["kind"] = "SUBMIT"

	job, err := ParseJob(encode(t, payload))
	if err != nil {
		t.Fatalf("worker must not be stricter than the shared contract: %v", err)
	}
	if job.SubmissionID != nil {
		t.Fatalf("expected a nil submission id, got %v", *job.SubmissionID)
	}
}

func TestParseJobRejectsNonPositiveLimits(t *testing.T) {
	payload := validJobMap()
	limits, _ := payload["limits"].(map[string]any)
	limits["memoryLimitMb"] = 0

	_, err := ParseJob(encode(t, payload))
	if err == nil || !strings.Contains(err.Error(), "memoryLimitMb") {
		t.Fatalf("expected a limit validation error, got %v", err)
	}
}

func TestParseJobRejectsUnknownComparisonMode(t *testing.T) {
	payload := validJobMap()
	payload["testCases"] = []any{map[string]any{
		"id":             "case-1",
		"name":           "public",
		"input":          "",
		"expectedOutput": "42",
		"weight":         1,
		"isPublic":       true,
		"comparison":     "FUZZY",
	}}

	if _, err := ParseJob(encode(t, payload)); err == nil {
		t.Fatal("expected an error for an unknown comparison mode")
	}
}

func publicCase(overrides map[string]any) map[string]any {
	testCase := map[string]any{
		"id":             "case-1",
		"name":           "public",
		"input":          "",
		"expectedOutput": "42",
		"weight":         1,
		"isPublic":       true,
		"comparison":     "TRIMMED",
		"timeLimitMs":    nil,
		"memoryLimitMb":  nil,
	}
	for key, value := range overrides {
		testCase[key] = value
	}
	return testCase
}

// A case's own limits win; a null falls back to the job's.
func TestParseJobReadsPerCaseLimitOverrides(t *testing.T) {
	payload := validJobMap()
	payload["testCases"] = []any{
		publicCase(map[string]any{"id": "slow", "timeLimitMs": 9000, "memoryLimitMb": 512}),
		publicCase(map[string]any{"id": "default"}),
	}

	job, err := ParseJob(encode(t, payload))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	slow, fallback := job.TestCases[0], job.TestCases[1]
	if slow.RunTimeout(job.Limits) != 9000 || slow.MemoryLimit(job.Limits) != 512 {
		t.Fatalf("override ignored: %d ms, %d MB", slow.RunTimeout(job.Limits), slow.MemoryLimit(job.Limits))
	}
	if fallback.RunTimeout(job.Limits) != 5000 || fallback.MemoryLimit(job.Limits) != 256 {
		t.Fatalf("null did not fall back to the job limits: %d ms, %d MB",
			fallback.RunTimeout(job.Limits), fallback.MemoryLimit(job.Limits))
	}
}

func TestParseJobRejectsNonPositivePerCaseLimits(t *testing.T) {
	for _, field := range []string{"timeLimitMs", "memoryLimitMb"} {
		payload := validJobMap()
		payload["testCases"] = []any{publicCase(map[string]any{field: 0})}

		if _, err := ParseJob(encode(t, payload)); err == nil {
			t.Fatalf("expected a zero %s to be rejected", field)
		}
	}
}

func TestProbeIdentitySalvagesReportingFieldsFromInvalidPayload(t *testing.T) {
	// Version is wrong, so ParseJob refuses — but the job still has to be
	// reported as SYSTEM_ERROR rather than disappearing.
	payload := validJobMap()
	payload["contractVersion"] = 99
	raw := encode(t, payload)

	if _, err := ParseJob(raw); err == nil {
		t.Fatal("expected the payload to be rejected")
	}

	identity, ok := ProbeIdentity(raw)
	if !ok {
		t.Fatal("expected identity to be salvageable")
	}
	if identity.JobID != "job-1" || identity.CallbackToken != "token" {
		t.Fatalf("unexpected identity: %+v", identity)
	}
}

func TestProbeIdentityFailsWithoutJobIDOrToken(t *testing.T) {
	if _, ok := ProbeIdentity([]byte(`{"jobId":"job-1"}`)); ok {
		t.Fatal("expected probe to fail without a callback token")
	}
	if _, ok := ProbeIdentity([]byte(`not json`)); ok {
		t.Fatal("expected probe to fail on non-JSON")
	}
}
