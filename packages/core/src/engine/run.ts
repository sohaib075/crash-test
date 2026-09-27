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
import { AppError } from "../errors";
import { applyFix, undoFix } from "./fixes";

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
  const planning = await prisma.run.updateMany({ where: { id: runId, status: { in: ["QUEUED", "PLANNING"] } }, data: { status: "PLANNING" } });
  if (!planning.count) return;
  await publish({ type: "run:updated", runId, status: "PLANNING" });

  const st = await getBackend().sandboxStatus();
  if (!st.sandbox) {
    throw new Error(
      `Safety: ${st.name ?? "this workspace"} is a ${st.keyMode ?? "live"}${st.writable ? "" : ", read-only"} key, not a graph8 developer sandbox. ` +
        "Crash Test only runs fake buyers in a sandbox (the outbox exists only there). Add a sandbox key with write scopes to .env.",
    );
  }
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
  // Only a run still being planned may start: Reset demo can stop it during discovery or the AI plan.
  const started = await prisma.run.updateMany({ where: { id: runId, status: "PLANNING" }, data: { status: "RUNNING" } });
  if (!started.count) return stopOpenResults(runId);
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
  const line = /[.!?]$/.test(passLine) ? passLine : `${passLine}.`;
  // A check that couldn't look found nothing: no problem sentence, no leads or pipeline.
  const clean = o.pass || !!o.inconclusive;
  const text = o.pass ? { summary: line, whyItMatters: null as string | null }
    : o.inconclusive ? { summary: `Couldn't check: ${line}`, whyItMatters: null as string | null }
    : await explain(testId, o.facts);
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
        leadsAffected: clean ? 0 : leads, pipelineAtRisk: clean ? 0 : pipeline, dealIds: clean ? [] : dealIds,
        contactIds: clean ? [] : (o.affectedContactIds ?? []), problem: clean ? null : text.summary,
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
  const ctx = makeCtx(r.runId, ws, await loadSettings(), attempt, r.run.trigger);
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
  const claim = await prisma.testResult.updateMany({
    where: { id: resultId, status: "QUEUED", run: { is: { status: "RUNNING" } } },
    data: { status: "RUNNING" },
  });
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
  const ctx = makeCtx(r.runId, ws, await loadSettings(), 0, r.run.trigger);
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
  // Existing fixes (a retried job) are kept, not duplicated. An undone or skipped
  // one doesn't count: a re-check that finds the problem again proposes it again.
  const existing = (await prisma.fix.findMany({ where: { resultId } }))
    .filter((f) => f.status !== "UNDONE" && !(f.status === "REJECTED" && f.mode !== "OFF"));
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
    const claim = await prisma.fix.updateMany({ where: { id: f.id, status: "PROPOSED", appliedAt: null }, data: { appliedAt: new Date() } });
    if (!claim.count) continue;
    const done = await applyFix(f.id).catch(() => null);
    if (done?.status === "APPLIED" && !RECORD_ONLY.has(f.action)) remedial = true;
  }
  return remedial;
}

