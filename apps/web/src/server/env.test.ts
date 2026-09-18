import { afterEach, describe, expect, it, vi } from "vitest";

/** The schema's required fields; each case stubs only what it is testing. */
const REQUIRED = {
  DATABASE_URL: "postgresql://test/test",
  REDIS_URL: "redis://localhost:6379",
  EXECUTION_CALLBACK_SECRET: "a".repeat(48),
  INTERNAL_API_SECRET: "b".repeat(48),
};

/**
 * getServerEnv caches on first read, so varying the environment means rebuilding
 * the module rather than merely reassigning process.env.
 */
async function loadEnv(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...REQUIRED, ...overrides })) {
    vi.stubEnv(key, value);
  }
  return import("./env");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isSessionCookieSecure", () => {
  it("follows production when the override is unset", async () => {
    const env = await loadEnv({ NODE_ENV: "production", SESSION_COOKIE_SECURE: undefined });
    expect(env.isSessionCookieSecure()).toBe(true);
  });

  it("follows development when the override is unset", async () => {
    const env = await loadEnv({ NODE_ENV: "development", SESSION_COOKIE_SECURE: undefined });
    expect(env.isSessionCookieSecure()).toBe(false);
  });

  /**
   * The case the override exists for: a production build served on a lab LAN
   * over plain HTTP, where the browser discards a Secure cookie and every login
   * loops back to the sign-in page.
   */
  it("drops Secure in production when explicitly disabled", async () => {
    const env = await loadEnv({ NODE_ENV: "production", SESSION_COOKIE_SECURE: "false" });
    expect(env.isSessionCookieSecure()).toBe(false);
    expect(env.isProduction()).toBe(true);
  });

  it("forces Secure outside production when explicitly enabled", async () => {
    const env = await loadEnv({ NODE_ENV: "development", SESSION_COOKIE_SECURE: "true" });
    expect(env.isSessionCookieSecure()).toBe(true);
  });

  it("refuses a value that is neither true nor false", async () => {
    const env = await loadEnv({ NODE_ENV: "production", SESSION_COOKIE_SECURE: "yes" });
    expect(() => env.isSessionCookieSecure()).toThrow(/SESSION_COOKIE_SECURE/);
  });
});
