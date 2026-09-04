import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "web",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration specs need PostgreSQL and Redis; they run via
    // `pnpm test:integration`, not as part of the default unit run.
    exclude: ["**/node_modules/**", "src/**/*.int.test.ts"],
  },
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
