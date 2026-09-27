// Express 5 app with every route from build plan v4 §20. Exported separately
// from index.ts so Supertest can drive it without a port.
import {
  approveFix, buildReport, cleanupRun, demoReset, discoverAndStore, JOBS, loadSettings, readiness, rejectFix,
  reportDTO, resultDetail, runDTO, saveReportToGraph8, shareReport, startRun, totals, undoAndResettle, workspaceDTO,
  type Queue,
} from "@crash/core";
import { prisma } from "@crash/db";
import { PatchModesBody, PatchSettingsBody, PatchTestBody, StartRunBody, TEST_BY_ID, type TestId } from "@crash/shared";
import cors from "cors";
import express, { type Request } from "express";
import { z } from "zod";
import { requirePassword } from "./auth";
import { body, errors, HttpError, requestLog } from "./middleware";

export function createApp(queue: Queue) {
  const app = express();
  app.set("trust proxy", "loopback"); // behind the web app's proxy in production
  app.disable("x-powered-by");
  app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" }));
  app.use(requirePassword);
  app.use(express.json({ limit: "200kb" }));
  app.use(requestLog);

  const id = (req: Request) => {
    const v = String(req.params.id ?? "");
    if (!/^[\w-]{6,80}$/.test(v)) throw new HttpError(400, "BAD_ID", "Invalid id");
    return v;
  };
  const notFound = (what: string) => new HttpError(404, "NOT_FOUND", `${what} not found`);

  app.get("/api/health", (_req, res) => void res.json({ ok: true }));

  // ---- readiness + demo
  app.get("/api/ready", async (req, res) => void res.json(await readiness({ lite: req.query.lite === "1" })));
  app.post("/api/demo/reset", async (_req, res) => void res.json(await demoReset()));
  app.post("/api/cleanup", async (_req, res) => void res.json({ cleaned: await cleanupRun() }));

  // ---- workspace + sequences
  app.get("/api/workspace", async (_req, res) => {
    const ws = await workspaceDTO();
    if (ws) return void res.json(ws);
    await discoverAndStore();
    res.json(await workspaceDTO());
  });
  app.post("/api/workspace/discover", async (_req, res) => {
    await discoverAndStore();
    res.json(await workspaceDTO());
  });
  app.get("/api/sequences", async (_req, res) => void res.json((await workspaceDTO())?.sequences ?? []));
  app.get("/api/sequences/:id", async (req, res) => {
    const seq = (await workspaceDTO())?.sequences.find((s) => s.id === req.params.id || s.graph8Id === req.params.id);
    if (!seq) throw notFound("Sequence");
    const row = await prisma.sequence.findFirst({ where: { OR: [{ id: seq.id }, { graph8Id: seq.graph8Id }] } });
    const history = row
      ? await prisma.testResult.findMany({ where: { OR: [{ targetId: row.graph8Id }, { targetId: { contains: row.graph8Id } }] }, orderBy: { createdAt: "desc" }, take: 40 })
      : [];
    const gate = row ? await prisma.gateEvent.findMany({ where: { sequenceId: row.id }, orderBy: { detectedAt: "desc" }, take: 20 }) : [];
    res.json({ ...seq, history: history.map((h) => ({ id: h.id, runId: h.runId, testId: h.testId, testName: TEST_BY_ID[h.testId as TestId]?.name, status: h.status, summary: h.summary, at: h.createdAt })), gate });
  });

  // ---- runs
  app.post("/api/runs", async (req, res) => {
    const b = body(StartRunBody, req);
    const active = await prisma.run.findFirst({ where: { trigger: "MANUAL", status: { in: ["QUEUED", "PLANNING", "RUNNING"] } } });
    if (active) throw new HttpError(409, "RUN_IN_PROGRESS", "A run is already in progress", `Open /runs/${active.id}`);
    const run = await startRun(queue, { trigger: "MANUAL", ...b });
    res.status(201).json({ id: run.id });
  });
  app.get("/api/runs", async (req, res) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(req.query);
    if (!q.success) throw new HttpError(400, "BAD_REQUEST", "limit must be a whole number from 1 to 50");
    const take = q.data.limit;
    const runs = await prisma.run.findMany({ orderBy: { startedAt: "desc" }, take, include: { results: true } });
    res.json(runs.map((r) => ({ id: r.id, trigger: r.trigger, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, totals: totals(r.results, r) })));
  });
  app.get("/api/runs/:id", async (req, res) => {
    const run = await runDTO(id(req));
    if (!run) throw notFound("Run");
    res.json(run);
  });

  // ---- results + fixes
  app.get("/api/results/:id", async (req, res) => {
    const r = await resultDetail(id(req));
    if (!r) throw notFound("Result");
    res.json(r);
  });
  app.post("/api/results/:id/retest", async (req, res) => {
    const r = await prisma.testResult.findUnique({ where: { id: id(req) }, include: { run: true } });
    if (!r) throw notFound("Result");
    if (r.run.status === "FAILED") throw new HttpError(409, "RUN_STOPPED", "This run was stopped, so its tests can't run again.", "Start a new run.");
    // Claim it: one re-check at a time. A claim older than 10 minutes on a finished run is stale (lost job).
    const stale = new Date(Date.now() - 10 * 60_000);
    const claim = await prisma.testResult.updateMany({
      where: {
        id: r.id,
        OR: [
          { status: { notIn: ["QUEUED", "RUNNING"] }, OR: [{ retestStatus: null }, { retestStatus: { notIn: ["QUEUED", "RUNNING"] } }] },
          { updatedAt: { lt: stale }, run: { is: { status: { not: "RUNNING" } } } },
        ],
      },
      data: { retestStatus: "QUEUED" },
    });
    if (!claim.count) throw new HttpError(409, "RESULT_BUSY", "This test is already running");
    try {
      await queue.send(JOBS.retest, { resultId: r.id }, { singletonKey: `retest-${r.id}` });
    } catch (err) {
      // Not queued: release the claim so the button doesn't stay "Running…".
      await prisma.testResult.updateMany({ where: { id: r.id, retestStatus: "QUEUED" }, data: { retestStatus: r.retestStatus } });
      throw err;
    }
    res.status(202).json({ ok: true });
  });
  app.post("/api/fixes/:id/apply", async (req, res) => {
    const f = await prisma.fix.findUnique({ where: { id: id(req) }, include: { result: true } });
    if (!f) throw notFound("Fix");
    // A check or re-test is running on this result: applying now would race it.
    if (f.result.status === "RUNNING" || f.result.status === "QUEUED") throw new HttpError(409, "RESULT_BUSY", "Wait for the check to finish, then apply.");
    if (f.status === "FAILED") await prisma.fix.update({ where: { id: f.id }, data: { status: "PROPOSED", appliedAt: null, error: null } });
    else if (f.status !== "PROPOSED" || f.appliedAt) throw new HttpError(409, "FIX_NOT_PROPOSED", `Fix is ${f.appliedAt && f.status === "PROPOSED" ? "being applied" : f.status.toLowerCase()}`);
    await queue.send(JOBS.fix, { fixId: f.id }, { singletonKey: `apply-${f.id}` });
    res.status(202).json({ ok: true });
  });
  app.post("/api/fixes/:id/reject", async (req, res) => {
    const fixId = id(req);
    if (!(await prisma.fix.findUnique({ where: { id: fixId } }))) throw notFound("Fix");
    await rejectFix(queue, fixId);
    res.json({ ok: true });
  });
  app.post("/api/fixes/:id/undo", async (req, res) => {
    const fixId = id(req);
    if (!(await prisma.fix.findUnique({ where: { id: fixId } }))) throw notFound("Fix");
    const f = await undoAndResettle(fixId);
    res.json({ ok: true, status: f.status });
  });

  // ---- modes, tests, settings
  app.get("/api/modes", async (_req, res) => void res.json(await prisma.fixModeSetting.findMany({ orderBy: { action: "asc" } })));
  app.patch("/api/modes", async (req, res) => {
    const b = body(PatchModesBody, req);
    for (const m of b.modes) await prisma.fixModeSetting.upsert({ where: { action: m.action }, create: m, update: { mode: m.mode } });
    res.json(await prisma.fixModeSetting.findMany({ orderBy: { action: "asc" } }));
  });
  app.get("/api/tests", async (_req, res) => {
    const defs = await prisma.testDefinition.findMany();
    res.json(defs.map((d) => ({ ...d, blurb: TEST_BY_ID[d.id as TestId]?.blurb, waitsOnSends: TEST_BY_ID[d.id as TestId]?.waitsOnSends })).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))));
  });
  app.patch("/api/tests/:id", async (req, res) => {
    const b = body(PatchTestBody, req);
    if (!Object.hasOwn(TEST_BY_ID, String(req.params.id))) throw notFound("Test");
    res.json(await prisma.testDefinition.update({ where: { id: String(req.params.id) }, data: b }));
  });
  app.get("/api/settings", async (_req, res) => void res.json(await loadSettings()));
  app.patch("/api/settings", async (req, res) => {
    const b = body(PatchSettingsBody, req);
    for (const [key, value] of Object.entries(b)) await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    res.json(await loadSettings());
  });

  // ---- gate
  app.get("/api/gate/events", async (_req, res) => {
    const ev = await prisma.gateEvent.findMany({ orderBy: { detectedAt: "desc" }, take: 50, include: { sequence: true } });
    res.json(ev.map((e) => ({ id: e.id, sequenceId: e.sequence.graph8Id, sequenceName: e.sequence.name, changedSteps: e.changedSteps, message: e.message, result: e.result, runId: e.runId, detectedAt: e.detectedAt, resolvedAt: e.resolvedAt })));
  });
  app.patch("/api/gate", async (req, res) => {
    const b = body(z.object({ enabled: z.boolean() }), req);
    await prisma.setting.upsert({ where: { key: "gateEnabled" }, create: { key: "gateEnabled", value: b.enabled }, update: { value: b.enabled } });
    res.json({ enabled: b.enabled });
  });

  // ---- reports
  app.post("/api/reports", async (_req, res) => void res.status(201).json(await buildReport()));
  app.get("/api/reports/latest", async (_req, res) => {
    const r = await prisma.report.findFirst({ orderBy: { createdAt: "desc" } });
    res.json(r ? reportDTO(r) : null);
  });
  const report = async (req: Request) => {
    const r = await prisma.report.findUnique({ where: { id: id(req) } });
    if (!r) throw notFound("Report");
    return r.id;
  };
  app.post("/api/reports/:id/save", async (req, res) => void res.json(await saveReportToGraph8(await report(req))));
  app.post("/api/reports/:id/share", async (req, res) => void res.json(await shareReport(await report(req))));
  app.get("/api/public/reports/:token", async (req, res) => {
    const token = String(req.params.token);
    if (!/^[a-f0-9]{64}$/.test(token)) throw notFound("Report");
    const r = await prisma.report.findUnique({ where: { shareToken: token } });
    if (!r) throw notFound("Report");
    res.json(reportDTO(r));
  });

  app.use((_req, _res, next) => next(new HttpError(404, "NOT_FOUND", "No such route")));
  app.use(errors);
  return { app, approveFix };
}
