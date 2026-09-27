import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// Optional password for a deployed app: set APP_PASSWORD (any user name works).
// Unset (local dev) means no prompt. Shared report links (/r/…), their API and the
// health check stay public. The API server checks the same password again.
export function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password || passwordOk(req.headers.get("authorization"), password)) return NextResponse.next();
  return new NextResponse("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Crash Test", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}

function passwordOk(header: string | null, password: string) {
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const given = decoded.slice(decoded.indexOf(":") + 1);
  // Compare digests in constant time (equal length, no early exit).
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(password));
}

export const config = {
  // Everything except static build files, share links, their API and the health check.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|r/|api/public/|api/health$).*)"],
};
