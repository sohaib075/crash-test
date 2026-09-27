// Readiness (§07), demo reset (§06), Monday report (§10).
import { reportSummary } from "@crash/ai";
import { Prisma, prisma } from "@crash/db";
import { TEST_BY_ID, type Area, type ReadyDTO, type ReportDTO, type TestId } from "@crash/shared";
import { randomBytes } from "crypto";
import { config } from "../config";
import { call } from "../graph8/client";
import { runLog } from "../publish";
import type { Workspace } from "../types";
import { getBackend, loadSettings } from "./context";

import { rebaseline } from "./gate";
import { cleanupRun, discoverAndStore, distinctLeads, resettleAfterUndo, undoAndResettle } from "./run";
import { RECORD_ONLY } from "../tests/registry";

export async function readiness(opts: { lite?: boolean } = {}): Promise<ReadyDTO> {
  const checks: ReadyDTO["checks"] = [];
  const add = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, ok, detail });

  try {
    await prisma.$queryRaw`SELECT 1`;
    const m = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    add("db", "Database reachable, migrations applied", true, `${m[0]?.n ?? 0} migration(s) applied`);
  } catch (e) {
    add("db", "Database reachable, migrations applied", false, `Start Postgres: npm run db (${(e as Error).message.slice(0, 80)})`);
  }

  const hb = await prisma.heartbeat.findUnique({ where: { id: "worker" } }).catch(() => null);
  const age = hb ? Math.round((Date.now() - hb.at.getTime()) / 1000) : null;
  add("worker", "Worker alive", age != null && age < 30, age == null ? "No heartbeat yet. Start it: npm run dev:worker" : `Heartbeat ${age}s ago`);

  let ws: Workspace | null = null;
  let sandbox = true;
  try {
    await call("list_org_users_roles_org_users_get", undefined, { retries: 1 });
    const st = await getBackend().sandboxStatus();
    sandbox = st.sandbox;
    const match = !config.workspaceId || st.workspaceId === config.workspaceId;
    // A live key is fine in live-safe mode (read-only checks); it needs no write scopes then.
    const liveSafe = !st.sandbox && process.env.LIVE_SAFE_MODE !== "off";
    add("key", "graph8 key valid, correct workspace", (st.sandbox ? st.writable !== false : liveSafe) && match,
      `${st.name ?? ""} · ${st.sandbox ? "sandbox" : liveSafe ? `${st.keyMode ?? "live"} key: live-safe mode (read-only checks, no emails)` : `${st.keyMode ?? "live"} key, NOT a sandbox`}${st.sandbox && st.writable === false ? " · read-only scopes" : ""} · org ${st.workspaceId ?? "?"}${config.workspaceId && !match ? ` (expected ${config.workspaceId})` : ""}`);
  } catch (e) {
    add("key", "graph8 key valid, correct workspace", false, (e as Error).message);
  }

  if (opts.lite) return { ok: checks.every((c) => c.ok), checks };

  if (!sandbox && process.env.LIVE_SAFE_MODE !== "off") {
    add("outbox", "Outbox (sandbox only)", true, "Not used in live-safe mode: no emails are sent");
  } else {
    try {
      const r = (await call("sandbox_outbox_sandbox_outbox_get", { query: { limit: 1 } }, { retries: 1 })) as { count?: number };
      add("outbox", "Outbox reachable", true, `${r.count ?? 0} sends in the sandbox outbox`);
    } catch (e) {
      add("outbox", "Outbox reachable", false, (e as Error).message);
    }
  }

  try {
    ws = (await discoverAndStore()).ws;
    // Same rule as the quote check (T13): off by more than the tolerance in Settings.
    const tol = (await loadSettings()).quoteTolerancePct;
    const mismatched = ws.quotes.filter((q) => {
      const d = ws!.deals.find((x) => x.id === q.dealId);
      return q.total != null && d?.amount != null && d.amount > 0 && (Math.abs(q.total - d.amount) / d.amount) * 100 > tol;
    }).length;
    // The full demo needs its seeded flows; live-safe mode just needs something to check.
    const ok = !sandbox && process.env.LIVE_SAFE_MODE !== "off"
      ? ws.sequences.length + ws.quotes.length + ws.bookingLinks.length > 0
      : ws.sequences.length >= 3 && ws.quotes.length >= 1;
    add("demo", "Demo data present", ok, `${ws.sequences.length} sequences · ${ws.quotes.length} sent quotes (${mismatched} mismatched) · ${ws.bookingLinks.length} booking links · ${ws.deals.length} open deals`);
  } catch (e) {
    add("demo", "Demo data present", false, (e as Error).message);
  }

  const cached = await prisma.llmCache.count().catch(() => 0);
  add("ai", "AI reachable, cache warm", true, config.aiEnabled && !config.apiKey ? "graph8 copilot waits for the key; rules fallback is on" : config.aiEnabled ? `graph8 copilot · ${cached} cached answers${cached ? "" : " (first run warms it)"} · rules fallback always on` : "AI off: deterministic rules");

  const left = await prisma.fakeBuyer.count({ where: { cleanedUp: false } }).catch(() => -1);
  add("buyers", "No fake buyers left over", left === 0, left === 0 ? "0 fake buyers" : `${left} fake buyers not cleaned up. Press "Reset demo".`);

  return { ok: checks.every((c) => c.ok), checks };
}

