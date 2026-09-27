import type { NextFunction, Request, Response } from "express";
import { log } from "@crash/core";
import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public hint?: string) {
    super(message);
  }
}

export function body<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) throw new HttpError(400, "BAD_REQUEST", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

export function errors(err: unknown, req: Request, res: Response, _next: NextFunction) {
  void _next;
  if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message, hint: err.hint } });
  const e = err as { code?: string; message?: string; hint?: string; status?: number };
  const status = e.code === "NO_KEY" ? 503 : e.status && e.status >= 400 && e.status < 600 ? 502 : 500;
  log.error({ err, path: req.path }, "request failed");
  res.status(status).json({ error: { code: e.code ?? "INTERNAL", message: e.message ?? "Something went wrong", hint: e.hint } });
}

export function requestLog(req: Request, res: Response, next: NextFunction) {
  const t0 = Date.now();
  res.on("finish", () => {
    if (req.path !== "/api/health") log.debug({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t0 }, "http");
  });
  next();
}
