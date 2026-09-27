// API shapes shared by server and web (§20). Money is a number in the
// workspace currency; ids are our DB ids unless named graph8Id.
import { z } from "zod";
import type { Area, FixAction, FixMode, HealthBand, TestId, TestStatus } from "./constants";
import { AREAS, FIX_ACTIONS, FIX_MODES, TEST_IDS } from "./constants";

export type EvidenceDTO = {
  id: string;
  kind: "EMAIL" | "QUOTE" | "BOOKING" | "CONTACT" | "DEAL" | "SEQUENCE";
  graph8Id: string;
  title: string;
  fields: Record<string, unknown>;
  excerpt: string | null;
  highlight: string | null;
  at: string;
};

export type FixDTO = {
  id: string;
  action: FixAction;
  mode: FixMode;
  status: "PROPOSED" | "APPLIED" | "REJECTED" | "UNDONE" | "FAILED";
  targetId: string;
  preview: string;
  before: unknown;
  after: unknown;
  reason: string;
  error: string | null;
  appliedAt: string | null;
  undoneAt: string | null;
};

export type ResultDTO = {
  id: string;
  runId: string;
  testId: TestId;
  testName: string;
  area: Area;
  targetType: string;
  targetId: string;
  targetName: string;
  status: TestStatus;
  summary: string | null;
  /** The original problem sentence (summary becomes the fix sentence once fixed). */
  problem: string | null;
  whyItMatters: string | null;
  expected: string;
  actual: string | null;
  error: string | null;
  leadsAffected: number | null;
  pipelineAtRisk: number | null;
  retestStatus: TestStatus | null;
  updatedAt: string;
  evidence?: EvidenceDTO[];
  fixes?: FixDTO[];
  writebacks?: { kind: string; graph8Id: string }[];
};

export type RunTotals = {
  tests: number;
  queued: number;
  running: number;
  pass: number;
  fail: number;
  needsApproval: number;
  fixed: number;
  error: number;
  leadsProtected: number;
  leadsAtRisk: number;
  pipelineAtRisk: number;
};

export type RunDTO = {
  id: string;
  trigger: "MANUAL" | "GATE" | "SCHEDULE";
  status: "QUEUED" | "PLANNING" | "RUNNING" | "DONE" | "FAILED";
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  planSource: string | null;
  totals: RunTotals;
  results: ResultDTO[];
  logs: { message: string; at: string }[];
  buyers: number;
  cleanedUp: boolean;
};

export type SequenceStepDTO = { id: string; order: number; type: string; delayMinutes: number; subject?: string; body?: string };

export type SequenceDTO = {
  id: string;
  graph8Id: string;
  name: string;
  status: string;
  priority: number;
  steps: SequenceStepDTO[];
  senderEmails: string[];
  contactCount: number | null;
  health: { score: number; band: HealthBand; reasons: string[]; at: string } | null;
  trend: { score: number; at: string }[];
};

export type WorkspaceDTO = {
  graph8Id: string;
  name: string;
  discoveredAt: string | null;
  sandbox: boolean;
  sequences: SequenceDTO[];
  quotes: { id: string; number: string; status: string; total: number | null; dealAmount: number | null; currency: string }[];
  bookingLinks: { id: string; name: string; hosts: string[] }[];
  users: { id: string; email: string; name: string }[];
  openPipeline: number;
  openDeals: number;
  gate: { enabled: boolean; blocked: { sequenceId: string; name: string; message: string; resultId?: string }[] };
  lastRun: { id: string; status: string; startedAt: string; totals: RunTotals } | null;
};

export type ReadyCheck = { id: string; label: string; ok: boolean; detail: string };
export type ReadyDTO = { ok: boolean; checks: ReadyCheck[] };

export type GateEventDTO = {
  id: string;
  sequenceId: string;
  sequenceName: string;
  changedSteps: number[];
  message: string | null;
  result: "CHECKING" | "BLOCKED" | "RELEASED";
  runId: string | null;
  detectedAt: string;
  resolvedAt: string | null;
};

export type ReportDTO = {
  id: string;
  periodStart: string;
  periodEnd: string;
  testsRun: number;
  failures: number;
  autoFixed: number;
  leadsProtected: number;
  pipelineSaved: number;
  summary: string;
  graph8TaskId: string | null;
  shareToken: string | null;
  createdAt: string;
  data: {
    byArea: { area: Area; tests: number; failures: number; fixed: number }[];
    topIssues: { testId: TestId; testName: string; target: string; summary: string; status: TestStatus; pipelineAtRisk: number }[];
    health: { name: string; score: number; band: HealthBand }[];
  };
};

// ---- request bodies (validated with zod on the server) ----

export const StartRunBody = z.object({
  areas: z.array(z.enum(AREAS)).optional(),
  testIds: z.array(z.enum(TEST_IDS)).optional(),
  targetIds: z.array(z.string()).optional(),
});
export type StartRunBody = z.infer<typeof StartRunBody>;

export const PatchModesBody = z.object({
  modes: z.array(z.object({ action: z.enum(FIX_ACTIONS), mode: z.enum(FIX_MODES) })).min(1),
});

export const PatchTestBody = z.object({
  enabled: z.boolean().optional(),
  weight: z.number().int().min(0).max(100).optional(),
});

export const PatchSettingsBody = z.object({
  maxSendsPerDay: z.number().int().min(1).max(10).optional(),
  maxSendsPerWeek: z.number().int().min(1).max(50).optional(),
  speedGoalSec: z.number().int().min(30).max(86400).optional(),
  gateEnabled: z.boolean().optional(),
  gatePollSec: z.number().int().min(10).max(600).optional(),
  quoteTolerancePct: z.number().min(0).max(20).optional(),
});

export type ApiError = { error: { code: string; message: string; hint?: string } };
