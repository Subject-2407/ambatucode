import { describe, expect, it } from "vitest";
import { createValueSync } from "./value-sync";

describe("createValueSync", () => {
  it("ignores a render that lags behind fast typing", () => {
    const sync = createValueSync();
    // Three keystrokes land before React renders the first of them.
    sync.emitted("a");
    sync.emitted("ab");
    sync.emitted("abc");

    // The stale renders arrive in order while the editor already holds "abc".
    expect(sync.shouldApply("a", "abc")).toBe(false);
    expect(sync.shouldApply("ab", "abc")).toBe(false);
    expect(sync.shouldApply("abc", "abc")).toBe(false);
  });

  it("applies a change that did not come from the editor", () => {
    const sync = createValueSync();
    sync.emitted("print(1)");
    expect(sync.shouldApply("print(1)", "print(1)")).toBe(false);

    // A reset to starter code, or a switch of language.
    expect(sync.shouldApply("# starter\n", "print(1)")).toBe(true);
  });

  it("applies an outside change that arrives while echoes are still in flight", () => {
    const sync = createValueSync();
    sync.emitted("x");
    sync.emitted("xy");
    expect(sync.shouldApply("recovered draft", "xy")).toBe(true);
  });

  it("forgets older echoes once a newer one has arrived", () => {
    const sync = createValueSync();
    sync.emitted("a");
    sync.emitted("ab");
    expect(sync.shouldApply("ab", "abc")).toBe(false);
    // "a" can no longer be an echo: React already rendered past it. Seeing it
    // now means somebody set the buffer back to "a" on purpose.
    expect(sync.shouldApply("a", "abc")).toBe(true);
  });

  it("treats a value equal to the editor's as nothing to do", () => {
    const sync = createValueSync();
    expect(sync.shouldApply("same", "same")).toBe(false);
  });
});
