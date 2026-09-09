// Package contract mirrors packages/shared/src/contracts/execution.ts.
//
// This is the entire vocabulary the worker shares with the rest of the system.
// There is no database connection here and no other channel: everything the
// worker knows arrives in an ExecutionJob, and everything it reports leaves in
// an ExecutionResult.
//
// When the TypeScript contract changes, this file changes in the same commit
// and Version is bumped on both sides.
package contract

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// Version must equal EXECUTION_CONTRACT_VERSION in the shared package.
//
// A deploy can leave an old worker draining a queue that already holds a new
// payload shape. Without this check a renamed field would surface as a
// silently mis-graded submission; with it the worker refuses the job and says
// exactly why.
const Version = 1

type Kind string

const (
	KindRun    Kind = "RUN"
	KindSubmit Kind = "SUBMIT"
)

type Language string

const (
	LanguagePython     Language = "python"
	LanguageJavaScript Language = "javascript"
	LanguageJava       Language = "java"
	LanguageCPP        Language = "cpp"
)

type ComparisonMode string

const (
	ComparisonExact           ComparisonMode = "EXACT"
	ComparisonTrimmed         ComparisonMode = "TRIMMED"
	ComparisonToken           ComparisonMode = "TOKEN"
	ComparisonNumericTolerant ComparisonMode = "NUMERIC_TOLERANT"
)

type TestScriptFramework string

const (
	FrameworkJUnit  TestScriptFramework = "JUNIT"
	FrameworkJest   TestScriptFramework = "JEST"
	FrameworkPytest TestScriptFramework = "PYTEST"
	FrameworkCustom TestScriptFramework = "CUSTOM"
)

// Status is the submission status the worker reports. QUEUED and RUNNING are
// the backend's to set; the worker only ever reports a terminal status.
type Status string

const (
	StatusGraded              Status = "GRADED"
	StatusCompileError        Status = "COMPILE_ERROR"
	StatusRuntimeError        Status = "RUNTIME_ERROR"
	StatusTimeLimitExceeded   Status = "TIME_LIMIT_EXCEEDED"
	StatusMemoryLimitExceeded Status = "MEMORY_LIMIT_EXCEEDED"
	StatusSystemError         Status = "SYSTEM_ERROR"
)

type Limits struct {
	CompileTimeoutMs int64 `json:"compileTimeoutMs"`
	RunTimeoutMs     int64 `json:"runTimeoutMs"`
	WallTimeoutMs    int64 `json:"wallTimeoutMs"`
	MemoryLimitMb    int64 `json:"memoryLimitMb"`
	MaxOutputBytes   int64 `json:"maxOutputBytes"`
	MaxProcesses     int64 `json:"maxProcesses"`
}

type TestCase struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	Input          string         `json:"input"`
	ExpectedOutput string         `json:"expectedOutput"`
	Weight         float64        `json:"weight"`
	IsPublic       bool           `json:"isPublic"`
	Comparison     ComparisonMode `json:"comparison"`
}

type TestScriptFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type TestScript struct {
	Framework  TestScriptFramework `json:"framework"`
	Entrypoint string              `json:"entrypoint"`
	Files      []TestScriptFile    `json:"files"`
}

// Job is one unit of execution. It carries no user id and no personal data;
// the only credential is CallbackToken, an HMAC over JobID that the worker
// echoes back when reporting.
type Job struct {
	ContractVersion int         `json:"contractVersion"`
	JobID           string      `json:"jobId"`
	Kind            Kind        `json:"kind"`
	SubmissionID    *string     `json:"submissionId"`
	Language        Language    `json:"language"`
	SourceCode      string      `json:"sourceCode"`
	Limits          Limits      `json:"limits"`
	TestCases       []TestCase  `json:"testCases"`
	TestScript      *TestScript `json:"testScript"`
	CallbackToken   string      `json:"callbackToken"`
}

type TestResult struct {
	TestCaseID      *string  `json:"testCaseId"`
	Name            string   `json:"name"`
	Passed          bool     `json:"passed"`
	Weight          float64  `json:"weight"`
	ExecutionTimeMs float64  `json:"executionTimeMs"`
	MemoryUsedKb    *float64 `json:"memoryUsedKb"`
	StdoutExcerpt   string   `json:"stdoutExcerpt"`
	StderrExcerpt   string   `json:"stderrExcerpt"`
}

// Result never carries the source code back — the backend already has it.
type Result struct {
	ContractVersion int          `json:"contractVersion"`
	JobID           string       `json:"jobId"`
	SubmissionID    *string      `json:"submissionId"`
	Status          Status       `json:"status"`
	CompilerOutput  *string      `json:"compilerOutput"`
	SystemError     *string      `json:"systemError"`
	ExecutionTimeMs float64      `json:"executionTimeMs"`
	MemoryUsedKb    *float64     `json:"memoryUsedKb"`
	TestResults     []TestResult `json:"testResults"`
}

