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
		"testScript":    nil,
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

func TestParseJobRejectsTestScriptOnRunJob(t *testing.T) {
	payload := validJobMap()
	payload["testScript"] = map[string]any{
		"framework":  "PYTEST",
		"entrypoint": "test_main.py",
		"files":      []any{},
	}

	_, err := ParseJob(encode(t, payload))
	if err == nil || !strings.Contains(err.Error(), "test script") {
		t.Fatalf("expected a test-script rejection, got %v", err)
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
