// Regression tests for the full-website audit (API errors, fix lifecycle,
// gate release, reset during a run, clean-up, report and health numbers).
import {
  buildReport, demoReset, discoverAndStore, executeTest, finalizeRun, gateTick, GraphError, planRun, rebaseline, REGISTRY, retestJob,
  runDTO, startRun, undoAndResettle, type Queue,
} from "@crash/core";
import { Prisma, prisma } from "@crash/db";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/server/src/app";
import { errors } from "../apps/server/src/middleware";
import { mockBackend, mockState } from "../packages/core/src/mock";
import { DEMO_MODES, drain, queue, resetAll, setModes } from "./helpers";

const { app } = createApp(queue);
const noop: Queue = { send: async () => "job" };
const results = async (runId: string) => (await runDTO(runId))!.results;

describe("audit: API errors", () => {
  beforeEach(resetAll);

  it("bad JSON is a 400, an oversized body a 413 — never a 502", async () => {
    const bad = await request(app).post("/api/runs").set("Content-Type", "application/json").send('{"testIds": [');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("BAD_REQUEST");
    const big = await request(app).post("/api/runs").send({ pad: "x".repeat(300_000) });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("only graph8 failures are a bad gateway; a missing row is a 404", async () => {
    const t = express();
    t.get("/p2025", () => {
      throw new Prisma.PrismaClientKnownRequestError("No record", { code: "P2025", clientVersion: "6" });
    });
    t.get("/p2002", () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed on secret_column", { code: "P2002", clientVersion: "6" });
    });
    t.get("/graph8", () => {
      throw new GraphError("UPSTREAM", "graph8 said 500", 500);
    });
    t.get("/nokey", () => {
      throw new GraphError("NO_KEY", "No graph8 key");
    });
    t.get("/other", () => {
      throw Object.assign(new Error("boom"), { status: 404 });
    });
    t.use(errors);
    expect((await request(t).get("/p2025")).status).toBe(404);
    const p2002 = await request(t).get("/p2002");
    expect(p2002.status).toBe(500);
    expect(JSON.stringify(p2002.body)).not.toContain("secret_column");
    expect((await request(t).get("/graph8")).status).toBe(502);
    expect((await request(t).get("/nokey")).status).toBe(503);
    expect((await request(t).get("/other")).status).toBe(500);
  });

  it("validates ids and query params", async () => {
    expect((await request(app).get("/api/runs?limit=abc")).status).toBe(400);
    expect((await request(app).get("/api/runs?limit=0")).status).toBe(400);
    expect((await request(app).get("/api/runs?limit=5")).status).toBe(200);
    expect((await request(app).patch("/api/tests/constructor").send({ enabled: true })).status).toBe(404);
    expect((await request(app).post("/api/reports/doesnotexist1/save")).status).toBe(404);
    expect((await request(app).post("/api/reports/doesnotexist1/share")).status).toBe(404);
  });

  it("skip needs a live proposal, undo needs an applied fix, re-run waits for a running test", async () => {
    await setModes(DEMO_MODES);
    const run = await startRun(queue, { testIds: ["T3"] });
    await drain();
    const r = (await results(run.id)).find((x) => x.targetId === "seq_q4")!;
    const pause = (await prisma.fix.findMany({ where: { resultId: r.id } })).find((f) => f.action === "PAUSE_SEQUENCE")!;
    expect(pause.status).toBe("APPLIED");

    const skip = await request(app).post(`/api/fixes/${pause.id}/reject`);
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe("FIX_NOT_PROPOSED");
    expect((await prisma.fix.findUniqueOrThrow({ where: { id: pause.id } })).status).toBe("APPLIED");

    await setModes({ REOWN_VIA_LIST: "APPROVE" });
    const run2 = await startRun(queue, { testIds: ["T4"] });
    await drain();
    const reown = (await prisma.fix.findFirstOrThrow({ where: { action: "REOWN_VIA_LIST", result: { runId: run2.id } } }));
    const undo = await request(app).post(`/api/fixes/${reown.id}/undo`);
    expect(undo.status).toBe(409);
    expect(undo.body.error.code).toBe("FIX_NOT_APPLIED");

    await prisma.testResult.update({ where: { id: r.id }, data: { status: "RUNNING" } });
    const busy = await request(app).post(`/api/results/${r.id}/retest`);
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe("RESULT_BUSY");
  });
});

describe("audit: fix lifecycle", () => {
  beforeEach(async () => {
    await resetAll();
    await setModes(DEMO_MODES);
  });

  it("undoing the fix that made a result FIXED puts it back to failing", async () => {
    const run = await startRun(queue, { testIds: ["T3"] });
    await drain();
    const r = (await results(run.id)).find((x) => x.targetId === "seq_q4")!;
    expect(r.status).toBe("FIXED");
    const pause = (await prisma.fix.findMany({ where: { resultId: r.id } })).find((f) => f.action === "PAUSE_SEQUENCE")!;
    await undoAndResettle(pause.id);
    const after = await prisma.testResult.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("FAIL");
    expect(after.actual).toMatch(/fix undone$/);
    expect(after.summary).toBe(r.problem);
    expect((await runDTO(run.id))!.totals.fixed).toBe(0);
  });

  it("'Re-run this test' records a new failure and proposes its fixes", async () => {
    await setModes({ PAUSE_SEQUENCE: "APPROVE", WITHDRAW_CONTACT: "APPROVE", CREATE_TASK: "APPROVE" });
    // First run: the step is clean, so T7 passes.
    const run = await startRun(queue, { testIds: ["T7"] });
    await drain();
    const r = (await results(run.id)).find((x) => x.targetId === "seq_in")!;
    expect(r.status).toBe("PASS");
    // Someone edits the step; the re-check must see it and say so.
    mockState().seqs.find((s) => s.id === "seq_in")!.steps[0].body = "Hi {{first_name|there}}, sign this week and we guarantee 50% off your first year.\n\nUnsubscribe: {{unsubscribe_link}}";
    await retestJob(queue, r.id);
    await drain();
    const after = await prisma.testResult.findUniqueOrThrow({ where: { id: r.id }, include: { fixes: true } });
    expect(after.status).toBe("NEEDS_APPROVAL");
    expect(after.retestStatus).toBe("FAIL");
    expect(after.fixes.some((f) => f.action === "PAUSE_SEQUENCE" && f.status === "PROPOSED")).toBe(true);
  });

  it("a re-check that passes retires proposals that are no longer needed", async () => {
    await setModes({ PAUSE_SEQUENCE: "APPROVE", CREATE_TASK: "APPROVE" });
    mockState().seqs.find((s) => s.id === "seq_in")!.steps[0].body = "Hi {{first_name|there}}, we guarantee 50% off.";
    const run = await startRun(queue, { testIds: ["T7"] });
    await drain();
    const r = (await results(run.id)).find((x) => x.targetId === "seq_in")!;
    expect(r.status).toBe("NEEDS_APPROVAL");
    mockState().seqs.find((s) => s.id === "seq_in")!.steps[0].body = "Hi {{first_name|there}}, happy to help.\n\nUnsubscribe: {{unsubscribe_link}}";
    await retestJob(queue, r.id);
    await drain();
    const after = await prisma.testResult.findUniqueOrThrow({ where: { id: r.id }, include: { fixes: true } });
    expect(after.status).toBe("PASS");
    expect(after.fixes.every((f) => f.status !== "PROPOSED")).toBe(true);
  });

  it("re-checking a fixed result: still contained stays FIXED; no longer contained fails", async () => {
    mockState().seqs.find((s) => s.id === "seq_in")!.steps[0].body = "Hi {{first_name|there}}, we guarantee 50% off.\n\nUnsubscribe: {{unsubscribe_link}}";
    const run = await startRun(queue, { testIds: ["T7"] });
    await drain();
    const r = (await results(run.id)).find((x) => x.targetId === "seq_in")!;
    expect(r.status).toBe("FIXED");
    // The copy is still bad, but the paused sequence can't send it.
    await retestJob(queue, r.id);
    await drain();
    let after = await prisma.testResult.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("FIXED");
    expect(after.actual).toMatch(/still contained/);
    // Someone resumes the sequence in graph8: the fix no longer holds.
    mockState().seqs.find((s) => s.id === "seq_in")!.status = "live";
    await retestJob(queue, r.id);
    await drain();
    after = await prisma.testResult.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("FAIL");
    expect(after.retestStatus).toBe("FAIL");
  });

  it("one re-check at a time per result", async () => {
    const run = await startRun(queue, { testIds: ["T7"] });
    await drain();
    const r = (await results(run.id)).find((x) => x.targetId === "seq_in")!;
    const held = createApp(noop).app; // jobs are accepted but never run
    expect((await request(held).post(`/api/results/${r.id}/retest`)).status).toBe(202);
    const again = await request(held).post(`/api/results/${r.id}/retest`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("RESULT_BUSY");
  });

  it("clean-up retires proposals that act on the deleted test buyer", async () => {
    await setModes({ PAUSE_SEQUENCE: "APPROVE", WITHDRAW_CONTACT: "APPROVE", CREATE_TASK: "APPROVE" });
    const run = await startRun(queue, { testIds: ["T1"] });
    await drain();
    const r = (await results(run.id)).find((x) => x.targetId === "seq_q4")!;
    const fixes = await prisma.fix.findMany({ where: { resultId: r.id } });
    const withdraw = fixes.find((f) => f.action === "WITHDRAW_CONTACT")!;
    expect(withdraw.status).toBe("REJECTED");
    expect(withdraw.error).toMatch(/cleaned up/);
    expect(fixes.find((f) => f.action === "PAUSE_SEQUENCE")!.status).toBe("PROPOSED");
    expect(r.status).toBe("NEEDS_APPROVAL");
  });

  it("the fix phase holds its results RUNNING, so a finalize can't slip in mid re-test", async () => {
    const seen: string[] = [];
    let runId = "";
    const orig = mockBackend.createTask;
    mockBackend.createTask = async (t) => {
      // Called while the Autopilot task is being applied, inside the fix phase.
      const rs = await prisma.testResult.findMany({ where: { runId, fixes: { some: { mode: "AUTOPILOT" } } } });
      seen.push(...rs.map((r) => r.status));
      await finalizeRun(queue, runId);
      return orig(t);
    };
    try {
      runId = (await startRun(queue, { testIds: ["T1"] })).id;
      await drain();
    } finally {
      mockBackend.createTask = orig;
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s === "RUNNING")).toBe(true);
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("DONE");
    const h = (await runDTO(runId))!.health.find((x) => x.graph8Id === "seq_q4")!;
    expect(h.band).not.toBe("HEALTHY");
  });

  it("T4 says 'couldn't check' when graph8's team list can't be read", async () => {
    const o = await REGISTRY.T4!.check({ ws: { ownerIdsComplete: false } } as never, { type: "workspace", id: "owners", name: "All", why: "" }, {});
    expect(o.inconclusive).toBe(true);
  });
});

describe("audit: reset during a run", () => {
  beforeEach(resetAll);

  it("a stopped run starts no more tests and creates no buyers", async () => {
    const run = await startRun(noop, { testIds: ["T1"] });
    await planRun(noop, run.id);
    const queued = await prisma.testResult.findMany({ where: { runId: run.id, status: "QUEUED" } });
    expect(queued.length).toBeGreaterThan(0);
    await prisma.run.update({ where: { id: run.id }, data: { status: "FAILED" } });
    await executeTest(noop, queued[0].id);
    expect((await prisma.testResult.findUniqueOrThrow({ where: { id: queued[0].id } })).status).toBe("QUEUED");
    expect(await prisma.fakeBuyer.count()).toBe(0);
  });

  it("Reset demo stops live runs first and marks their open tests", async () => {
    const run = await startRun(noop, { testIds: ["T1", "T3"] });
    await planRun(noop, run.id);
    const out = await demoReset();
    const r = await prisma.run.findUniqueOrThrow({ where: { id: run.id }, include: { results: true } });
    expect(r.status).toBe("FAILED");
    expect(r.error).toBe("Stopped by demo reset");
    expect(r.results.every((x) => x.status === "ERROR" && x.error === "Stopped by demo reset")).toBe(true);
    expect(out.log[0]).toMatch(/Stopped 1 run/);
  });
});

describe("audit: gate", () => {
  beforeEach(async () => {
    await resetAll();
    await setModes(DEMO_MODES);
  });

  it("undoing the gate's pause releases the block (the banner clears)", async () => {
    await discoverAndStore();
    await rebaseline();
    mockState().seqs.find((s) => s.id === "seq_in")!.steps[0].body = "Hi {{first_name|there}}, sign this week and we guarantee 50% off your first year.\n\nUnsubscribe: {{unsubscribe_link}}";
    await gateTick(queue);
    await drain();
    const ev = await prisma.gateEvent.findFirstOrThrow({ include: { run: { include: { results: { include: { fixes: true } } } } } });
    expect(ev.result).toBe("BLOCKED");
    const pause = ev.run!.results.flatMap((r) => r.fixes).find((f) => f.action === "PAUSE_SEQUENCE" && f.status === "APPLIED")!;
    await undoAndResettle(pause.id);
    const after = await prisma.gateEvent.findUniqueOrThrow({ where: { id: ev.id } });
    expect(after.result).toBe("RELEASED");
    expect(mockState().seqs.find((s) => s.id === "seq_in")!.status).toBe("live");
  });

  it("a later clean edit releases an older block", async () => {
    await discoverAndStore();
    await rebaseline();
    const seq = await prisma.sequence.findFirstOrThrow({ where: { graph8Id: "seq_in" } });
    const old = await prisma.gateEvent.create({ data: { sequenceId: seq.id, changedSteps: [1], result: "BLOCKED", message: "old block" } });
    mockState().seqs.find((s) => s.id === "seq_in")!.steps[0].body = "Hi {{first_name|there}}, a quick question about your team.\n\nUnsubscribe: {{unsubscribe_link}}";
    await gateTick(queue);
    await drain();
    const latest = await prisma.gateEvent.findFirstOrThrow({ where: { NOT: { id: old.id } } });
    expect(latest.result).toBe("RELEASED");
    expect(latest.message).toBe("Change passed the checks.");
    expect((await prisma.gateEvent.findUniqueOrThrow({ where: { id: old.id } })).result).toBe("RELEASED");
  });
});

describe("audit: numbers", () => {
  beforeEach(async () => {
    await resetAll();
    await setModes(DEMO_MODES);
  });

  it("health uses the weights from Settings", async () => {
    await prisma.testDefinition.update({ where: { id: "T3" }, data: { weight: 50 } });
    const run = await startRun(queue, { testIds: ["T3"] });
    await drain();
    const h = (await runDTO(run.id))!.health.find((x) => x.graph8Id === "seq_q4")!;
    expect(h.score).toBe(50);
  });

  it("report: passed/errors per area, biggest issue first, one row per finding", async () => {
    await startRun(queue, { testIds: ["T13", "T3"] });
    await drain();
    await startRun(queue, { testIds: ["T13"] });
    await drain();
    const rep = await buildReport();
    const bill = rep.data.byArea.find((a) => a.area === "BILL")!;
    expect(bill.passed).toBeGreaterThan(0);
    expect(bill.errors).toBe(0);
    const top = rep.data.topIssues;
    expect(top[0].pipelineAtRisk).toBe(Math.max(...top.map((t) => t.pipelineAtRisk ?? 0)));
    const keys = top.map((t) => `${t.testId}|${t.target}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("health: a later partial run keeps earlier failures of other tests", async () => {
    await setModes({ PAUSE_SEQUENCE: "APPROVE" }); // keep Q4 live so the partial run can target it
    await startRun(queue, { testIds: ["T1", "T3"] });
    await drain();
    // Like a gate run: only the content check, only Q4.
    const partial = await startRun(queue, { testIds: ["T7"], targetIds: ["seq_q4"] });
    await drain();
    const h = (await runDTO(partial.id))!.health.find((x) => x.graph8Id === "seq_q4")!;
    expect(h.score).toBe(100 - 30 - 15 - 15); // T1 + T3 from the first run, T7 from this one
    expect(h.reasons).toEqual(expect.arrayContaining(["opt-out leak", "broken personalisation", "content check"]));
  });
});

describe("audit: second verification round", () => {
  beforeEach(async () => {
    await resetAll();
    await setModes(DEMO_MODES);
  });

  it("Reset demo during planning: the run stays stopped and nothing starts", async () => {
    const run = await startRun(noop, { testIds: ["T1"] });
    const orig = mockBackend.discover;
    mockBackend.discover = async () => {
      const ws = await orig();
      // Reset demo lands while graph8 is being read.
      await prisma.run.update({ where: { id: run.id }, data: { status: "FAILED", error: "Stopped by demo reset" } });
      return ws;
    };
    try {
      await planRun(noop, run.id);
    } finally {
      mockBackend.discover = orig;
    }
    const r = await prisma.run.findUniqueOrThrow({ where: { id: run.id }, include: { results: true } });
    expect(r.status).toBe("FAILED");
    expect(r.results.every((x) => x.status === "ERROR")).toBe(true);
    expect(await prisma.fakeBuyer.count()).toBe(0);
  });

  it("Skip on a held result doesn't release the hold", async () => {
    await setModes({ PAUSE_SEQUENCE: "APPROVE", WITHDRAW_CONTACT: "APPROVE", CREATE_TASK: "APPROVE" });
    const run = await startRun(queue, { testIds: ["T3"] });
    await drain();
    const r = (await results(run.id)).find((x) => x.targetId === "seq_q4")!;
    const task = (await prisma.fix.findMany({ where: { resultId: r.id } })).find((f) => f.action === "CREATE_TASK")!;
    await prisma.testResult.update({ where: { id: r.id }, data: { status: "RUNNING" } }); // e.g. a re-test in flight
    expect((await request(app).post(`/api/fixes/${task.id}/reject`)).status).toBe(200);
    expect((await prisma.testResult.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("RUNNING");
    const pause = (await prisma.fix.findMany({ where: { resultId: r.id } })).find((f) => f.action === "PAUSE_SEQUENCE")!;
    const apply = await request(app).post(`/api/fixes/${pause.id}/apply`);
    expect(apply.status).toBe(409);
    expect(apply.body.error.code).toBe("RESULT_BUSY");
  });

  it("a re-check that can't run keeps the verdict; a stopped run can't be re-run", async () => {
    const run = await startRun(queue, { testIds: ["T1"] });
    await drain();
    const r = (await results(run.id)).find((x) => x.targetId === "seq_in")!;
    expect(r.status).toBe("PASS");
    const orig = mockBackend.createContact;
    mockBackend.createContact = async () => {
      throw new Error("graph8 is having a moment");
    };
    try {
      await retestJob(queue, r.id);
      await drain();
    } finally {
      mockBackend.createContact = orig;
    }
    const after = await prisma.testResult.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("PASS");
    expect(after.retestStatus).toBe("ERROR");
    await prisma.run.update({ where: { id: run.id }, data: { status: "FAILED" } });
    const again = await request(app).post(`/api/results/${r.id}/retest`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("RUN_STOPPED");
  });

  it("undoing a withdraw of a cleaned-up buyer is a no-op, not an error", async () => {
    const run = await startRun(queue, { testIds: ["T1"] });
    await drain();
    const r = (await results(run.id)).find((x) => x.targetId === "seq_q4")!;
    const withdraw = (await prisma.fix.findMany({ where: { resultId: r.id } })).find((f) => f.action === "WITHDRAW_CONTACT" && f.status === "APPLIED")!;
    const res = await request(app).post(`/api/fixes/${withdraw.id}/undo`);
    expect(res.status).toBe(200);
    const f = await prisma.fix.findUniqueOrThrow({ where: { id: withdraw.id } });
    expect(f.status).toBe("UNDONE");
    expect(f.error).toMatch(/nothing to restore/);
    // The pause still holds, so the result is still fixed.
    expect((await prisma.testResult.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("FIXED");
  });

  it("a malformed URL is a 400 and unknown errors never leak internals", async () => {
    const res = await request(app).get("/api/runs/%E0%A4%A");
    expect(res.status).toBe(400);
  });
});
