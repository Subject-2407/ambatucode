import { describe, expect, it } from "vitest";
import type { InteractiveBlockAttrs } from "@ambatucode/shared";
import { blockChanged, previewNotice } from "./interactive-block-draft";

const block: InteractiveBlockAttrs = {
  id: "blk_1",
  title: "Loop trace",
  html: "<p id=step></p>",
  css: "",
  js: "",
  initialHeight: 320,
};

describe("blockChanged", () => {
  it("is false for an untouched copy", () => {
    expect(blockChanged(block, { ...block })).toBe(false);
  });

  it("notices any field, shown or not", () => {
    expect(blockChanged(block, { ...block, js: "step.textContent = 1;" })).toBe(true);
    expect(blockChanged(block, { ...block, title: "Loop trace II" })).toBe(true);
    expect(blockChanged(block, { ...block, initialHeight: 400 })).toBe(true);
  });
});

describe("previewNotice", () => {
  const valid = { previewValid: true, draftValid: true, overflowing: [] };

  it("says nothing while the preview is running the block", () => {
    expect(previewNotice(valid)).toBeNull();
  });

  it("names the panes that are over their limit", () => {
    expect(
      previewNotice({ previewValid: false, draftValid: false, overflowing: ["HTML", "JS"] }),
    ).toBe("Trim HTML, JS back under the limit to see a preview.");
  });

  it("does not send the Architect after a problem already fixed", () => {
    // The debounced copy still fails; the live draft no longer does.
    expect(previewNotice({ previewValid: false, draftValid: true, overflowing: [] })).toBe(
      "Updating the preview…",
    );
  });

  it("explains a failure no pane is flagged for", () => {
    expect(
      previewNotice({
        previewValid: false,
        draftValid: false,
        overflowing: [],
        firstIssue: "Block id must be 1-64 of A-Z, a-z, 0-9, _ or -",
      }),
    ).toMatch(/^The preview cannot run this block: Block id/);
  });
});
