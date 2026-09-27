import { createHash, timingSafeEqual } from "crypto";
import type { IncomingMessage } from "http";
import type { NextFunction, Request, Response } from "express";

// Optional password for a deployed app (APP_PASSWORD, any user name). The web app
// asks for it first and forwards the browser's Basic credentials with every proxied
// /api and /socket.io request; checking again here keeps the API closed even if its
// port is ever reachable directly. Unset (local dev) means open.
export function passwordOk(header: string | undefined | null): boolean {
  const password = process.env.APP_PASSWORD;
  if (!password) return true;
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const given = decoded.slice(decoded.indexOf(":") + 1);
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(password));
}

/**
 * Browsers attach cached Basic credentials to requests from any site, so with a
 * password set, a request that changes something (or opens the live socket) must
 * come from this app's own pages.
 */
export function fromOwnSite(req: IncomingMessage): boolean {
  if (!process.env.APP_PASSWORD) return true;
  const site = req.headers["sec-fetch-site"];
  if (site === "cross-site" || site === "same-site") return false;
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin navigations and non-browser clients
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Health checks and shared report links stay public. */
const PUBLIC = (path: string) => path === "/api/health" || path.startsWith("/api/public/");
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function requirePassword(req: Request, res: Response, next: NextFunction) {
  if (PUBLIC(req.path)) return next();
  if (!passwordOk(req.headers.authorization)) {
    res
      .status(401)
      .set("WWW-Authenticate", 'Basic realm="Crash Test", charset="UTF-8"')
      .json({ error: { code: "UNAUTHORIZED", message: "Password required" } });
    return;
  }
  if (!SAFE.has(req.method) && !fromOwnSite(req)) {
    res.status(403).json({ error: { code: "CROSS_SITE", message: "Requests that change something must come from Crash Test itself" } });
    return;
  }
  next();
}
