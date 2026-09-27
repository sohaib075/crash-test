// Production entry (`npm start`, and the Docker image's command).
// 1. Applies database migrations and seeds the defaults (safe to repeat).
// 2. Runs the API, the worker and the web app together. Only the web app listens
//    publicly (on $PORT); it proxies /api and /socket.io to the API on loopback.
// If any of the three stops, the others are stopped too and this exits non-zero,
// so the platform restarts the whole container.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const next = path.join(root, "node_modules/next/dist/bin/next");

const PORT = process.env.PORT || "3000";
// Must match INTERNAL_API_URL at build time (default http://127.0.0.1:4000).
const API_PORT = process.env.INTERNAL_API_PORT || "4000";
const env = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" };

const say = (msg) => console.log(`[start] ${msg}`);

// docker-compose.prod.yml passes the database's parts (POSTGRES_HOST etc.): build the URL here,
// encoded, so any password works (a raw "/", "#" or "?" would break a hand-written URL).
if (!env.DATABASE_URL && env.POSTGRES_HOST) {
  const enc = encodeURIComponent;
  env.DATABASE_URL = `postgresql://${enc(env.POSTGRES_USER || "crash")}:${enc(env.POSTGRES_PASSWORD || "")}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT || "5432"}/${enc(env.POSTGRES_DB || "crashtest")}`;
}
if (!env.DATABASE_URL) {
  console.error("[start] DATABASE_URL is not set. Point it at your PostgreSQL database (see .env.production.example).");
  process.exit(1);
}
// Fail closed: a deployed URL without a password lets anyone run tests and change graph8.
if (!env.APP_PASSWORD && env.ALLOW_NO_PASSWORD !== "1") {
  console.error("[start] APP_PASSWORD is not set. Set a long random password (e.g. `openssl rand -base64 24`), or set ALLOW_NO_PASSWORD=1 for a private network.");
  process.exit(1);
}
if (env.APP_PASSWORD && env.APP_PASSWORD.length < 12) {
  console.error("[start] APP_PASSWORD is too short: use at least 12 characters (e.g. `openssl rand -base64 24`).");
  process.exit(1);
}
if (!env.APP_PASSWORD) say("WARNING: running without APP_PASSWORD (ALLOW_NO_PASSWORD=1).");
if (!env.GRAPH8_API_KEY) say("WARNING: GRAPH8_API_KEY is not set. The app starts, but every graph8 call will fail.");

// Stop requests can arrive at any time, even during migrations (a cancelled deploy):
// never kill a migration half-way; stop cleanly once it has finished.
let children = null;
let stopRequested = false;
const onSignal = () => (children ? stop(0) : (stopRequested = true));
process.on("SIGTERM", onSignal);
process.on("SIGINT", onSignal);

// TypeScript runs through tsx's loader inside each process (no extra launcher process).
const ts = (file) => ["--import", "tsx", file];

function run(name, args, extraEnv = {}) {
  return spawn(process.execPath, args, { cwd: root, env: { ...env, ...extraEnv }, stdio: "inherit" }).on("error", (e) => {
    console.error(`[start] could not start ${name}: ${e.message}`);
  });
}

// 1. Database first: nothing else may start on an old schema. A database that is still
// starting (fresh container, managed DB waking up) gets a few more tries.
let migrated = false;
for (let attempt = 1; attempt <= 6 && !migrated; attempt++) {
  if (attempt > 1) {
    say(`Retrying migrations in 5 s (attempt ${attempt} of 6)…`);
    await new Promise((r) => setTimeout(r, 5000));
  } else say("Applying database migrations…");
  const migrate = run("migrations", ts("packages/db/src/migrate.ts"));
  migrated = await new Promise((resolve) => migrate.on("exit", (code) => resolve(code === 0)));
  if (stopRequested) break;
}
if (stopRequested) process.exit(0);
if (!migrated) {
  console.error("[start] Migrations failed; not starting. Check DATABASE_URL and that the database is reachable.");
  process.exit(1);
}

// 2. The three services.
children = [
  ["api", run("api", ts("apps/server/src/index.ts"), { SERVER_HOST: "127.0.0.1", SERVER_PORT: API_PORT })],
  ["worker", run("worker", ts("apps/worker/src/index.ts"))],
  ["web", run("web", [next, "start", "apps/web", "-p", PORT, "-H", "0.0.0.0"])],
];
say(`Crash Test is starting on port ${PORT} (API on 127.0.0.1:${API_PORT}).`);

let stopping = false;
// A child that died by a signal (e.g. killed for memory) has signalCode set, not exitCode.
const exitedAlready = (c) => c.exitCode !== null || c.signalCode !== null;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const [, child] of children) if (!exitedAlready(child)) child.kill("SIGTERM");
  const exited = children.map(([, c]) => (exitedAlready(c) ? Promise.resolve() : new Promise((r) => c.once("exit", r))));
  Promise.all(exited).then(() => process.exit(code));
  setTimeout(() => process.exit(code), 10_000);
}
for (const [name, child] of children) {
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[start] ${name} stopped (${signal ?? `exit ${code}`}); stopping the others.`);
    stop(1);
  });
}
