// Worker/server → Postgres NOTIFY → server relays to Socket.IO (§16).
// Payloads stay small (NOTIFY limit 8 KB); the UI refetches details.
import { prisma } from "@crash/db";
import { CHANNEL, type LiveEvent } from "@crash/shared";
import { log } from "./log";

type Listener = (e: LiveEvent) => void;
const local = new Set<Listener>();

/** In-process subscribers (tests, single-process mode). */
export function onLocalEvent(fn: Listener) {
  local.add(fn);
  return () => local.delete(fn);
}

export async function publish(e: LiveEvent) {
  local.forEach((fn) => fn(e));
  try {
    await prisma.$executeRaw`select pg_notify(${CHANNEL}, ${JSON.stringify(e)})`;
  } catch (err) {
    log.warn({ err }, "publish failed");
  }
}

export async function runLog(runId: string, message: string) {
  const at = new Date();
  await prisma.runLog.create({ data: { runId, message, at } }).catch(() => {});
  await publish({ type: "log", runId, message, at: at.toISOString() });
}
