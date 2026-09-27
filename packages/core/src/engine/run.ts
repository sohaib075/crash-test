// Run lifecycle (§16 request flow, §21 jobs). Every step is saved before and
// after, and every job re-reads the DB first, so pg-boss retries and worker
// restarts are safe (§06).
import { explain, plan as aiPlan, templateExplain } from "@crash/ai";
import { Prisma, prisma, type FixMode } from "@crash/db";
import { band, TEST_BY_ID, TERMINAL, type Area, type FixAction, type RunTrigger, type TestId } from "@crash/shared";
import { log } from "../log";
import { publish, runLog } from "../publish";
import { RECORD_ONLY, REGISTRY } from "../tests/registry";
import type { Outcome, ProposedFix, Scratch, Target } from "../tests/types";
import type { Workspace } from "../types";
import { getBackend, loadSettings, makeCtx } from "./context";
import { applyFix } from "./fixes";

export interface Queue {
  send(name: string, data: object, opts?: { singletonKey?: string; startAfter?: number; retryLimit?: number; retryDelay?: number; retryBackoff?: boolean; priority?: number }): Promise<string | null>;
}
export const JOBS = {
  plan: "run.plan",
  test: "test.execute",
  fix: "fix.apply",
  fixes: "run.fixes",
  finalize: "run.finalize",
  retest: "result.retest",
  cleanup: "cleanup.run",
  gate: "gate.watch",
  report: "report.build",
} as const;

// ---------------------------------------------------------------- start
export async function startRun(q: Queue, input: { trigger?: RunTrigger; testIds?: TestId[]; areas?: Area[]; targetIds?: string[] } = {}) {
  const ws = await prisma.workspace.findFirst({ orderBy: { discoveredAt: "desc" } })
    ?? (await prisma.workspace.create({ data: { graph8Id: "pending", name: "graph8 workspace" } }));
  const defs = await prisma.testDefinition.findMany({ where: { enabled: true } });
  let testIds = (input.testIds?.length ? input.testIds : defs.map((d) => d.id as TestId)).filter((id) => REGISTRY[id]);
  if (input.areas?.length) testIds = testIds.filter((id) => input.areas!.includes(TEST_BY_ID[id].area));
  const run = await prisma.run.create({
    data: { workspaceId: ws.id, trigger: input.trigger ?? "MANUAL", testIds, targetIds: input.targetIds ?? [] },
  });
  await publish({ type: "run:updated", runId: run.id, status: run.status });
  await q.send(JOBS.plan, { runId: run.id }, { singletonKey: run.id, retryLimit: 2, retryBackoff: true });
  return run;
}

// ---------------------------------------------------------------- discover
export async function discoverAndStore(): Promise<{ ws: Workspace; workspaceId: string }> {
  const ws = await getBackend().discover();
  const row = await prisma.workspace.upsert({
    where: { graph8Id: ws.graph8Id || "unknown" },
    create: { graph8Id: ws.graph8Id || "unknown", name: ws.name, discoveredAt: new Date(), summary: ws as unknown as Prisma.InputJsonValue },
    update: { name: ws.name, discoveredAt: new Date(), summary: ws as unknown as Prisma.InputJsonValue },
  });
  for (const s of ws.sequences) {
    await prisma.sequence.upsert({
      where: { graph8Id: s.id },
      create: { graph8Id: s.id, workspaceId: row.id, name: s.name, status: s.status, priority: s.priority, raw: s.raw as Prisma.InputJsonValue },
      update: { workspaceId: row.id, name: s.name, status: s.status, priority: s.priority, raw: s.raw as Prisma.InputJsonValue },
    });
  }
  return { ws, workspaceId: row.id };
}

export function wsOf(run: { plan: Prisma.JsonValue }): Workspace {
  return (run.plan as unknown as { ws: Workspace }).ws;
}

