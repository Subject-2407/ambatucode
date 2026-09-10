import { Redis } from "ioredis";

/**
 * Clears the login rate-limit counters before the suite runs.
 *
 * The suite signs in roughly ten times, and the limiter is deliberately strict
 * — ten attempts per username per five minutes. Two runs inside that window
 * exhaust a seed account's budget, and because a lockout returns exactly the
 * same generic error as a wrong password (by design, so accounts cannot be
 * enumerated) the third run fails looking like an authentication regression
 * rather than a spent quota.
 *
 * Clearing only the login counters, and only here, keeps that safety property
 * under test everywhere else: nothing in the suite raises the limit or bypasses
 * the limiter, it simply starts from a clean window.
 */
export default async function globalSetup(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });

  try {
    // KEYS rather than SCAN on purpose: this is a development database with a
    // handful of keys, and the setup should be over before the first browser
    // starts.
    const keys = await redis.keys("ratelimit:login:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } finally {
    await redis.quit();
  }
}
