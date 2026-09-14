import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXECUTION_LIMITS,
  EXECUTION_CONTRACT_VERSION,
  executionJobSchema,
  executionResultSchema,
} from "./execution";

function validJob(): unknown {
  return {
    contractVersion: EXECUTION_CONTRACT_VERSION,
    jobId: "job-1",
    kind: "RUN",
    submissionId: null,
    language: "python",
    sourceCode: "print(1)",
    limits: DEFAULT_EXECUTION_LIMITS,
    testCases: [],
    testScripts: [],
    callbackToken: "token",
  };
}

function validResult(): unknown {
  return {
    contractVersion: EXECUTION_CONTRACT_VERSION,
    jobId: "job-1",
    submissionId: null,
    status: "GRADED",
    compilerOutput: null,
    systemError: null,
    executionTimeMs: 3,
    memoryUsedKb: null,
    testResults: [],
  };
}

describe("execution contract shapes", () => {
  it("carries per-case limit overrides, null meaning the job's own limit", () => {
    const job = {
      ...(validJob() as Record<string, unknown>),
      testCases: [
        {
          id: "case-1",
          name: "slow case",
          input: "",
          expectedOutput: "",
          weight: 1,
          isPublic: true,
          comparison: "TRIMMED",
          timeLimitMs: 9_000,
          memoryLimitMb: null,
        },
      ],
    };
    const parsed = executionJobSchema.parse(job);
    expect(parsed.testCases[0]?.timeLimitMs).toBe(9_000);
    expect(parsed.testCases[0]?.memoryLimitMb).toBeNull();
  });

  it("rejects a case missing its limit overrides", () => {
    const job = {
      ...(validJob() as Record<string, unknown>),
      testCases: [
        {
          id: "case-1",
          name: "v1 case",
          input: "",
          expectedOutput: "",
          weight: 1,
          isPublic: true,
          comparison: "TRIMMED",
        },
      ],
    };
    expect(() => executionJobSchema.parse(job)).toThrow();
  });

  it("requires a status on every test result", () => {
    const row = {
      testCaseId: "case-1",
      testScriptId: null,
      name: "case",
      passed: false,
      weight: 1,
      executionTimeMs: 5_000,
      memoryUsedKb: null,
      stdoutExcerpt: "",
      stderrExcerpt: "",
    };
    const result = (testResult: unknown) => ({
      ...(validResult() as Record<string, unknown>),
      testResults: [testResult],
    });
    expect(() => executionResultSchema.parse(result(row))).toThrow();
    expect(
      executionResultSchema.parse(result({ ...row, status: "TIME_LIMIT_EXCEEDED" })).testResults[0]
        ?.status,
    ).toBe("TIME_LIMIT_EXCEEDED");
    // Compiling and platform failure describe a job, never one case.
    expect(() =>
      executionResultSchema.parse(result({ ...row, status: "COMPILE_ERROR" })),
    ).toThrow();
  });

  it("carries several test scripts, each under a unique id", () => {
    const script = (id: string) => ({
      id,
      framework: "PYTEST",
      path: "test_main.py",
      content: "def test_ok():\n    pass\n",
      weight: 1,
    });
    const job = (scripts: unknown[]) => ({
      ...(validJob() as Record<string, unknown>),
      testScripts: scripts,
    });

    expect(executionJobSchema.parse(job([script("a"), script("b")])).testScripts).toHaveLength(2);
    expect(() => executionJobSchema.parse(job([script("a"), script("a")]))).toThrow();
    expect(() => executionJobSchema.parse({ ...job([]), testScripts: null })).toThrow();
  });
});

describe("execution contract version", () => {
  it("accepts a job stamped with the current version", () => {
    expect(executionJobSchema.parse(validJob()).contractVersion).toBe(EXECUTION_CONTRACT_VERSION);
  });

  it("accepts a result stamped with the current version", () => {
    expect(executionResultSchema.parse(validResult()).contractVersion).toBe(
      EXECUTION_CONTRACT_VERSION,
    );
  });

  // A worker left behind by a partial deploy must not grade against a payload
  // shape it does not understand — both directions fail closed instead.
  it("rejects a job from a mismatched producer", () => {
    const stale = { ...(validJob() as Record<string, unknown>), contractVersion: 999 };
    expect(() => executionJobSchema.parse(stale)).toThrow();
  });

  it("rejects a result from a mismatched worker", () => {
    const stale = { ...(validResult() as Record<string, unknown>), contractVersion: 999 };
    expect(() => executionResultSchema.parse(stale)).toThrow();
  });

  it("rejects a payload with no version at all", () => {
    const { contractVersion: _omitted, ...unversioned } = validJob() as Record<string, unknown>;
    expect(() => executionJobSchema.parse(unversioned)).toThrow();
  });
});