/** Clean up buyers, undo every applied fix (resumes sequences, restores the planted problems), rebaseline the gate. */
export async function demoReset() {
  const log: string[] = [];
  const live = await prisma.run.findMany({ where: { status: { in: ["QUEUED", "PLANNING", "RUNNING"] } } });
  await prisma.run.updateMany({ where: { id: { in: live.map((r) => r.id) } }, data: { status: "FAILED", error: "Stopped by demo reset", finishedAt: new Date() } });
  await prisma.testResult.updateMany({ where: { runId: { in: live.map((r) => r.id) }, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "ERROR", error: "Stopped by demo reset" } });
  if (live.length) log.push(`Stopped ${live.length} run${live.length === 1 ? "" : "s"} in progress`);
  const cleaned = await cleanupRun();
  log.push(`Cleaned up ${cleaned} fake buyers`);
  const applied = await prisma.fix.findMany({ where: { status: "APPLIED" }, orderBy: { appliedAt: "desc" } });
  let undone = 0;
  const skipped = new Map<string, number>();
  for (const f of applied) {
    try {
      await undoAndResettle(f.id);
      undone++;
    } catch (e) {
      const why = `${f.action}: ${(e as Error).message}`;
      skipped.set(why, (skipped.get(why) ?? 0) + 1);
      await prisma.fix.update({ where: { id: f.id }, data: { status: "UNDONE", undoneAt: new Date(), error: (e as Error).message } });
      if (!RECORD_ONLY.has(f.action)) await resettleAfterUndo(f.resultId).catch(() => {});
    }
  }
  log.push(`Undid ${undone} fixes (sequences resumed, planted problems restored)`);
  for (const [why, n] of skipped) log.push(`Skipped ${n} × ${why}`);
  await discoverAndStore().catch(() => {});
  await rebaseline().catch(() => {});
  log.push("Gate baseline refreshed");
  return { ok: true, log };
}

