// Pre-flight gate (§10, §21 gate.watch): snapshot every live sequence's steps;
// when a step changes, start a GATE run of the content check on that sequence.
import { Prisma, prisma } from "@crash/db";
import { createHash } from "crypto";
import { log } from "../log";
import { publish } from "../publish";
import { isLive } from "../tests/types";
import { getBackend, loadSettings } from "./context";
import { type Queue, startRun } from "./run";

const hash = (s: unknown) => createHash("sha1").update(JSON.stringify(s)).digest("hex").slice(0, 16);

export async function gateTick(q: Queue) {
  const settings = await loadSettings();
  if (!settings.gateEnabled) return { checked: 0, changed: 0 };
  const seqs = await prisma.sequence.findMany();
  let changed = 0;
  for (const seq of seqs) {
    if (!isLive(seq.status)) continue;
    // Don't stack gate runs on the same sequence.
    const busy = await prisma.gateEvent.findFirst({ where: { sequenceId: seq.id, result: "CHECKING" } });
    if (busy) continue;
    let steps;
    try {
      steps = await getBackend().sequenceSteps(seq.graph8Id);
    } catch (err) {
      log.warn({ err, seq: seq.name }, "gate: could not read steps");
      continue;
    }
    const hashes = steps.map((s) => hash([s.subject, s.body, s.type, s.delayMinutes]));
    const last = await prisma.sequenceSnapshot.findFirst({ where: { sequenceId: seq.id }, orderBy: { takenAt: "desc" } });
    if (last && JSON.stringify(last.stepHashes) === JSON.stringify(hashes)) continue;
    await prisma.sequenceSnapshot.create({ data: { sequenceId: seq.id, stepHashes: hashes, steps: steps as unknown as Prisma.InputJsonValue } });
    if (!last) continue; // first snapshot is the baseline
    // Compare over the longer list, so an added or removed step counts as a change too.
    const n = Math.max(hashes.length, last.stepHashes.length);
    const changedSteps = Array.from({ length: n }, (_, i) => (hashes[i] !== last.stepHashes[i] ? i + 1 : 0)).filter(Boolean);
    changed++;
    const run = await startRun(q, { trigger: "GATE", testIds: ["T7"], targetIds: [seq.graph8Id] });
    await prisma.gateEvent.create({ data: { sequenceId: seq.id, runId: run.id, changedSteps, result: "CHECKING", message: `${changedSteps.length === 1 ? "Step" : "Steps"} ${changedSteps.join(", ")} changed. Checking the new copy…` } });
    await publish({ type: "gate:checking", sequenceId: seq.graph8Id, name: seq.name, runId: run.id });
    log.info({ seq: seq.name, changedSteps }, "gate: change detected");
  }
  return { checked: seqs.length, changed };
}

/** Take fresh baselines (after a demo reset) so old edits don't trigger. */
export async function rebaseline() {
  const seqs = await prisma.sequence.findMany();
  for (const seq of seqs) {
    const steps = await getBackend().sequenceSteps(seq.graph8Id).catch(() => null);
    if (!steps) continue;
    await prisma.sequenceSnapshot.create({ data: { sequenceId: seq.id, stepHashes: steps.map((s) => hash([s.subject, s.body, s.type, s.delayMinutes])), steps: steps as unknown as Prisma.InputJsonValue } });
  }
  await prisma.gateEvent.updateMany({ where: { result: { in: ["CHECKING", "BLOCKED"] } }, data: { result: "RELEASED", resolvedAt: new Date(), message: "Cleared by demo reset" } });
}
