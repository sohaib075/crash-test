import type { NextFunction, Request, Response } from "express";
import { AppError, GraphError, log } from "@crash/core";
import { Prisma } from "@crash/db";
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

const CLIENT_ERRORS: Record<string, [number, string, string]> = {
  "entity.parse.failed": [400, "BAD_REQUEST", "Request body is not valid JSON"],
  "entity.too.large": [413, "PAYLOAD_TOO_LARGE", "Request body is too large"],
  "encoding.unsupported": [415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported request encoding"],
  "charset.unsupported": [415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported request charset"],
};

export function errors(err: unknown, req: Request, res: Response, _next: NextFunction) {
  void _next;
  const send = (status: number, code: string, message: string, hint?: string) => res.status(status).json({ error: { code, message, hint } });
  if (err instanceof HttpError || err instanceof AppError) return send(err.status, err.code, err.message, err.hint);
  const e = err as { code?: string; message?: string; hint?: string; status?: number; type?: string; expose?: boolean };

  // body-parser / router errors are the client's fault: keep their 4xx, never call them a graph8 outage.
  const known = e.type ? CLIENT_ERRORS[e.type] : undefined;
  if (known || (e.expose && e.status && e.status >= 400 && e.status < 500)) {
    log.warn({ path: req.path, type: e.type }, "bad request");
    const [status, code, message] = known ?? [e.status!, "BAD_REQUEST", e.message ?? "Bad request"];
    return send(status, code, message);
  }
  // Prisma: a missing row is a 404; anything else is ours, without internals.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return send(404, "NOT_FOUND", "Not found");
    log.error({ err, path: req.path }, "database request failed");
    return send(500, "INTERNAL", "Something went wrong");
  }
  if (err instanceof Prisma.PrismaClientValidationError || err instanceof Prisma.PrismaClientInitializationError || err instanceof Prisma.PrismaClientUnknownRequestError) {
    log.error({ err, path: req.path }, "database request failed");
    return send(500, "INTERNAL", "Something went wrong");
  }
  // Only a graph8 call failing is a bad gateway.
  if (err instanceof GraphError) {
    log.error({ err, path: req.path }, "graph8 request failed");
    return send(err.code === "NO_KEY" ? 503 : 502, err.code, err.message, err.hint);
  }
  log.error({ err, path: req.path }, "request failed");
  send(500, e.code ?? "INTERNAL", e.message ?? "Something went wrong", e.hint);
}

export function requestLog(req: Request, res: Response, next: NextFunction) {
  const t0 = Date.now();
  res.on("finish", () => {
    if (req.path !== "/api/health") log.debug({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t0 }, "http");
  });
  next();
}
