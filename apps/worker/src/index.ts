// Worker: pg-boss jobs (§21). Every job re-reads the DB first, so retries and
// restarts are safe. Heartbeat every 10 s for /ready.
import {
  approveFix, cleanupRun, config, executeTest, failRun, finalizeRun, gateTick, JOBS, loadSettings, log, maybeFinalize, planRun, retestJob, runFixPhase, type Queue,
} from "@crash/core";
import { acquireWorkerLock, prisma, waitForDb } from "@crash/db";
import PgBoss from "pg-boss";

async function main() {
  await waitForDb();
  // Before resuming anything: only one worker may run (overlapping deploys).
  await acquireWorkerLock(() => log.info("Another worker is running; waiting for it to stop…"));
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss" });
  boss.on("error", (e) => log.error(e, "pg-boss"));
  await boss.start();
  for (const name of Object.values(JOBS)) await boss.createQueue(name).catch(() => {});
  const q: Queue = { send: (name, data, opts) => boss.send(name, data, opts ?? {}) };

  const safe = (name: string, fn: (data: Record<string, string>) => Promise<unknown>) =>
    async (jobs: PgBoss.Job<Record<string, string>>[]) => {
      for (const j of jobs) {
        try {
          await fn(j.data);
        } catch (err) {
          log.error({ err, job: name, data: j.data }, "job failed");
          if (name === JOBS.plan) {
            // The run can't be planned: fail it cleanly (resolves a gate event, cleans up) instead of retrying into a no-op.
            await failRun(j.data.runId, (err as Error).message);
            return;
          }
          throw err;
        }
      }
    };

  // Before any job runs: a fix claimed (appliedAt) but never applied by a killed worker can be applied again.
  const claims = await prisma.fix.updateMany({ where: { status: "PROPOSED", appliedAt: { not: null } }, data: { appliedAt: null } });
  if (claims.count) log.info({ fixes: claims.count }, "Released interrupted fix claims");
  // Resume, before any handler starts (so a job picked up now is never mistaken for an interrupted one):
  // tests stuck RUNNING from a killed worker go back on the queue (E7). Results held RUNNING by an
  // interrupted fix phase are not re-tested; the fixes job re-sent below settles them.
  const stuck = await prisma.testResult.findMany({ where: { status: { in: ["QUEUED", "RUNNING"] }, run: { status: "RUNNING", fixPhase: false } } });
  for (const r of stuck) {
    await prisma.testResult.update({ where: { id: r.id }, data: { status: "QUEUED" } });
    await q.send(JOBS.test, { resultId: r.id }, { singletonKey: `resume-${r.id}-${Date.now()}` });
  }
  const planning = await prisma.run.findMany({ where: { status: { in: ["QUEUED", "PLANNING"] } } });
  for (const r of planning) {
    await prisma.run.update({ where: { id: r.id }, data: { status: "QUEUED" } });
    await q.send(JOBS.plan, { runId: r.id }, { singletonKey: `resume-${r.id}-${Date.now()}` });
  }
  const fixing = await prisma.run.findMany({ where: { status: "RUNNING", fixPhase: true } });
  for (const r of fixing) await q.send(JOBS.fixes, { runId: r.id }, { singletonKey: `resume-fixes-${r.id}-${Date.now()}` });
  // A worker killed between a test's last status and maybeFinalize: finish those runs.
  const idle = await prisma.run.findMany({ where: { status: "RUNNING", fixPhase: false } });
  for (const r of idle) await maybeFinalize(q, r.id);
  if (stuck.length || planning.length) log.info({ tests: stuck.length, runs: planning.length }, "Resumed interrupted work");

  await boss.work(JOBS.plan, { pollingIntervalSeconds: 0.5 }, safe(JOBS.plan, (d) => planRun(q, d.runId)));
  // Several tests in parallel; the graph8 client caps concurrent calls at 4.
  for (let i = 0; i < 6; i++) await boss.work(JOBS.test, { pollingIntervalSeconds: 0.5 }, safe(JOBS.test, (d) => executeTest(q, d.resultId)));
  await boss.work(JOBS.fix, { pollingIntervalSeconds: 0.5 }, safe(JOBS.fix, (d) => approveFix(q, d.fixId)));
  await boss.work(JOBS.fixes, { pollingIntervalSeconds: 0.5 }, safe(JOBS.fixes, (d) => runFixPhase(q, d.runId)));
  await boss.work(JOBS.finalize, { pollingIntervalSeconds: 0.5 }, safe(JOBS.finalize, (d) => finalizeRun(q, d.runId)));
  await boss.work(JOBS.retest, { pollingIntervalSeconds: 0.5 }, safe(JOBS.retest, (d) => retestJob(q, d.resultId)));
  await boss.work(JOBS.cleanup, { pollingIntervalSeconds: 1 }, safe(JOBS.cleanup, (d) => cleanupRun(d.runId)));

  // Heartbeat (§07) and gate watch (§21) on timers.
  const beat = () => prisma.heartbeat.upsert({ where: { id: "worker" }, create: { id: "worker", at: new Date() }, update: { at: new Date() } }).catch(() => {});
  await beat();
  setInterval(beat, 10_000);

  let gateBusy = false;
  const gateLoop = async () => {
    const s = await loadSettings().catch(() => null);
    setTimeout(gateLoop, (s?.gatePollSec ?? 20) * 1000);
    if (!s?.gateEnabled || gateBusy || !config.apiKey) return;
    gateBusy = true;
    try {
      await gateTick(q);
    } catch (err) {
      log.warn({ err }, "gate tick failed");
    } finally {
      gateBusy = false;
    }
  };
  setTimeout(gateLoop, 5000);

  log.info("Crash Test worker running");
  const stop = async () => {
    await boss.stop({ graceful: true, timeout: 5000 }).catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  log.error(e);
  process.exit(1);
});
