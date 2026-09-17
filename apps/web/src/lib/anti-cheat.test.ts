import { describe, expect, it } from "vitest";
import { blocksClipboardEvent, clipboardChord, describeAntiCheat } from "./anti-cheat";

describe("blocksClipboardEvent", () => {
  it("always stops a paste, wherever it lands", () => {
    expect(blocksClipboardEvent({ action: "PASTE", insideEditor: true })).toBe(true);
    expect(blocksClipboardEvent({ action: "PASTE", insideEditor: false })).toBe(true);
  });

  it("leaves copy and cut alone inside the editor", () => {
    expect(blocksClipboardEvent({ action: "COPY", insideEditor: true })).toBe(false);
    expect(blocksClipboardEvent({ action: "CUT", insideEditor: true })).toBe(false);
  });

  it("stops copying the problem statement out", () => {
    expect(blocksClipboardEvent({ action: "COPY", insideEditor: false })).toBe(true);
    expect(blocksClipboardEvent({ action: "CUT", insideEditor: false })).toBe(true);
  });

  it("stops the context menu everywhere", () => {
    expect(blocksClipboardEvent({ action: "CONTEXT_MENU", insideEditor: true })).toBe(true);
  });
});

describe("clipboardChord", () => {
  it("recognises the three chords on both platforms", () => {
    expect(clipboardChord({ key: "c", ctrlKey: true, metaKey: false })).toBe("COPY");
    expect(clipboardChord({ key: "x", ctrlKey: false, metaKey: true })).toBe("CUT");
    expect(clipboardChord({ key: "v", ctrlKey: true, metaKey: false })).toBe("PASTE");
  });

  it("is case insensitive, so caps lock does not open a hole", () => {
    expect(clipboardChord({ key: "V", ctrlKey: true, metaKey: false })).toBe("PASTE");
  });

  it("catches paste-without-formatting, which adds shift", () => {
    expect(clipboardChord({ key: "v", ctrlKey: true, metaKey: false })).toBe("PASTE");
  });

  it("ignores an unmodified key", () => {
    expect(clipboardChord({ key: "c", ctrlKey: false, metaKey: false })).toBeNull();
  });

  it("ignores other modified keys", () => {
    expect(clipboardChord({ key: "s", ctrlKey: true, metaKey: false })).toBeNull();
  });
});

describe("describeAntiCheat", () => {
  it("says nothing when nothing is enabled", () => {
    expect(
      describeAntiCheat({
        blockClipboard: false,
        blockContextMenu: false,
        detectFocusLoss: false,
      }),
    ).toBeNull();
  });

  it("names every control that is on", () => {
    const notice = describeAntiCheat({
      blockClipboard: true,
      blockContextMenu: true,
      detectFocusLoss: true,
    });
    expect(notice).toContain("Copying and pasting");
    expect(notice).toContain("right-click");
    expect(notice).toContain("recorded");
  });
});
