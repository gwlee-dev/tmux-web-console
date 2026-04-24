import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginAndGetCookie } from "../build-app.js";

describe("window routes", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("POST /api/windows returns 201 on creation", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/windows",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: { sessionName: "alpha", name: "shell" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      ok: true,
      sessionName: "alpha",
      name: "shell"
    });
  });

  it("POST /api/windows returns 400 when sessionName is missing", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/windows",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: { name: "shell" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "sessionName is required" });
  });

  it("POST /api/windows returns 400 when name is missing", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/windows",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: { sessionName: "alpha" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "name is required" });
  });

  it("DELETE /api/windows/:id validates and forwards kill payload after login", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "DELETE",
      url: "/api/windows/%401",
      headers: { cookie: cookieHeader }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      windowId: "@1"
    });
  });

  it("DELETE /api/windows/:id returns 400 when id is only whitespace", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "DELETE",
      url: "/api/windows/%20",
      headers: { cookie: cookieHeader }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "id is required" });
  });
});
