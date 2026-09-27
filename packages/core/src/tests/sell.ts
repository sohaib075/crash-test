// SELL tests: T1 opt-out leak, T2 double tap, T3 broken personalisation,
// T7 content check, T9 contact limit.
import { promiseCheck } from "@crash/ai";
import type { CrashTest, EvidenceIn, Outcome, Target } from "./types";
import { hasEmail, isLive } from "./types";
import { brokenMergeHits, contentIssues, excerpt, maxSendsInWindow, plural } from "./rules";
import type { SentEmail, Workspace } from "../types";
import { config } from "../config";

const liveSeqs = (ws: Workspace) => ws.sequences.filter((s) => isLive(s.status) && hasEmail(s.steps));
const seqTargets = (ws: Workspace, why: string): Target[] => liveSeqs(ws).map((s) => ({ type: "sequence", id: s.id, name: s.name, why }));
const seqName = (ws: Workspace, id: string) => ws.sequences.find((s) => s.id === id)?.name ?? id;

export function emailEvidence(e: SentEmail, highlight?: string): EvidenceIn {
  return {
    kind: "EMAIL",
    graph8Id: e.outboxId,
    title: e.subject || "(no subject)",
    fields: { to: e.to, from: e.from },
    excerpt: excerpt(e.body, highlight, 600),
    highlight,
    at: e.sentAt || new Date().toISOString(),
    raw: e.raw,
  };
}

const task = (targetId: string, title: string, body: string, contactId?: string) => ({
  action: "CREATE_TASK" as const,
  targetId,
  args: { title, body, contactId },
  preview: `Create a task in graph8: "${title}".`,
  before: null,
  after: { task: title },
  reason: "Leave a record where the team already works.",
});

const pause = (ctxName: string, sequenceId: string, reason: string) => ({
  action: "PAUSE_SEQUENCE" as const,
  targetId: sequenceId,
  args: { sequenceId },
  preview: `Pause "${ctxName}" in graph8. Nothing else in the sequence changes; resume is one click.`,
  before: { status: "live" },
  after: { status: "paused" },
  reason,
});

// ---------------------------------------------------------------- T1
export const T1: CrashTest = {
  id: "T1",
  targets: (ws) => seqTargets(ws, "Live email sequence"),
  async setup(ctx, t, s) {
    const b = await ctx.buyer("T1", t.id);
    await ctx.backend.suppress(b.contactId);
    s.buyers = [b];
  },
  async trigger(ctx, t, s) {
    s.since = new Date(Date.now() - 2000).toISOString();
    // graph8 may refuse to enrol into a paused sequence; nothing can send from it anyway.
    if (/pause/i.test(await ctx.backend.sequenceStatus(t.id))) return;
    await ctx.backend.enrol(t.id, [s.buyers![0].contactId], await ctx.tagList());
  },
  async retest(ctx, t, s) {
    // After the pause: the opted-out buyer who was emailed gets nothing more.
    if (!/pause/i.test(await ctx.backend.sequenceStatus(t.id)) || !s.buyers?.length) return null;
    const b = s.buyers[0];
    const since = new Date().toISOString();
    const sends = await ctx.waitForSends([b.email], { since, expectAtLeast: 1, timeoutMs: config.negativeWaitMs });
    return {
      pass: sends.length === 0,
      expected: "0 more emails to the opted-out buyer",
      actual: `sequence paused, ${plural(sends.length, "email")} in ${Math.round(config.negativeWaitMs / 1000)}s`,
      evidence: sends.map((e) => emailEvidence(e)),
      facts: { buyer: b.name, sequence: t.name },
    };
  },
  async check(ctx, t, s): Promise<Outcome> {
    const b = s.buyers![0];
    const sends = await ctx.waitForSends([b.email], { since: s.since!, expectAtLeast: 1, timeoutMs: config.negativeWaitMs });
    return {
      pass: sends.length === 0,
      expected: "0 emails to an opted-out buyer",
      actual: sends.length ? `${plural(sends.length, "email")} to ${b.email}` : "0 emails to the opted-out buyer",
      evidence: sends.map((e) => emailEvidence(e)),
      facts: { buyer: b.name, sends: sends.length, sequence: t.name },
      affectedContactIds: sends.length ? await ctx.realContactsInSequence(t.id) : [],
    };
  },
  async proposeFix(ctx, t, s) {
    const b = s.buyers![0];
    return [
      pause(t.name, t.id, `"${t.name}" emailed an opted-out buyer, so it ignores suppressions.`),
      {
        action: "WITHDRAW_CONTACT", targetId: b.contactId, args: { contactId: b.contactId, sequenceId: t.id },
        preview: `Remove ${b.name} (${b.email}) from "${t.name}".`,
        before: { enrolled: [t.name] }, after: { enrolled: [] }, reason: "Stop further emails to the opted-out buyer now.",
      },
      task(t.id, `Crash Test: "${t.name}" emails opted-out contacts`, `A suppressed test buyer (${b.email}) was emailed by "${t.name}". The sequence ignores suppressions. It was paused by Crash Test. Check the sequence's suppression settings before resuming.`),
    ];
  },
};

