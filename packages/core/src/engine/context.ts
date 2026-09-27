// Backend selection, settings, the shared outbox poller and the test Ctx.
import { personas as aiPersonas } from "@crash/ai";
import { prisma } from "@crash/db";
import { DEFAULT_SETTINGS, type Settings, type TestId } from "@crash/shared";
import { createHash } from "crypto";
import type { Backend } from "../backend";
import { assertTestEmail, config, isTestEmail } from "../config";
import { graph8Backend, TAG_FIELD } from "../graph8/backend";
import { runLog } from "../publish";
import type { Ctx } from "../tests/types";
import type { SentEmail, Workspace } from "../types";

let backend: Backend = graph8Backend;
/** Tests swap in the in-memory backend; the app always uses graph8. */
export function setBackend(b: Backend) {
  backend = b;
}
export function getBackend() {
  return backend;
}

export async function loadSettings(): Promise<Settings> {
  const rows = await prisma.setting.findMany();
  const s = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) s[r.key] = r.value;
  s.testDomain = config.testDomain;
  return s as Settings;
}

// ---- one shared outbox fetch per poll interval (§06, §21 outbox.poll) ----
let cache: { at: number; items: SentEmail[] } | null = null;
let inflight: Promise<SentEmail[]> | null = null;

export async function recentOutbox(): Promise<SentEmail[]> {
  if (cache && Date.now() - cache.at < config.outboxPollMs) return cache.items;
  inflight ??= backend
    .outbox(new Date(Date.now() - 6 * 3600_000).toISOString())
    .then((items) => {
      cache = { at: Date.now(), items };
      return items;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
export function resetOutboxCache() {
  cache = null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitForSends(emails: string[], { since, expectAtLeast = 1, timeoutMs = config.outboxTimeoutMs }: { since: string; expectAtLeast?: number; timeoutMs?: number }) {
  const want = new Set(emails.map((e) => e.toLowerCase()));
  const t0 = Date.parse(since);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hits = (await recentOutbox()).filter((e) => want.has(e.to) && (!e.sentAt || Date.parse(e.sentAt) >= t0));
    if (hits.length >= expectAtLeast || Date.now() >= deadline) return hits;
    await sleep(Math.min(config.outboxPollMs, Math.max(100, deadline - Date.now())));
  }
}

// ---- fake buyers: deterministic email, read before write (§06) ----
const personaCache = new Map<string, Awaited<ReturnType<typeof aiPersonas>>["list"]>();

export function buyerEmail(runId: string, testId: string, key: string) {
  const h = createHash("sha1").update(key).digest("hex").slice(0, 6);
  return `${runId.slice(-8)}-${testId}-${h}@${config.testDomain}`.toLowerCase();
}

export async function tagList(runId: string): Promise<string> {
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  if (run.tagListId) return run.tagListId;
  const id = await backend.createList(`crash-test ${runId}`);
  const updated = await prisma.run.updateMany({ where: { id: runId, tagListId: null }, data: { tagListId: id } });
  if (updated.count === 0) {
    // Another job won the race; keep theirs and drop ours.
    await backend.deleteList(id).catch(() => {});
    return (await prisma.run.findUniqueOrThrow({ where: { id: runId } })).tagListId!;
  }
  return id;
}

export function makeCtx(runId: string, ws: Workspace, settings: Settings, attempt = 0, trigger: Ctx["trigger"] = "MANUAL"): Ctx {
  return {
    runId,
    trigger,
    ws,
    settings,
    backend,
    log: (m) => runLog(runId, m),
    tagList: () => tagList(runId),
    waitForSends,

    async buyer(testId: TestId, key: string, opts = {}) {
      const email = buyerEmail(runId, testId, `${key}#${attempt}`);
      assertTestEmail(email);
      const run = await prisma.run.findUnique({ where: { id: runId } });
      if (run?.status === "FAILED") throw new Error("Run was stopped; not creating more test buyers.");
      if ((run?.plan as { liveSafe?: boolean } | null)?.liveSafe) throw new Error("Safety: live-safe mode never creates fake buyers on a live key.");
      const existing = await prisma.fakeBuyer.findUnique({ where: { email } });
      const persona = existing?.persona as { firstName: string; lastName: string } | undefined;
      if (existing) return { contactId: existing.contactId, email, name: persona?.firstName || email };

      const wsKey = ws.sequences.map((s) => s.name).join("|");
      if (!personaCache.has(wsKey)) personaCache.set(wsKey, (await aiPersonas(8, ws.sequences.map((s) => `- ${s.name}`).join("\n"))).list);
      const pool = personaCache.get(wsKey)!;
      const p = { ...pool[parseInt(createHash("sha1").update(email).digest("hex").slice(0, 4), 16) % pool.length] };
      if (opts.blankName) { p.firstName = ""; p.company = ""; }

      const found = await backend.findContactByEmail(email);
      const contactId = found ?? (await backend.createContact({ email, ...p }, { [TAG_FIELD]: runId }));
      try {
        // A cleaned-up buyer's contact id can't be in use any more; drop its row so the id is free.
        await prisma.fakeBuyer.deleteMany({ where: { contactId, cleanedUp: true, NOT: { email } } });
        await prisma.fakeBuyer.upsert({
          where: { email },
          create: { runId, contactId, email, testId, persona: p },
          update: {},
        });
      } catch (err) {
        // Never leave an untracked fake buyer behind in graph8.
        if (!found) await backend.deleteContact(contactId).catch(() => {});
        throw err;
      }
      await backend.addToList(await tagList(runId), [contactId]);
      const name = p.firstName ? `${p.firstName} ${p.lastName}` : email;
      await runLog(runId, `Created fake buyer ${name} <${email}> for ${testId}`);
      return { contactId, email, name };
    },

    async realContactsInSequence(sequenceId: string) {
      const ids = await backend.sequenceContactIds(sequenceId).catch(() => [] as string[]);
      const fakes = new Set((await prisma.fakeBuyer.findMany({ select: { contactId: true } })).map((f) => f.contactId));
      return ids.filter((id) => !fakes.has(id));
    },
  };
}

export { isTestEmail };
