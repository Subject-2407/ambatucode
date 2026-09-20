import { describe, expect, it } from "vitest";
import {
  MAX_TEST_CASE_IO_BYTES,
  createAssessmentRequestSchema,
  createTestCaseRequestSchema,
  openAccessProblem,
  timingProblem,
} from "./assessments";

describe("openAccessProblem", () => {
  it("refuses open access on a live assessment", () => {
    // A Live session is one clock an Architect starts. "Whenever you like" has
    // no meaning against it, so the pair is refused rather than half-honoured.
    expect(openAccessProblem({ isOpenAccess: true, executionMode: "LIVE" })).not.toBeNull();
  });

  it("allows it for individual and untimed assessments", () => {
    expect(openAccessProblem({ isOpenAccess: true, executionMode: "INDIVIDUAL" })).toBeNull();
    expect(openAccessProblem({ isOpenAccess: true, executionMode: null })).toBeNull();
  });

  it("says nothing about a live assessment that is not open", () => {
    expect(openAccessProblem({ isOpenAccess: false, executionMode: "LIVE" })).toBeNull();
  });

  it("is applied when an assessment is created", () => {
    const result = createAssessmentRequestSchema.safeParse({
      title: "Binary search",
      problemStatement: "Find it.",
      allowedLanguages: ["python"],
      timeMode: "TIMED",
      durationMinutes: 30,
      executionMode: "LIVE",
      isOpenAccess: true,
    });
    expect(result.success).toBe(false);
  });

  it("defaults to closed, so an assessment is never open by omission", () => {
    const result = createAssessmentRequestSchema.safeParse({
      title: "Binary search",
      problemStatement: "Find it.",
      allowedLanguages: ["python"],
    });
    expect(result.success && result.data.isOpenAccess).toBe(false);
  });
});

describe("exitPolicy", () => {
  it("defaults to keeping the attempt open", () => {
    // The safe default: leaving by accident must not hand in an exam.
    const result = createAssessmentRequestSchema.safeParse({
      title: "Binary search",
      problemStatement: "Find it.",
      allowedLanguages: ["python"],
    });
    expect(result.success && result.data.exitPolicy).toBe("RESUME");
  });

  it("refuses a policy it does not have", () => {
    const result = createAssessmentRequestSchema.safeParse({
      title: "Binary search",
      problemStatement: "Find it.",
      allowedLanguages: ["python"],
      exitPolicy: "ESCAPE",
    });
    expect(result.success).toBe(false);
  });
});

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
