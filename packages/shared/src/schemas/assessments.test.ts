import { describe, expect, it } from "vitest";
import {
  MAX_TEST_CASE_IO_BYTES,
  createAssessmentRequestSchema,
  createTestCaseRequestSchema,
  timingProblem,
} from "./assessments";

describe("timingProblem", () => {
  it("requires a duration and a mode for a timed assessment", () => {
    expect(
      timingProblem({ timeMode: "TIMED", durationMinutes: null, executionMode: "LIVE" }),
    ).not.toBeNull();
    expect(
      timingProblem({ timeMode: "TIMED", durationMinutes: 30, executionMode: null }),
    ).not.toBeNull();
    expect(
      timingProblem({ timeMode: "TIMED", durationMinutes: 30, executionMode: "LIVE" }),
    ).toBeNull();
  });

  it("refuses timing on an untimed assessment", () => {
    expect(
      timingProblem({ timeMode: "UNTIMED", durationMinutes: 30, executionMode: null }),
    ).not.toBeNull();
    expect(
      timingProblem({ timeMode: "UNTIMED", durationMinutes: null, executionMode: null }),
    ).toBeNull();
  });

  it("is applied when an assessment is created", () => {
    const result = createAssessmentRequestSchema.safeParse({
      title: "Binary search",
      problemStatement: "Find it.",
      allowedLanguages: ["python"],
      timeMode: "TIMED",
    });
    expect(result.success).toBe(false);
  });
});

describe("createTestCaseRequestSchema", () => {
  const base = { name: "Case", input: "", expectedOutput: "" };

  it("defaults a new case to hidden", () => {
    expect(createTestCaseRequestSchema.parse(base).kind).toBe("HIDDEN");
  });

  it("measures input in bytes, so multi-byte text cannot slip past the limit", () => {
    // Three bytes per character: under the limit by characters, over it by bytes.
    const heavy = "界".repeat(Math.floor(MAX_TEST_CASE_IO_BYTES / 3) + 1);
    expect(heavy.length).toBeLessThan(MAX_TEST_CASE_IO_BYTES);
    expect(createTestCaseRequestSchema.safeParse({ ...base, input: heavy }).success).toBe(false);
  });
});
