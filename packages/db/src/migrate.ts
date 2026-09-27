// Apply every Prisma migration to DATABASE_URL, then seed the defaults.
// `npm run db:migrate` — safe to run any number of times.
import { execSync } from "child_process";
import path from "path";
import { ensureDatabase } from "./ensure";

const dbDir = path.resolve(import.meta.dirname, "..");

export async function migrateAndSeed(url: string) {
  const state = await ensureDatabase(url);
  if (state === "created") console.log(`Created database "${new URL(url).pathname.slice(1)}" (UTF-8).`);
  try {
    execSync("npx prisma migrate deploy", { cwd: dbDir, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  } catch (e) {
    throw new Error(`prisma migrate deploy failed:
${String((e as { stderr?: Buffer }).stderr ?? e)}`);
  }
  process.env.DATABASE_URL = url;
  const { seedDefaults } = await import("./seed");
  await seedDefaults();
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set in .env");
    process.exit(1);
  }
  migrateAndSeed(url)
    .then(() => console.log("Migrations applied and defaults seeded."))
    .catch((e) => {
      console.error(String(e.message ?? e));
      process.exit(1);
    })
    .finally(async () => (await import("./index")).prisma.$disconnect());
}
