import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginAndGetCookie } from "../build-app.js";

describe("session routes", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("GET /api/tree returns the session/window/pane hierarchy", async () => {
    app = await buildTestApp();
    const cookieHeader = await loginAndGetCookie(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/tree",
      headers: { cookie: cookieHeader }
    });

    expect(response.statusCode).toBe(200);
    const tree = response.json();
    expect(tree.sessions).toHaveLength(1);
    expect(tree.sessions[0].name).toBe("alpha");
    expect(tree.sessions[0].windows[0].panes[0].id).toBe("%1");
  });

  it("GET /api/sessions returns the session list", async () => {
    app = await buildTestApp();
    const cookieHeader = await loginAndGetCookie(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { cookie: cookieHeader }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sessions: [{ id: "$1", name: "alpha", windows: 1, attached: 1 }]
    });
  });

  it("POST /api/sessions returns 201 on successful creation", async () => {
    app = await buildTestApp();
    const cookieHeader = await loginAndGetCookie(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: { name: "beta" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ ok: true, name: "beta" });
  });

  it("POST /api/sessions returns 400 when name is missing", async () => {
    app = await buildTestApp();
    const cookieHeader = await loginAndGetCookie(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "name is required" });
  });

  it("DELETE /api/sessions/:name forwards the kill request", async () => {
    app = await buildTestApp();
    const cookieHeader = await loginAndGetCookie(app);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/sessions/alpha",
      headers: { cookie: cookieHeader }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, name: "alpha" });
  });

  it("PATCH /api/sessions/:name validates and forwards rename payload after login", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "PATCH",
      url: "/api/sessions/alpha",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: { name: "beta" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      name: "alpha",
      nextName: "beta"
    });
  });

  it("PATCH /api/sessions/:name returns 400 when new name is missing", async () => {
    app = await buildTestApp();
    const cookieHeader = await loginAndGetCookie(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/sessions/alpha",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "name is required" });
  });
});
