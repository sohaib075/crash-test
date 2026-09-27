// `npm run db:check` — is the database integrated and working?
// Checks the connection, encoding, migrations, tables, seeded defaults, a real
// write/read/delete, the LISTEN/NOTIFY channel the live board uses, the pg-boss
// job queue, the worker heartbeat and the API server's view. Exit 1 on any FAIL.
import { CHANNEL, TEST_DEFS, FIX_ACTIONS, DEFAULT_SETTINGS } from "@crash/shared";
import { readdirSync } from "fs";
import path from "path";
import pg from "pg";

type Row = { ok: boolean | null; name: string; detail: string; hint?: string };
const rows: Row[] = [];
const add = (ok: boolean | null, name: string, detail: string, hint?: string) => {
  rows.push({ ok, name, detail, hint });
  const tag = ok === true ? "PASS" : ok === false ? "FAIL" : "INFO";
  console.log(`${tag}  ${name.padEnd(34)} ${detail}${ok === false && hint ? `\n      → ${hint}` : ""}`);
};

const LOCAL = "postgresql://crash:crash@localhost:5432/crashtest";
const TABLES = ["Workspace", "Sequence", "SequenceSnapshot", "TestDefinition", "FixModeSetting", "Run", "RunLog", "TestResult", "Evidence", "FakeBuyer", "Fix", "Writeback", "GateEvent", "HealthScore", "Report", "LlmCache", "Heartbeat", "Setting"];
const redact = (u: string) => u.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:****@");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    add(false, "DATABASE_URL", "not set", "Add DATABASE_URL to crash-test/.env");
    return;
  }
  const host = new URL(url).hostname;
  const mode = url === LOCAL ? "built-in (embedded PostgreSQL)" : /localhost|127\.0\.0\.1/.test(host) ? "local PostgreSQL" : "hosted PostgreSQL";
  add(null, "DATABASE_URL", `${redact(url)}  [${mode}]`);

  // 1. Connection
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  const t0 = Date.now();
  try {
    await c.connect();
  } catch (e) {
    add(false, "Connect", (e as Error).message,
      url === LOCAL ? "Start it: npm run dev (or npm run db)" : "Check host/port/password in DATABASE_URL; hosted DBs need ?sslmode=require (add &uselibpqcompat=true on certificate errors)");
    return;
  }
  const v = (await c.query("select version() v, current_database() db, current_user u")).rows[0];
  add(true, "Connect", `${Date.now() - t0} ms · ${String(v.v).split(",")[0]} · db=${v.db} user=${v.u}`);

  // 2. Encoding
  const enc = (await c.query("show server_encoding")).rows[0].server_encoding;
  add(enc === "UTF8", "UTF-8 encoding", enc, "Recreate the database with ENCODING 'UTF8' (names and emoji fail otherwise)");

  // 3. Migrations
  const onDisk = readdirSync(path.resolve("packages/db/prisma/migrations")).filter((f) => /^\d+_/.test(f)).sort();
  let applied: { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[] = [];
  try {
    applied = (await c.query("select migration_name, finished_at, rolled_back_at from _prisma_migrations")).rows;
  } catch {
    /* table missing */
  }
  const done = new Set(applied.filter((m) => m.finished_at && !m.rolled_back_at).map((m) => m.migration_name));
  const missing = onDisk.filter((m) => !done.has(m));
  const failed = applied.filter((m) => !m.finished_at && !m.rolled_back_at).map((m) => m.migration_name);
  add(!missing.length && !failed.length, "Migrations applied", `${done.size}/${onDisk.length}${missing.length ? ` · missing: ${missing.join(", ")}` : ""}${failed.length ? ` · FAILED: ${failed.join(", ")}` : ""}`, "Run: npm run db:migrate");

  // 4. Tables
  const present = new Set((await c.query("select tablename from pg_tables where schemaname='public'")).rows.map((r) => r.tablename));
  const absent = TABLES.filter((t) => !present.has(t));
  add(!absent.length, "Tables", absent.length ? `missing: ${absent.join(", ")}` : `all ${TABLES.length} present`, "Run: npm run db:migrate");
  if (!absent.length) {
    const counts: string[] = [];
    for (const t of ["Run", "TestResult", "Fix", "FakeBuyer", "Report", "LlmCache"]) counts.push(`${t}=${(await c.query(`select count(*)::int n from "${t}"`)).rows[0].n}`);
    add(null, "Data", counts.join(" · "));
  }

  // 5. Seeded defaults
  if (!absent.length) {
    const tests = (await c.query(`select count(*)::int n from "TestDefinition"`)).rows[0].n;
    const modes = (await c.query(`select count(*)::int n from "FixModeSetting"`)).rows[0].n;
    const settings = (await c.query(`select count(*)::int n from "Setting"`)).rows[0].n;
    const ok = tests >= TEST_DEFS.length && modes >= FIX_ACTIONS.length && settings >= Object.keys(DEFAULT_SETTINGS).length;
    add(ok, "Seeded defaults", `${tests} tests · ${modes} fix modes · ${settings} settings`, "Run: npm run db:seed");

    // 6. Real write → read → delete, with non-ASCII text, inside a transaction
    const probe = `db-check ✓ → “${Date.now()}” 🧪`;
    try {
      await c.query("begin");
      await c.query(`insert into "Setting"(key, value) values ($1, $2)`, ["__db_check", JSON.stringify(probe)]);
      const back = (await c.query(`select value from "Setting" where key=$1`, ["__db_check"])).rows[0]?.value;
      await c.query(`delete from "Setting" where key=$1`, ["__db_check"]);
      await c.query("commit");
      add(back === probe, "Write · read · delete", back === probe ? "round trip ok (UTF-8 text intact)" : `read back ${JSON.stringify(back)}`);
    } catch (e) {
      await c.query("rollback").catch(() => {});
      add(false, "Write · read · delete", (e as Error).message, "The user in DATABASE_URL needs INSERT/UPDATE/DELETE rights");
    }
  }

  // 7. LISTEN / NOTIFY (live board updates travel this way)
  const listener = new pg.Client({ connectionString: url });
  try {
    await listener.connect();
    await listener.query(`LISTEN ${CHANNEL}_check`);
    const got = new Promise<boolean>((res) => {
      listener.on("notification", (m) => m.payload === "ping" && res(true));
      setTimeout(() => res(false), 3000);
    });
    await c.query(`select pg_notify($1, 'ping')`, [`${CHANNEL}_check`]);
    const ok = await got;
    add(ok, "LISTEN / NOTIFY (live updates)", ok ? "message delivered" : "no message within 3 s",
      "Use a direct or session connection (Supabase: port 5432), not a transaction pooler (6543)");
  } catch (e) {
    add(false, "LISTEN / NOTIFY (live updates)", (e as Error).message);
  } finally {
    await listener.end().catch(() => {});
  }

  // 8. pg-boss job queue
  const boss = (await c.query(`select count(*)::int n from information_schema.tables where table_schema='pgboss' and table_name in ('job','queue','version')`)).rows[0].n;
  if (boss >= 3) {
    const queues = (await c.query(`select name from pgboss.queue order by name`)).rows.map((r) => r.name);
    const jobs = (await c.query(`select state, count(*)::int n from pgboss.job group by state order by state`)).rows.map((r) => `${r.state}=${r.n}`);
    add(queues.length >= 7, "Job queue (pg-boss)", `${queues.length} queues${jobs.length ? ` · jobs: ${jobs.join(" ")}` : ""}`, "Start the worker once (npm run dev) to create the queues");
    const stuck = (await c.query(`select count(*)::int n from pgboss.job where state='active' and started_on < now() - interval '10 minutes'`)).rows[0].n;
    if (stuck) add(false, "Stuck jobs", `${stuck} active for > 10 min`, "Restart the worker; it re-queues interrupted work");
  } else {
    add(false, "Job queue (pg-boss)", "schema not created yet", "Start the worker once: npm run dev");
  }

  // 9. Worker heartbeat (Prisma stores UTC timestamps without a zone)
  if (present.has("Heartbeat")) {
    const hb = (await c.query(`select extract(epoch from (now() at time zone 'utc') - at)::int age from "Heartbeat" where id='worker'`)).rows[0];
    add(hb ? hb.age < 30 : false, "Worker heartbeat", hb ? `${hb.age}s ago` : "none yet", "Start the worker: npm run dev");
  }
  await c.end();

  // 10. The API server's own view of the database
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  try {
    const r = (await (await fetch(`${api}/api/ready?lite=1`, { signal: AbortSignal.timeout(5000) })).json()) as { checks: { id: string; ok: boolean; detail: string }[] };
    const db = r.checks.find((x) => x.id === "db");
    add(db?.ok ?? false, "API server → database", db?.detail ?? "no db check returned", "The server's DATABASE_URL differs? Restart npm run dev after editing .env");
  } catch {
    add(null, "API server → database", `server not reachable at ${api} (start npm run dev to include this check)`);
  }
}

main()
  .catch((e) => add(false, "db-check crashed", (e as Error).message))
  .finally(() => {
    const bad = rows.filter((r) => r.ok === false);
    console.log(bad.length ? `\nDATABASE NOT READY: ${bad.length} problem${bad.length === 1 ? "" : "s"} above.` : "\nDATABASE OK: integrated and working.");
    process.exit(bad.length ? 1 : 0);
  });
