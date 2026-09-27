// Test harness: real Postgres (crashtest_test), real engine, in-memory graph8
// double, and an inline queue that runs jobs like the worker does.
import { approveFix, cleanupRun, executeTest, failRun, finalizeRun, JOBS, planRun, resetOutboxCache, retestJob, runFixPhase, setBackend, type Queue } from "@crash/core";
import { mockBackend, resetMock } from "../packages/core/src/mock";
import { prisma } from "@crash/db";
import { seedDefaults } from "../packages/db/src/seed";

setBackend(mockBackend);

const pending: Promise<unknown>[] = [];
export const jobErrors: unknown[] = [];

export const queue: Queue = {
  async send(name, data) {
    const d = data as Record<string, string>;
    const handlers: Record<string, () => Promise<unknown>> = {
      [JOBS.plan]: () => planRun(queue, d.runId).catch((e) => failRun(d.runId, (e as Error).message)),
      [JOBS.retest]: () => retestJob(queue, d.resultId),
      [JOBS.test]: () => executeTest(queue, d.resultId),
      [JOBS.fix]: () => approveFix(queue, d.fixId),
      [JOBS.fixes]: () => runFixPhase(queue, d.runId),
      [JOBS.finalize]: () => finalizeRun(queue, d.runId),
      [JOBS.cleanup]: () => cleanupRun(d.runId),
    };
    const p = new Promise((r) => setImmediate(r)).then(() => handlers[name]?.()).catch((e) => jobErrors.push(e));
    pending.push(p);
    return "job";
  },
};

export async function drain() {
  while (pending.length) await Promise.all(pending.splice(0));
}

export async function resetAll() {
  resetMock();
  resetOutboxCache();
  jobErrors.length = 0;
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await seedDefaults();
}

export async function setModes(modes: Record<string, "AUTOPILOT" | "APPROVE" | "OFF">) {
  for (const [action, mode] of Object.entries(modes)) {
    await prisma.fixModeSetting.update({ where: { action: action as never }, data: { mode } });
  }
}

export const DEMO_MODES = {
  PAUSE_SEQUENCE: "AUTOPILOT", WITHDRAW_CONTACT: "AUTOPILOT", ADD_SUPPRESSION: "AUTOPILOT",
  REOWN_VIA_LIST: "APPROVE", CREATE_TASK: "AUTOPILOT", ADD_DEAL_NOTE: "APPROVE",
} as const;