/** Phase 2: apply autopilot fixes one by one, then re-test everything that changed, in parallel. */
export async function runFixPhase(q: Queue, runId: string) {
  const live = async () => (await prisma.run.findUnique({ where: { id: runId } }))?.status === "RUNNING";
  if (!(await live())) return; // stopped (e.g. by Reset demo)
  // Results with Autopilot fixes to apply, plus any a restarted worker left held mid-phase.
  const results = await prisma.testResult.findMany({
    where: { runId, OR: [{ fixes: { some: { mode: "AUTOPILOT", status: "PROPOSED" } } }, { status: "RUNNING" }] },
    include: { fixes: true },
    orderBy: { createdAt: "asc" },
  });
  if (results.length) await runLog(runId, `${results.length} problem${results.length === 1 ? "" : "s"} to fix on Autopilot. Fixing, then re-testing.`);
  // Hold these results as RUNNING for the whole phase: between "fix applied" and
  // "re-test started" a queued finalize must not see the run as idle (it would
  // score health early and clean up buyers mid re-test).
  for (const r of results) await setStatus(r.id, "RUNNING");
  const changed = new Map<string, boolean>();
  for (const r of results) {
    // Reset demo mid-phase: stop applying (it already undid what was applied).
    if (!(await live())) return stopOpenResults(runId);
    const resumed = r.fixes.some((f) => f.status === "APPLIED" && !RECORD_ONLY.has(f.action));
    changed.set(r.id, (await applyAutopilot(r.id)) || resumed);
  }
  if (!(await live())) return stopOpenResults(runId);
  await Promise.all(results.map((r) => settleResult(q, r.id, { retest: changed.get(r.id) ?? false }).catch((err) => settleFailed(q, r.id, err))));
  await refreshTotals(runId);
  await q.send(JOBS.finalize, { runId }, { singletonKey: `fin-${runId}` });
}

/** A settle threw: give a still-held result an honest status and let the run finish. */
async function settleFailed(q: Queue, resultId: string, err: unknown) {
  log.error({ err, resultId }, "settle failed");
  const cur = await prisma.testResult.findUnique({ where: { id: resultId }, include: { run: true } }).catch(() => null);
  if (cur?.status === "RUNNING") await setStatus(resultId, await fallbackStatus(resultId)).catch(() => {});
  if (cur?.run.status === "RUNNING") await maybeFinalize(q, cur.runId).catch(() => {});
}

/** A stopped run's open results say why they never finished. */
async function stopOpenResults(runId: string) {
  const run = await prisma.run.findUnique({ where: { id: runId } });
  await prisma.testResult.updateMany({ where: { runId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "ERROR", error: run?.error ?? "Run was stopped" } });
}

/** Status a result falls back to when nothing proves it fixed. */
async function fallbackStatus(resultId: string) {
  const pending = await prisma.fix.count({ where: { resultId, status: "PROPOSED", mode: "APPROVE" } });
  return pending ? "NEEDS_APPROVAL" : "FAIL";
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
    await retest(resultId, { s: opts.s });
  } else if (pending.length) {
    await setStatus(resultId, "NEEDS_APPROVAL");
  } else if (r.retestStatus === "PASS" && r.fixes.some((f) => f.status === "APPLIED" && !RECORD_ONLY.has(f.action))) {
    await setStatus(resultId, "FIXED");
  } else {
    await setStatus(resultId, "FAIL");
  }
  // A late re-test can be the last open result of a live run.
  if (r.run.status === "RUNNING") await maybeFinalize(q, r.runId);
}

/**
 * Two kinds of re-test:
 *  - "afterFix" (default): a remedial fix just landed; prove it worked (custom test.retest hooks).
 *  - "recheck": "Re-run this test" — observe again from scratch and record what is true now.
 */
