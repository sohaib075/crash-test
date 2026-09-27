// Postgres LISTEN crash_events → Socket.IO (§16). The worker publishes with NOTIFY.
import { CHANNEL, type LiveEvent } from "@crash/shared";
import { log } from "@crash/core";
import pg from "pg";
import type { Server } from "socket.io";

export async function bridgeEvents(io: Server) {
  let delay = 2000;
  // Reconnect with backoff (e.g. a managed database restarting); never crash the API over it.
  const reconnect = () =>
    setTimeout(() => {
      connect().then(() => (delay = 2000)).catch((err) => {
        log.warn({ err }, "LISTEN reconnect failed; retrying");
        delay = Math.min(delay * 2, 30_000);
        reconnect();
      });
    }, delay);
  const connect = async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    let lost = false;
    client.on("error", (err) => {
      if (lost) return;
      lost = true;
      log.warn({ err }, "LISTEN connection lost; reconnecting");
      client.end().catch(() => {});
      reconnect();
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    client.on("notification", (msg) => {
      if (!msg.payload) return;
      try {
        const e = JSON.parse(msg.payload) as LiveEvent;
        io.emit(e.type, e);
        if ("runId" in e && e.runId) io.to(`run:${e.runId}`).emit("run-event", e);
        io.emit("event", e);
      } catch {
        /* ignore malformed */
      }
    });
    log.info("Listening for live events");
  };
  await connect();
  io.on("connection", (s) => {
    s.on("join", (runId: string) => s.join(`run:${runId}`));
    s.on("leave", (runId: string) => s.leave(`run:${runId}`));
  });
}
