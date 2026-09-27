// T7: unapproved promises in sequence copy. The AI may flag sentences, but a
// flag only counts if it quotes an EXACT substring of the step (§22).
import { z } from "zod";
import { askJson } from "./llm";

export type PromiseFlag = { quote: string; kind: "discount" | "guarantee" | "pricing" | "legal" | "other"; severity: "high" | "medium" | "low" };

const KEYWORDS: { re: RegExp; kind: PromiseFlag["kind"]; severity: PromiseFlag["severity"] }[] = [
  { re: /\bguarantee[sd]?\b/i, kind: "guarantee", severity: "high" },
  { re: /\b\d{1,3}\s?%\s?(off|discount)\b/i, kind: "discount", severity: "high" },
  { re: /\bfree (for|of charge|forever|month|year)/i, kind: "pricing", severity: "medium" },
  { re: /\b(money[- ]back|full refund|risk[- ]free)\b/i, kind: "guarantee", severity: "high" },
  { re: /\b(lowest price|price match|price lock)\b/i, kind: "pricing", severity: "medium" },
  { re: /\bno contract\b|\bcancel any ?time\b/i, kind: "legal", severity: "low" },
];

export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

export function keywordPromises(text: string): PromiseFlag[] {
  const out: PromiseFlag[] = [];
  for (const s of sentences(text)) {
    const hit = KEYWORDS.find((k) => k.re.test(s));
    if (hit) out.push({ quote: s, kind: hit.kind, severity: hit.severity });
  }
  return out;
}

const Schema = z.array(z.object({
  quote: z.string(),
  kind: z.enum(["discount", "guarantee", "pricing", "legal", "other"]),
  severity: z.enum(["high", "medium", "low"]),
}));

export async function promiseCheck(text: string, opts: { timeoutMs?: number } = {}): Promise<{ flags: PromiseFlag[]; source: string }> {
  const r = await askJson(
    "promiseCheck",
    Schema,
    `You review B2B sales emails for commitments a rep is not allowed to make without approval: discounts, guarantees, refunds, special pricing, legal terms. Return every such sentence, quoting it EXACTLY as written. Return [] if there are none.\n\nEMAIL:\n${text}`,
    () => keywordPromises(text),
    opts,
  );
  // Code enforces the exact-substring rule; keywords always count.
  const verified = r.value.filter((f) => f.quote.length > 8 && text.includes(f.quote));
  const merged = [...verified];
  for (const k of keywordPromises(text)) if (!merged.some((m) => m.quote.includes(k.quote) || k.quote.includes(m.quote))) merged.push(k);
  return { flags: merged, source: r.source };
}
