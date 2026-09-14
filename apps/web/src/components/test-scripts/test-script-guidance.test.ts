import { describe, expect, it } from "vitest";
import { LANGUAGES, TEST_SCRIPT_FRAMEWORKS } from "@ambatucode/shared";
import { describeScriptContract } from "./test-script-guidance";

describe("describeScriptContract", () => {
  it("explains every framework in every language", () => {
    for (const framework of TEST_SCRIPT_FRAMEWORKS) {
      for (const language of LANGUAGES) {
        const guidance = describeScriptContract(framework, language);
        expect(guidance.submission, `${framework}/${language}`).not.toBe("");
        expect(guidance.results, `${framework}/${language}`).not.toBe("");
      }
    }
  });

  // These names are what the worker actually writes; a script importing
  // anything else fails every submission.
  it("names the files the worker writes the submission to", () => {
    expect(describeScriptContract("PYTEST", "python").submission).toContain("main.py");
    expect(describeScriptContract("JEST", "javascript").submission).toContain("main.js");
    expect(describeScriptContract("JUNIT", "java").submission).toContain("default package");
  });

  it("tells a custom script where its report and the compiled program go", () => {
    expect(describeScriptContract("CUSTOM", "python").results).toContain("AMBATUCODE_REPORT");
    expect(describeScriptContract("CUSTOM", "cpp").submission).toContain("AMBATUCODE_PROGRAM");
  });
});
