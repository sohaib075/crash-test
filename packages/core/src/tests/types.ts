// A test module (§09): targets → setup → trigger → check → proposeFix.
// Apply / undo live in engine/fixes.ts (they depend on the action, not the test).
import type { Facts } from "@crash/ai";
import type { FixAction, Settings, TestId } from "@crash/shared";
import type { Backend } from "../backend";
import type { SentEmail, Workspace } from "../types";

export type TargetType = "sequence" | "pair" | "quote" | "workspace" | "booking_link" | "list";
export type Target = { type: TargetType; id: string; name: string; why: string };

export type EvidenceIn = {
  kind: "EMAIL" | "QUOTE" | "BOOKING" | "CONTACT" | "DEAL" | "SEQUENCE";
  graph8Id: string;
  title: string;
  fields: Record<string, unknown>;
  excerpt?: string;
  highlight?: string;
  at: string;
  raw?: unknown;
};

export type Outcome = {
  pass: boolean;
  /** Couldn't observe enough to decide. Shown as ERROR, never fixed. */
  inconclusive?: boolean;
  expected: string;
  actual: string;
  evidence: EvidenceIn[];
  facts: Facts;
  /** Real contacts affected, for leads + $ at risk. */
  affectedContactIds?: string[];
  leadsAffected?: number;
  /** Explicit $ at risk (e.g. T13 deal amount). Otherwise computed from affected contacts' open deals. */
  pipelineAtRisk?: number;
  /** Deals behind pipelineAtRisk (T13: the quote's deal). */
  dealIds?: string[];
  actualSec?: number;
  goalSec?: number;
};

export type FixArgs = {
  sequenceId?: string;
  contactId?: string;
  contactIds?: string[];
  ownerUserId?: string;
  dealId?: string;
  title?: string;
  body?: string;
};

export type ProposedFix = {
  action: FixAction;
  targetId: string;
  args: FixArgs;
  /** Plain English: exactly what changes in graph8. */
  preview: string;
  before: unknown;
  after: unknown;
  reason: string;
};

/** Scratch state persisted on TestResult.state so a restarted worker resumes (§06). */
export type Scratch = {
  phase?: "setup" | "triggered" | "checked";
  since?: string;
  buyers?: { contactId: string; email: string; name: string }[];
  [k: string]: unknown;
};

export interface Ctx {
  runId: string;
  ws: Workspace;
  settings: Settings;
  backend: Backend;
  log(msg: string): Promise<void>;
  /** Idempotent: deterministic email, re-uses the contact if it exists. */
  buyer(testId: TestId, key: string, opts?: { blankName?: boolean }): Promise<{ contactId: string; email: string; name: string }>;
  tagList(): Promise<string>;
  waitForSends(emails: string[], opts: { since: string; expectAtLeast?: number; timeoutMs?: number }): Promise<SentEmail[]>;
  realContactsInSequence(sequenceId: string): Promise<string[]>;
}

export interface CrashTest {
  id: TestId;
  targets(ws: Workspace, settings: Settings): Target[];
  setup?(ctx: Ctx, t: Target, s: Scratch): Promise<void>;
  trigger?(ctx: Ctx, t: Target, s: Scratch): Promise<void>;
  check(ctx: Ctx, t: Target, s: Scratch): Promise<Outcome>;
  proposeFix(ctx: Ctx, t: Target, s: Scratch, o: Outcome): Promise<ProposedFix[]>;
  /** Optional custom re-test. Return null to fall back to setup → trigger → check with a fresh buyer. */
  retest?(ctx: Ctx, t: Target, s: Scratch, applied: ProposedFix[]): Promise<Outcome | null>;
}

export const isLive = (status: string) => /live|active|running|resum|scheduling|waiting|sending/i.test(status) && !/pause|terminat|archiv|draft|complete|stop/i.test(status);
export const hasEmail = (steps: { type: string }[]) => steps.length === 0 || steps.some((s) => /mail/i.test(s.type));
