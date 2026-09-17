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
    expect(
      uploadTestScriptRequestSchema.safeParse(script({ path: "test_solution.js" })).success,
    ).toBe(false);
    expect(
      uploadTestScriptRequestSchema.safeParse(
        script({ language: "java", framework: "JUNIT", path: "SolutionTest.kt" }),
      ).success,
    ).toBe(false);
  });

  it("refuses the path the submission is written to", () => {
    expect(uploadTestScriptRequestSchema.safeParse(script({ path: "main.py" })).success).toBe(
      false,
    );
    expect(
      uploadTestScriptRequestSchema.safeParse(
        script({ language: "cpp", framework: "CUSTOM", path: "main.cpp" }),
      ).success,
    ).toBe(false);
  });

  const java = (path: string, content: string, framework = "JUNIT") =>
    uploadTestScriptRequestSchema.safeParse(script({ language: "java", framework, path, content }));

  // A class under another name compiles, then runs no tests at all.
  it("refuses a Java script whose class is not named after its file", () => {
    const body =
      "import org.junit.jupiter.api.Test;\nclass StudentConstructorTest {\n  @Test void ok() {}\n}\n";
    const refused = java("ConstructorTest.java", body);
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.message).toMatch(/must declare a class named ConstructorTest/);
    expect(java("StudentConstructorTest.java", body).success).toBe(true);
    expect(java("tests/Check.java", "public class Check {}\n", "CUSTOM").success).toBe(true);
    // A longer name that merely starts with the file's is not the class.
    expect(java("Check.java", "class CheckTwice {}\n", "CUSTOM").success).toBe(false);
  });

  it("refuses JUnit 4", () => {
    expect(
      java("SolutionTest.java", "import org.junit.Test;\nclass SolutionTest {}\n").success,
    ).toBe(false);
    expect(
      java(
        "SolutionTest.java",
        "import static org.junit.Assert.assertEquals;\nclass SolutionTest {}\n",
      ).success,
    ).toBe(false);
    expect(
      java(
        "SolutionTest.java",
        "import static org.junit.jupiter.api.Assertions.assertEquals;\nclass SolutionTest {}\n",
      ).success,
    ).toBe(true);
  });

  it("refuses a GoogleTest script with its own main", () => {
    const cpp = (content: string) =>
      uploadTestScriptRequestSchema.safeParse(
        script({ language: "cpp", framework: "GOOGLETEST", path: "solution_test.cpp", content }),
      );
    expect(
      cpp('#include "main.cpp"\nint main(int argc, char** argv) { return 0; }\n').success,
    ).toBe(false);
    expect(cpp('#include <gtest/gtest.h>\n#include "main.cpp"\nTEST(A, B) {}\n').success).toBe(
      true,
    );
  });

  it("refuses an empty or oversized file", () => {
    expect(uploadTestScriptRequestSchema.safeParse(script({ content: "  \n" })).success).toBe(
      false,
    );
    const heavy = "界".repeat(Math.floor(MAX_TEST_SCRIPT_BYTES / 3) + 1);
    expect(uploadTestScriptRequestSchema.safeParse(script({ content: heavy })).success).toBe(false);
  });
});
