// Server/worker env. Keys never reach the browser (§26).
const TEST_RUN = process.env.VITEST === "true";
const ms = (env: string | undefined, real: number, test: number) => Number(env ?? (TEST_RUN ? test : real));

export const config = {
  apiKey: process.env.GRAPH8_API_KEY ?? "",
  baseUrl: process.env.GRAPH8_BASE_URL || undefined,
  workspaceId: process.env.GRAPH8_WORKSPACE_ID || process.env.EXPECTED_WORKSPACE_ID || undefined,
  testDomain: (process.env.TEST_DOMAIN ?? "crashtest.example").toLowerCase(),
  aiEnabled: process.env.GRAPH8_AI !== "off",
  aiTimeoutMs: Number(process.env.GRAPH8_AI_TIMEOUT_MS ?? 30_000),
  outboxTimeoutMs: ms(process.env.OUTBOX_TIMEOUT_MS, 180_000, 8_000),
  outboxPollMs: ms(process.env.OUTBOX_POLL_MS, 5_000, 300),
  negativeWaitMs: ms(process.env.NEGATIVE_WAIT_MS, 60_000, 5_000),
  concurrency: Number(process.env.GRAPH8_CONCURRENCY ?? 4),
  logLevel: process.env.LOG_LEVEL ?? "info",
};

export function isTestEmail(email: string) {
  return email.toLowerCase().endsWith("@" + config.testDomain);
}

/** Fake buyers only on TEST_DOMAIN; anything else throws (§26). */
export function assertTestEmail(email: string) {
  if (!isTestEmail(email)) throw new Error(`Safety: refusing to touch ${email}; fake buyers must use @${config.testDomain}`);
}
