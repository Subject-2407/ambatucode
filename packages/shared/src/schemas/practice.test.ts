import { describe, expect, it } from "vitest";
import {
  createPracticeRequestSchema,
  practiceTestCaseInputSchema,
  runPracticeRequestSchema,
  updatePracticeRequestSchema,
} from "./practice";

const validActivity = {
  title: "Greet the caller",
  prompt: "Print a greeting.",
  allowedLanguages: ["python"],
  testCases: [{ name: "Ordinary name", input: "Ada\n", expectedOutput: "Hello, Ada!" }],
};

describe("createPracticeRequestSchema", () => {
  it("applies the teaching-friendly defaults", () => {
    const parsed = createPracticeRequestSchema.parse(validActivity);
    expect(parsed.timeLimitMs).toBe(5_000);
    expect(parsed.memoryLimitMb).toBe(256);
    expect(parsed.starterCode).toEqual({});
    expect(parsed.testCases[0]?.comparison).toBe("TRIMMED");
  });

  it("refuses an activity with no language to run it in", () => {
    expect(
      createPracticeRequestSchema.safeParse({ ...validActivity, allowedLanguages: [] }).success,
    ).toBe(false);
  });

  it("refuses a duplicated language", () => {
    expect(
      createPracticeRequestSchema.safeParse({
        ...validActivity,
        allowedLanguages: ["python", "python"],
      }).success,
    ).toBe(false);
  });

  it("refuses an activity with no cases to check against", () => {
    expect(createPracticeRequestSchema.safeParse({ ...validActivity, testCases: [] }).success).toBe(
      false,
    );
  });
});

describe("practiceTestCaseInputSchema", () => {
  it("lets a freshly typed case arrive without an id", () => {
    const parsed = practiceTestCaseInputSchema.parse({
      name: "New case",
      input: "1",
      expectedOutput: "1",
    });
    expect(parsed.id).toBeUndefined();
  });

  it("keeps an id the editor already has", () => {
    expect(
      practiceTestCaseInputSchema.parse({
        id: "case-1",
        name: "New case",
        input: "1",
        expectedOutput: "1",
      }).id,
    ).toBe("case-1");
  });
});

describe("updatePracticeRequestSchema", () => {
  it("rejects an empty patch", () => {
    expect(updatePracticeRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("runPracticeRequestSchema", () => {
  it("carries the buffer, and accepts an empty one", () => {
    const parsed = runPracticeRequestSchema.parse({ language: "python", sourceCode: "" });
    expect(parsed.sourceCode).toBe("");
  });

  it("rejects a language outside the vocabulary", () => {
    expect(runPracticeRequestSchema.safeParse({ language: "ruby", sourceCode: "" }).success).toBe(
      false,
    );
  });
});
