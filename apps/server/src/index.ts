// API server :4000 — Express 5 + Socket.IO. Keys stay here and in the worker (§26).
import { config, log } from "@crash/core";
import { waitForDb } from "@crash/db";
import { createServer } from "http";
import { Server } from "socket.io";
import { createApp } from "./app";
import { fromOwnSite, passwordOk } from "./auth";
import { queue, stopBoss } from "./boss";
import { bridgeEvents } from "./events";

const port = Number(process.env.SERVER_PORT ?? 4000);
// Production runs the API on loopback behind the web app (SERVER_HOST=127.0.0.1); dev listens everywhere.
const host = process.env.SERVER_HOST || undefined;
const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

async function main() {
  if (!config.apiKey) log.warn("GRAPH8_API_KEY is not set: graph8 calls will fail until it's added to .env");
  await waitForDb();
  const { app } = createApp(queue);
  const http = createServer(app);
  const io = new Server(http, {
    cors: { origin },
    // Accept "/socket.io?EIO=…" as well as "/socket.io/?EIO=…": the web app's proxy drops the trailing slash.
    addTrailingSlash: false,
    // Same password as the API (the web app forwards the browser's credentials).
    // Same password as the API (the web app forwards the browser's credentials), and only from our own pages.
    allowRequest: (req, cb) => cb(null, passwordOk(req.headers.authorization) && fromOwnSite(req)),
  });
  await bridgeEvents(io);
  http.listen(port, host, () => log.info(`Crash Test API on http://${host ?? "localhost"}:${port}`));

  // Graceful stop (deploys, restarts): finish in-flight requests, then close the queue.
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    log.info("API stopping");
    setTimeout(() => process.exit(0), 8000).unref();
    io.close();
    http.close(async () => {
      await stopBoss();
      process.exit(0);
    });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((e) => {
  log.error(e);
  process.exit(1);
});
