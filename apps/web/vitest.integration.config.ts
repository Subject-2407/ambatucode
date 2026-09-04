import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Integration specs run against the docker/compose/dev.yml PostgreSQL and
 * Redis. They share one database, so they run serially and clean up the rows
 * they create.
 */
export default defineConfig({
  test: {
    name: "web-integration",
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
