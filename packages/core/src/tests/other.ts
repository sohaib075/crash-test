// BILL T13 quote check · HYGIENE T4 orphan lead, T8 speed-to-lead · BOOK T11 booking hosts.
import type { CrashTest, EvidenceIn, Outcome, ProposedFix } from "./types";
import { isLive } from "./types";
import { plural, quoteProblems, usd } from "./rules";
import { emailEvidence } from "./sell";
import type { OwnerRow } from "../types";

// ---------------------------------------------------------------- T4
export const T4: CrashTest = {
  id: "T4",
  targets: () => [{ type: "workspace", id: "owners", name: "All active leads", why: "Owner check" }],
  async check(ctx, _t, s) {
    if (ctx.ws.ownerIdsComplete === false) {
      return { pass: false, inconclusive: true, expected: "every active lead has an owner who still works here", actual: "Couldn't read graph8's team members, so owners can't be matched", evidence: [], facts: { count: 0 } };
    }
    // Match an owner against every id variant graph8 returns for a team member.
    const current = new Set(ctx.ws.users.filter((u) => u.active).flatMap((u) => [u.id, u.email, ...(u.aliases ?? [])]));
    const rows = await ctx.backend.activeContactOwners();
    const orphans: OwnerRow[] = rows.filter((r) => !r.ownerId || !current.has(String(r.ownerId)));
    s.orphans = orphans.map((o) => o.contactId);
    const noOwner = orphans.filter((o) => !o.ownerId).length;
    return {
      pass: orphans.length === 0,
      expected: "every active lead has an owner who still works here",
      actual: orphans.length ? `${plural(orphans.length, "lead")} orphaned (${noOwner} with no owner, ${orphans.length - noOwner} owned by someone who left)` : `${rows.length} leads checked, all owned`,
      evidence: orphans.slice(0, 12).map((o) => ({
        kind: "CONTACT" as const, graph8Id: o.contactId, title: o.name || o.email,
        fields: { email: o.email, owner: o.ownerId ? `${o.ownerId} (not on the team)` : "none" }, at: new Date().toISOString(),
      })),
      facts: { count: orphans.length },
      affectedContactIds: orphans.map((o) => o.contactId),
    };
  },
  async proposeFix(ctx, _t, s) {
    const ids = (s.orphans as string[]) ?? [];
    const owner = ctx.ws.users.find((u) => u.active);
    if (!owner || !ids.length) return [];
    const preview = await ctx.backend.previewReown(ids, owner.id).catch(() => ({ count: ids.length }));
    s.owner = owner.name;
    return [{
      action: "REOWN_VIA_LIST", targetId: "owners", args: { contactIds: ids, ownerUserId: owner.id },
      preview: `Assign ${plural(preview.count, "lead")} to ${owner.name} through a temporary list (graph8 preview: ${preview.count} records). assign-owner is never called.`,
      before: { owner: "none or departed", leads: ids.length }, after: { owner: owner.name, leads: preview.count },
      reason: "Every lead needs someone to follow up.",
    }];
  },
};

// ---------------------------------------------------------------- T13
export const T13: CrashTest = {
  id: "T13",
  targets: (ws) => ws.quotes.map((q) => ({ type: "quote" as const, id: q.id, name: `Quote ${q.number}`, why: "Sent quote" })),
  async check(ctx, t, s) {
    const q = ctx.ws.quotes.find((x) => x.id === t.id);
    if (!q) return { pass: false, inconclusive: true, expected: "quote readable", actual: "quote not found", evidence: [], facts: { quote: t.name } };
    const deal = q.dealId ? ctx.ws.deals.find((d) => d.id === q.dealId) ?? null : null;
    const suppressed = q.recipientContactId ? await ctx.backend.isSuppressed(q.recipientContactId).catch(() => false) : false;
    const active = ctx.ws.users.filter((u) => u.active);
    const senderActive = q.senderEmail ? active.some((u) => u.email === q.senderEmail) : q.senderUserId ? active.some((u) => u.id === q.senderUserId) : null;
    const problems = quoteProblems({
      total: q.total, dealAmount: deal?.amount ?? null, lineItemCount: q.lineItemCount, expiresAt: q.expiresAt,
      recipientSuppressed: suppressed, senderActive, tolerancePct: ctx.settings.quoteTolerancePct,
    });
    s.dealId = deal?.id ?? q.dealId;
    s.dealName = deal?.name ?? "the deal";
    const evidence: EvidenceIn[] = [{
      kind: "QUOTE", graph8Id: q.id, title: `Quote ${q.number}`,
      fields: {
        quoteTotal: q.total, dealAmount: deal?.amount ?? null, currency: q.currency, deal: deal?.name ?? null,
        lineItems: q.lineItemCount, expiresAt: q.expiresAt, sender: q.senderEmail, recipient: q.recipientEmail, status: q.status,
      },
      highlight: problems[0]?.code, at: q.sentAt ?? new Date().toISOString(), raw: q.raw,
    }];
    return {
      pass: problems.length === 0,
      expected: `total matches the deal (±${ctx.settings.quoteTolerancePct}%), has line items, not expired, current sender, recipient not opted out`,
      actual: problems.length ? problems.map((p) => p.message).join(" ") : `${q.total != null ? usd(q.total) : "total"} matches ${deal ? "the deal" : "(no linked deal)"}`,
      evidence,
      facts: { quote: q.number, problem: problems.map((p) => p.message).join(" "), deal: deal?.name },
      pipelineAtRisk: problems.length ? deal?.amount ?? q.total ?? 0 : 0,
      dealIds: problems.length && deal ? [deal.id] : [],
      leadsAffected: problems.length ? 1 : 0,
    };
  },
  async proposeFix(_ctx, t, s, o) {
    const dealId = s.dealId as string | undefined;
    const text = `Crash Test found a problem with ${t.name}: ${o.actual}\n\nThe quote was NOT edited (editing a sent quote voids its signing link). Please review and re-issue if needed.`;
    const out: ProposedFix[] = [{
      action: "CREATE_TASK", targetId: dealId ?? t.id, args: { dealId, title: `Crash Test: check ${t.name}`, body: text },
      preview: `Create a task on ${s.dealName}: "Crash Test: check ${t.name}". The quote itself is never edited.`,
      before: null, after: { task: `Crash Test: check ${t.name}` }, reason: "Billing needs to see both numbers.",
    }];
    if (dealId) out.push({
      action: "ADD_DEAL_NOTE", targetId: dealId, args: { dealId, title: "", body: text },
      preview: `Add a note to ${s.dealName} with both numbers.`, before: null, after: { note: "added" }, reason: "Keep the finding on the deal.",
    });
    return out;
  },
};