export async function retest(resultId: string, opts: { s?: Scratch; mode?: "afterFix" | "recheck"; q?: Queue } = {}) {
  const mode = opts.mode ?? "afterFix";
  const r = await prisma.testResult.findUniqueOrThrow({ where: { id: resultId }, include: { run: true, fixes: true } });
  const wasFixed = r.fixes.some((f) => f.status === "APPLIED" && !RECORD_ONLY.has(f.action));
  await setStatus(resultId, "RUNNING", { retestStatus: "RUNNING" });
  const testId = r.testId as TestId;
  const test = REGISTRY[testId]!;
  try {
    const ws = wsOf(r.run);
    // Each re-test gets fresh buyers (a new attempt number), never a cleaned-up contact.
    const attempt = (await prisma.fakeBuyer.count({ where: { runId: r.runId, testId } })) + 1;
    const ctx = makeCtx(r.runId, ws, await loadSettings(), attempt, r.run.trigger);
    const target: Target = { type: r.targetType as Target["type"], id: r.targetId, name: r.targetName, why: "" };
    const scratch = opts.s ?? ((r.state as Scratch) ?? {});
    const ids = (scratch.buyers ?? []).map((b) => b.contactId);
    const buyersGone = ids.length ? (await prisma.fakeBuyer.count({ where: { contactId: { in: ids }, cleanedUp: true } })) > 0 : false;
    let o: Outcome | null = mode === "afterFix" && test.retest && !buyersGone ? await test.retest(ctx, target, scratch, []) : null;
    const fresh: Scratch = {};
    if (!o) {
      await test.setup?.(ctx, target, fresh);
      await test.trigger?.(ctx, target, fresh);
      o = await test.check(ctx, target, fresh);
    }

    const before = (r.actual ?? "").split(" → ")[0];
    // A re-check that still fails on a FIXED result: does the fix in place still contain it?
    const held = mode === "recheck" && wasFixed && !o.pass && !o.inconclusive && test.retest
      ? await test.retest(ctx, target, fresh, []).catch(() => null)
      : null;
    if (mode === "recheck") {
      // Record the new observation, exactly like a first run would.
      if (o.inconclusive) {
        // Couldn't look: a fixed result stays fixed, anything else can't claim a verdict.
        if (r.status === "FIXED") await setStatus(resultId, "FIXED", { retestStatus: "ERROR", error: o.actual });
        else await setStatus(resultId, "ERROR", { retestStatus: "ERROR", error: o.actual, actual: o.actual });
      } else if (o.pass && wasFixed) {
        // The fix still holds: keep the fix sentence and the leads/pipeline it protected.
        await setStatus(resultId, "FIXED", { retestStatus: "PASS", error: null, actual: `${before} → re-checked, still fixed: ${o.actual}` });
      } else if (o.pass) {
        await saveOutcome(resultId, o, ws, testId);
        // The problem is gone: its waiting proposals no longer apply.
        await prisma.fix.updateMany({
          where: { resultId, OR: [{ status: "PROPOSED", appliedAt: null }, { status: "FAILED" }] },
          data: { status: "REJECTED", error: "Not needed: the re-check passed." },
        });
        await setStatus(resultId, "PASS", { retestStatus: "PASS", error: null });
      } else if (held?.pass && !held.inconclusive) {
        // The problem is still there (e.g. the copy), but the fix in place still contains it
        // (e.g. the sequence is paused): the result stays FIXED, and says so.
        await setStatus(resultId, "FIXED", { retestStatus: "PASS", error: null, actual: `${before} → re-checked: still contained (${held.actual})` });
      } else {
        await saveOutcome(resultId, o, ws, testId);
        await prisma.testResult.update({ where: { id: resultId }, data: { retestStatus: "FAIL", error: null } });
        // A newly found problem gets the same fix proposals as a first run
        // (proposeFixes settles the status; the result stays RUNNING until then).
        if (!wasFixed && opts.q) await proposeFixes(opts.q, resultId, target, fresh, o);
        else await setStatus(resultId, await fallbackStatus(resultId));
      }
      // Say what the result is now: a new failure may already have been fixed on Autopilot.
      const now = (await prisma.testResult.findUnique({ where: { id: resultId } }))?.status;
      const verdict = o.inconclusive ? "couldn't check"
        : o.pass ? "passes"
        : held?.pass ? "still contained by its fix"
        : now === "FIXED" ? "found a problem and fixed it"
        : now === "NEEDS_APPROVAL" ? "fails; a fix is waiting for approval"
        : "still failing";
      await runLog(r.runId, `Re-checked ${TEST_BY_ID[testId].name} on ${r.targetName}: ${verdict}`);
      await publish({ type: "toast", tone: o.pass || held?.pass || now === "FIXED" ? "pass" : "fail", message: `${TEST_BY_ID[testId].name} on ${r.targetName}: ${verdict}`, runId: r.runId, resultId });
      return;
    }

    // An Undo can land while this re-test runs: FIXED needs a remedial fix still in place.
    const stillApplied = (await prisma.fix.findMany({ where: { resultId, status: "APPLIED" } })).some((f) => !RECORD_ONLY.has(f.action));
    const ok = o.pass && !o.inconclusive && stillApplied;
    const facts = { ...(scratch as Record<string, unknown>), ...o.facts, sequence: r.targetName, lower: (scratch.lower as string) ?? undefined, owner: scratch.owner as string, count: r.leadsAffected ?? undefined } as Record<string, string | number | undefined>;
    // Name the buyer who was actually harmed, not the fresh re-test buyer.
    const original = (scratch.buyers ?? [])[0]?.name;
    const fixedText = ok ? templateExplain(testId, { ...facts, buyer: original ?? facts.buyer ?? "the buyer" }, true).summary : null;
    await setStatus(resultId, ok ? "FIXED" : await fallbackStatus(resultId), {
      retestStatus: ok ? "PASS" : "FAIL",
      error: null,
      actual: ok ? `${before} → re-test passed: ${o.actual}` : `${before} → still failing: ${o.actual}`,
      ...(fixedText ? { summary: fixedText } : {}),
    });
    await runLog(r.runId, `Re-test ${ok ? "passed" : "failed"}: ${TEST_BY_ID[testId].name} on ${r.targetName}`);
    await publish({ type: "toast", tone: ok ? "pass" : "fail", message: ok ? `Fixed: ${TEST_BY_ID[testId].name} in ${r.targetName}` : `Still failing: ${r.targetName}`, runId: r.runId, resultId });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // A re-check that couldn't run keeps the verdict it had; an unproven fix is not FIXED.
    if (mode === "recheck") await setStatus(resultId, r.status, { retestStatus: "ERROR", error });
    else await setStatus(resultId, await fallbackStatus(resultId), { retestStatus: "ERROR", error });
  }
}

