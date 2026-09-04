import { defineConfig } from "vitest/config";

/**
 * Integration specs boot a real Socket.IO server against the
 * docker/compose/dev.yml PostgreSQL and Redis.
 */
export default defineConfig({
  test: {
    name: "realtime-integration",
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
