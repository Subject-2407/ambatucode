import { describe, expect, it } from "vitest";
import {
  EMPTY_RICH_TEXT_DOCUMENT,
  practiceTestCaseSchema,
  practiceTestCasesSchema,
  richTextDocumentSchema,
  starterCodeMapSchema,
} from "./content";

describe("richTextDocumentSchema", () => {
  it("accepts a nested document with marks and text", () => {
    const parsed = richTextDocumentSchema.parse({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Binary search", marks: [{ type: "bold" }] }],
        },
        {
          type: "codeBlock",
          attrs: { language: "python" },
          content: [{ type: "text", text: "lo, hi = 0, len(xs)" }],
        },
      ],
    });

    expect(parsed.content).toHaveLength(2);
    expect(parsed.content[0]?.content?.[0]?.marks?.[0]?.type).toBe("bold");
    expect(parsed.content[1]?.attrs?.language).toBe("python");
  });

  it("treats an empty document as valid and defaults its content", () => {
    expect(richTextDocumentSchema.parse({ type: "doc" })).toEqual(EMPTY_RICH_TEXT_DOCUMENT);
  });

  it("rejects a root that is not a doc", () => {
    // A Material column holding a bare paragraph would render as nothing at
    // all; failing loudly beats a silently blank lesson.
    expect(() => richTextDocumentSchema.parse({ type: "paragraph" })).toThrow();
  });

  it("rejects a node with no type", () => {
    expect(() =>
      richTextDocumentSchema.parse({ type: "doc", content: [{ text: "orphaned" }] }),
    ).toThrow();
  });
});

describe("starterCodeMapSchema", () => {
  it("accepts starter code for only some of the allowed languages", () => {
    expect(starterCodeMapSchema.parse({ python: "def solve():\n    pass\n" })).toEqual({
      python: "def solve():\n    pass\n",
    });
  });

  it("accepts an empty map", () => {
    expect(starterCodeMapSchema.parse({})).toEqual({});
  });

  it("rejects a language the platform does not know", () => {
    expect(() => starterCodeMapSchema.parse({ malbolge: "" })).toThrow();
  });
});

describe("practiceTestCaseSchema", () => {
  it("defaults comparison to TRIMMED", () => {
    const parsed = practiceTestCaseSchema.parse({
      id: "case-1",
      name: "echoes its input",
      input: "hello",
      expectedOutput: "hello",
    });

    expect(parsed.comparison).toBe("TRIMMED");
  });

  /**
   * Practice has no hidden cases and no grade. Anything smuggling either
   * concept in must not survive parsing, or a practice payload could start
   * carrying data the Run pipeline was never built to protect.
   */
  it("drops any attempt to mark a practice case hidden or weighted", () => {
    const parsed = practiceTestCaseSchema.parse({
      id: "case-1",
      name: "sneaky",
      input: "x",
      expectedOutput: "y",
      isPublic: false,
      weight: 10,
    });

    expect(parsed).not.toHaveProperty("isPublic");
    expect(parsed).not.toHaveProperty("weight");
  });

  it("parses a list of cases", () => {
    const parsed = practiceTestCasesSchema.parse([
      { id: "a", name: "first", input: "1", expectedOutput: "1" },
      { id: "b", name: "second", input: "2", expectedOutput: "4", comparison: "EXACT" },
    ]);

    expect(parsed.map((testCase) => testCase.comparison)).toEqual(["TRIMMED", "EXACT"]);
  });
});