// ---------------------------------------------------------------- T11 (host check; no paid booking)
export const T11: CrashTest = {
  id: "T11",
  targets: (ws) => ws.bookingLinks.map((b) => ({ type: "booking_link" as const, id: b.id, name: b.name, why: "Public booking link" })),
  async check(ctx, t) {
    const link = ctx.ws.bookingLinks.find((b) => b.id === t.id)!;
    const current = ctx.ws.users.filter((u) => u.active);
    const gone = link.hostEmails.filter((e) => !current.some((u) => u.email === e));
    const noHosts = link.hostEmails.length === 0 && link.hostUserIds.length === 0;
    const pass = !gone.length && !noHosts;
    return {
      pass,
      inconclusive: noHosts,
      expected: "every host is a current team member",
      actual: noHosts ? "graph8 returned no host list for this link" : gone.length ? `goes to ${gone.join(", ")}, who ${gone.length === 1 ? "is" : "are"} no longer on the team` : `${plural(link.hostEmails.length, "host")}, all current`,
      evidence: [{ kind: "BOOKING", graph8Id: link.id, title: link.name, fields: { hosts: link.hostEmails, departed: gone, slug: link.slug }, at: new Date().toISOString(), raw: link.raw }],
      facts: { link: link.name, problem: gone.length ? `go to ${gone.join(", ")}, who is no longer on the team` : "have no host" },
    };
  },
  async proposeFix(_ctx, t, _s, o) {
    return [{
      action: "CREATE_TASK", targetId: t.id, args: { title: `Crash Test: fix hosts for "${t.name}"`, body: `Booking link "${t.name}": ${o.actual}. Update the host group so new meetings reach someone.` },
      preview: `Create a task: fix the host group for "${t.name}".`, before: null, after: { task: "created" }, reason: "Meetings must reach a current rep.",
    }];
  },
};

// ---------------------------------------------------------------- T8
export const T8: CrashTest = {
  id: "T8",
  targets: (ws) => ws.sequences.filter((s) => isLive(s.status) && s.sourceListIds.length).map((s) => ({ type: "sequence" as const, id: s.id, name: s.name, why: "Fed by a list" })),
  async setup(ctx, t, s) {
    s.buyers = [await ctx.buyer("T8", t.id)];
  },
  async trigger(ctx, t, s) {
    const listId = ctx.ws.sequences.find((x) => x.id === t.id)!.sourceListIds[0];
    s.since = new Date(Date.now() - 2000).toISOString();
    s.listId = listId;
    await ctx.backend.addToList(listId, [s.buyers![0].contactId]);
  },
  async check(ctx, t, s): Promise<Outcome> {
    const goal = ctx.settings.speedGoalSec;
    const b = s.buyers![0];
    const sends = await ctx.waitForSends([b.email], { since: s.since!, expectAtLeast: 1, timeoutMs: goal * 1000 });
    const waited = sends[0] ? Math.round((Date.parse(sends[0].sentAt) - Date.parse(s.since!)) / 1000) : goal;
    const list = ctx.ws.lists.find((l) => l.id === s.listId)?.name ?? "the feeding list";
    return {
      pass: sends.length > 0 && waited <= goal,
      expected: `first touch within ${Math.round(goal / 60)} min`,
      actual: sends.length ? `first email after ${waited}s` : `no email within ${Math.round(goal / 60)} min`,
      evidence: sends.slice(0, 1).map((e) => emailEvidence(e)),
      facts: { list, waited: sends.length ? `${waited}s` : `over ${Math.round(goal / 60)} min`, goal: `${Math.round(goal / 60)} min` },
      actualSec: waited, goalSec: goal, leadsAffected: sends.length ? 0 : 1,
    };
  },
  async proposeFix(ctx, t, s) {
    const b = s.buyers![0];
    return [{
      action: "CREATE_TASK", targetId: t.id, args: { title: `Crash Test: "${t.name}" isn't picking up new leads`, body: `A test lead added to the feeding list was not contacted within the goal. Check the sequence's "wait for new contacts" trigger.`, contactId: b.contactId },
      preview: `Create a task about the broken trigger on "${t.name}".`, before: null, after: { task: "created" }, reason: "New leads go cold.",
    }];
  },
};