// ---------------------------------------------------------------- approvals
export async function approveFix(q: Queue, fixId: string) {
  const before = await prisma.fix.findUniqueOrThrow({ where: { id: fixId } });
  // Claim: two deliveries of the same approval must not apply (or re-test) twice.
  const claim = await prisma.fix.updateMany({ where: { id: fixId, status: "PROPOSED", appliedAt: null }, data: { appliedAt: new Date() } });
  if (!claim.count) return;
  // Mid-run, keep the result busy until it is settled, so the run can't finalize in between.
  const live = (await prisma.testResult.findUniqueOrThrow({ where: { id: before.resultId }, include: { run: true } })).run.status === "RUNNING";
  if (live) await setStatus(before.resultId, "RUNNING");
  let applied = false;
  try {
    applied = (await applyFix(fixId)).status === "APPLIED";
  } catch {
    /* the fix is marked FAILED with its error; the card offers Retry */
  } finally {
    const r = await prisma.testResult.findUniqueOrThrow({ where: { id: before.resultId }, include: { run: true } });
    await settleResult(q, before.resultId, { retest: applied && !RECORD_ONLY.has(before.action) }).catch((err) => settleFailed(q, before.resultId, err));
    // Approvals often land after the run finished and cleaned up: tidy the re-test buyers.
    if (r.run.status === "DONE" && applied && !RECORD_ONLY.has(before.action)) await q.send(JOBS.cleanup, { runId: r.runId }, { startAfter: 1 });
    await refreshTotals(r.runId);
  }
}

