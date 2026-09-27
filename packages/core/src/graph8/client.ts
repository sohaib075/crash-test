// Every graph8 call: p-limit (4 parallel), retry with backoff + jitter (3 tries),
// timing logs, and a hard block on assign-owner (§06, §26).
import { g8 } from "@graph8/sdk";
import pLimit from "p-limit";
import { config } from "../config";
import { log } from "../log";

export type Any = Record<string, unknown>;

const FORBIDDEN = new Set(["assign_company_owner_companies_assign_owner_post"]);
/** assign-owner re-owns EVERY matching record in the org unless scoped to a list (§26). */
const LIST_SCOPED = new Set(["assign_contact_owner_contacts_assign_owner_post"]);
const limit = pLimit(config.concurrency);

let ready = false;
function api() {
  if (!ready) {
    if (!config.apiKey) throw new GraphError("NO_KEY", "GRAPH8_API_KEY is not set", 0, "Add your sandbox key to .env.local and restart.");
    g8.init({ apiKey: config.apiKey, ...(config.baseUrl ? { apiUrl: config.baseUrl } : {}) } as Parameters<typeof g8.init>[0]);
    ready = true;
  }
  return g8.api as unknown as { call(op: string, input?: unknown): Promise<unknown> };
}

export class GraphError extends Error {
  constructor(public code: string, message: string, public status = 0, public hint?: string) {
    super(message);
  }
}

export const callStats: { op: string; ms: number; ok: boolean; status?: number; at: string }[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function friendly(err: unknown): GraphError {
  if (err instanceof GraphError) return err;
  const e = err as { status?: number; message?: string; code?: string; detail?: unknown };
  const status = e.status ?? 0;
  if (status === 429) return new GraphError("RATE_LIMIT", "graph8 rate limit", 429, "Retrying shortly.");
  if (status === 401 || status === 403) return new GraphError("AUTH", `graph8 rejected the key (${status})`, status, "Check the key and its scopes.");
  if (status >= 500) return new GraphError("GRAPH8_DOWN", `graph8 error ${status}`, status, "Usually temporary. Retry.");
  const detail = e.detail ? `: ${JSON.stringify(e.detail).slice(0, 300)}` : "";
  return new GraphError(e.code ?? "GRAPH8_ERROR", `${e.message ?? "graph8 call failed"}${detail}`, status);
}

export async function call<T = Any>(op: string, input?: unknown, opts: { retries?: number } = {}): Promise<T> {
  if (FORBIDDEN.has(op)) throw new GraphError("FORBIDDEN", `Safety: ${op} is blocked; re-own through a list instead.`);
  if (LIST_SCOPED.has(op)) {
    const body = (input as { body?: { list_id?: unknown; filterModel?: unknown; segmentFilter?: unknown } } | undefined)?.body;
    if (!body?.list_id || body.filterModel || body.segmentFilter) throw new GraphError("FORBIDDEN", `Safety: ${op} is only allowed scoped to a temporary list_id.`);
  }
  const tries = opts.retries ?? 3;
  let last: GraphError | null = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const t0 = Date.now();
    try {
      const res = (await limit(() => api().call(op, input))) as T;
      callStats.push({ op, ms: Date.now() - t0, ok: true, at: new Date().toISOString() });
      log.debug({ op, ms: Date.now() - t0 }, "graph8");
      return res;
    } catch (err) {
      last = friendly(err);
      callStats.push({ op, ms: Date.now() - t0, ok: false, status: last.status, at: new Date().toISOString() });
      const retryable = last.status === 429 || last.status >= 500 || last.status === 0;
      if (!retryable || last.code === "NO_KEY" || attempt === tries) break;
      const wait = Math.min(8000, 500 * 2 ** attempt) + Math.random() * 300;
      log.warn({ op, status: last.status, attempt, wait }, "graph8 retry");
      await sleep(wait);
    } finally {
      if (callStats.length > 1000) callStats.splice(0, callStats.length - 1000);
    }
  }
  throw last!;
}

export const data = <T>(res: unknown): T => ((res as Any)?.data ?? res) as T;
export const items = (res: unknown): Any[] => {
  const d = data<unknown>(res);
  if (Array.isArray(d)) return d as Any[];
  for (const k of ["items", "results", "records", "rows", "users", "members", "quotes", "deals", "bookings"]) {
    const v = (d as Any)?.[k];
    if (Array.isArray(v)) return v as Any[];
  }
  return [];
};
export const str = (...vals: unknown[]) => {
  for (const v of vals) if (typeof v === "string" && v) return v;
  for (const v of vals) if (typeof v === "number") return String(v);
  return "";
};
export const num = (id: string | number) => {
  const n = Number(id);
  if (!Number.isFinite(n)) throw new GraphError("BAD_ID", `expected numeric id, got ${id}`);
  return n;
};
export const money = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export async function allPages(op: string, query: Any = {}, maxPages = 5, path?: Any): Promise<Any[]> {
  const out: Any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = (await call(op, { ...(path ? { path } : {}), query: { ...query, page, limit: 200 } })) as Any;
    const batch = items(res);
    out.push(...batch);
    const p = res.pagination as Any | undefined;
    if (!p?.has_next || !batch.length) break;
  }
  return out;
}
