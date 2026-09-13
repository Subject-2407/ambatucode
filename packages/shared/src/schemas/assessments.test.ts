import { describe, expect, it } from "vitest";
import {
  MAX_TEST_CASE_IO_BYTES,
  createAssessmentRequestSchema,
  createTestCaseRequestSchema,
  timingProblem,
  uploadTestScriptRequestSchema,
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

describe("uploadTestScriptRequestSchema", () => {
  const script = (overrides: Record<string, unknown> = {}) => ({
    language: "python",
    framework: "PYTEST",
    entrypoint: "tests/test_solution.py",
    files: [{ path: "tests/test_solution.py", content: "def test_ok():\n    assert True\n" }],
    ...overrides,
  });

  it("accepts a well-formed script", () => {
    expect(uploadTestScriptRequestSchema.safeParse(script()).success).toBe(true);
  });

  it.each([
    "../escape.py",
    "tests/../../escape.py",
    "/etc/passwd",
    "C:\\Windows\\win.ini",
    "tests\\test.py",
    ".hidden.py",
    "tests/.hidden/test.py",
    "tests//test.py",
    "tests/",
    "",
  ])("refuses the path %j", (path) => {
    const result = uploadTestScriptRequestSchema.safeParse(
      script({ entrypoint: path, files: [{ path, content: "" }] }),
    );
    expect(result.success).toBe(false);
  });

  it("requires the entrypoint to be one of the files", () => {
    expect(
      uploadTestScriptRequestSchema.safeParse(script({ entrypoint: "missing.py" })).success,
    ).toBe(false);
  });

  it("refuses duplicate paths", () => {
    const file = { path: "tests/test_solution.py", content: "" };
    expect(uploadTestScriptRequestSchema.safeParse(script({ files: [file, file] })).success).toBe(
      false,
    );
  });

  it("refuses a packaged framework in the wrong language", () => {
    expect(uploadTestScriptRequestSchema.safeParse(script({ framework: "JUNIT" })).success).toBe(
      false,
    );
    expect(
      uploadTestScriptRequestSchema.safeParse(script({ framework: "CUSTOM", language: "cpp" }))
        .success,
    ).toBe(true);
  });
});
