import { describe, expect, it } from "vitest";
import type { RichTextDocument } from "@ambatucode/shared";
import { headingLevel, isEmptyDocument, sanitizeHref } from "./rich-text";

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