// ---------------------------------------------------------------- plan
export async function planRun(q: Queue, runId: string) {
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "QUEUED" && run.status !== "PLANNING") return;
  await prisma.run.update({ where: { id: runId }, data: { status: "PLANNING" } });
  await publish({ type: "run:updated", runId, status: "PLANNING" });

  const st = await getBackend().sandboxStatus();
  if (!st.sandbox) throw new Error("Safety: this key is not a sandbox workspace; refusing to run.");
  await runLog(runId, "Discovering sequences, steps, users, deals, quotes and booking links…");
  const { ws, workspaceId } = await discoverAndStore();
  if (process.env.GRAPH8_WORKSPACE_ID && ws.graph8Id && ws.graph8Id !== process.env.GRAPH8_WORKSPACE_ID) {
    throw new Error(`Safety: workspace ${ws.graph8Id} is not the demo workspace.`);
  }
  const n = (c: number, w: string) => `${c} ${w}${c === 1 ? "" : "s"}`;
  await runLog(runId, `Found ${n(ws.sequences.length, "sequence")}, ${n(ws.quotes.length, "sent quote")}, ${n(ws.deals.length, "open deal")}, ${n(ws.bookingLinks.length, "booking link")}, ${n(ws.users.length, "team member")}.`);

  const settings = await loadSettings();
  const candidates: (Target & { testId: TestId })[] = [];
  for (const id of run.testIds as TestId[]) {
    for (const t of REGISTRY[id]?.targets(ws, settings) ?? []) {
      if (run.targetIds.length && !run.targetIds.some((x) => t.id === x || t.id.split("+").includes(x))) continue;
      candidates.push({ ...t, testId: id });
    }
  }
  await runLog(runId, "Planning which checks apply to which flows…");
  const summary = ws.sequences.map((s) => `- ${s.name} (${s.status}, ${s.steps.length} steps)`).join("\n") + `\nQuotes: ${ws.quotes.length}. Deals: ${ws.deals.length}.`;
  const planned = run.trigger === "GATE"
    ? { tests: candidates.map((c) => ({ testId: c.testId, targetType: c.type, targetId: c.id, targetName: c.name, why: c.why })), source: "rules" }
    : await aiPlan(candidates.map((c) => ({ testId: c.testId, targetType: c.type, targetId: c.id, targetName: c.name, why: c.why })), summary);

  await prisma.run.update({ where: { id: runId }, data: { workspaceId, plan: { ws, source: planned.source, tests: planned.tests } as unknown as Prisma.InputJsonValue } });
  for (const t of planned.tests) {
    const def = TEST_BY_ID[t.testId as TestId];
    await prisma.testResult.upsert({
      where: { runId_testId_targetId: { runId, testId: t.testId, targetId: t.targetId } },
      create: { runId, testId: t.testId, area: def.area, targetType: t.targetType, targetId: t.targetId, targetName: t.targetName, expected: def.blurb },
      update: {},
    });
  }
  await prisma.run.update({ where: { id: runId }, data: { status: "RUNNING" } });
  await publish({ type: "run:updated", runId, status: "RUNNING" });
  await runLog(runId, `Planned ${planned.tests.length} checks (${planned.source === "rules" ? "rules" : "graph8 AI"}).`);

  const results = await prisma.testResult.findMany({ where: { runId } });
  if (!results.length) return finalizeRun(q, runId);
  // Fast read-only checks first so the board fills while sends are pending.
  for (const r of results) {
    const fast = !TEST_BY_ID[r.testId as TestId].waitsOnSends;
    await q.send(JOBS.test, { resultId: r.id }, { singletonKey: r.id, priority: fast ? 10 : 0, retryLimit: 2, retryDelay: 5, retryBackoff: true });
    await publish({ type: "result:updated", runId, resultId: r.id, testId: r.testId as TestId, area: r.area, status: r.status });
  }
}

// ---------------------------------------------------------------- execute
function dealsFor(ws: Workspace, contactIds: string[]) {
  const set = new Set(contactIds);
  return ws.deals.filter((d) => d.open && d.contactIds.some((c) => set.has(c)));
}

