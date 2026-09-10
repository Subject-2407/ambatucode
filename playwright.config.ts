import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite for apps/web.
 *
 * The infrastructure must be up before this runs — PostgreSQL and Redis from
 * docker/compose/dev.yml, migrated and seeded — because these specs exercise
 * real sessions against the real database. There is no mocked API layer: the
 * behaviour under test (one active session per account) lives in the server,
 * and a mock could not disprove it.
 *
 *   docker compose -f docker/compose/dev.yml up -d
 *   pnpm db:migrate && pnpm db:seed
 *   pnpm test:e2e
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const REALTIME_URL = process.env.E2E_REALTIME_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalSetup: "./e2e/global-setup.ts",
  /**
   * Both Node apps, because single-active-session is only observable when they
   * are both up: apps/web revokes the row and publishes on Redis, but the first
   * browser only finds out when apps/realtime drops its socket. With the
   * realtime server absent the client sees a plain transport error, which it
   * deliberately ignores as a blip, and the supersede notice never appears.
   *
   * Each entry reuses a server the developer already has running.
   */
  webServer: [
    {
      command: "pnpm --filter web dev",
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter realtime dev",
      url: `${REALTIME_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
