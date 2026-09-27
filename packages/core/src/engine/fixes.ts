// The allow-listed fixes (§09, §26): apply records the REAL before/after state
// from graph8; undo reverses it. Tasks and notes are stored as Writebacks.
import { prisma, type Fix } from "@crash/db";
import { FIX_ACTIONS, FIX_LABEL } from "@crash/shared";
import type { FixArgs } from "../tests/types";
import { isTestEmail } from "../config";
import { publish, runLog } from "../publish";
import { getBackend, tagList } from "./context";

type Applied = { before: unknown; after: unknown; writeback?: { kind: string; graph8Id: string } };

export async function executeFix(fix: Fix, runId: string): Promise<Applied> {
  const b = getBackend();
  const a = fix.args as FixArgs;
  if (!FIX_ACTIONS.includes(fix.action)) throw new Error(`Safety: ${fix.action} is not on the allow-list`);
  switch (fix.action) {
    case "PAUSE_SEQUENCE": {
      const before = await b.sequenceStatus(a.sequenceId!);
      if (!/pause/i.test(before)) await b.pauseSequence(a.sequenceId!);
      const after = await b.sequenceStatus(a.sequenceId!);
      await prisma.sequence.updateMany({ where: { graph8Id: a.sequenceId! }, data: { status: after } });
      return { before: { status: before }, after: { status: after } };
    }
    case "RESUME_SEQUENCE": {
      const before = await b.sequenceStatus(a.sequenceId!);
      await b.resumeSequence(a.sequenceId!);
      const after = await b.sequenceStatus(a.sequenceId!);
      await prisma.sequence.updateMany({ where: { graph8Id: a.sequenceId! }, data: { status: after } });
      return { before: { status: before }, after: { status: after } };
    }
    case "WITHDRAW_CONTACT": {
      const before = await b.contactSequenceIds(a.contactId!);
      await b.withdraw([a.contactId!], a.sequenceId ? [a.sequenceId] : undefined);
      return { before: { sequences: before }, after: { sequences: await b.contactSequenceIds(a.contactId!) } };
    }
    case "ADD_SUPPRESSION": {
      const before = await b.isSuppressed(a.contactId!);
      await b.suppress(a.contactId!);
      return { before: { suppressed: before }, after: { suppressed: true } };
    }
    case "REOWN_VIA_LIST": {
      const rows = await b.activeContactOwners();
      const prev = Object.fromEntries(rows.filter((r) => a.contactIds!.includes(r.contactId)).map((r) => [r.contactId, r.ownerId]));
      await b.reownViaList(a.contactIds!, a.ownerUserId!);
      return { before: { owners: prev }, after: { owner: a.ownerUserId, count: a.contactIds!.length } };
    }
    case "CREATE_TASK": {
      const id = await b.createTask({ contactId: a.contactId, dealId: a.dealId, title: a.title ?? "Crash Test finding", body: a.body ?? fix.reason });
      return { before: null, after: { taskId: id }, writeback: { kind: "task", graph8Id: id } };
    }
    case "ADD_DEAL_NOTE": {
      const id = await b.addDealNote(a.dealId!, a.body ?? fix.reason);
      return { before: null, after: { noteId: id }, writeback: { kind: "deal_note", graph8Id: id } };
    }
    case "CANCEL_TEST_BOOKING":
      return { before: null, after: null };
  }
  void runId;
}

export async function applyFix(fixId: string): Promise<Fix> {
  const fix = await prisma.fix.findUniqueOrThrow({ where: { id: fixId }, include: { result: true } });
  if (fix.status === "APPLIED") return fix;
  if (fix.status !== "PROPOSED") throw new Error(`Fix is ${fix.status.toLowerCase()}`);
  const runId = fix.result.runId;
  try {
    const r = await executeFix(fix, runId);
    const updated = await prisma.fix.update({ where: { id: fixId }, data: { status: "APPLIED", before: r.before as object, after: r.after as object, appliedAt: new Date(), error: null } });
    if (r.writeback) {
      await prisma.writeback.upsert({
        where: { resultId_kind: { resultId: fix.resultId, kind: r.writeback.kind } },
        create: { resultId: fix.resultId, ...r.writeback },
        update: { graph8Id: r.writeback.graph8Id },
      });
    }
    await runLog(runId, `${FIX_LABEL[fix.action]}: ${fix.preview}`);
    await publish({ type: "fix:applied", runId, fixId, resultId: fix.resultId });
    return updated;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.fix.update({ where: { id: fixId }, data: { status: "FAILED", error: msg } });
    await runLog(runId, `Fix failed (${FIX_LABEL[fix.action]}): ${msg}`);
    throw err;
  }
}