async function saveOutcome(resultId: string, o: Outcome, ws: Workspace, testId: TestId) {
  const leads = o.leadsAffected ?? o.affectedContactIds?.length ?? 0;
  const deals = o.affectedContactIds?.length ? dealsFor(ws, o.affectedContactIds) : [];
  const pipeline = o.pipelineAtRisk ?? deals.reduce((n, d) => n + (d.amount ?? 0), 0);
  const dealIds = o.dealIds ?? deals.map((d) => d.id);
  const passLine = o.actual.charAt(0).toUpperCase() + o.actual.slice(1);
  const text = o.pass ? { summary: /[.!?]$/.test(passLine) ? passLine : `${passLine}.`, whyItMatters: null as string | null } : await explain(testId, o.facts);
  await prisma.$transaction([
    prisma.evidence.deleteMany({ where: { resultId } }),
    prisma.evidence.createMany({
      data: o.evidence.map((e) => ({
        resultId, kind: e.kind, graph8Id: e.graph8Id || "-", title: e.title, fields: e.fields as Prisma.InputJsonValue,
        excerpt: e.excerpt ?? null, highlight: e.highlight ?? null, at: new Date(e.at || Date.now()), raw: (e.raw ?? {}) as Prisma.InputJsonValue,
      })),
    }),
    prisma.testResult.update({
      where: { id: resultId },
      data: {
        expected: o.expected, actual: o.actual, summary: text.summary, whyItMatters: text.whyItMatters,
        leadsAffected: o.pass ? 0 : leads, pipelineAtRisk: o.pass ? 0 : pipeline, dealIds: o.pass ? [] : dealIds,
        contactIds: o.pass ? [] : (o.affectedContactIds ?? []), problem: o.pass ? null : text.summary,
        goalSec: o.goalSec, actualSec: o.actualSec,
      },
    }),
  ]);
}

async function setStatus(resultId: string, status: Prisma.TestResultUpdateInput["status"], extra: Prisma.TestResultUpdateInput = {}) {
  const r = await prisma.testResult.update({ where: { id: resultId }, data: { status, ...extra } });
  await publish({ type: "result:updated", runId: r.runId, resultId, testId: r.testId as TestId, area: r.area, status: r.status, summary: r.summary });
  return r;
}

async function runPhases(resultId: string, attempt = 0): Promise<{ o: Outcome; s: Scratch; target: Target }> {
  const r = await prisma.testResult.findUniqueOrThrow({ where: { id: resultId }, include: { run: true } });
  const ws = wsOf(r.run);
  const test = REGISTRY[r.testId as TestId]!;
  const ctx = makeCtx(r.runId, ws, await loadSettings(), attempt);
  const target: Target = { type: r.targetType as Target["type"], id: r.targetId, name: r.targetName, why: "" };
  const s: Scratch = attempt === 0 ? ((r.state as Scratch) ?? {}) : {};
  const save = () => prisma.testResult.update({ where: { id: resultId }, data: { state: s as Prisma.InputJsonValue } });
  if (!s.phase) {
    await test.setup?.(ctx, target, s);
    s.phase = "setup";
    await save();
  }
  if (s.phase === "setup") {
    await test.trigger?.(ctx, target, s);
    s.phase = "triggered";
    await save();
  }
  const o = await test.check(ctx, target, s);
  s.phase = "checked";
  await save();
  return { o, s, target };
}

