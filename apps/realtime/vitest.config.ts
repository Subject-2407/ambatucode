import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "realtime",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/**/*.int.test.ts"],
  },
});
