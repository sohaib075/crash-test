import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { __prisma?: PrismaClient };
export const prisma = (g.__prisma ??= new PrismaClient({ log: ["warn", "error"] }));

export * from "@prisma/client";

/**
 * One worker at a time: during a zero-downtime deploy the old container keeps running
 * until the new one is healthy. Holds a session advisory lock for the process lifetime;
 * a second worker waits here until the first one exits. If the lock's connection drops,
 * the process exits so the platform restarts it cleanly.
 */
export async function acquireWorkerLock(onWait: () => void) {
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  c.on("error", () => process.exit(1));
  const key = "hashtext('crash-test-worker')";
  const got = (await c.query(`SELECT pg_try_advisory_lock(${key}) AS ok`)).rows[0]?.ok;
  if (!got) {
    onWait();
    await c.query(`SELECT pg_advisory_lock(${key})`);
  }
  return c;
}

/** Wait for Postgres (it may still be starting under `npm run dev`). Uses a
 *  plain pg client so the boot-time retries don't print Prisma errors. */
export async function waitForDb(timeoutMs = 90_000) {
  const { default: pg } = await import("pg");
  const t0 = Date.now();
  for (;;) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    try {
      await c.connect();
      const r = await c.query("SELECT count(*)::int AS n FROM _prisma_migrations");
      if ((r.rows[0]?.n ?? 0) > 0) return;
    } catch {
      /* not up yet */
    } finally {
      await c.end().catch(() => {});
    }
    if (Date.now() - t0 > timeoutMs) throw new Error("Postgres is not reachable. Start it with: npm run db");
    await new Promise((r) => setTimeout(r, 1000));
  }
}
