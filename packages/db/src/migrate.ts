// Apply every Prisma migration to DATABASE_URL, then seed the defaults.
// `npm run db:migrate` — safe to run any number of times.
import { execSync } from "child_process";
import path from "path";

const dbDir = path.resolve(import.meta.dirname, "..");

export async function migrateAndSeed(url: string) {
  execSync("npx prisma migrate deploy", { cwd: dbDir, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
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
      console.error(String(e.stderr ?? e.message ?? e));
      process.exit(1);
    })
    .finally(async () => (await import("./index")).prisma.$disconnect());
}
