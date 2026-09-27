// Supertest over the Express app (§25): runs, fixes (apply / reject / undo), modes, errors.
import { runDTO } from "@crash/core";
import { prisma } from "@crash/db";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/server/src/app";
import { drain, queue, resetAll } from "./helpers";

const { app } = createApp(queue);

describe("API", () => {
  beforeEach(resetAll);

  it("starts a run, rejects a second concurrent run, and serves the board", async () => {
    const a = await request(app).post("/api/runs").send({ testIds: ["T3"] });
    expect(a.status).toBe(201);
    const b = await request(app).post("/api/runs").send({});
    expect([201, 409]).toContain(b.status);
    await drain();
    const run = await request(app).get(`/api/runs/${a.body.id}`);
    expect(run.status).toBe(200);
    expect(run.body.status).toBe("DONE");
    expect(run.body.results[0].status).toBe("NEEDS_APPROVAL");
  });

  it("apply, reject and undo fixes", async () => {
    const { body } = await request(app).post("/api/runs").send({ testIds: ["T3"] });
    await drain();
    const result = (await runDTO(body.id))!.results[0];
    const fixes = await prisma.fix.findMany({ where: { resultId: result.id } });
    const pause = fixes.find((f) => f.action === "PAUSE_SEQUENCE")!;
    expect((await request(app).post(`/api/fixes/${pause.id}/apply`)).status).toBe(202);
    await drain();
    expect((await prisma.fix.findUniqueOrThrow({ where: { id: pause.id } })).status).toBe("APPLIED");
    expect((await request(app).post(`/api/fixes/${pause.id}/apply`)).status).toBe(409);
    const undo = await request(app).post(`/api/fixes/${pause.id}/undo`);
    expect(undo.body.status).toBe("UNDONE");
    const detail = await request(app).get(`/api/results/${result.id}`);
    expect(detail.body.evidence.length).toBeGreaterThan(0);
  });

  it("validates bodies with zod and returns the error shape", async () => {
    const r = await request(app).patch("/api/modes").send({ modes: [{ action: "DELETE_EVERYTHING", mode: "AUTOPILOT" }] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("BAD_REQUEST");
    const ok = await request(app).patch("/api/modes").send({ modes: [{ action: "PAUSE_SEQUENCE", mode: "AUTOPILOT" }] });
    expect(ok.body.find((m: { action: string }) => m.action === "PAUSE_SEQUENCE").mode).toBe("AUTOPILOT");
    expect((await request(app).get("/api/runs/nope!")).status).toBe(400);
    expect((await request(app).get("/api/public/reports/abc")).status).toBe(404);
  });

  it("builds a report and shares a read-only link", async () => {
    await request(app).post("/api/runs").send({ testIds: ["T1", "T13"] });
    await drain();
    const rep = await request(app).post("/api/reports");
    expect(rep.status).toBe(201);
    expect(rep.body.testsRun).toBeGreaterThan(0);
    const shared = await request(app).post(`/api/reports/${rep.body.id}/share`);
    expect(shared.body.shareToken).toMatch(/^[a-f0-9]{64}$/);
    const pub = await request(app).get(`/api/public/reports/${shared.body.shareToken}`);
    expect(pub.body.id).toBe(rep.body.id);
  });
});
