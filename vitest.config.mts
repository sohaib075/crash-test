import { existsSync, readFileSync } from "fs";
import { defineConfig } from "vitest/config";

// Tests run against a separate "<name>_test" database on the SAME server as
// DATABASE_URL in .env (built-in, local PostgreSQL 18, or hosted), so they never
// touch app data. TEST_DATABASE_URL overrides. tests/global-setup.ts creates and
// migrates it before the run.
function envFile(): Record<string, string> {
  if (!existsSync(".env")) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? envFile().DATABASE_URL ?? "postgresql://crash:crash@localhost:5432/crashtest";
const u = new URL(base);
const name = u.pathname.replace(/^\//, "") || "crashtest";
if (!process.env.TEST_DATABASE_URL && !name.endsWith("_test")) u.pathname = `/${name}_test`;
const testUrl = u.toString();
process.env.CRASH_TEST_DATABASE_URL = testUrl; // read by global-setup (same process)

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    env: {
      GRAPH8_API_KEY: "",
      DATABASE_URL: testUrl,
      LOG_LEVEL: "warn",
      GRAPH8_AI: "off",
    },
  },
});
