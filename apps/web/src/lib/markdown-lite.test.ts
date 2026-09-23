import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdownLite } from "./markdown-lite";

describe("parseInline", () => {
  it("returns one text node for plain prose", () => {
    expect(parseInline("just words")).toEqual([{ kind: "text", value: "just words" }]);
  });

  it("reads bold, italic and code", () => {
    expect(parseInline("**a** *b* `c`")).toEqual([
      { kind: "strong", value: "a" },
      { kind: "text", value: " " },
      { kind: "em", value: "b" },
      { kind: "text", value: " " },
      { kind: "code", value: "c" },
    ]);
  });

  it("treats underscores as italic", () => {
    expect(parseInline("_b_")).toEqual([{ kind: "em", value: "b" }]);
  });

  it("does not read markers inside inline code", () => {
    expect(parseInline("`a ** b`")).toEqual([{ kind: "code", value: "a ** b" }]);
  });

  it("prefers bold over italic for a doubled marker", () => {
    expect(parseInline("**bold**")).toEqual([{ kind: "strong", value: "bold" }]);
  });

  it("leaves an unmatched marker as text", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ kind: "text", value: "2 * 3 = 6" }]);
  });

  it("merges the runs between markers", () => {
    const nodes = parseInline("a `b` c `d` e");
    expect(nodes.filter((node) => node.kind === "text").map((node) => node.value)).toEqual([
      "a ",
      " c ",
      " e",
    ]);
  });
});

describe("parseMarkdownLite", () => {
  it("keeps plain prose as one paragraph", () => {
    expect(parseMarkdownLite("hello world")).toEqual([
      { kind: "paragraph", content: [{ kind: "text", value: "hello world" }] },
    ]);
  });

  it("preserves a single newline inside a paragraph", () => {
    const [block] = parseMarkdownLite("line one\nline two");
    expect(block).toEqual({
      kind: "paragraph",
      content: [{ kind: "text", value: "line one\nline two" }],
    });
  });

  it("splits paragraphs on a blank line", () => {
    const blocks = parseMarkdownLite("one\n\ntwo");
    expect(blocks).toHaveLength(2);
    expect(blocks.every((block) => block.kind === "paragraph")).toBe(true);
  });

  it("reads the three heading levels", () => {
    const blocks = parseMarkdownLite("# a\n## b\n### c");
    expect(blocks.map((block) => (block.kind === "heading" ? block.level : null))).toEqual([
      1, 2, 3,
    ]);
  });

  it("caps a deeper heading at level three", () => {
    const [block] = parseMarkdownLite("#### deep");
    expect(block).toMatchObject({ kind: "heading", level: 3 });
  });

  it("groups consecutive bullets into one list", () => {
    const [block] = parseMarkdownLite("- a\n- b\n- c");
    expect(block).toMatchObject({ kind: "list", ordered: false });
    expect(block?.kind === "list" ? block.items : []).toHaveLength(3);
  });

  it("reads a numbered list as ordered", () => {
    const [block] = parseMarkdownLite("1. a\n2. b");
    expect(block).toMatchObject({ kind: "list", ordered: true });
  });

  it("keeps a fenced block verbatim and records its language", () => {
    const [block] = parseMarkdownLite("```python\nprint(1)\n\nprint(2)\n```");
    expect(block).toEqual({
      kind: "code",
      language: "python",
      value: "print(1)\n\nprint(2)",
    });
  });

  it("does not read markers inside a fenced block", () => {
    const [block] = parseMarkdownLite("```\n# not a heading\n- not a list\n```");
    expect(block).toMatchObject({ kind: "code", value: "# not a heading\n- not a list" });
  });

  it("runs an unterminated fence to the end", () => {
    const [block] = parseMarkdownLite("```\nstill typing");
    expect(block).toMatchObject({ kind: "code", value: "still typing" });
  });

  it("reads a fence with no language as having none", () => {
    const [block] = parseMarkdownLite("```\nx\n```");
    expect(block).toMatchObject({ kind: "code", language: null });
  });

  it("joins consecutive quote lines", () => {
    const [block] = parseMarkdownLite("> one\n> two");
    expect(block).toEqual({
      kind: "quote",
      content: [{ kind: "text", value: "one\ntwo" }],
    });
  });

  it("reads a horizontal rule", () => {
    expect(parseMarkdownLite("---")).toEqual([{ kind: "rule" }]);
  });

  it("ends a paragraph when a list starts without a blank line", () => {
    const blocks = parseMarkdownLite("intro\n- a\n- b");
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "list"]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(parseMarkdownLite("")).toEqual([]);
    expect(parseMarkdownLite("  \n\n  ")).toEqual([]);
  });

  it("normalises CRLF line endings", () => {
    const blocks = parseMarkdownLite("one\r\n\r\ntwo");
    expect(blocks).toHaveLength(2);
  });
});
