import { Redis } from "ioredis";

/**
 * Routes the suite visits, compiled once before the first test.
 *
 * `next dev` compiles a route the first time it is requested, and a cold
 * compile of a heavy screen takes longer than a whole test is allowed. Without
 * this the first spec to open a screen fails on a timeout that says nothing
 * about the screen — and the same spec passes on the next run, which is the
 * worst kind of flake to chase.
 *
 * An unauthenticated request compiles the route and redirects to the login
 * page, which is all that is needed here.
 */
const WARM_ROUTES = [
  "/login",
  "/dashboard",
  "/modules",
  "/submissions",
  "/achievements",
  "/profile",
  "/manage/modules",
  "/manage/grades",
  "/admin/users",
];

/**
 * Route handlers are compiled on first request too, and those are the ones
 * that actually bite: a screen renders its skeleton immediately and then waits
 * on a fetch that is quietly compiling, so the failure looks like missing data
 * rather than a cold build.
 *
 * The id in each path is a placeholder. Every handler authenticates before it
 * reads a parameter, so an unauthenticated request compiles the module and
 * comes back 401 without touching the database — which is all that is wanted
 * here. A method the route does not export answers 405, and Next has to
 * compile the module to know that, so POST-only routes warm from a GET.
 */
const WARM_API_ROUTES = [
  "/api/auth/me",
  "/api/modules",
  "/api/me/submissions",
  "/api/modules/warm/grades",
  "/api/modules/warm/grades/export",
  "/api/modules/warm/leaderboard",
  "/api/modules/warm/enroll",
  "/api/modules/warm/sections",
  "/api/sections/warm/leaderboard",
  "/api/sections/warm/assessments",
  "/api/assessments/warm/grades",
  "/api/assessments/warm/leaderboard",
  "/api/assessments/warm/test-cases",
  "/api/assessments/warm/sessions",
  "/api/sessions/warm/start",
  "/api/sessions/warm/attempt/start",
  "/api/attempts/warm",
  "/api/attempts/warm/draft",
  "/api/attempts/warm/submit",
  "/api/attempts/warm/reset",
  "/api/attempts/warm/official",
  "/api/submissions/warm",
  "/api/users/warm/achievements",
];

async function warmRoutes(baseUrl: string): Promise<void> {
  await Promise.all(
    [...WARM_ROUTES, ...WARM_API_ROUTES].map((route) =>
      fetch(`${baseUrl}${route}`, { redirect: "manual" }).catch(() => undefined),
    ),
  );
}

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
 *
 * It also compiles every route the suite touches, so that no test pays for a
 * cold dev build inside its own timeout.
 */
export default async function globalSetup(): Promise<void> {
  await warmRoutes(process.env.E2E_BASE_URL ?? "http://localhost:3000");

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
