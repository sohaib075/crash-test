import PgBoss from "pg-boss";
import { JOBS, type Queue } from "@crash/core";

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss" });
  boss.on("error", (e) => console.error("pg-boss", e));
  await boss.start();
  for (const name of Object.values(JOBS)) await boss.createQueue(name).catch(() => {});
  return boss;
}

/** Stop the queue on shutdown, only if this process ever started it. */
export async function stopBoss() {
  if (boss) await boss.stop({ graceful: true, timeout: 5000 }).catch(() => {});
}

export const queue: Queue = {
  async send(name, data, opts) {
    return (await getBoss()).send(name, data, opts ?? {});
  },
};
