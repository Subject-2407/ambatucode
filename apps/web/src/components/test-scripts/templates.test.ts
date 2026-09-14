import { describe, expect, it } from "vitest";
import { LANGUAGES, uploadTestScriptRequestSchema } from "@ambatucode/shared";
import { frameworksFor } from "./script-file";
import { SCRIPT_TEMPLATES, templatesFor } from "./templates";

// Each template was also run against a correct and a structurally wrong
// submission in the real sandboxes; these checks keep the catalogue itself
// honest as it changes.
describe("script templates", () => {
  it("are all uploadable as written", () => {
    for (const template of SCRIPT_TEMPLATES) {
      const result = uploadTestScriptRequestSchema.safeParse(template);
      expect(result.success, template.id).toBe(true);
    }
  });

  it("have unique ids", () => {
    const ids = SCRIPT_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offer every language at least one starting point", () => {
    for (const language of LANGUAGES) {
      const offered = frameworksFor(language).flatMap((framework) =>
        templatesFor(framework, language),
      );
      expect(offered.length, language).toBeGreaterThan(0);
    }
  });

  // The worker selects the JUnit class a path names; a mismatch fails every run.
  it("name each Java file after the class it declares", () => {
    for (const template of SCRIPT_TEMPLATES.filter((entry) => entry.language === "java")) {
      const className = template.path.replace(/\.java$/, "");
      expect(template.content, template.id).toContain(`public class ${className} `);
      expect(template.content, template.id).not.toMatch(/^package /m);
    }
  });

  it("send custom runners' results where the worker reads them", () => {
    for (const template of SCRIPT_TEMPLATES.filter((entry) => entry.framework === "CUSTOM")) {
      expect(template.content, template.id).toContain("AMBATUCODE_REPORT");
    }
  });
});
