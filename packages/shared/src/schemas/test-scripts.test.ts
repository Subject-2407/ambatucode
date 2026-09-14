import { describe, expect, it } from "vitest";
import { MAX_TEST_SCRIPT_BYTES, uploadTestScriptRequestSchema } from "./test-scripts";

describe("uploadTestScriptRequestSchema", () => {
  const script = (overrides: Record<string, unknown> = {}) => ({
    language: "python",
    framework: "PYTEST",
    path: "tests/test_solution.py",
    content: "def test_ok():\n    assert True\n",
    ...overrides,
  });

  it("accepts a well-formed script and defaults its weight", () => {
    const result = uploadTestScriptRequestSchema.safeParse(script());
    expect(result.success).toBe(true);
    expect(result.data?.weight).toBe(1);
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
    expect(uploadTestScriptRequestSchema.safeParse(script({ path })).success).toBe(false);
  });

  it("refuses a packaged framework in the wrong language", () => {
    expect(uploadTestScriptRequestSchema.safeParse(script({ framework: "JUNIT" })).success).toBe(
      false,
    );
    expect(
      uploadTestScriptRequestSchema.safeParse(
        script({ framework: "CUSTOM", language: "cpp", path: "harness.cpp" }),
      ).success,
    ).toBe(true);
  });

  it("refuses a file its language cannot run", () => {
    expect(uploadTestScriptRequestSchema.safeParse(script({ path: "test_solution.js" })).success).toBe(
      false,
    );
    expect(
      uploadTestScriptRequestSchema.safeParse(
        script({ language: "java", framework: "JUNIT", path: "SolutionTest.kt" }),
      ).success,
    ).toBe(false);
  });

  it("refuses the path the submission is written to", () => {
    expect(uploadTestScriptRequestSchema.safeParse(script({ path: "main.py" })).success).toBe(false);
    expect(
      uploadTestScriptRequestSchema.safeParse(
        script({ language: "cpp", framework: "CUSTOM", path: "main.cpp" }),
      ).success,
    ).toBe(false);
  });

  it("refuses an empty or oversized file", () => {
    expect(uploadTestScriptRequestSchema.safeParse(script({ content: "  \n" })).success).toBe(false);
    const heavy = "界".repeat(Math.floor(MAX_TEST_SCRIPT_BYTES / 3) + 1);
    expect(uploadTestScriptRequestSchema.safeParse(script({ content: heavy })).success).toBe(false);
  });
});
