// Live-safe mode: on a live key (no sandbox) only read-only checks run. No fake
// buyers, no email, nothing changes in graph8 unless someone approves a fix.
import { discoverAndStore, gateTick, loadSettings, makeCtx, rebaseline, runDTO, startRun } from "@crash/core";
import { prisma } from "@crash/db";
import { LIVE_SAFE_TESTS, type TestId } from "@crash/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockBackend, mockState } from "../packages/core/src/mock";
import { DEMO_MODES, drain, queue, resetAll, setModes } from "./helpers";

const ALL: TestId[] = ["T1", "T2", "T3", "T4", "T7", "T8", "T9", "T11", "T13"];
const sandboxStatus = mockBackend.sandboxStatus;
const snapshot = () => {
  const m = mockState();
  return JSON.stringify({
    seqs: m.seqs.map((s) => [s.id, s.status, s.steps.map((x) => x.body)]),
    tasks: m.tasks.size,
    notes: m.notes.size,
    lists: [...m.lists.keys()],
    contacts: [...m.contacts.values()].map((c) => [c.id, c.ownerId, c.suppressed, [...c.sequences]]),
  });
};

describe("live-safe mode (live key)", () => {
  beforeEach(async () => {
    await resetAll();
    // Autopilot everywhere: live-safe must still change nothing without an approval.
    await setModes({ ...DEMO_MODES, REOWN_VIA_LIST: "AUTOPILOT", ADD_DEAL_NOTE: "AUTOPILOT" });
    mockBackend.sandboxStatus = async () => ({ sandbox: false, keyMode: "live", writable: true, workspaceId: "mock-demo", name: "Live org" });
  });
  afterEach(() => {
    mockBackend.sandboxStatus = sandboxStatus;
    delete process.env.LIVE_SAFE_MODE;
  });

  it("runs only the read-only checks and changes nothing in graph8", async () => {
    const before = snapshot();
    const run = await startRun(queue, { testIds: ALL });
    await drain();
    const dto = (await runDTO(run.id))!;
    expect(dto.status).toBe("DONE");
    expect(dto.liveSafe).toBe(true);
    const ran = new Set(dto.results.map((r) => r.testId));
    expect([...ran].every((id) => LIVE_SAFE_TESTS.includes(id))).toBe(true);
    for (const id of ["T4", "T7", "T13"] as TestId[]) expect(ran.has(id)).toBe(true);
    // Findings are still found and explained…
    expect(dto.results.some((r) => r.status === "NEEDS_APPROVAL")).toBe(true);
    // …but no fake buyer, no applied fix, no change in graph8.
    expect(await prisma.fakeBuyer.count()).toBe(0);
    const fixes = await prisma.fix.findMany({ where: { result: { runId: run.id } } });
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.every((f) => f.status !== "APPLIED" && (f.mode === "APPROVE" || f.mode === "OFF"))).toBe(true);
    expect(snapshot()).toBe(before);
    expect(dto.logs.some((l) => /live-safe mode/.test(l.message) && /Skipped/.test(l.message))).toBe(true);
  });

  it("never creates a fake buyer on a live-safe run, even if a test asks", async () => {
    const run = await startRun(queue, { testIds: ["T4"] });
    await drain();
    const { ws } = await discoverAndStore();
    const ctx = makeCtx(run.id, ws, await loadSettings());
    await expect(ctx.buyer("T1", "seq_q4")).rejects.toThrow(/live-safe/);
  });

  it("the gate still catches a bad edit, but doesn't pause a live sequence by itself", async () => {
    await discoverAndStore();
    await rebaseline();
    mockState().seqs.find((s) => s.id === "seq_in")!.steps[0].body = "Hi {{first_name|there}}, sign this week and we guarantee 50% off your first year.\n\nUnsubscribe: {{unsubscribe_link}}";
    await gateTick(queue);
    await drain();
    const ev = await prisma.gateEvent.findFirstOrThrow({ include: { run: { include: { results: { include: { fixes: true } } } } } });
    expect(ev.result).toBe("BLOCKED");
    expect(ev.message).toMatch(/Not paused/);
    expect(mockState().seqs.find((s) => s.id === "seq_in")!.status).toBe("live");
    const pause = ev.run!.results.flatMap((r) => r.fixes).find((f) => f.action === "PAUSE_SEQUENCE")!;
    expect([pause.status, pause.mode]).toEqual(["PROPOSED", "APPROVE"]);
  });

  it("LIVE_SAFE_MODE=off refuses live keys like before", async () => {
    process.env.LIVE_SAFE_MODE = "off";
    const run = await startRun(queue, { testIds: ["T4"] });
    await drain();
    const r = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(r.status).toBe("FAILED");
    expect(r.error).toMatch(/Safety/);
  });
});