export async function undoFix(fixId: string): Promise<Fix> {
  const b = getBackend();
  const fix = await prisma.fix.findUniqueOrThrow({ where: { id: fixId }, include: { result: true } });
  if (fix.status === "UNDONE") return fix;
  if (fix.status !== "APPLIED") throw new Error("Only an applied fix can be undone");
  const a = fix.args as FixArgs;
  let note: string | null = null;
  const before = fix.before as Record<string, unknown> | null;
  const after = fix.after as Record<string, unknown> | null;
  switch (fix.action) {
    case "PAUSE_SEQUENCE": {
      // Several findings can pause the same sequence. Resume only when no other
      // applied fix still holds it paused, so one Undo never re-opens a leak another fix closed.
      const others = await prisma.fix.count({
        where: { id: { not: fixId }, action: "PAUSE_SEQUENCE", status: "APPLIED", targetId: fix.targetId },
      });
      if (others) {
        const seq = await prisma.sequence.findUnique({ where: { graph8Id: a.sequenceId! } });
        note = `Still paused: ${others} other fix${others === 1 ? "" : "es"} paused "${seq?.name ?? a.sequenceId}" too. Undo ${others === 1 ? "it" : "them"} to resume the sequence.`;
      } else if (/pause/i.test(await b.sequenceStatus(a.sequenceId!))) {
        await b.resumeSequence(a.sequenceId!);
      }
      await prisma.sequence.updateMany({ where: { graph8Id: a.sequenceId! }, data: { status: await b.sequenceStatus(a.sequenceId!) } });
      break;
    }
    case "RESUME_SEQUENCE":
      await b.pauseSequence(a.sequenceId!);
      await prisma.sequence.updateMany({ where: { graph8Id: a.sequenceId! }, data: { status: await b.sequenceStatus(a.sequenceId!) } });
      break;
    case "WITHDRAW_CONTACT": {
      const buyer = await prisma.fakeBuyer.findUnique({ where: { contactId: a.contactId! } });
      if (buyer?.cleanedUp) throw new Error("That fake buyer was already cleaned up; nothing to restore.");
      const removed = ((before?.sequences as string[]) ?? []).filter((s) => !((after?.sequences as string[]) ?? []).includes(s));
      for (const s of removed) {
        // graph8 enrols through a list: the run's tag list for fake buyers,
        // otherwise the sequence's own associated list.
        const seq = await prisma.sequence.findUnique({ where: { graph8Id: s } });
        const assoc = (seq?.raw as Record<string, unknown> | undefined)?.associated_list_id;
        const listId = buyer ? await tagList(buyer.runId) : assoc != null ? String(assoc) : null;
        if (!listId) throw new Error("graph8 needs a list to re-enrol this contact; re-add them in graph8.");
        await b.enrol(s, [a.contactId!], listId);
      }
      break;
    }
    case "ADD_SUPPRESSION":
      if (before?.suppressed === false) await b.reinstate(a.contactId!);
      break;
    case "REOWN_VIA_LIST": {
      const owners = (before?.owners as Record<string, string | null>) ?? {};
      const byOwner = new Map<string, string[]>();
      const cleared: string[] = [];
      for (const [cid, owner] of Object.entries(owners)) {
        if (owner) byOwner.set(owner, [...(byOwner.get(owner) ?? []), cid]);
        else cleared.push(cid);
      }
      for (const [owner, ids] of byOwner) await b.reownViaList(ids, owner).catch(() => {});
      // Leads that had no owner go back to having none (restores the planted T4 problem).
      if (cleared.length) await b.clearOwnerViaList(cleared);
      break;
    }
    case "CREATE_TASK":
      if (after?.taskId) await b.deleteTask(String(after.taskId)).catch(() => {});
      await prisma.writeback.deleteMany({ where: { resultId: fix.resultId, kind: "task" } });
      break;
    case "ADD_DEAL_NOTE":
      if (after?.noteId && a.dealId) await b.deleteDealNote(a.dealId, String(after.noteId)).catch(() => {});
      await prisma.writeback.deleteMany({ where: { resultId: fix.resultId, kind: "deal_note" } });
      break;
    case "CANCEL_TEST_BOOKING":
      break;
  }
  const updated = await prisma.fix.update({ where: { id: fixId }, data: { status: "UNDONE", undoneAt: new Date(), error: note } });
  await runLog(fix.result.runId, `Undid: ${FIX_LABEL[fix.action]}`);
  await publish({ type: "fix:undone", runId: fix.result.runId, fixId, resultId: fix.resultId });
  return updated;
}

export { isTestEmail };
