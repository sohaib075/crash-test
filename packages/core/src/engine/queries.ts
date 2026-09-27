// DB → API DTOs (packages/shared/dto.ts).
import { prisma, type Evidence, type Fix, type Run, type TestResult } from "@crash/db";
import { TEST_BY_ID, type FixAction, type RunDTO, type ResultDTO, type RunTotals, type SequenceDTO, type TestId, type WorkspaceDTO } from "@crash/shared";
import type { Workspace } from "../types";
import { distinctLeads } from "./run";

const n = (d: unknown) => (d == null ? null : Number(d));

export function fixDTO(f: Fix) {
  return {
    id: f.id, action: f.action as FixAction, mode: f.mode, status: f.status, targetId: f.targetId, preview: f.preview,
    before: f.before, after: f.after, reason: f.reason, error: f.error,
    appliedAt: f.appliedAt?.toISOString() ?? null, undoneAt: f.undoneAt?.toISOString() ?? null,
  };
}

export function resultDTO(r: TestResult & { evidence?: Evidence[]; fixes?: Fix[]; writebacks?: { kind: string; graph8Id: string }[] }): ResultDTO {
  return {
    id: r.id, runId: r.runId, testId: r.testId as TestId, testName: TEST_BY_ID[r.testId as TestId]?.name ?? r.testId, area: r.area,
    targetType: r.targetType, targetId: r.targetId, targetName: r.targetName, status: r.status, summary: r.summary, problem: r.problem,
    whyItMatters: r.whyItMatters, expected: r.expected, actual: r.actual, error: r.error, leadsAffected: r.leadsAffected,
    pipelineAtRisk: n(r.pipelineAtRisk), retestStatus: r.retestStatus, updatedAt: r.updatedAt.toISOString(),
    evidence: r.evidence?.map((e) => ({
      id: e.id, kind: e.kind, graph8Id: e.graph8Id, title: e.title, fields: e.fields as Record<string, unknown>,
      excerpt: e.excerpt, highlight: e.highlight, at: e.at.toISOString(),
    })),
    fixes: r.fixes?.map(fixDTO),
    writebacks: r.writebacks?.map((w) => ({ kind: w.kind, graph8Id: w.graph8Id })),
  };
}

export function totals(results: TestResult[], run?: Run): RunTotals {
  const c = (s: string) => results.filter((r) => r.status === s).length;
  return {
    tests: results.length, queued: c("QUEUED"), running: c("RUNNING"), pass: c("PASS"), fail: c("FAIL"),
    needsApproval: c("NEEDS_APPROVAL"), fixed: c("FIXED"), error: c("ERROR"),
    leadsProtected: distinctLeads(results.filter((r) => r.status === "FIXED")),
    leadsAtRisk: distinctLeads(results.filter((r) => ["FAIL", "NEEDS_APPROVAL"].includes(r.status))),
    pipelineAtRisk: run ? Number(run.pipelineAtRisk) || results.filter((r) => ["FAIL", "NEEDS_APPROVAL", "FIXED"].includes(r.status)).reduce((x, r) => x + Number(r.pipelineAtRisk ?? 0), 0) : 0,
  };
}

export async function runDTO(runId: string): Promise<RunDTO | null> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      results: { include: { fixes: true, writebacks: true }, orderBy: { createdAt: "asc" } },
      logs: { orderBy: { at: "asc" }, take: 300 },
      _count: { select: { buyers: true } },
      health: { include: { sequence: true }, orderBy: { score: "asc" } },
    },
  });
  if (!run) return null;
  return {
    id: run.id, trigger: run.trigger, status: run.status, error: run.error, startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null, planSource: (run.plan as { source?: string } | null)?.source ?? null,
    liveSafe: (run.plan as { liveSafe?: boolean } | null)?.liveSafe === true,
    totals: totals(run.results, run), results: run.results.map(resultDTO),
    logs: run.logs.map((l) => ({ message: l.message, at: l.at.toISOString() })), buyers: run._count.buyers, cleanedUp: run.cleanedUp,
    health: run.health.map((h) => ({ sequenceId: h.sequenceId, graph8Id: h.sequence.graph8Id, name: h.sequence.name, score: h.score, band: h.band, reasons: h.reasons })),
  };
}

export async function resultDetail(resultId: string) {
  const r = await prisma.testResult.findUnique({ where: { id: resultId }, include: { evidence: true, fixes: { orderBy: { createdAt: "asc" } }, writebacks: true } });
  return r ? resultDTO(r) : null;
}

export async function workspaceDTO(): Promise<WorkspaceDTO | null> {
  const w = await prisma.workspace.findFirst({ where: { discoveredAt: { not: null } }, orderBy: { discoveredAt: "desc" } });
  if (!w?.summary) return null;
  const ws = w.summary as unknown as Workspace;
  const seqRows = await prisma.sequence.findMany({ where: { workspaceId: w.id }, include: { health: { orderBy: { createdAt: "desc" }, take: 12 } } });
  const sequences: SequenceDTO[] = ws.sequences.map((s) => {
    const row = seqRows.find((r) => r.graph8Id === s.id);
    const h = row?.health[0];
    return {
      id: row?.id ?? s.id, graph8Id: s.id, name: s.name, status: row?.status ?? s.status, priority: s.priority, steps: s.steps,
      senderEmails: s.senderEmails, contactCount: s.contactCount,
      health: h ? { score: h.score, band: h.band, reasons: h.reasons, at: h.createdAt.toISOString() } : null,
      trend: (row?.health ?? []).slice().reverse().map((x) => ({ score: x.score, at: x.createdAt.toISOString() })),
    };
  });
  const blocked = await prisma.gateEvent.findMany({ where: { result: "BLOCKED" }, include: { sequence: true, run: { include: { results: true } } }, orderBy: { detectedAt: "desc" }, take: 5 });
  const settings = await prisma.setting.findUnique({ where: { key: "gateEnabled" } });
  const last = await prisma.run.findFirst({ where: { trigger: "MANUAL" }, orderBy: { startedAt: "desc" }, include: { results: true } });
  const openDeals = ws.deals.filter((d) => d.open);
  return {
    graph8Id: w.graph8Id, name: w.name, discoveredAt: w.discoveredAt?.toISOString() ?? null, sandbox: ws.sandbox, keyMode: ws.keyMode, writable: ws.writable, sequences,
    quotes: ws.quotes.map((q) => ({ id: q.id, number: q.number, status: q.status, total: q.total, currency: q.currency, dealAmount: ws.deals.find((d) => d.id === q.dealId)?.amount ?? null })),
    bookingLinks: ws.bookingLinks.map((b) => ({ id: b.id, name: b.name, hosts: b.hostEmails })),
    users: ws.users.filter((u) => u.active).map((u) => ({ id: u.id, email: u.email, name: u.name })),
    openPipeline: openDeals.reduce((x, d) => x + (d.amount ?? 0), 0), openDeals: openDeals.length,
    gate: {
      enabled: settings ? settings.value !== false : true,
      blocked: blocked.map((b) => ({ sequenceId: b.sequence.graph8Id, name: b.sequence.name, message: b.message ?? "", resultId: b.run?.results.find((r) => r.status !== "PASS")?.id })),
    },
    lastRun: last ? { id: last.id, status: last.status, startedAt: last.startedAt.toISOString(), totals: totals(last.results, last) } : null,
  };
}