/** Biggest pipeline first, then newest; one row per test + target (a finding repeated across runs counts once). */
function topIssues<T extends { testId: string; targetId: string; pipelineAtRisk: unknown; createdAt: Date }>(rows: T[], n = 8) {
  const seen = new Set<string>();
  return [...rows]
    .sort((a, b) => Number(b.pipelineAtRisk ?? 0) - Number(a.pipelineAtRisk ?? 0) || b.createdAt.getTime() - a.createdAt.getTime())
    .filter((r) => {
      const k = `${r.testId}|${r.targetId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, n);
}

export async function buildReport(days = 7): Promise<ReportDTO> {
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - days * 864e5);
  const results = await prisma.testResult.findMany({ where: { run: { startedAt: { gte: periodStart }, trigger: { in: ["MANUAL", "GATE"] } } }, include: { run: true } });
  const failedFirst = results.filter((r) => ["FAIL", "NEEDS_APPROVAL", "FIXED"].includes(r.status));
  const fixed = results.filter((r) => r.status === "FIXED");
  const leadsProtected = distinctLeads(fixed);
  // Protected pipeline: distinct open deals behind fixed results, plus deals whose quote was flagged.
  const protectedRows = [...fixed, ...results.filter((r) => r.testId === "T13" && r.status !== "PASS" && r.status !== "FIXED")];
  const amounts = new Map<string, number>();
  for (const r of protectedRows) {
    const ws = r.run.plan ? (r.run.plan as unknown as { ws: Workspace }).ws : null;
    // No linked deal (e.g. a quote alone): count the finding once, not once per run.
    if (!r.dealIds.length) { const k = `finding:${r.testId}|${r.targetId}`; if (!amounts.has(k)) amounts.set(k, Number(r.pipelineAtRisk ?? 0)); continue; }
    for (const id of r.dealIds) if (!amounts.has(id)) amounts.set(id, ws?.deals.find((d) => d.id === id)?.amount ?? 0);
  }
  const pipelineSaved = [...amounts.values()].reduce((a, b) => a + b, 0);
  const top = [...failedFirst].sort((a, b) => Number(b.pipelineAtRisk ?? 0) - Number(a.pipelineAtRisk ?? 0))[0];
  const numbers = { testsRun: results.length, failures: failedFirst.length, autoFixed: fixed.length, leadsProtected, pipelineSaved, topIssue: top ? (top.problem ?? top.summary ?? undefined) : undefined };
  const summary = await reportSummary(numbers);
  const byArea = (["SELL", "BOOK", "BILL", "HYGIENE"] as Area[]).map((area) => ({
    area, tests: results.filter((r) => r.area === area).length,
    failures: failedFirst.filter((r) => r.area === area).length, fixed: fixed.filter((r) => r.area === area).length,
    passed: results.filter((r) => r.area === area && r.status === "PASS").length,
    errors: results.filter((r) => r.area === area && r.status === "ERROR").length,
  }));
  const latest = await prisma.healthScore.findMany({ distinct: ["sequenceId"], orderBy: { createdAt: "desc" }, include: { sequence: true } });
  const data = {
    byArea,
    topIssues: topIssues(failedFirst).map((r) => ({ testId: r.testId as TestId, testName: TEST_BY_ID[r.testId as TestId].name, target: r.targetName, summary: r.problem ?? r.summary ?? r.actual ?? "", status: r.status, pipelineAtRisk: Number(r.pipelineAtRisk ?? 0) })),
    health: latest.map((h) => ({ name: h.sequence.name, score: h.score, band: h.band })),
  };
  const ws = await prisma.workspace.findFirst({ orderBy: { discoveredAt: "desc" } });
  const row = await prisma.report.create({
    data: {
      workspaceId: ws!.id, periodStart, periodEnd, testsRun: numbers.testsRun, failures: numbers.failures, autoFixed: numbers.autoFixed,
      leadsProtected, pipelineSaved, summary, data: data as unknown as Prisma.InputJsonValue,
    },
  });
  return reportDTO(row);
}

export function reportDTO(r: Prisma.ReportGetPayload<object>): ReportDTO {
  return {
    id: r.id, periodStart: r.periodStart.toISOString(), periodEnd: r.periodEnd.toISOString(), testsRun: r.testsRun, failures: r.failures,
    autoFixed: r.autoFixed, leadsProtected: r.leadsProtected, pipelineSaved: Number(r.pipelineSaved), summary: r.summary,
    graph8TaskId: r.graph8TaskId, shareToken: r.shareToken, createdAt: r.createdAt.toISOString(), data: r.data as ReportDTO["data"],
  };
}

export async function saveReportToGraph8(id: string) {
  const r = await prisma.report.findUniqueOrThrow({ where: { id } });
  if (r.graph8TaskId) return reportDTO(r);
  const d = reportDTO(r);
  const body = `${r.summary}\n\nTests run: ${r.testsRun}\nFailures: ${r.failures}\nFixed and re-tested: ${r.autoFixed}\nLeads protected: ${r.leadsProtected}\nPipeline protected: $${Math.round(Number(r.pipelineSaved)).toLocaleString("en-US")}\n\n${d.data.topIssues.map((i) => `• ${i.testName} — ${i.target}: ${i.summary}`).join("\n")}`;
  const taskId = await getBackend().createTask({ title: `Crash Test Monday report (${r.periodEnd.toDateString()})`, body });
  return reportDTO(await prisma.report.update({ where: { id }, data: { graph8TaskId: taskId } }));
}

export async function shareReport(id: string) {
  const r = await prisma.report.findUniqueOrThrow({ where: { id } });
  if (r.shareToken) return reportDTO(r);
  return reportDTO(await prisma.report.update({ where: { id }, data: { shareToken: randomBytes(32).toString("hex") } }));
}

export { runLog };
