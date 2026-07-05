import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
  },
});
