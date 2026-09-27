// All AI goes through graph8 copilot (injected by @crash/core so there is one
// graph8 client) and a Postgres cache keyed by input hash (§22). Every function
// has a code fallback; failures never block a run.
import { prisma } from "@crash/db";
import { createHash } from "crypto";
import { z } from "zod";

type Chat = (message: string) => Promise<unknown>;
let chat: Chat | null = null;
let enabled = true;
let timeoutMs = 30_000;

export function configureAi(opts: { chat: Chat; enabled: boolean; timeoutMs: number }) {
  chat = opts.chat;
  enabled = opts.enabled;
  timeoutMs = opts.timeoutMs;
}
export function aiEnabled() {
  return enabled && !!chat;
}

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** First balanced {...} or [...] block in the text that parses as JSON. */
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/g, "");
  for (let i = 0; i < t.length; i++) {
    const open = t[i];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        try { return JSON.parse(t.slice(i, j + 1)); } catch { break; }
      }
    }
  }
  return null;
}

export type AiResult<T> = { value: T; source: "ai" | "cache" | "rules" };

export async function askJson<T extends z.ZodType>(
  purpose: string,
  schema: T,
  prompt: string,
  fallback: () => z.infer<T>,
  opts: { timeoutMs?: number } = {},
): Promise<AiResult<z.infer<T>>> {
  const hash = createHash("sha256").update(purpose + "\n" + prompt).digest("hex");
  const cached = await prisma.llmCache.findUnique({ where: { hash } }).catch(() => null);
  if (cached) {
    const p = schema.safeParse(cached.output);
    if (p.success) return { value: p.data, source: "cache" };
  }
  if (!aiEnabled()) return { value: fallback(), source: "rules" };

  const message = `${prompt}\n\nReply with ONLY one JSON value, no prose, matching this JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}`;
  try {
    const res = await Promise.race([
      chat!(message),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("copilot timeout")), opts.timeoutMs ?? timeoutMs)),
    ]);
    for (const s of strings(res).sort((a, b) => b.length - a.length)) {
      const p = schema.safeParse(extractJson(s));
      if (p.success) {
        await prisma.llmCache
          .upsert({ where: { hash }, create: { hash, purpose, output: p.data as object }, update: { output: p.data as object } })
          .catch(() => {});
        return { value: p.data, source: "ai" };
      }
    }
  } catch {
    /* fall through to rules */
  }
  return { value: fallback(), source: "rules" };
}
