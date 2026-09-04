import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  constantTimeEquals,
  generateSessionToken,
  hashSessionToken,
  isSessionLive,
  readSessionCookie,
} from "./session-token";

describe("session token", () => {
  it("generates a 64-character hex token", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a distinct token each call", () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken());
  });

  it("hashes deterministically and never returns the raw token", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toBe(hashSessionToken(token));
    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("compares equal and unequal strings without throwing on length mismatch", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abd")).toBe(false);
    expect(constantTimeEquals("abc", "abcdef")).toBe(false);
  });
});

describe("isSessionLive", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("accepts a session that is neither revoked nor expired", () => {
    expect(isSessionLive({ revokedAt: null, expiresAt: new Date("2026-01-02") }, now)).toBe(true);
  });

  it("rejects a revoked session even when unexpired", () => {
    expect(
      isSessionLive({ revokedAt: new Date("2025-12-31"), expiresAt: new Date("2026-01-02") }, now),
    ).toBe(false);
  });

  it("rejects an expired session", () => {
    expect(isSessionLive({ revokedAt: null, expiresAt: new Date("2025-12-31") }, now)).toBe(false);
  });
});

describe("readSessionCookie", () => {
  it("reads the session cookie from a multi-cookie header", () => {
    const header = `theme=dark; ${SESSION_COOKIE_NAME}=abc123; other=1`;
    expect(readSessionCookie(header)).toBe("abc123");
  });

  it("returns null when the header is missing or has no session cookie", () => {
    expect(readSessionCookie(undefined)).toBeNull();
    expect(readSessionCookie("theme=dark")).toBeNull();
    expect(readSessionCookie(`${SESSION_COOKIE_NAME}=`)).toBeNull();
  });
});