// Identity is the little that can be salvaged from a payload ParseJob refused.
//
// A malformed job still has to be reported as SYSTEM_ERROR rather than
// vanishing, and reporting needs the job id and the callback credential. This
// reads them leniently, with no validation, precisely because the strict path
// has already failed.
type Identity struct {
	JobID         string
	SubmissionID  *string
	CallbackToken string
}

// ProbeIdentity extracts reporting identity from an otherwise invalid payload.
// The second return is false when even this much could not be read.
func ProbeIdentity(raw []byte) (Identity, bool) {
	var probe struct {
		JobID         string  `json:"jobId"`
		SubmissionID  *string `json:"submissionId"`
		CallbackToken string  `json:"callbackToken"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return Identity{}, false
	}
	if probe.JobID == "" || probe.CallbackToken == "" {
		return Identity{}, false
	}
	return Identity{
		JobID:         probe.JobID,
		SubmissionID:  probe.SubmissionID,
		CallbackToken: probe.CallbackToken,
	}, true
}

// ParseJob decodes and validates a job payload.
//
// Go's json package is permissive by default — a missing field becomes a zero
// value — so every constraint the Zod schema expresses on the producer side is
// re-checked explicitly here. A payload that does not satisfy all of them is a
// contract bug, not a participant error, and must not reach a container.
func ParseJob(raw []byte) (Job, error) {
	// Read the version before anything else. A producer that added a field
	// would otherwise trip the strict decode below and report "unknown field"
	// when the real answer is "this worker is out of date" — the version check
	// has to run first for the error to be actionable.
	var probe struct {
		ContractVersion *int `json:"contractVersion"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return Job{}, fmt.Errorf("decode job envelope: %w", err)
	}
	if probe.ContractVersion == nil {
		return Job{}, fmt.Errorf("job has no contractVersion; worker speaks v%d", Version)
	}
	if *probe.ContractVersion != Version {
		return Job{}, fmt.Errorf(
			"contract version mismatch: job is v%d, worker speaks v%d — deploy the matching worker",
			*probe.ContractVersion, Version,
		)
	}

	var job Job
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&job); err != nil {
		return Job{}, fmt.Errorf("decode job: %w", err)
	}

	if job.JobID == "" {
		return Job{}, fmt.Errorf("job id is empty")
	}
	if job.Kind != KindRun && job.Kind != KindSubmit {
		return Job{}, fmt.Errorf("unknown job kind %q", job.Kind)
	}
	if job.CallbackToken == "" {
		return Job{}, fmt.Errorf("callback token is empty")
	}
	if err := job.Limits.validate(); err != nil {
		return Job{}, err
	}
	for i, testCase := range job.TestCases {
		if testCase.ID == "" {
			return Job{}, fmt.Errorf("test case %d has an empty id", i)
		}
		switch testCase.Comparison {
		case ComparisonExact, ComparisonTrimmed, ComparisonToken, ComparisonNumericTolerant:
		default:
			return Job{}, fmt.Errorf("test case %d has unknown comparison mode %q", i, testCase.Comparison)
		}
	}

	// The producer refuses to put hidden cases or a test script on a RUN job.
	// Re-check it here: a leak of expected output for a hidden case is a
	// security defect, and this is the last place it can be caught before the
	// data is echoed back in a Coder-visible excerpt.
	if job.Kind == KindRun {
		for i, testCase := range job.TestCases {
			if !testCase.IsPublic {
				return Job{}, fmt.Errorf("run job carries non-public test case %d", i)
			}
		}
		if job.TestScript != nil {
			return Job{}, fmt.Errorf("run job carries a test script")
		}
	}
	// A SUBMIT job with no submissionId is deliberately *not* rejected here.
	// The shared Zod schema allows it for both kinds, and this file mirrors
	// that schema rather than inventing constraints the producer does not
	// enforce — a stricter worker would refuse jobs the producer considers
	// valid and report nothing at all.
	//
	// Such a job still grades correctly; the backend's ingest simply has no
	// Submission row to write to. Making the id mandatory for SUBMIT belongs
	// in the shared contract, alongside the formal-submission work.

	return job, nil
}

func (l Limits) validate() error {
	checks := []struct {
		name  string
		value int64
	}{
		{"compileTimeoutMs", l.CompileTimeoutMs},
		{"runTimeoutMs", l.RunTimeoutMs},
		{"wallTimeoutMs", l.WallTimeoutMs},
		{"memoryLimitMb", l.MemoryLimitMb},
		{"maxOutputBytes", l.MaxOutputBytes},
		{"maxProcesses", l.MaxProcesses},
	}
	for _, check := range checks {
		if check.value <= 0 {
			return fmt.Errorf("limit %s must be positive, got %d", check.name, check.value)
		}
	}
	return nil
}
