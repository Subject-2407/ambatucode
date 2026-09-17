import { describe, expect, it } from "vitest";
import { chooseDraft, type LocalDraft, type ServerDraft } from "./local-draft";

const local = (overrides: Partial<LocalDraft> = {}): LocalDraft => ({
  attemptId: "attempt-1",
  language: "python",
  sourceCode: "print('local')",
  savedAtMs: 1_000,
  ...overrides,
});

const server = (overrides: Partial<ServerDraft> = {}): ServerDraft => ({
  language: "python",
  sourceCode: "print('server')",
  savedAtMs: 1_000,
  ...overrides,
});

describe("chooseDraft", () => {
  it("has nothing to restore when neither side holds a draft", () => {
    expect(chooseDraft({ local: null, server: null, skewMs: 0 })).toEqual({ source: "NONE" });
  });

  it("falls back to the server draft when the browser has none", () => {
    const choice = chooseDraft({ local: null, server: server(), skewMs: 0 });
    expect(choice).toEqual({
      source: "SERVER",
      language: "python",
      sourceCode: "print('server')",
    });
  });

  it("uses the local draft when the server never received one", () => {
    const choice = chooseDraft({ local: local(), server: null, skewMs: 0 });
    expect(choice.source).toBe("LOCAL");
  });

  it("prefers newer local work", () => {
    const choice = chooseDraft({
      local: local({ savedAtMs: 5_000 }),
      server: server({ savedAtMs: 4_000 }),
      skewMs: 0,
    });
    expect(choice.source).toBe("LOCAL");
  });

  it("takes the server draft when it is newer — another device was here", () => {
    const choice = chooseDraft({
      local: local({ savedAtMs: 4_000 }),
      server: server({ savedAtMs: 5_000 }),
      skewMs: 0,
    });
    expect(choice.source).toBe("SERVER");
  });

  it("corrects for clock skew before comparing", () => {
    // The browser clock runs ten seconds slow, so a local save that looks older
    // than the server's actually happened after it.
    const choice = chooseDraft({
      local: local({ savedAtMs: 4_000 }),
      server: server({ savedAtMs: 8_000 }),
      skewMs: 10_000,
    });
    expect(choice.source).toBe("LOCAL");
  });

  it("breaks a tie toward the local copy", () => {
    const choice = chooseDraft({ local: local(), server: server(), skewMs: 0 });
    expect(choice.source).toBe("LOCAL");
  });

  it("reports identical content as the server draft, not as a restore", () => {
    const choice = chooseDraft({
      local: local({ sourceCode: "same", savedAtMs: 9_000 }),
      server: server({ sourceCode: "same", savedAtMs: 1_000 }),
      skewMs: 0,
    });
    expect(choice.source).toBe("SERVER");
  });

  it("treats a language change as a real difference", () => {
    const choice = chooseDraft({
      local: local({ language: "javascript", sourceCode: "same", savedAtMs: 9_000 }),
      server: server({ language: "python", sourceCode: "same", savedAtMs: 1_000 }),
      skewMs: 0,
    });
    expect(choice).toEqual({ source: "LOCAL", language: "javascript", sourceCode: "same" });
  });
});
