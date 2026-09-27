// Pure pass/fail rules. No I/O — unit-tested in rules.test.ts (§25).
import type { SentEmail } from "../types";

// ---- T3 broken personalisation ----
const BROKEN_MERGE = [/\{\{[^}]*\}\}/, /\{\{/, /\}\}/, /\b(Hi|Hello|Hey|Dear)\s*,/i, /\bundefined\b/, /\bnull\b/, /\bNaN\b/];

export function brokenMergeHits(text: string): string[] {
  const hits: string[] = [];
  for (const re of BROKEN_MERGE) {
    const m = text.match(re);
    if (m && !hits.some((h) => h.includes(m[0]) || m[0].includes(h))) hits.push(m[0]);
  }
  return hits;
}

// ---- T2 / T9 frequency ----
export function maxSendsInWindow(evidence: SentEmail[], to: string, windowMs: number): number {
  const times = evidence
    .filter((e) => e.to.toLowerCase() === to.toLowerCase())
    .map((e) => Date.parse(e.sentAt))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; j < times.length; j++) {
    while (times[j] - times[i] >= windowMs) i++;
    best = Math.max(best, j - i + 1);
  }
  return best;
}

// ---- T7 content check (fixed rules; promises are in @crash/ai) ----
const UNSUB = /unsubscribe|opt[\s-]?out|\{\{\s*unsubscribe|manage (your )?preferences/i;
const LEFTOVERS: RegExp[] = [
  /\[(insert|your|add|company|first ?name|name|link|date)[^\]]{0,40}\]/i,
  /\blorem ipsum\b/i,
  /\b(TODO|TBD|FIXME|XXX)\b/,
  /\{\{\s*\}\}/,
  /<(first|company|name)[^>]{0,20}>/i,
];

export type ContentIssue = { rule: "unsubscribe" | "leftover"; quote: string; message: string };

export function contentIssues(body: string, isEmail: boolean): ContentIssue[] {
  const out: ContentIssue[] = [];
  if (isEmail && body.trim() && !UNSUB.test(body)) {
    out.push({ rule: "unsubscribe", quote: "", message: "has no unsubscribe line" });
  }
  for (const re of LEFTOVERS) {
    const m = body.match(re);
    if (m) out.push({ rule: "leftover", quote: m[0], message: `still contains template text "${m[0]}"` });
  }
  return out;
}

// ---- T13 quote check ----
export type QuoteFacts = {
  total: number | null;
  dealAmount: number | null;
  lineItemCount: number | null;
  expiresAt: string | null;
  recipientSuppressed: boolean;
  senderActive: boolean | null;
  tolerancePct: number;
  now?: number;
};

export type QuoteProblem = { code: "total_mismatch" | "no_line_items" | "expired" | "recipient_suppressed" | "sender_departed"; message: string };

export function quoteProblems(q: QuoteFacts): QuoteProblem[] {
  const out: QuoteProblem[] = [];
  if (q.total != null && q.dealAmount != null && q.dealAmount > 0) {
    const diffPct = (Math.abs(q.total - q.dealAmount) / q.dealAmount) * 100;
    if (diffPct > q.tolerancePct) {
      out.push({ code: "total_mismatch", message: `says ${usd(q.total)}. The deal says ${usd(q.dealAmount)}.` });
    }
  }
  if (q.lineItemCount === 0) out.push({ code: "no_line_items", message: "has no line items." });
  if (q.expiresAt && Date.parse(q.expiresAt) < (q.now ?? Date.now())) {
    out.push({ code: "expired", message: `expired on ${new Date(q.expiresAt).toDateString()} and nobody followed up.` });
  }
  if (q.recipientSuppressed) out.push({ code: "recipient_suppressed", message: "was sent to a contact who opted out." });
  if (q.senderActive === false) out.push({ code: "sender_departed", message: "was sent by a rep who is no longer on the team." });
  return out;
}

export function usd(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function excerpt(text: string, around?: string, len = 220): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!around) return flat.slice(0, len);
  const i = flat.indexOf(around);
  if (i < 0) return flat.slice(0, len);
  const start = Math.max(0, i - len / 3);
  return (start > 0 ? "…" : "") + flat.slice(start, start + len) + (start + len < flat.length ? "…" : "");
}

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
