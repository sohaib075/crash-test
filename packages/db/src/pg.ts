// Local PostgreSQL 16 without Docker: real Postgres binaries via embedded-postgres.
// `npm run db` starts it on :5432 (data in .pgdata/) and keeps it running.
// If you have Docker, `docker compose up -d` does the same job.
import EmbeddedPostgres from "embedded-postgres";
import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "../../..");
const dataDir = path.join(root, ".pgdata");
const port = Number(process.env.PGPORT ?? 5432);

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

async function main() {
  const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("crashtest");
  const url = `postgresql://crash:crash@localhost:${port}/crashtest`;
  // Apply migrations and seed defaults so `npm run dev` is the only command needed.
  execSync("npx prisma migrate deploy", { cwd: path.join(root, "packages/db"), env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  process.env.DATABASE_URL = url;
  const { seedDefaults } = await import("./seed");
  await seedDefaults();
  console.log(`PostgreSQL 16 ready on :${port}, migrated and seeded  (DATABASE_URL=${url})`);
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
