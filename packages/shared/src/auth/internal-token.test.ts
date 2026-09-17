import { describe, expect, it } from "vitest";
import {
  autoSubmitScope,
  expireSessionScope,
  isInternalTokenValid,
  issueInternalToken,
} from "./internal-token";

const SECRET = "internal-secret-for-tests-only-0123456789";
const NOW = 1_700_000_000_000;

describe("internal token", () => {
  it("verifies for the scope it was issued for", () => {
    const token = issueInternalToken(SECRET, autoSubmitScope("attempt-1"), NOW);
    expect(isInternalTokenValid(SECRET, autoSubmitScope("attempt-1"), token, NOW)).toBe(true);
  });

  it("cannot be replayed against another attempt or another action", () => {
    const token = issueInternalToken(SECRET, autoSubmitScope("attempt-1"), NOW);
    expect(isInternalTokenValid(SECRET, autoSubmitScope("attempt-2"), token, NOW)).toBe(false);
    expect(isInternalTokenValid(SECRET, expireSessionScope("attempt-1"), token, NOW)).toBe(false);
  });

  it("is refused with a different secret", () => {
    const token = issueInternalToken(
      "some-other-secret-0123456789abcdef",
      autoSubmitScope("a"),
      NOW,
    );
    expect(isInternalTokenValid(SECRET, autoSubmitScope("a"), token, NOW)).toBe(false);
  });

  it("expires", () => {
    const token = issueInternalToken(SECRET, autoSubmitScope("a"), NOW);
    expect(isInternalTokenValid(SECRET, autoSubmitScope("a"), token, NOW + 60 * 60 * 1000)).toBe(
      false,
    );
  });

  it("cannot have its expiry extended without re-signing", () => {
    const token = issueInternalToken(SECRET, autoSubmitScope("a"), NOW);
    const [, signature] = token.split(".");
    const forged = `${NOW + 10 * 60 * 60 * 1000}.${signature}`;
    expect(isInternalTokenValid(SECRET, autoSubmitScope("a"), forged, NOW)).toBe(false);
  });

  it.each(["", "garbage", ".", "123.", "abc.def"])("rejects the malformed token %j", (token) => {
    expect(isInternalTokenValid(SECRET, autoSubmitScope("a"), token, NOW)).toBe(false);
  });
});
