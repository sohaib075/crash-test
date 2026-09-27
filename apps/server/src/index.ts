// API server :4000 — Express 5 + Socket.IO. Keys stay here and in the worker (§26).
import { config, log } from "@crash/core";
import { waitForDb } from "@crash/db";
import { createServer } from "http";
import { Server } from "socket.io";
import { createApp } from "./app";
import { queue } from "./boss";
import { bridgeEvents } from "./events";

const port = Number(process.env.SERVER_PORT ?? 4000);
const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

async function main() {
  if (!config.apiKey) log.warn("GRAPH8_API_KEY is not set: graph8 calls will fail until it's added to .env.local");
  await waitForDb();
  const { app } = createApp(queue);
  const http = createServer(app);
  const io = new Server(http, { cors: { origin } });
  await bridgeEvents(io);
  http.listen(port, () => log.info(`Crash Test API on http://localhost:${port}`));
}

main().catch((e) => {
  log.error(e);
  process.exit(1);
});
