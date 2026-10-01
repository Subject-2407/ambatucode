import { describe, expect, it } from "vitest";
import type { RichTextDocument } from "@ambatucode/shared";
import {
  hiddenFromCoders,
  materialIsDirty,
  sameDocument,
  type MaterialDraft,
} from "./material-draft";

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const document = (...content: RichTextDocument["content"]): RichTextDocument => ({
  type: "doc",
  content,
});

const saved: MaterialDraft = {
  title: "Reading input",
  content: document(paragraph("Use input().")),
  isPublished: false,
};

describe("materialIsDirty", () => {
  it("is clean when nothing changed", () => {
    expect(materialIsDirty(saved, { ...saved })).toBe(false);
  });

  it("notices the title, the content, and the published flag", () => {
    expect(materialIsDirty(saved, { ...saved, title: "Reading input II" })).toBe(true);
    expect(materialIsDirty(saved, { ...saved, isPublished: true })).toBe(true);
    expect(
      materialIsDirty(saved, { ...saved, content: document(paragraph("Use sys.stdin.")) }),
    ).toBe(true);
  });
});

describe("sameDocument", () => {
  it("ignores the order the keys were stored in", () => {
    // The shape a JSONB column hands back: keys reordered, nothing else.
    const fromDatabase: RichTextDocument = {
      content: [{ content: [{ text: "Use input().", type: "text" }], type: "paragraph" }],
      type: "doc",
    };
    expect(sameDocument(saved.content, fromDatabase)).toBe(true);
  });

  it("treats an absent key and an undefined one alike", () => {
    const withUndefined = document({ type: "paragraph", attrs: undefined, content: [] });
    expect(sameDocument(document({ type: "paragraph", content: [] }), withUndefined)).toBe(true);
  });

  it("treats every empty document as the same document", () => {
    expect(sameDocument(document(), document({ type: "paragraph" }))).toBe(true);
  });

  it("still sees an Interactive Block in an otherwise empty document", () => {
    const withBlock = document({ type: "interactiveBlock", attrs: { id: "blk_1" } });
    expect(sameDocument(document(), withBlock)).toBe(false);
  });

  it("notices a changed mark attribute", () => {
    const link = (href: string) =>
      document({
        type: "paragraph",
        content: [{ type: "text", text: "docs", marks: [{ type: "link", attrs: { href } }] }],
      });
    expect(sameDocument(link("https://a.example"), link("https://b.example"))).toBe(false);
  });

  it("does not confuse a reordered list with the same list", () => {
    expect(
      sameDocument(
        document(paragraph("a"), paragraph("b")),
        document(paragraph("b"), paragraph("a")),
      ),
    ).toBe(false);
  });
});

describe("hiddenFromCoders", () => {
  it("says nothing when both are published", () => {
    expect(hiddenFromCoders({ materialPublished: true, modulePublished: true })).toBeNull();
  });

  it("names the draft module even when the material is published", () => {
    expect(hiddenFromCoders({ materialPublished: true, modulePublished: false })).toMatch(
      /module is a draft/,
    );
  });

  it("names a draft material, and both when both are drafts", () => {
    expect(hiddenFromCoders({ materialPublished: false, modulePublished: true })).toMatch(
      /material is a draft/,
    );
    expect(hiddenFromCoders({ materialPublished: false, modulePublished: false })).toMatch(
      /both drafts/,
    );
  });
});
