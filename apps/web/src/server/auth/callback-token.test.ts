import { beforeAll, describe, expect, it, vi } from "vitest";
import { isAppError } from "@ambatucode/shared";
import { inspectCallbackToken, issueCallbackToken, verifyCallbackToken } from "./callback-token";

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://test/test");
  vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  vi.stubEnv("EXECUTION_CALLBACK_SECRET", "a".repeat(48));
  vi.stubEnv("INTERNAL_API_SECRET", "b".repeat(48));
});

function expectForbidden(action: () => void): void {
  try {
    action();
  } catch (error) {
    expect(isAppError(error) && error.code).toBe("FORBIDDEN");
    return;
  }
  throw new Error("Expected the token to be rejected");
}

describe("execution callback token", () => {
  it("accepts a token it just issued for the same job", () => {
    const token = issueCallbackToken("job-1");
    expect(() => verifyCallbackToken("job-1", token)).not.toThrow();
  });

  it("rejects a token minted for a different job", () => {
    const token = issueCallbackToken("job-1");
    expectForbidden(() => verifyCallbackToken("job-2", token));
  });

  it("rejects a tampered signature", () => {
    const token = issueCallbackToken("job-1");
    const [expiry, signature] = token.split(".");
    const flipped = signature?.startsWith("0")
      ? `1${signature.slice(1)}`
      : `0${signature?.slice(1)}`;
    expectForbidden(() => verifyCallbackToken("job-1", `${expiry}.${flipped}`));
  });

  it("rejects a token whose expiry was extended without re-signing", () => {
    const token = issueCallbackToken("job-1");
    const signature = token.slice(token.indexOf(".") + 1);
    expectForbidden(() => verifyCallbackToken("job-1", `${Date.now() + 86_400_000}.${signature}`));
  });

  it("rejects an expired token", () => {
    const issuedAt = Date.now() - 60 * 60 * 1000;
    const token = issueCallbackToken("job-1", issuedAt);
    expectForbidden(() => verifyCallbackToken("job-1", token));
  });

  it("recognises a late token as genuine, and only a genuine one", () => {
    const stale = issueCallbackToken("job-1", Date.now() - 60 * 60 * 1000);
    expect(inspectCallbackToken("job-1", stale)).toBe("EXPIRED");
    expect(inspectCallbackToken("job-1", issueCallbackToken("job-1"))).toBe("VALID");
    // A stale token for another job is not proof of anything about this one.
    expectForbidden(() => inspectCallbackToken("job-2", stale));
  });

  it("rejects malformed tokens", () => {
    expectForbidden(() => verifyCallbackToken("job-1", ""));
    expectForbidden(() => verifyCallbackToken("job-1", "no-separator"));
    expectForbidden(() => verifyCallbackToken("job-1", "notanumber.abcdef"));
  });
});
