import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    env: {
      GRAPH8_API_KEY: "",
      DATABASE_URL: "postgresql://crash:crash@localhost:5432/crashtest_test",
      LOG_LEVEL: "warn",
      GRAPH8_AI: "off",
    },
  },
});