export async function executeTest(q: Queue, resultId: string) {
  // Atomic claim: a re-delivered job (or a resumed one) can't run the same test twice.
  const claim = await prisma.testResult.updateMany({ where: { id: resultId, status: "QUEUED" }, data: { status: "RUNNING" } });
  if (!claim.count) return;
  const r0 = await prisma.testResult.findUniqueOrThrow({ where: { id: resultId }, include: { run: true } });
  await publish({ type: "result:updated", runId: r0.runId, resultId, testId: r0.testId as TestId, area: r0.area, status: "RUNNING" });
  const testId = r0.testId as TestId;
  try {
    const { o, s, target } = await runPhases(resultId);
    const ws = wsOf(r0.run);
    await saveOutcome(resultId, o, ws, testId);
    if (o.inconclusive) {
      await setStatus(resultId, "ERROR", { error: o.actual });
    } else if (o.pass) {
      await setStatus(resultId, "PASS");
    } else {
      await runLog(r0.runId, `${TEST_BY_ID[testId].name} failed on ${r0.targetName}: ${o.actual}`);
      await publish({ type: "toast", tone: "fail", message: `${TEST_BY_ID[testId].name} found in ${r0.targetName}`, runId: r0.runId, resultId });
      await proposeFixes(q, resultId, target, s, o);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = (err as { hint?: string }).hint;
    log.error({ err, resultId }, "test failed to run");
    await setStatus(resultId, "ERROR", { error: hint ? `${msg}. ${hint}` : msg });
  }
  // Keep the board's totals live (distinct deals), not only at the end.
  await refreshTotals(r0.runId).catch(() => {});
  await maybeFinalize(q, r0.runId);
}

async function modes(): Promise<Record<FixAction, FixMode>> {
  const rows = await prisma.fixModeSetting.findMany();
  return Object.fromEntries(rows.map((r) => [r.action, r.mode])) as Record<FixAction, FixMode>;
}

async function proposeFixes(q: Queue, resultId: string, target: Target, s: Scratch, o: Outcome) {
  const r = await prisma.testResult.findUniqueOrThrow({ where: { id: resultId }, include: { run: true } });
  const ws = wsOf(r.run);
  const test = REGISTRY[r.testId as TestId]!;
  const ctx = makeCtx(r.runId, ws, await loadSettings());
  let proposals: ProposedFix[] = [];
  try {
    proposals = await test.proposeFix(ctx, target, s, o);
  } catch (err) {
    await runLog(r.runId, `Could not propose a fix: ${err instanceof Error ? err.message : err}`);
  }
  // proposeFix may record facts (e.g. T2's lower-priority sequence) the re-test copy needs.
  await prisma.testResult.update({ where: { id: resultId }, data: { state: s as Prisma.InputJsonValue } });
  const m = await modes();
  const isGate = r.run.trigger === "GATE";
  // Existing fixes (a retried job) are kept, not duplicated.
  const existing = await prisma.fix.findMany({ where: { resultId } });
  for (const p of proposals) {
    if (existing.some((f) => f.action === p.action && f.targetId === p.targetId)) continue;
    // The pre-flight gate exists to block: it pauses on its own (§10).
    const mode: FixMode = isGate && p.action === "PAUSE_SEQUENCE" ? "AUTOPILOT" : m[p.action] ?? "APPROVE";
    const fix = await prisma.fix.create({
      data: {
        resultId, action: p.action, mode, status: mode === "OFF" ? "REJECTED" : "PROPOSED", targetId: p.targetId,
        args: p.args as Prisma.InputJsonValue, preview: p.preview, before: (p.before ?? {}) as Prisma.InputJsonValue,
        after: (p.after ?? {}) as Prisma.InputJsonValue, reason: p.reason,
      },
    });
    await publish({ type: "fix:proposed", runId: r.runId, fixId: fix.id, resultId, action: p.action });
  }
  // Autopilot fixes wait for phase 2, once every check has finished, so a fix
  // (e.g. pausing a sequence) cannot hide another test's failure on the same
  // flow. Gate runs and late re-tests apply straight away.
  const run = await prisma.run.findUniqueOrThrow({ where: { id: r.runId } });
  if (isGate || run.fixPhase) {
    const remedial = await applyAutopilot(resultId);
    await settleResult(q, resultId, { retest: remedial, s });
  } else {
    const approvals = await prisma.fix.count({ where: { resultId, status: "PROPOSED", mode: "APPROVE" } });
    await setStatus(resultId, approvals ? "NEEDS_APPROVAL" : "FAIL");
  }
}

/** Apply this result's pending Autopilot fixes. Returns true if one of them changed the machine. */
async function applyAutopilot(resultId: string) {
  const fixes = await prisma.fix.findMany({ where: { resultId, mode: "AUTOPILOT", status: "PROPOSED" }, orderBy: { createdAt: "asc" } });
  let remedial = false;
  for (const f of fixes) {
    const done = await applyFix(f.id).catch(() => null);
    if (done?.status === "APPLIED" && !RECORD_ONLY.has(f.action)) remedial = true;
  }
  return remedial;
}

/** Phase 2: apply autopilot fixes one by one, then re-test everything that changed, in parallel. */
export async function runFixPhase(q: Queue, runId: string) {
  const results = await prisma.testResult.findMany({
    where: { runId, fixes: { some: { mode: "AUTOPILOT", status: "PROPOSED" } } },
    orderBy: { createdAt: "asc" },
  });
  if (results.length) await runLog(runId, `${results.length} problem${results.length === 1 ? "" : "s"} to fix on Autopilot. Fixing, then re-testing.`);
  const changed = new Map<string, boolean>();
  for (const r of results) changed.set(r.id, await applyAutopilot(r.id));
  await Promise.all(results.map((r) => settleResult(q, r.id, { retest: changed.get(r.id) ?? false }).catch((err) => log.error({ err }, "settle failed"))));
  await refreshTotals(runId);
  await q.send(JOBS.finalize, { runId }, { singletonKey: `fin-${runId}` });
}

/**
 * Decide the result's status from its fixes. Re-test only when the caller just
 * applied a remedial fix — approving a task, or skipping something, never
 * re-runs a test that already passed its re-test.
 */
export async function settleResult(q: Queue, resultId: string, opts: { retest: boolean; s?: Scratch }) {
  const r = await prisma.testResult.findUniqueOrThrow({ where: { id: resultId }, include: { fixes: true, run: true } });
  const pending = r.fixes.filter((f) => f.status === "PROPOSED" && f.mode === "APPROVE");
  if (opts.retest) {
    await retest(resultId, opts.s);
  } else if (pending.length) {
    await setStatus(resultId, "NEEDS_APPROVAL");
  } else if (r.retestStatus === "PASS") {
    await setStatus(resultId, "FIXED");
  } else {
    await setStatus(resultId, "FAIL");
  }
  // A late re-test can be the last open result of a live run.
  if (r.run.status === "RUNNING") await maybeFinalize(q, r.runId);
}

export async function retest(resultId: string, s?: Scratch) {
  const r = await prisma.testResult.findUniqueOrThrow({ where: { id: resultId }, include: { run: true } });
  await setStatus(resultId, "RUNNING", { retestStatus: "RUNNING" });
  const testId = r.testId as TestId;
  const test = REGISTRY[testId]!;
  try {
    const ws = wsOf(r.run);
    // Each re-test gets fresh buyers (a new attempt number), never a cleaned-up contact.
    const attempt = (await prisma.fakeBuyer.count({ where: { runId: r.runId, testId } })) + 1;
    const ctx = makeCtx(r.runId, ws, await loadSettings(), attempt);
    const target: Target = { type: r.targetType as Target["type"], id: r.targetId, name: r.targetName, why: "" };
    const scratch = s ?? ((r.state as Scratch) ?? {});
    const ids = (scratch.buyers ?? []).map((b) => b.contactId);
    const buyersGone = ids.length ? (await prisma.fakeBuyer.count({ where: { contactId: { in: ids }, cleanedUp: true } })) > 0 : false;
    let o: Outcome | null = test.retest && !buyersGone ? await test.retest(ctx, target, scratch, []) : null;
    if (!o) {
      const fresh: Scratch = {};
      await test.setup?.(ctx, target, fresh);
      await test.trigger?.(ctx, target, fresh);
      o = await test.check(ctx, target, fresh);
    }
    const ok = o.pass && !o.inconclusive;
    const facts = { ...(scratch as Record<string, unknown>), ...o.facts, sequence: r.targetName, lower: (scratch.lower as string) ?? undefined, owner: scratch.owner as string, count: r.leadsAffected ?? undefined } as Record<string, string | number | undefined>;
    // Name the buyer who was actually harmed, not the fresh re-test buyer.
    const original = (scratch.buyers ?? [])[0]?.name;
    const fixedText = ok ? templateExplain(testId, { ...facts, buyer: original ?? facts.buyer ?? "the buyer" }, true).summary : null;
    const before = (r.actual ?? "").split(" → ")[0];
    await setStatus(resultId, ok ? "FIXED" : "FAIL", {
      retestStatus: ok ? "PASS" : "FAIL",
      error: null,
      actual: ok ? `${before} → re-test passed: ${o.actual}` : `${before} → still failing: ${o.actual}`,
      ...(fixedText ? { summary: fixedText } : {}),
    });
    await runLog(r.runId, `Re-test ${ok ? "passed" : "failed"}: ${TEST_BY_ID[testId].name} on ${r.targetName}`);
    await publish({ type: "toast", tone: ok ? "pass" : "fail", message: ok ? `Fixed: ${TEST_BY_ID[testId].name} in ${r.targetName}` : `Still failing: ${r.targetName}`, runId: r.runId, resultId });
  } catch (err) {
    await setStatus(resultId, "FAIL", { retestStatus: "ERROR", error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------- approvals
export async function approveFix(q: Queue, fixId: string) {
  const before = await prisma.fix.findUniqueOrThrow({ where: { id: fixId } });
  // Claim: two deliveries of the same approval must not apply (or re-test) twice.
  const claim = await prisma.fix.updateMany({ where: { id: fixId, status: "PROPOSED", appliedAt: null }, data: { appliedAt: new Date() } });
  if (!claim.count) return;
  let applied = false;
  try {
    applied = (await applyFix(fixId)).status === "APPLIED";
  } catch {
    /* the fix is marked FAILED with its error; the card offers Retry */
  } finally {
    const r = await prisma.testResult.findUniqueOrThrow({ where: { id: before.resultId }, include: { run: true } });
    await settleResult(q, before.resultId, { retest: applied && !RECORD_ONLY.has(before.action) });
    // Approvals often land after the run finished and cleaned up: tidy the re-test buyers.
    if (r.run.status === "DONE" && applied && !RECORD_ONLY.has(before.action)) await q.send(JOBS.cleanup, { runId: r.runId }, { startAfter: 1 });
    await refreshTotals(r.runId);
  }
}

export async function rejectFix(q: Queue, fixId: string) {
  const fix = await prisma.fix.update({ where: { id: fixId }, data: { status: "REJECTED" } });
  await settleResult(q, fix.resultId, { retest: false });
  const r = await prisma.testResult.findUniqueOrThrow({ where: { id: fix.resultId } });
  await refreshTotals(r.runId);
}

/** "Re-run this test" from the drawer, as a worker job. */
export async function retestJob(q: Queue, resultId: string) {
  const r = await prisma.testResult.findUniqueOrThrow({ where: { id: resultId }, include: { run: true } });
  await retest(resultId);
  const after = await prisma.run.findUniqueOrThrow({ where: { id: r.runId } });
  if (after.status === "RUNNING") await maybeFinalize(q, r.runId);
  // Only a finished run gets tidied; a live run still needs its other buyers.
  else await cleanupRun(r.runId);
  await refreshTotals(r.runId);
}

/** A run that can't continue: mark it, resolve its gate event, clean up its buyers. */
export async function failRun(runId: string, message: string) {
  await prisma.run.update({ where: { id: runId }, data: { status: "FAILED", error: message, finishedAt: new Date() } }).catch(() => {});
  const ev = await prisma.gateEvent.findUnique({ where: { runId }, include: { sequence: true } });
  if (ev && ev.result === "CHECKING") {
    await prisma.gateEvent.update({ where: { id: ev.id }, data: { result: "RELEASED", resolvedAt: new Date(), message: `Could not check this change: ${message}` } });
    await publish({ type: "gate:released", sequenceId: ev.sequence.graph8Id, name: ev.sequence.name });
  }
  await cleanupRun(runId).catch(() => {});
  await publish({ type: "run:updated", runId, status: "FAILED" });
}

// ---------------------------------------------------------------- finalize
export async function maybeFinalize(q: Queue, runId: string) {
  const open = await prisma.testResult.count({ where: { runId, status: { in: ["QUEUED", "RUNNING"] } } });
  if (open) return;
  const claimed = await prisma.run.updateMany({ where: { id: runId, fixPhase: false }, data: { fixPhase: true } });
  if (claimed.count) await q.send(JOBS.fixes, { runId }, { singletonKey: `fixes-${runId}` });
  else await q.send(JOBS.finalize, { runId }, { singletonKey: `fin-${runId}` });
}

/** Sum of distinct open deals behind failing results (a deal counts once). */
export async function distinctPipeline(runId: string, failing: { dealIds: string[]; pipelineAtRisk: Prisma.Decimal | null }[]) {
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  const ws = run.plan ? wsOf(run) : null;
  const seen = new Set<string>();
  let total = 0;
  for (const r of failing) {
    if (!r.dealIds.length) {
      total += Number(r.pipelineAtRisk ?? 0);
      continue;
    }
    for (const id of r.dealIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      total += ws?.deals.find((d) => d.id === id)?.amount ?? 0;
    }
  }
  return total;
}

/** Distinct leads behind a set of results (falls back to the count when ids are unknown). */
export function distinctLeads(rows: { contactIds: string[]; leadsAffected: number | null }[]) {
  const ids = new Set<string>();
  let unknown = 0;
  for (const r of rows) {
    if (r.contactIds.length) r.contactIds.forEach((c) => ids.add(c));
    else unknown = Math.max(unknown, r.leadsAffected ?? 0);
  }
  return ids.size + unknown;
}

export async function refreshTotals(runId: string) {
  const results = await prisma.testResult.findMany({ where: { runId } });
  const leadsProtected = distinctLeads(results.filter((r) => r.status === "FIXED"));
  const pipelineAtRisk = await distinctPipeline(runId, results.filter((r) => ["FAIL", "NEEDS_APPROVAL", "FIXED"].includes(r.status)));
  const run = await prisma.run.update({ where: { id: runId }, data: { leadsProtected, pipelineAtRisk } });
  await publish({ type: "run:updated", runId, status: run.status });
}

export async function finalizeRun(q: Queue, runId: string) {
  // Never finalize (and clean up buyers) while a re-test or an Autopilot fix is still in flight.
  const busy = await prisma.testResult.count({
    where: { runId, OR: [{ status: { in: ["QUEUED", "RUNNING"] } }, { fixes: { some: { mode: "AUTOPILOT", status: "PROPOSED" } } }] },
  });
  if (busy) return;
  const claimed = await prisma.run.updateMany({ where: { id: runId, status: { in: ["RUNNING", "PLANNING", "QUEUED"] } }, data: { status: "DONE", finishedAt: new Date() } });
  if (!claimed.count) return;
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { results: true } });
  await computeHealth(runId);
  await refreshTotals(runId);
  await runLog(runId, "Run finished. Cleaning up fake buyers…");
  await cleanupRun(runId);
  await publish({ type: "run:updated", runId, status: "DONE" });
  if (run.trigger === "GATE") await resolveGate(runId);
  void q;
}

export async function computeHealth(runId: string) {
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { results: true } });
  const ws = wsOf(run);
  const failedFirst = run.results.filter((r) => ["FAIL", "NEEDS_APPROVAL", "FIXED"].includes(r.status));
  for (const s of ws.sequences) {
    const hits = failedFirst.filter((r) => r.targetId === s.id || r.targetId.split("+").includes(s.id));
    const tested = run.results.some((r) => r.targetId === s.id || r.targetId.split("+").includes(s.id));
    if (!tested) continue;
    const score = Math.max(0, 100 - hits.reduce((n, r) => n + TEST_BY_ID[r.testId as TestId].weight, 0));
    const seq = await prisma.sequence.findUnique({ where: { graph8Id: s.id } });
    if (!seq) continue;
    const reasons = [...new Set(hits.map((r) => TEST_BY_ID[r.testId as TestId].name.toLowerCase()))];
    await prisma.healthScore.upsert({
      where: { sequenceId_runId: { sequenceId: seq.id, runId } },
      create: { sequenceId: seq.id, runId, score, band: band(score), reasons },
      update: { score, band: band(score), reasons },
    });
    await publish({ type: "health:updated", sequenceId: s.id, score, band: band(score) });
  }
}

// ---------------------------------------------------------------- cleanup
export async function cleanupRun(runId?: string) {
  const b = getBackend();
  const buyers = await prisma.fakeBuyer.findMany({ where: { cleanedUp: false, ...(runId ? { runId } : {}) } });
  if (buyers.length) {
    const ids = buyers.map((x) => x.contactId);
    await b.withdraw(ids).catch((e) => log.warn({ e }, "withdraw failed"));
    for (const x of buyers) {
      await b.reinstate(x.contactId).catch(() => {});
      let gone = true;
      await b.deleteContact(x.contactId).catch(() => (gone = false));
      if (!gone) await b.suppress(x.contactId).catch(() => {}); // can't delete: keep it silent and tagged
      await prisma.fakeBuyer.update({ where: { id: x.id }, data: { cleanedUp: true } });
    }
  }
  const runs = await prisma.run.findMany({ where: { ...(runId ? { id: runId } : {}), tagListId: { not: null } } });
  for (const r of runs) {
    await b.deleteList(r.tagListId!).catch(() => {});
    await prisma.run.update({ where: { id: r.id }, data: { tagListId: null } });
  }
  if (runId) {
    await prisma.run.update({ where: { id: runId }, data: { cleanedUp: true } });
    await runLog(runId, buyers.length ? `Cleaned up ${buyers.length} fake buyer${buyers.length === 1 ? "" : "s"}.` : "Nothing to clean up.");
  }
  return buyers.length;
}

// ---------------------------------------------------------------- gate resolution
async function resolveGate(runId: string) {
  const ev = await prisma.gateEvent.findUnique({ where: { runId }, include: { sequence: true } });
  if (!ev) return;
  const results = await prisma.testResult.findMany({ where: { runId } });
  const bad = results.find((r) => ["FAIL", "NEEDS_APPROVAL", "FIXED"].includes(r.status));
  if (bad) {
    const message = `"${ev.sequence.name}" was edited and failed the ${TEST_BY_ID[bad.testId as TestId].name.toLowerCase()}. ${bad.status === "FIXED" || bad.status === "NEEDS_APPROVAL" ? "Sequence paused." : ""}`.trim();
    await prisma.gateEvent.update({ where: { id: ev.id }, data: { result: "BLOCKED", resolvedAt: new Date(), message } });
    await publish({ type: "gate:blocked", sequenceId: ev.sequence.graph8Id, name: ev.sequence.name, runId, resultId: bad.id, message });
  } else {
    await prisma.gateEvent.update({ where: { id: ev.id }, data: { result: "RELEASED", resolvedAt: new Date(), message: "Change passed the checks." } });
    await publish({ type: "gate:released", sequenceId: ev.sequence.graph8Id, name: ev.sequence.name });
  }
}