export async function rejectFix(q: Queue, fixId: string) {
  // Only a proposal nobody is applying can be skipped; an applied fix must be undone instead.
  const claim = await prisma.fix.updateMany({ where: { id: fixId, status: "PROPOSED", appliedAt: null }, data: { status: "REJECTED" } });
  const fix = await prisma.fix.findUniqueOrThrow({ where: { id: fixId } });
  if (!claim.count) {
    const state = fix.status === "PROPOSED" ? "being applied" : fix.status.toLowerCase();
    throw new AppError(409, "FIX_NOT_PROPOSED", `This fix is ${state}, so it can't be skipped.`, fix.status === "APPLIED" ? "Use Undo instead." : undefined);
  }
  // If a check, re-test or another apply holds this result, that holder settles it
  // (the skipped fix is already out of its count). Settling here would release the hold.
  const res = await prisma.testResult.findUniqueOrThrow({ where: { id: fix.resultId }, include: { fixes: true } });
  const held = res.status === "RUNNING" || res.status === "QUEUED" || res.fixes.some((f) => f.status === "PROPOSED" && f.appliedAt);
  if (!held) await settleResult(q, fix.resultId, { retest: false });
  const r = await prisma.testResult.findUniqueOrThrow({ where: { id: fix.resultId } });
  await refreshTotals(r.runId);
}

/** Undo a fix, then make the result tell the truth about it (RB-4). */
export async function undoAndResettle(fixId: string) {
  const fix = await undoFix(fixId);
  if (!RECORD_ONLY.has(fix.action)) await resettleAfterUndo(fix.resultId);
  return fix;
}

/** After a remedial fix is undone: a FIXED result with no fix left in place is failing again. */
export async function resettleAfterUndo(resultId: string) {
  const r = await prisma.testResult.findUniqueOrThrow({ where: { id: resultId }, include: { fixes: true } });
  const stillFixed = r.fixes.some((f) => f.status === "APPLIED" && !RECORD_ONLY.has(f.action));
  if (r.status === "FIXED" && !stillFixed) {
    await setStatus(r.id, await fallbackStatus(r.id), {
      retestStatus: null,
      summary: r.problem ?? r.summary,
      actual: `${(r.actual ?? "").split(" → ")[0]} → fix undone`,
    });
    await refreshTotals(r.runId);
  }
}

