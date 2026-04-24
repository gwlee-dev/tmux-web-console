import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginAndGetCookie } from "../build-app.js";

describe("pane routes", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("GET /api/panes/:id returns captured pane output after login", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/panes/%251?lines=120",
      headers: { cookie: cookieHeader }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      targetPane: "%1",
      content: "[32mline one[0m\nline two",
      lineCount: 2,
      historyLines: 120,
      capturedAt: "2026-04-21T03:00:00.000Z",
      includesAnsi: true
    });
  });

  it("GET /api/panes/:id falls back to default history lines when none is provided", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/panes/%251",
      headers: { cookie: cookieHeader }
    });

    expect(response.statusCode).toBe(200);
    // default paneHistoryLines in createConfig is 200.
    expect(response.json().historyLines).toBe(200);
  });

  it("POST /api/panes/:id/input forwards terminal keystrokes after login", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/panes/%251/input",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: { input: "ls\r" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      targetPane: "%1",
      inputLength: 3
    });
  });

  it("POST /api/panes/:id/input returns 400 when input is missing", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/panes/%251/input",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "input is required" });
  });

  it("POST /api/panes/:id/input returns 400 when input exceeds 4096 characters", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/panes/%251/input",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: { input: "a".repeat(4097) }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "input must be 4096 characters or fewer"
    });
  });

  it("POST /api/panes/:id/resize syncs terminal dimensions after login", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/panes/%251/resize",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: { cols: 132, rows: 38 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      targetPane: "%1",
      requestedCols: 132,
      requestedRows: 38,
      appliedCols: 100,
      appliedRows: 30,
      windowId: "@1",
      sessionName: "alpha"
    });
  });

  it("POST /api/panes/:id/resize returns 400 when cols is not a positive integer", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/panes/%251/resize",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: { cols: 0, rows: 38 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "cols must be a positive integer"
    });
  });

  it("POST /api/panes/:id/resize returns 400 when rows is not an integer", async () => {
    app = await buildTestApp();

    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/panes/%251/resize",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      payload: { cols: 100, rows: 38.5 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "rows must be a positive integer"
    });
  });
});
