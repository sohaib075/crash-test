// Deployment: the optional APP_PASSWORD gate on the API (the web app has the same gate).
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/server/src/app";
import { passwordOk } from "../apps/server/src/auth";
import { queue, resetAll } from "./helpers";

const { app } = createApp(queue);
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

describe("APP_PASSWORD", () => {
  beforeEach(resetAll);
  afterEach(() => {
    delete process.env.APP_PASSWORD;
  });

  it("is open when unset (local dev)", async () => {
    expect((await request(app).get("/api/runs")).status).toBe(200);
    expect(passwordOk(undefined)).toBe(true);
  });

  it("closes the API but keeps health and shared reports public", async () => {
    process.env.APP_PASSWORD = "s3cret:with-colon";
    const closed = await request(app).get("/api/runs");
    expect(closed.status).toBe(401);
    expect(closed.headers["www-authenticate"]).toMatch(/^Basic/);
    expect((await request(app).post("/api/demo/reset")).status).toBe(401);
    expect((await request(app).get("/api/runs").set("Authorization", basic("anyone", "wrong"))).status).toBe(401);
    expect((await request(app).get("/api/runs").set("Authorization", "Bearer s3cret")).status).toBe(401);
    expect((await request(app).get("/api/runs").set("Authorization", basic("anyone", "s3cret:with-colon"))).status).toBe(200);
    expect((await request(app).get("/api/health")).status).toBe(200);
    // Public share API: a bad token is a 404, never a password prompt.
    expect((await request(app).get(`/api/public/reports/${"a".repeat(64)}`)).status).toBe(404);
  });

  it("refuses changes sent from another site with the cached password (CSRF)", async () => {
    process.env.APP_PASSWORD = "long-enough-password";
    const auth = basic("x", "long-enough-password");
    const crossSite = await request(app).post("/api/demo/reset").set("Authorization", auth).set("Sec-Fetch-Site", "cross-site");
    expect(crossSite.status).toBe(403);
    const foreignOrigin = await request(app).patch("/api/gate").set("Authorization", auth).set("Origin", "https://evil.example").send({ enabled: false });
    expect(foreignOrigin.status).toBe(403);
    // Reads are fine; our own pages (same origin, as forwarded by the web app) can change things.
    expect((await request(app).get("/api/runs").set("Authorization", auth).set("Sec-Fetch-Site", "cross-site")).status).toBe(200);
    const own = await request(app).patch("/api/gate").set("Authorization", auth).set("Sec-Fetch-Site", "same-origin")
      .set("Origin", "https://crash.example").set("X-Forwarded-Host", "crash.example").send({ enabled: true });
    expect(own.status).toBe(200);
  });
});
