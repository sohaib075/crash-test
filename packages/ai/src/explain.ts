// Plain-English summary + "why it matters" for a result (§12 microcopy).
// Templates are the source of truth for facts; the AI may only reword, and its
// wording is rejected unless it keeps every key fact (names, numbers).
import type { TestId } from "@crash/shared";
import { z } from "zod";
import { askJson } from "./llm";

export type Facts = Record<string, string | number | undefined>;

export const formatMoney = (n: unknown) => (typeof n === "number" ? `$${Math.round(n).toLocaleString("en-US")}` : String(n ?? ""));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

type T = { summary: (f: Facts) => string; fixed: (f: Facts) => string; why: (f: Facts) => string; keys: string[] };

const TEMPLATES: Partial<Record<TestId, T>> = {
  T1: {
    summary: (f) => `${f.buyer} opted out but got ${plural(Number(f.sends), "email")} from ${f.sequence}.`,
    fixed: (f) => `Paused ${f.sequence} and removed ${f.buyer}. Re-test passed.`,
    why: () => "Emailing someone who opted out breaks anti-spam law and hurts sender reputation for every rep.",
    keys: ["buyer", "sequence"],
  },
  T2: {
    summary: (f) => `${f.buyer} got ${f.sends} emails in one day from ${f.sequence}.`,
    fixed: (f) => `Removed ${f.buyer} from ${f.lower}. One sequence per buyer now.`,
    why: () => "Buyers who get two pitches in a day unsubscribe or mark you as spam.",
    keys: ["buyer", "sequence"],
  },
  T3: {
    summary: (f) => `${f.sequence} sent "${f.token}" to a buyer with no first name or company.`,
    fixed: (f) => `Paused ${f.sequence} until the merge field has a fallback. Re-test passed.`,
    why: () => "Broken merge fields make every email in that step look like spam.",
    keys: ["sequence"],
  },
  T4: {
    summary: (f) => `${plural(Number(f.count), "active lead")} ${Number(f.count) === 1 ? "has" : "have"} no owner who still works here.`,
    fixed: (f) => `Gave ${plural(Number(f.count), "lead")} to ${f.owner}. Every lead has an owner.`,
    why: () => "Leads with no owner get no follow-up and go cold.",
    keys: ["count"],
  },
  T7: {
    summary: (f) => `${f.sequence} step ${f.step} ${f.problem}.`,
    fixed: (f) => `Paused ${f.sequence}. A task quotes the sentence for review.`,
    why: (f) => (f.leads ? `${f.leads} leads would get it.` : "Every lead in the sequence would get it."),
    keys: ["sequence"],
  },
  T13: {
    summary: (f) => `Quote ${f.quote} ${f.problem}`,
    fixed: (f) => `Created a task and a deal note on ${f.deal} with both numbers. The quote was not edited.`,
    why: () => "A wrong quote delays signature, starts a dispute, or loses the deal.",
    keys: ["quote"],
  },
  T11: {
    summary: (f) => `Bookings through "${f.link}" ${f.problem}.`,
    fixed: (f) => `Created a task to fix the host group for "${f.link}" and cancelled the test booking.`,
    why: () => "A first meeting that never happens is the most expensive lead you lose.",
    keys: ["link"],
  },
  T8: {
    summary: (f) => `A new lead on ${f.list} waited ${f.waited} for a first touch (goal ${f.goal}).`,
    fixed: () => "Enrolled the lead manually and created a task about the trigger.",
    why: () => "Leads contacted in the first 5 minutes convert many times more often.",
    keys: ["list"],
  },
  T9: {
    summary: (f) => `${f.buyer} is in ${f.count} sequences and would get ${f.sends} messages this week.`,
    fixed: (f) => `Withdrew ${f.buyer} from the extra sequences.`,
    why: () => "Over-contacted buyers unsubscribe from everything.",
    keys: ["buyer"],
  },
};

export function templateExplain(testId: TestId, facts: Facts, fixed = false) {
  const t = TEMPLATES[testId];
  if (!t) return { summary: String(facts.summary ?? ""), whyItMatters: "" };
  return { summary: fixed ? t.fixed(facts) : t.summary(facts), whyItMatters: t.why(facts) };
}

const Schema = z.object({ summary: z.string().min(10).max(220), whyItMatters: z.string().min(10).max(220) });

export async function explain(testId: TestId, facts: Facts) {
  const base = templateExplain(testId, facts);
  const keys = TEMPLATES[testId]?.keys ?? [];
  const r = await askJson(
    `explain:${testId}`,
    Schema,
    `Rewrite this QA finding for a busy sales manager: one plain-English sentence (summary) and one sentence on why it matters in money or leads. Keep every name and number exactly. No jargon.\nSummary: ${base.summary}\nWhy it matters: ${base.whyItMatters}`,
    () => base,
  );
  const keep = keys.every((k) => facts[k] === undefined || r.value.summary.includes(String(facts[k])));
  return keep ? r.value : base;
}
