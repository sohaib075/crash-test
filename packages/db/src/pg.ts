// Database for `npm run dev`. DATABASE_URL in the root .env decides:
//   • local default (postgresql://crash:crash@localhost:5432/crashtest) → starts an
//     embedded PostgreSQL 16 (real binaries, data in .pgdata/, no Docker needed)
//   • anything else (Docker, your own Postgres, Neon, Supabase, RDS…) → uses it as-is
// Either way it then applies migrations and seeds the defaults.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "fs";
import path from "path";
import { migrateAndSeed } from "./migrate";

const root = path.resolve(import.meta.dirname, "../../..");
const dataDir = path.join(root, ".pgdata");
const LOCAL = "postgresql://crash:crash@localhost:5432/crashtest";
const url = process.env.DATABASE_URL || LOCAL;
const embedded = process.env.EMBEDDED_PG === "on" || (process.env.EMBEDDED_PG !== "off" && url === LOCAL);

async function main() {
  if (!embedded) {
    await migrateAndSeed(url);
    console.log(`Using your PostgreSQL at ${redact(url)}: migrated and seeded`);
    return; // nothing to keep running
  }
  const port = Number(new URL(url).port || 5432);
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "crash",
    password: "crash",
    port,
    persistent: true,
    // Windows defaults to WIN1252; the app stores emoji, arrows and names from any locale.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
  });
  const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("crashtest");
  await migrateAndSeed(url);
  console.log(`PostgreSQL 16 (embedded) ready on :${port}, migrated and seeded`);
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function redact(u: string) {
  return u.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:****@");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