// ---------------------------------------------------------------- T2
const pairIds = (id: string) => id.split("+") as [string, string];

export const T2: CrashTest = {
  id: "T2",
  targets(ws) {
    const live = liveSeqs(ws);
    const out: Target[] = [];
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++)
        out.push({ type: "pair", id: `${live[i].id}+${live[j].id}`, name: `${live[i].name} + ${live[j].name}`, why: "Two live sequences can hit one buyer" });
    return out.slice(0, 6);
  },
  async setup(ctx, t, s) {
    s.buyers = [await ctx.buyer("T2", t.id)];
  },
  async trigger(ctx, t, s) {
    const [a, b] = pairIds(t.id);
    s.since = new Date(Date.now() - 2000).toISOString();
    const list = await ctx.tagList();
    await ctx.backend.enrol(a, [s.buyers![0].contactId], list);
    await ctx.backend.enrol(b, [s.buyers![0].contactId], list);
  },
  async check(ctx, t, s) {
    const b = s.buyers![0];
    const max = ctx.settings.maxSendsPerDay;
    const sends = await ctx.waitForSends([b.email], { since: s.since!, expectAtLeast: max + 1, timeoutMs: config.negativeWaitMs });
    const peak = maxSendsInWindow(sends, b.email, 864e5);
    const [a, c] = pairIds(t.id);
    const both = peak > max ? await Promise.all([ctx.realContactsInSequence(a), ctx.realContactsInSequence(c)]).then(([x, y]) => x.filter((id) => y.includes(id))) : [];
    return {
      pass: peak <= max,
      expected: `at most ${max} email per buyer per 24 hours`,
      actual: `${plural(peak, "email")} in 24 hours`,
      evidence: sends.map((e) => emailEvidence(e)),
      facts: { buyer: b.name, sends: peak, sequence: `${seqName(ctx.ws, a)} and ${seqName(ctx.ws, c)}` },
      // Real leads exposed: contacts already enrolled in both sequences.
      affectedContactIds: both,
    };
  },
  async proposeFix(ctx, t, s) {
    const [a, b] = pairIds(t.id);
    const pa = ctx.ws.sequences.find((x) => x.id === a)?.priority ?? 0;
    const pb = ctx.ws.sequences.find((x) => x.id === b)?.priority ?? 0;
    const lower = pa >= pb ? a : b;
    const buyer = s.buyers![0];
    s.lower = seqName(ctx.ws, lower);
    return [
      {
        action: "WITHDRAW_CONTACT", targetId: buyer.contactId, args: { contactId: buyer.contactId, sequenceId: lower },
        preview: `Remove ${buyer.name} from "${seqName(ctx.ws, lower)}" (the lower-priority sequence).`,
        before: { enrolled: [seqName(ctx.ws, a), seqName(ctx.ws, b)] }, after: { enrolled: [seqName(ctx.ws, lower === a ? b : a)] },
        reason: "Keep the buyer in the higher-priority sequence only.",
      },
      task(t.id, `Crash Test: ${t.name} double-tap buyers`, `A test buyer in both "${seqName(ctx.ws, a)}" and "${seqName(ctx.ws, b)}" got ${s.lower ? "two" : "several"} emails in one day. Add an exclusion between these sequences or a workspace send cap.`),
    ];
  },
  async retest(ctx, t, s) {
    // Contact-level fix: the same buyer is out of the lower sequence and gets nothing new.
    const b = s.buyers![0];
    const since = new Date().toISOString();
    const sends = await ctx.waitForSends([b.email], { since, expectAtLeast: 1, timeoutMs: config.negativeWaitMs });
    const enrolled = await ctx.backend.contactSequenceIds(b.contactId);
    const [a, c] = pairIds(t.id);
    const both = enrolled.includes(a) && enrolled.includes(c);
    return {
      pass: !both && sends.length === 0,
      expected: "buyer in one sequence, no further emails",
      actual: `${both ? "still in both" : "in one sequence"}, ${plural(sends.length, "email")} since the fix`,
      evidence: sends.map((e) => emailEvidence(e)),
      facts: { buyer: b.name, lower: String(s.lower ?? "") },
    };
  },
};

