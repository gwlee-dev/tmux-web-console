import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../build-app.js";

describe("Swagger plugin", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("serves the OpenAPI spec under /docs/json with every /api/* path documented", async () => {
    app = await buildTestApp();
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/docs/json" });

    expect(response.statusCode).toBe(200);
    const spec = response.json();
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("tmux-web-console");

    const paths = Object.keys(spec.paths ?? {});
    // 14 unique path patterns (GET/POST pairs share a path, e.g. /api/sessions).
    expect(paths.length).toBeGreaterThanOrEqual(14);

    // Spot-check representative endpoints from each tag group. Note that
    // @fastify/swagger converts Fastify params (`:name`) into OpenAPI path
    // templates (`{name}`) in the emitted spec.
    expect(paths).toContain("/api/health");
    expect(paths).toContain("/api/login");
    expect(paths).toContain("/api/logout");
    expect(paths).toContain("/api/auth/me");
    expect(paths).toContain("/api/tree");
    expect(paths).toContain("/api/sessions");
    expect(paths).toContain("/api/sessions/{name}");
    expect(paths).toContain("/api/windows");
    expect(paths).toContain("/api/windows/{id}");
    expect(paths).toContain("/api/panes/{paneId}");
    expect(paths).toContain("/api/panes/{paneId}/input");
    expect(paths).toContain("/api/panes/{paneId}/resize");
    expect(paths).toContain("/api/panes/{paneId}/stream");
    expect(paths).toContain("/api/commands");
  });

  it("serves the Swagger UI entry at /docs (following redirect to static asset)", async () => {
    app = await buildTestApp();
    await app.ready();

    // @fastify/swagger-ui serves `/docs` with a 302 → `/docs/static/index.html`.
    // Follow the redirect chain manually through `app.inject`.
    const initial = await app.inject({ method: "GET", url: "/docs" });
    expect([200, 301, 302]).toContain(initial.statusCode);

    let location = initial.headers.location ?? "/docs/static/index.html";
    if (typeof location !== "string") {
      location = "/docs/static/index.html";
    }

    let followed = initial;
    for (let hop = 0; hop < 3; hop += 1) {
      if (followed.statusCode !== 301 && followed.statusCode !== 302) {
        break;
      }
      const nextUrl = followed.headers.location;
      if (typeof nextUrl !== "string" || !nextUrl.length) {
        break;
      }
      followed = await app.inject({ method: "GET", url: nextUrl });
    }

    expect(followed.statusCode).toBe(200);
    expect(String(followed.headers["content-type"] ?? "")).toContain("text/html");
    expect(followed.body.toLowerCase()).toContain("<html");
  });

  it("enumerates the Korean tag catalogue in the OpenAPI spec", async () => {
    app = await buildTestApp();
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/docs/json" });
    expect(response.statusCode).toBe(200);

    const tagNames = (response.json().tags ?? []).map(
      (tag: { name: string }) => tag.name
    );
    expect(tagNames).toEqual(
      expect.arrayContaining([
        "Health",
        "Auth",
        "Sessions",
        "Windows",
        "Panes",
        "Commands"
      ])
    );
  });
});
