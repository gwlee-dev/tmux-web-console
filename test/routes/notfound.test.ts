import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginAndGetCookie } from "../build-app.js";

describe("API 404 handling", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("returns 404 with JSON error for unknown /api/* routes", async () => {
    app = await buildTestApp();
    const cookieHeader = await loginAndGetCookie(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/nonexistent-route",
      headers: { cookie: cookieHeader }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Not found" });
  });

  it("returns 404 for unknown non-/api routes when viteEnabled is false", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/some-other-path"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Not found" });
  });
});
