import { describe, expect, it } from "vitest";
import {
  LANGUAGES,
  MAX_TEST_SCRIPT_BYTES,
  uploadTestScriptRequestSchema,
} from "@ambatucode/shared";
import {
  defaultFramework,
  defaultScriptPath,
  frameworksFor,
  readPickedScriptFile,
} from "./script-file";

function picked(name: string, content: string, size = content.length) {
  return { name, size, text: () => Promise.resolve(content) };
}

describe("frameworksFor", () => {
  it("offers a language its own framework and CUSTOM", () => {
    expect(frameworksFor("java")).toEqual(["JUNIT", "CUSTOM"]);
    expect(frameworksFor("cpp")).toEqual(["GOOGLETEST", "CUSTOM"]);
    expect(defaultFramework("python")).toBe("PYTEST");
    expect(defaultFramework("cpp")).toBe("GOOGLETEST");
  });

  // A default the upload schema refuses would greet the Architect with an error.
  it("suggests a path the upload schema accepts for every pairing", () => {
    for (const language of LANGUAGES) {
      for (const framework of frameworksFor(language)) {
        const result = uploadTestScriptRequestSchema.safeParse({
          language,
          framework,
          path: defaultScriptPath(framework, language),
          content: "x",
        });
        expect(result.success, `${framework}/${language}`).toBe(true);
      }
    }
  });
});

describe("readPickedScriptFile", () => {
  it("keeps the file's name and text", async () => {
    await expect(
      readPickedScriptFile(picked("SolutionTest.java", "class SolutionTest {}"), "java"),
    ).resolves.toEqual({ path: "SolutionTest.java", content: "class SolutionTest {}" });
  });

  it.each([
    ["too large", picked("test_big.py", "x", MAX_TEST_SCRIPT_BYTES + 1), "python"],
    ["a name the sandbox refuses", picked("my test.py", "x"), "python"],
    ["a hidden file", picked(".test.py", "x"), "python"],
    ["the wrong language", picked("test_solution.py", "x"), "java"],
    ["binary", picked("test_solution.py", "\u0000"), "python"],
  ] as const)("refuses a file that is %s", async (_label, file, language) => {
    await expect(readPickedScriptFile(file, language)).resolves.toHaveProperty("error");
  });
});
