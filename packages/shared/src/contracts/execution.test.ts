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
    testScript: null,
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
