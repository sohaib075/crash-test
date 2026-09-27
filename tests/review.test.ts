// Regression tests for the independent review's findings (#1–#9) and the
// board bug found in the full-stack walkthrough.
import { applyFix, demoReset, discoverAndStore, executeTest, gateTick, rebaseline, runDTO, startRun } from "@crash/core";
import { prisma } from "@crash/db";
import { beforeEach, describe, expect, it } from "vitest";
import { mockState } from "../packages/core/src/mock";
import { normQuote, normUser } from "../packages/core/src/graph8/normalize";
import { DEMO_MODES, drain, queue, resetAll, setModes } from "./helpers";

const results = async (runId: string) => (await runDTO(runId))!.results;

describe("review regressions", () => {
  beforeEach(async () => {
    await resetAll();
    await setModes(DEMO_MODES);
  });

  it("#1 approving a remedial fix mid-run still finalizes the run", async () => {
    const run = await startRun(queue, { testIds: ["T4", "T1"] });
    // Approve T4's re-own as soon as it is proposed, while T1 is still waiting on sends.
    for (let i = 0; i < 200; i++) {
      const fix = await prisma.fix.findFirst({ where: { action: "REOWN_VIA_LIST", status: "PROPOSED" } });
      if (fix) {
        await queue.send("fix.apply", { fixId: fix.id });
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    await drain();
    const r = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(r.status).toBe("DONE");
    expect(r.cleanedUp).toBe(true);
    expect((await results(run.id)).find((x) => x.testId === "T4")!.status).toBe("FIXED");
  });

  it("#2 + #3 'Re-run this test' after the run is cleaned up uses a fresh buyer and tidies it", async () => {
    const run = await startRun(queue, { testIds: ["T1"] });
    await drain();
    const r = (await results(run.id)).find((x) => x.targetId === "seq_q4")!;
    expect(r.status).toBe("FIXED");
    await queue.send("result.retest", { resultId: r.id });
    await drain();
    const again = (await results(run.id)).find((x) => x.id === r.id)!;
    expect(again.status).toBe("FIXED");
    expect(again.error).toBeNull();
    expect(await prisma.fakeBuyer.count({ where: { cleanedUp: false } })).toBe(0);
  });

  it("#4 a duplicated approval applies once and re-tests once", async () => {
    const run = await startRun(queue, { testIds: ["T4"] });
    await drain();
    const fix = (await prisma.fix.findFirst({ where: { action: "REOWN_VIA_LIST" } }))!;
    await queue.send("fix.apply", { fixId: fix.id });
    await queue.send("fix.apply", { fixId: fix.id });
    await drain();
    const logs = await prisma.runLog.findMany({ where: { runId: run.id, message: { startsWith: "Re-test" } } });
    expect(logs).toHaveLength(1);
    expect((await prisma.fix.findUniqueOrThrow({ where: { id: fix.id } })).status).toBe("APPLIED");
  });

  it("#4 a re-delivered test job doesn't run the test twice", async () => {
    const run = await startRun(queue, { testIds: ["T1"] });
    const r = await prisma.testResult.findFirst({ where: { runId: run.id } });
    if (r) await executeTest(queue, r.id); // extra delivery racing the queued one
    await drain();
    const emails = (await prisma.fakeBuyer.findMany()).map((b) => b.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it("#5 Reset demo restores leads that had no owner", async () => {
    const orphansBefore = [...mockState().contacts.values()].filter((c) => c.ownerId === null).map((c) => c.id).sort();
    const run = await startRun(queue, { testIds: ["T4"] });
    await drain();
    const fix = (await prisma.fix.findFirst({ where: { action: "REOWN_VIA_LIST" } }))!;
    await applyFix(fix.id);
    expect([...mockState().contacts.values()].filter((c) => c.ownerId === null)).toHaveLength(0);
    await demoReset();
    const orphansAfter = [...mockState().contacts.values()].filter((c) => c.ownerId === null).map((c) => c.id).sort();
    expect(orphansAfter).toEqual(orphansBefore);
    void run;
  });

  it("#6 a failed approval leaves the card actionable, and the fix can be retried", async () => {
    await startRun(queue, { testIds: ["T4"] });
    await drain();
    const fix = (await prisma.fix.findFirst({ where: { action: "REOWN_VIA_LIST" } }))!;
    const mock = (await import("../packages/core/src/mock")).mockBackend;
    const real = mock.reownViaList;
    mock.reownViaList = async () => { throw new Error("graph8 error 503"); };
    try {
      await queue.send("fix.apply", { fixId: fix.id });
      await drain();
    } finally {
      mock.reownViaList = real;
    }
    expect((await prisma.fix.findUniqueOrThrow({ where: { id: fix.id } })).status).toBe("FAILED");
    const r = await prisma.testResult.findUniqueOrThrow({ where: { id: fix.resultId } });
    expect(["FAIL", "NEEDS_APPROVAL"]).toContain(r.status);
    // Retry from the API path: FAILED goes back to PROPOSED and applies.
    await prisma.fix.update({ where: { id: fix.id }, data: { status: "PROPOSED", appliedAt: null, error: null } });
    await queue.send("fix.apply", { fixId: fix.id });
    await drain();
    expect((await prisma.fix.findUniqueOrThrow({ where: { id: fix.id } })).status).toBe("APPLIED");
    expect((await prisma.testResult.findUniqueOrThrow({ where: { id: fix.resultId } })).status).toBe("FIXED");
  });

  it("#7 a gate run that can't be planned releases its gate event", async () => {
    await discoverAndStore();
    await rebaseline();
    mockState().seqs.find((s) => s.id === "seq_in")!.steps[0].body = "Changed copy. Unsubscribe: {{unsubscribe_link}}";
    const mock = (await import("../packages/core/src/mock")).mockBackend;
    const sandbox = mock.sandboxStatus;
    mock.sandboxStatus = async () => {
      throw new Error("graph8 is unreachable");
    };
    try {
      await gateTick(queue);
      await drain();
    } finally {
      mock.sandboxStatus = sandbox;
    }
    const ev = await prisma.gateEvent.findFirstOrThrow({ include: { run: true } });
    expect(ev.result).toBe("RELEASED");
    expect(ev.run!.status).toBe("FAILED");
    expect(ev.message).toMatch(/Could not check/);
  });

  it("#9 approving a record-only fix does not re-test", async () => {
    await setModes({ CREATE_TASK: "APPROVE" });
    const run = await startRun(queue, { testIds: ["T3"] });
    await drain();
    const r = (await results(run.id)).find((x) => x.targetId === "seq_q4")!;
    expect(r.status).toBe("FIXED"); // pause ran on Autopilot and re-tested; the task still waits
    const task = (await prisma.fix.findFirst({ where: { resultId: r.id, action: "CREATE_TASK" } }))!;
    const retestsBefore = await prisma.runLog.count({ where: { runId: run.id, message: { startsWith: "Re-test" } } });
    await queue.send("fix.apply", { fixId: task.id });
    await drain();
    expect(await prisma.runLog.count({ where: { runId: run.id, message: { startsWith: "Re-test" } } })).toBe(retestsBefore);
    expect((await results(run.id)).find((x) => x.id === r.id)!.status).toBe("FIXED");
  });

  it("live totals never exceed open pipeline, even mid-run", async () => {
    const run = await startRun(queue, {});
    const open = mockState().deals.reduce((n, d) => n + (d.amount ?? 0), 0);
    let worst = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      const d = await runDTO(run.id);
      worst = Math.max(worst, d?.totals.pipelineAtRisk ?? 0);
      if (d?.status === "DONE") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await drain();
    expect(worst).toBeLessThanOrEqual(open);
  });

  it("normalizers: PropelAuth ids first, quote totals in cents", () => {
    const u = normUser({ id: 42, propel_auth_id: "pa_1", email: "A@x.test", first_name: "A" });
    expect(u.id).toBe("pa_1");
    expect(u.aliases).toEqual(["pa_1", "42"]);
    expect(normQuote({ id: "q", total: 1200000, line_items: [{ unit_amount: 600000, quantity: 2 }] }).total).toBe(12000);
    expect(normQuote({ id: "q", total: 12000, line_items: [{ unit_amount: 600000, quantity: 2 }] }).total).toBe(12000);
  });
});

describe("undo with several pauses on one sequence", () => {
  beforeEach(async () => {
    await resetAll();
    await setModes(DEMO_MODES);
  });
  it("resumes only when the last pause is undone, and says why otherwise", async () => {
    const { undoFix } = await import("@crash/core");
    await startRun(queue, { testIds: ["T1", "T3", "T7"] });
    await drain();
    const pauses = await prisma.fix.findMany({ where: { action: "PAUSE_SEQUENCE", status: "APPLIED", targetId: "seq_q4" }, orderBy: { appliedAt: "asc" } });
    expect(pauses.length).toBe(3);
    const q4 = () => mockState().seqs.find((s) => s.id === "seq_q4")!.status;
    await undoFix(pauses[2].id);
    expect(q4()).toBe("paused");
    expect((await prisma.fix.findUniqueOrThrow({ where: { id: pauses[2].id } })).error).toMatch(/Still paused: 2 other fixes/);
    await undoFix(pauses[1].id);
    expect(q4()).toBe("paused");
    await undoFix(pauses[0].id);
    expect(q4()).toBe("live");
  });
});
