import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginAndGetCookie } from "../build-app.js";

describe("command routes", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("POST /api/commands validates and forwards payload after login", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/commands",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: {
        targetPane: "%1",
        command: "pwd",
        enter: true
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      targetPane: "%1",
      command: "pwd",
      enter: true
    });
  });

  it("POST /api/commands defaults enter to true when omitted", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/commands",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: { targetPane: "%1", command: "ls" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().enter).toBe(true);
  });

  it("POST /api/commands returns 400 when targetPane is missing", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/commands",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: { command: "pwd" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "targetPane is required" });
  });

  it("POST /api/commands returns 400 when command is missing", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/commands",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: { targetPane: "%1" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "command is required" });
  });

  it("POST /api/commands returns 400 when command exceeds 2048 characters", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/commands",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: { targetPane: "%1", command: "x".repeat(2049) }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "command must be 2048 characters or fewer"
    });
  });
});
