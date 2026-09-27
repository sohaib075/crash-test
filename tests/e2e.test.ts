// Build plan v4 §05 acceptance tests E1–E8, run against the in-memory graph8
// double with the real engine and Postgres. The live versions run on stage.
import { applyFix, executeTest, gateTick, rebaseline, runDTO, startRun, undoFix, discoverAndStore } from "@crash/core";
import { prisma } from "@crash/db";
import { beforeEach, describe, expect, it } from "vitest";
import { mockState } from "../packages/core/src/mock";
import { DEMO_MODES, drain, jobErrors, queue, resetAll, setModes } from "./helpers";

const byTest = async (runId: string, testId: string, target?: string) =>
  (await runDTO(runId))!.results.filter((r) => r.testId === testId && (!target || r.targetId === target));

describe("E2E acceptance (in-memory graph8)", () => {
  beforeEach(async () => {
    await resetAll();
    await setModes(DEMO_MODES);
  });

  it("E1: one click runs every MVP test; 2+ fixed, the rest passed or waiting", async () => {
    const t0 = Date.now();
    const run = await startRun(queue, { trigger: "MANUAL" });
    await drain();
    const dto = (await runDTO(run.id))!;
    expect(jobErrors).toEqual([]);
    expect(dto.status).toBe("DONE");
    expect(Date.now() - t0).toBeLessThan(4 * 60_000);
    expect(dto.totals.fixed).toBeGreaterThanOrEqual(2);
    expect(dto.totals.error).toBe(0);
    for (const r of dto.results.filter((x) => x.status !== "PASS")) {
      expect(r.summary, `${r.testId} ${r.targetName} needs a plain-English summary`).toBeTruthy();
    }
    expect(dto.totals.pipelineAtRisk).toBeGreaterThan(0);
    // Fixes wait until every check finished: one test's pause must not hide another's failure.
    const q4 = (id: string) => dto.results.find((r) => r.testId === id && r.targetId === "seq_q4")!;
    expect(q4("T1").status).toBe("FIXED");
    expect(q4("T3").status).toBe("FIXED");
    expect(q4("T7").status).toBe("FIXED");
    // Pipeline at risk counts each open deal once, so it can never exceed open pipeline.
    const open = mockState().deals.reduce((n, d) => n + (d.amount ?? 0), 0);
    expect(dto.totals.pipelineAtRisk).toBeLessThanOrEqual(open);
    // Leads count each real contact once (the mock workspace has 18).
    expect(dto.totals.leadsProtected).toBeLessThanOrEqual(18);
    const q4Row = await prisma.sequence.findUniqueOrThrow({ where: { graph8Id: "seq_q4" } });
    expect(q4Row.status).toBe("paused");
    const health = await prisma.healthScore.findFirstOrThrow({ where: { sequenceId: q4Row.id } });
    expect(health.band).toBe("BROKEN");
  });

  it("E2: opted-out buyer in Q4 Outbound → fail with outbox evidence → pause/withdraw → re-test passes → task in graph8", async () => {
    const run = await startRun(queue, { testIds: ["T1"] });
    await drain();
    const [q4] = await byTest(run.id, "T1", "seq_q4");
    expect(q4.status).toBe("FIXED");
    expect(q4.summary).toMatch(/Paused Q4 Outbound/);
    const detail = await prisma.testResult.findUniqueOrThrow({ where: { id: q4.id }, include: { evidence: true, fixes: true, writebacks: true } });
    expect(detail.evidence.some((e) => e.kind === "EMAIL")).toBe(true);
    expect(detail.fixes.map((f) => [f.action, f.status])).toEqual(expect.arrayContaining([["PAUSE_SEQUENCE", "APPLIED"], ["CREATE_TASK", "APPLIED"]]));
    expect(detail.writebacks.find((w) => w.kind === "task")).toBeTruthy();
    expect(mockState().tasks.size).toBeGreaterThan(0);
    const [healthy] = await byTest(run.id, "T1", "seq_in");
    expect(healthy.status).toBe("PASS");
  });

  it("E3: quote total ≠ deal amount → fails with both numbers, deal note on approval, quote untouched", async () => {
    const before = JSON.stringify(mockState().quotes);
    const run = await startRun(queue, { testIds: ["T13"] });
    await drain();
    const [bad] = await byTest(run.id, "T13", "q_1042");
    expect(bad.status).toBe("NEEDS_APPROVAL");
    expect(bad.summary).toContain("$12,000");
    expect(bad.summary).toContain("$15,000");
    expect(bad.pipelineAtRisk).toBe(15000);
    const note = (await prisma.fix.findMany({ where: { resultId: bad.id } })).find((f) => f.action === "ADD_DEAL_NOTE")!;
    await applyFix(note.id);
    expect([...mockState().notes.values()].some((n) => n.dealId === "d_1" && n.body.includes("$12,000"))).toBe(true);
    expect(JSON.stringify(mockState().quotes)).toBe(before);
    const [good] = await byTest(run.id, "T13", "q_1043");
    expect(good.status).toBe("PASS");
  });

  it("E4: editing a live step to promise a discount is caught by the gate, sentence quoted, sequence paused", async () => {
    await discoverAndStore();
    await rebaseline();
    mockState().seqs.find((s) => s.id === "seq_in")!.steps[0].body = "Hi {{first_name|there}}, sign this week and we guarantee 50% off your first year.\n\nUnsubscribe: {{unsubscribe_link}}";
    const t0 = Date.now();
    const r = await gateTick(queue);
    await drain();
    expect(r.changed).toBe(1);
    const ev = await prisma.gateEvent.findFirstOrThrow({ include: { run: { include: { results: { include: { evidence: true } } } } } });
    expect(ev.result).toBe("BLOCKED");
    expect(Date.now() - t0).toBeLessThan(30_000);
    const res = ev.run!.results[0];
    expect(res.evidence.some((e) => e.highlight?.includes("guarantee 50% off"))).toBe(true);
    expect(mockState().seqs.find((s) => s.id === "seq_in")!.status).toBe("paused");
  });

  it("E5: approve mode → preview shown, nothing changes until Apply", async () => {
    await setModes({ PAUSE_SEQUENCE: "APPROVE", WITHDRAW_CONTACT: "APPROVE", CREATE_TASK: "APPROVE" });
    const run = await startRun(queue, { testIds: ["T3"] });
    await drain();
    const [r] = await byTest(run.id, "T3", "seq_q4");
    expect(r.status).toBe("NEEDS_APPROVAL");
    expect(mockState().seqs.find((s) => s.id === "seq_q4")!.status).toBe("live");
    const pause = (await prisma.fix.findMany({ where: { resultId: r.id } })).find((f) => f.action === "PAUSE_SEQUENCE")!;
    expect(pause.preview).toMatch(/Pause "Q4 Outbound"/);
    await queue.send("fix.apply", { fixId: pause.id });
    await drain();
    expect(mockState().seqs.find((s) => s.id === "seq_q4")!.status).toBe("paused");
  });

  it("E6: undo returns graph8 to 'before' and the fix shows Undone", async () => {
    const run = await startRun(queue, { testIds: ["T3"] });
    await drain();
    const [r] = await byTest(run.id, "T3", "seq_q4");
    const pause = (await prisma.fix.findMany({ where: { resultId: r.id } })).find((f) => f.action === "PAUSE_SEQUENCE")!;
    expect(mockState().seqs.find((s) => s.id === "seq_q4")!.status).toBe("paused");
    const tasksBefore = mockState().tasks.size;
    await undoFix(pause.id);
    expect(mockState().seqs.find((s) => s.id === "seq_q4")!.status).toBe("live");
    expect((await prisma.fix.findUniqueOrThrow({ where: { id: pause.id } })).status).toBe("UNDONE");
    const task = (await prisma.fix.findMany({ where: { resultId: r.id } })).find((f) => f.action === "CREATE_TASK")!;
    await undoFix(task.id);
    expect(mockState().tasks.size).toBe(tasksBefore - 1);
  });

  it("E7: a killed worker resumes without duplicate contacts or fixes", async () => {
    const run = await startRun(queue, { testIds: ["T1"] });
    await drain();
    const [r] = await byTest(run.id, "T1", "seq_q4");
    const buyers = await prisma.fakeBuyer.count();
    const fixes = await prisma.fix.count();
    // Simulate the job being re-delivered after a crash mid-test.
    await prisma.testResult.update({ where: { id: r.id }, data: { status: "RUNNING" } });
    await executeTest(queue, r.id);
    await drain();
    expect(await prisma.fakeBuyer.count()).toBe(buyers);
    expect(await prisma.fix.count()).toBe(fixes);
    const emails = (await prisma.fakeBuyer.findMany()).map((b) => b.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it("E8: clean-up leaves 0 fake buyers enrolled and no tag list", async () => {
    const run = await startRun(queue, { testIds: ["T1", "T2", "T3"] });
    await drain();
    const buyers = await prisma.fakeBuyer.findMany();
    expect(buyers.length).toBeGreaterThan(0);
    expect(buyers.every((b) => b.cleanedUp)).toBe(true);
    for (const b of buyers) expect(mockState().contacts.has(b.contactId)).toBe(false);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: run.id } })).tagListId).toBeNull();
    expect([...mockState().lists.values()].some((l) => l.name.startsWith("crash-test"))).toBe(false);
  });

  it("T4 orphan leads: re-own needs approval, preview shows the count", async () => {
    const run = await startRun(queue, { testIds: ["T4"] });
    await drain();
    const [r] = await byTest(run.id, "T4");
    expect(r.status).toBe("NEEDS_APPROVAL");
    expect(r.summary).toMatch(/3 active leads have no owner/);
    const fix = (await prisma.fix.findMany({ where: { resultId: r.id } }))[0];
    expect(fix.preview).toMatch(/3 leads/);
    await queue.send("fix.apply", { fixId: fix.id });
    await drain();
    expect((await runDTO(run.id))!.results[0].status).toBe("FIXED");
  });
});
