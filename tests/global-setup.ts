// Before any test: make sure the test database exists (created UTF-8 on the same
// server as DATABASE_URL) and has every migration. Tests reset their own data.
import { execSync } from "child_process";
import path from "path";
import { ensureDatabase } from "../packages/db/src/ensure";

export default async function setup() {
  const url = process.env.CRASH_TEST_DATABASE_URL!;
  const shown = url.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:****@");
  try {
    await ensureDatabase(url);
  } catch (e) {
    throw new Error(`Test database ${shown} is not reachable: ${(e as Error).message}\nStart your database (npm run db for the built-in one) or set TEST_DATABASE_URL.`);
  }
  execSync("npx prisma migrate deploy", {
    cwd: path.resolve("packages/db"),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
