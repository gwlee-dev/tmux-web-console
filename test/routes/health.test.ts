import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../build-app.js";

describe("GET /api/health", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("is public and reports credentials auth mode + pane history default", async () => {
    app = await buildTestApp();

    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);

    const payload = response.json();
    expect(payload.ok).toBe(true);
    expect(payload.authMode).toBe("credentials");
    expect(payload.paneHistoryLines).toBe(200);
  });
});
