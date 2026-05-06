import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginAndGetCookie } from "../build-app.js";

describe("auth routes", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("login sets an httpOnly session cookie and protected endpoints require it", async () => {
    app = await buildTestApp();

    const unauthorized = await app.inject({ method: "GET", url: "/api/tree" });
    expect(unauthorized.statusCode).toBe(401);

    const cookieHeader = await loginAndGetCookie(app);

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: cookieHeader }
    });
    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json().user.username).toBe("admin");

    const treeResponse = await app.inject({
      method: "GET",
      url: "/api/tree",
      headers: { cookie: cookieHeader }
    });
    expect(treeResponse.statusCode).toBe(200);
    expect(treeResponse.json().sessions[0].name).toBe("alpha");
  });

  it("logout clears the session cookie", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: { cookie: cookieHeader }
    });

    expect(response.statusCode).toBe(200);
    expect(response.cookies[0].name).toBe("tmux_web_console_session");
    expect(response.cookies[0].maxAge).toBe(0);
  });

  it("POST /api/login returns 401 when credentials are wrong", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { username: "admin", password: "wrong-pass" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Invalid credentials"
    });
  });

  it("POST /api/login returns 400 when username is missing", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: "secret-pass" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "username is required" });
  });

  it("POST /api/login returns 400 when password is missing", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { username: "admin" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "password is required" });
  });

  it("POST /api/login returns 400 when username is whitespace only", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { username: "   ", password: "secret-pass" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "username is required" });
  });

  it("GET /api/auth/me returns 401 when no session cookie is present", async () => {
    app = await buildTestApp();

    const response = await app.inject({ method: "GET", url: "/api/auth/me" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "로그인이 필요합니다." });
  });
});