/** "Re-run this test" from the drawer, as a worker job. */
export async function retestJob(q: Queue, resultId: string) {
  const r = await prisma.testResult.findUniqueOrThrow({ where: { id: resultId }, include: { run: true } });
  await retest(resultId, { mode: "recheck", q });
  const after = await prisma.run.findUniqueOrThrow({ where: { id: r.runId } });
  if (after.status === "RUNNING") await maybeFinalize(q, r.runId);
  // Only a finished run gets tidied (and re-scored); a live run still needs its other buyers.
  else {
    await cleanupRun(r.runId);
    if (after.status === "DONE") await computeHealth(r.runId);
  }
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
  const claimed = await prisma.run.updateMany({ where: { id: runId, fixPhase: false, status: "RUNNING" }, data: { fixPhase: true } });
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
  const weights = Object.fromEntries((await prisma.testDefinition.findMany()).map((d) => [d.id, d.weight]));
  for (const s of ws.sequences) {
    const touches = (targetId: string) => targetId === s.id || targetId.split("+").includes(s.id);
    if (!run.results.some((r) => touches(r.targetId))) continue;
    // Health is the latest observation of each test on this sequence, from any run: a gate
    // run that only re-checks the copy must not erase an opt-out leak found earlier.
    const rows = (await prisma.testResult.findMany({
      where: { targetId: { contains: s.id }, status: { in: ["PASS", "FAIL", "NEEDS_APPROVAL", "FIXED"] } },
      orderBy: { updatedAt: "desc" },
      take: 500,
    })).filter((r) => touches(r.targetId));
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(`${r.testId}|${r.targetId}`)) latest.set(`${r.testId}|${r.targetId}`, r);
    // Each failing test counts once, even when several T2 pairs include this sequence.
    const failing = [...new Set([...latest.values()].filter((r) => r.status !== "PASS").map((r) => r.testId))];
    const score = Math.max(0, 100 - failing.reduce((n, id) => n + (weights[id] ?? TEST_BY_ID[id as TestId].weight), 0));
    const seq = await prisma.sequence.findUnique({ where: { graph8Id: s.id } });
    if (!seq) continue;
    const reasons = failing.map((id) => TEST_BY_ID[id as TestId].name.toLowerCase());
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
    await retireBuyerFixes(ids);
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

/** Proposals that act on fake buyers we are deleting can never apply: retire them honestly. */
async function retireBuyerFixes(contactIds: string[]) {
  // A task about a flow can still be written; it just no longer links the deleted test contact.
  const tasks = (await prisma.fix.findMany({ where: { status: "PROPOSED", action: "CREATE_TASK" } }))
    .filter((f) => contactIds.includes(String((f.args as { contactId?: string }).contactId ?? "")));
  for (const f of tasks) {
    const { contactId: _gone, ...args } = f.args as Record<string, unknown>;
    void _gone;
    await prisma.fix.update({ where: { id: f.id }, data: { args: args as Prisma.InputJsonValue } });
  }
  const stale = (await prisma.fix.findMany({ where: { status: "PROPOSED", action: { in: ["WITHDRAW_CONTACT", "ADD_SUPPRESSION"] } } }))
    .filter((f) => contactIds.includes(String((f.args as { contactId?: string }).contactId ?? "")));
  for (const f of stale) {
    await prisma.fix.update({ where: { id: f.id }, data: { status: "REJECTED", error: "The test buyer was already cleaned up, so there is nothing to change." } });
    const r = await prisma.testResult.findUnique({ where: { id: f.resultId } });
    if (r && r.status === "NEEDS_APPROVAL") await setStatus(r.id, await fallbackStatus(r.id));
  }
}

// ---------------------------------------------------------------- gate resolution
async function resolveGate(runId: string) {
  const ev = await prisma.gateEvent.findUnique({ where: { runId }, include: { sequence: true } });
  if (!ev) return;
  const results = await prisma.testResult.findMany({ where: { runId } });
  const bad = results.find((r) => ["FAIL", "NEEDS_APPROVAL", "FIXED"].includes(r.status));
  if (bad) {
    const paused = await prisma.fix.count({ where: { resultId: bad.id, action: "PAUSE_SEQUENCE", status: "APPLIED" } });
    const message = `"${ev.sequence.name}" was edited and failed the ${TEST_BY_ID[bad.testId as TestId].name.toLowerCase()}. ${paused ? "Sequence paused." : "Not paused: see the check."}`;
    await prisma.gateEvent.update({ where: { id: ev.id }, data: { result: "BLOCKED", resolvedAt: new Date(), message } });
    await publish({ type: "gate:blocked", sequenceId: ev.sequence.graph8Id, name: ev.sequence.name, runId, resultId: bad.id, message });
  } else {
    const passed = results.length > 0 && results.every((r) => r.status === "PASS");
    const err = results.find((r) => r.status === "ERROR");
    const message = passed ? "Change passed the checks." : `Could not check this change: ${err?.error ?? "no checks ran"}`;
    await prisma.gateEvent.update({ where: { id: ev.id }, data: { result: "RELEASED", resolvedAt: new Date(), message } });
    if (passed) await releaseBlocks(ev.sequenceId, "A later change passed the checks.");
    await publish({ type: "gate:released", sequenceId: ev.sequence.graph8Id, name: ev.sequence.name });
  }
}

/** Resolve every still-BLOCKED gate event for a sequence (its block ended). */
export async function releaseBlocks(sequenceRowId: string, message: string) {
  const open = await prisma.gateEvent.findMany({ where: { sequenceId: sequenceRowId, result: "BLOCKED" }, include: { sequence: true } });
  if (!open.length) return;
  await prisma.gateEvent.updateMany({ where: { id: { in: open.map((e) => e.id) } }, data: { result: "RELEASED", resolvedAt: new Date(), message } });
  await publish({ type: "gate:released", sequenceId: open[0].sequence.graph8Id, name: open[0].sequence.name });
}
