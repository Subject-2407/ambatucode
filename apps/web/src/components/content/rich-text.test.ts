import { describe, expect, it } from "vitest";
import type { RichTextDocument, RichTextNode } from "@ambatucode/shared";
import { headingLevel, isEmptyDocument, readableInteractiveBlock, sanitizeHref } from "./rich-text";

describe("sanitizeHref", () => {
  it.each(["https://example.test/guide", "http://example.test", "mailto:tutor@example.test"])(
    "keeps %s",
    (href) => {
      expect(sanitizeHref(href)).toBe(href);
    },
  );

  it("keeps a relative link inside the app", () => {
    expect(sanitizeHref("/modules/python-foundations")).toBe("/modules/python-foundations");
  });

  /**
   * The Architect who wrote the Material is trusted; the href is still code
   * that runs in every reader's browser.
   */
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)  ",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "//evil.test",
  ])("drops %s", (href) => {
    expect(sanitizeHref(href)).toBeNull();
  });

  it.each([null, undefined, 42, ""])("drops the non-href %s", (href) => {
    expect(sanitizeHref(href)).toBeNull();
  });
});

describe("isEmptyDocument", () => {
  it("treats a document of blank paragraphs as empty", () => {
    const document: RichTextDocument = {
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "   " }] },
      ],
    };
    expect(isEmptyDocument(document)).toBe(true);
  });

  it("sees text nested inside a list", () => {
    const document: RichTextDocument = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Read this" }] }],
            },
          ],
        },
      ],
    };
    expect(isEmptyDocument(document)).toBe(false);
  });

  it("counts a rule as content even though it holds no text", () => {
    expect(isEmptyDocument({ type: "doc", content: [{ type: "horizontalRule" }] })).toBe(false);
  });

  it("counts an interactive block as content", () => {
    // The block is a leaf holding everything in its attrs, so a walk that only
    // looked for text would read a Material containing a whole simulation as
    // empty and offer the Coder nothing to read.
    const document: RichTextDocument = {
      type: "doc",
      content: [{ type: "interactiveBlock", attrs: { id: "sorting", html: "<canvas></canvas>" } }],
    };
    expect(isEmptyDocument(document)).toBe(false);
  });
});

describe("headingLevel", () => {
  it("accepts the levels the renderer knows", () => {
    expect(headingLevel({ level: 2 })).toBe(2);
  });

  it("falls back for a level it cannot render", () => {
    expect(headingLevel({ level: 6 })).toBeNull();
    expect(headingLevel(undefined)).toBeNull();
  });
});

describe("readableInteractiveBlock", () => {
  it("fills in the optional fields a stored block may omit", () => {
    const block = readableInteractiveBlock({
      type: "interactiveBlock",
      attrs: { id: "sorting", html: "<canvas></canvas>" },
    });

    expect(block).not.toBeNull();
    expect(block?.id).toBe("sorting");
    expect(block?.css).toBe("");
    expect(block?.js).toBe("");
  });

  it.each([
    ["an id carrying markup", { id: "<img src=x>", html: "" }],
    ["no id at all", { html: "<p>hi</p>" }],
    ["a height the host would refuse to honour", { id: "tall", initialHeight: 500_000 }],
    ["a key the frame knows nothing about", { id: "extra", srcdoc: "<script>x()</script>" }],
    ["no attrs whatsoever", undefined],
  ])("degrades to a notice rather than running %s", (_label, attrs) => {
    expect(readableInteractiveBlock({ type: "interactiveBlock", attrs })).toBeNull();
  });

  it("leaves the rest of the Material readable when one block is unusable", () => {
    // The whole point of the null: a single drifted block costs the reader that
    // block, not the lesson around it. A Material that threw here would take
    // every paragraph down with the one node that failed to parse.
    const before: RichTextNode = {
      type: "paragraph",
      content: [{ type: "text", text: "Before the block." }],
    };
    const broken: RichTextNode = {
      type: "interactiveBlock",
      attrs: { id: "broken", initialHeight: -1 },
    };
    const after: RichTextNode = {
      type: "paragraph",
      content: [{ type: "text", text: "After the block." }],
    };
    const document: RichTextDocument = { type: "doc", content: [before, broken, after] };

    expect(readableInteractiveBlock(broken)).toBeNull();
    expect(isEmptyDocument(document)).toBe(false);
    expect(before.content?.[0]?.text).toBe("Before the block.");
    expect(after.content?.[0]?.text).toBe("After the block.");
  });
});