// ---------------------------------------------------------------- T3
export const T3: CrashTest = {
  id: "T3",
  targets: (ws) => seqTargets(ws, "Steps use merge fields"),
  async setup(ctx, t, s) {
    s.buyers = [await ctx.buyer("T3", t.id, { blankName: true })];
  },
  async trigger(ctx, t, s) {
    s.since = new Date(Date.now() - 2000).toISOString();
    if (/pause/i.test(await ctx.backend.sequenceStatus(t.id))) return;
    await ctx.backend.enrol(t.id, [s.buyers![0].contactId], await ctx.tagList());
  },
  async check(ctx, t, s) {
    const b = s.buyers![0];
    if (/pause/i.test(await ctx.backend.sequenceStatus(t.id))) {
      return { pass: true, expected: "no broken merge fields", actual: "sequence paused; nothing sends", evidence: [], facts: { sequence: t.name } };
    }
    const sends = await ctx.waitForSends([b.email], { since: s.since!, expectAtLeast: 1 });
    if (!sends.length) {
      const paused = /pause/i.test(await ctx.backend.sequenceStatus(t.id));
      return paused
        ? { pass: true, expected: "no broken merge fields", actual: "sequence paused; nothing sends", evidence: [], facts: { sequence: t.name } }
        : { pass: false, inconclusive: true, expected: "no broken merge fields", actual: "no email arrived in the time window", evidence: [], facts: { sequence: t.name } };
    }
    const bad: EvidenceIn[] = [];
    let token = "";
    for (const e of sends) {
      const hits = brokenMergeHits(`${e.subject}\n${e.body}`);
      if (hits.length) {
        token ||= hits[0];
        bad.push(emailEvidence(e, hits[0]));
      }
    }
    return {
      pass: bad.length === 0,
      expected: "no {{ }}, \"Hi ,\", undefined or null",
      actual: bad.length ? `"${token}" in ${plural(bad.length, "email")}` : "Every merge field rendered",
      evidence: bad.length ? bad : sends.slice(0, 1).map((e) => emailEvidence(e)),
      facts: { sequence: t.name, token },
      affectedContactIds: bad.length ? await ctx.realContactsInSequence(t.id) : [],
    };
  },
  async proposeFix(ctx, t, s, o) {
    const step = ctx.ws.sequences.find((x) => x.id === t.id)?.steps.find((st) => brokenMergeHits(`${st.subject ?? ""} ${st.body ?? ""}`).length || /\{\{\s*\w+\s*\}\}/.test(`${st.subject ?? ""} ${st.body ?? ""}`));
    return [
      pause(t.name, t.id, `"${t.name}" sends broken merge fields.`),
      task(t.id, `Crash Test: broken merge field in "${t.name}"`, `Step ${step?.order ?? "?"} sent "${o.facts.token}" to a contact with no first name or company. Add a fallback (e.g. {{first_name|there}}) before resuming.`),
    ];
  },
};

