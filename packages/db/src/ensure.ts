// Create the database named in a DATABASE_URL if it doesn't exist yet (UTF-8),
// by connecting to the same server's maintenance database with the same login.
// Lets you point DATABASE_URL at any fresh PostgreSQL (e.g. a local PG 18
// install) and just run `npm run dev` / `npm run db:migrate`.
import pg from "pg";

export async function ensureDatabase(url: string): Promise<"exists" | "created"> {
  const u = new URL(url);
  const name = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!name) throw new Error("DATABASE_URL has no database name (…/DBNAME at the end)");
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Unsupported database name "${name}" (use letters, digits, _ or -)`);

  // Hosted providers often forbid the maintenance DB; if we can connect to the target, it exists.
  const direct = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await direct.connect();
    return "exists";
  } catch (e) {
    if ((e as { code?: string }).code !== "3D000") throw friendly(e, u); // 3D000 = database does not exist
  } finally {
    await direct.end().catch(() => {});
  }

  for (const maintenance of ["postgres", "template1"]) {
    const admin = new URL(url);
    admin.pathname = `/${maintenance}`;
    const c = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 8000 });
    try {
      await c.connect();
    } catch {
      await c.end().catch(() => {});
      continue;
    }
    try {
      await c.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);
      return "created";
    } catch (e) {
      if ((e as { code?: string }).code === "42P04") return "exists"; // created concurrently
      if ((e as { code?: string }).code === "42501") {
        throw new Error(`User "${decodeURIComponent(u.username)}" may not create databases. Create "${name}" yourself (e.g. in pgAdmin) or use a user with CREATEDB.`);
      }
      throw friendly(e, u);
    } finally {
      await c.end().catch(() => {});
    }
  }
  throw new Error(`Database "${name}" does not exist and the server's maintenance database isn't reachable to create it. Create it yourself, then retry.`);
}

function friendly(e: unknown, u: URL) {
  const err = e as { code?: string; message?: string };
  if (err.code === "28P01") return new Error("Password authentication failed: check the user and password in DATABASE_URL (special characters must be URL-encoded, e.g. @ → %40).");
  if (err.code === "ECONNREFUSED") return new Error(`Nothing is listening at ${u.hostname}:${u.port || 5432}. Is the PostgreSQL service running, and is the port right?`);
  return e instanceof Error ? e : new Error(String(e));
}