// ---------------------------------------------------------------- T7
export const T7: CrashTest = {
  id: "T7",
  targets: (ws) => seqTargets(ws, "Check every step's copy"),
  async check(ctx, t) {
    // Always read the current steps: the gate re-runs this right after an edit.
    const steps = await ctx.backend.sequenceSteps(t.id);
    const evidence: EvidenceIn[] = [];
    let first: { step: number; problem: string } | null = null;
    for (const st of steps) {
      const text = [st.subject, st.body].filter(Boolean).join("\n");
      if (!text) continue;
      const isEmail = /mail/i.test(st.type);
      const issues = contentIssues(st.body ?? "", isEmail).map((i) => ({ quote: i.quote, message: i.message }));
      // graph8 copilot answers in ~7-16 s (measured). Gate runs must block fast: keywords + 8 s.
      const { flags } = await promiseCheck(text, { timeoutMs: ctx.trigger === "GATE" ? 8_000 : 25_000 });
      for (const f of flags) issues.push({ quote: f.quote, message: `promises "${f.quote}", which nobody approved` });
      for (const i of issues) {
        first ??= { step: st.order, problem: i.message };
        evidence.push({
          kind: "SEQUENCE", graph8Id: st.id || `${t.id}:${st.order}`, title: `Step ${st.order}: ${st.subject ?? st.type}`,
          fields: { step: st.order, issue: i.message, sequence: t.name }, excerpt: excerpt(text, i.quote || undefined, 600),
          highlight: i.quote || undefined, at: new Date().toISOString(), raw: st,
        });
      }
    }
    const leads = evidence.length ? await ctx.realContactsInSequence(t.id) : [];
    return {
      pass: evidence.length === 0,
      expected: "unsubscribe line, no template leftovers, no unapproved promises",
      actual: evidence.length ? `${plural(evidence.length, "problem")}; first: step ${first!.step} ${first!.problem}` : `All ${plural(steps.length, "step")} clean`,
      evidence,
      facts: { sequence: t.name, step: first?.step, problem: first?.problem, leads: leads.length },
      affectedContactIds: leads,
    };
  },
  async retest(ctx, t) {
    // The copy is a human's to fix; the machine is safe once nothing can send it.
    const status = await ctx.backend.sequenceStatus(t.id);
    const paused = /pause/i.test(status);
    return {
      pass: paused, expected: "sequence paused until the copy is reviewed",
      actual: paused ? "sequence paused; nothing sends until the copy is fixed" : `sequence is ${status}`,
      evidence: [], facts: { sequence: t.name },
    };
  },
  async proposeFix(_ctx, t, _s, o) {
    const quote = o.evidence.find((e) => e.highlight)?.highlight;
    return [
      pause(t.name, t.id, `"${t.name}" step ${o.facts.step} ${o.facts.problem}.`),
      task(t.id, `Crash Test: review copy in "${t.name}"`, `Step ${o.facts.step} ${o.facts.problem}.${quote ? `\n\nSentence: "${quote}"` : ""}\n\nThe sequence was paused by Crash Test.`),
    ];
  },
};

// ---------------------------------------------------------------- T9
export const T9: CrashTest = {
  id: "T9",
  targets: () => [{ type: "workspace", id: "contact-limit", name: "All live sequences", why: "Weekly contact cap" }],
  async check(ctx) {
    const cap = ctx.settings.maxSendsPerWeek;
    const perContact = new Map<string, string[]>();
    for (const s of liveSeqs(ctx.ws)) {
      for (const c of await ctx.backend.sequenceContactIds(s.id).catch(() => [] as string[])) perContact.set(c, [...(perContact.get(c) ?? []), s.id]);
    }
    const weekly = (ids: string[]) => ids.reduce((n, id) => n + (ctx.ws.sequences.find((s) => s.id === id)?.steps.filter((st) => /mail/i.test(st.type) && st.delayMinutes <= 7 * 1440).length ?? 0), 0);
    const over = [...perContact.entries()].filter(([, ids]) => ids.length > 1 && weekly(ids) > cap);
    const worst = over.sort((a, b) => weekly(b[1]) - weekly(a[1]))[0];
    return {
      pass: over.length === 0,
      expected: `no buyer gets more than ${cap} messages a week`,
      actual: over.length ? `${plural(over.length, "buyer")} over the cap` : "all buyers within the cap",
      evidence: over.slice(0, 8).map(([cid, ids]) => ({
        kind: "CONTACT" as const, graph8Id: cid, title: `Contact ${cid}`, fields: { sequences: ids.map((i) => seqName(ctx.ws, i)), perWeek: weekly(ids) },
        at: new Date().toISOString(),
      })),
      facts: { buyer: worst ? `Contact ${worst[0]}` : "", count: worst?.[1].length, sends: worst ? weekly(worst[1]) : 0 },
      affectedContactIds: over.map(([c]) => c),
      state: { over },
    } as Outcome;
  },
  async proposeFix(ctx, _t, _s, o) {
    const over = (o as Outcome & { state?: { over: [string, string[]][] } }).state?.over ?? [];
    return over.slice(0, 20).flatMap(([cid, ids]) => {
      const keep = [...ids].sort((a, b) => (ctx.ws.sequences.find((s) => s.id === a)?.priority ?? 0) - (ctx.ws.sequences.find((s) => s.id === b)?.priority ?? 0))[0];
      return ids.filter((i) => i !== keep).map((seq) => ({
        action: "WITHDRAW_CONTACT" as const, targetId: cid, args: { contactId: cid, sequenceId: seq },
        preview: `Remove contact ${cid} from "${seqName(ctx.ws, seq)}" (keeps "${seqName(ctx.ws, keep)}").`,
        before: { sequences: ids.length }, after: { sequences: 1 }, reason: "Stay under the weekly contact cap.",
      }));
    });
  },
};
