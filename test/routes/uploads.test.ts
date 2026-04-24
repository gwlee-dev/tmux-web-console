import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { buildTestApp, loginAndGetCookie } from "../build-app.js";

function buildMultipartBody(
  parts: Array<{ name: string; filename: string; contentType: string; body: Buffer | string }>,
  boundary: string
): Buffer {
  const chunks: Array<Buffer | string> = [];
  for (const part of parts) {
    chunks.push(`--${boundary}\r\n`);
    chunks.push(
      `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
    );
    chunks.push(`Content-Type: ${part.contentType}\r\n\r\n`);
    chunks.push(part.body);
    chunks.push("\r\n");
  }
  chunks.push(`--${boundary}--\r\n`);
  return Buffer.concat(
    chunks.map((chunk) => (typeof chunk === "string" ? Buffer.from(chunk) : chunk))
  );
}

describe("upload routes", () => {
  let app: FastifyInstance | null = null;
  const createdPaths: string[] = [];

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    await Promise.all(createdPaths.map((p) => rm(p, { force: true }).catch(() => {})));
    createdPaths.length = 0;
  });

  it("POST /api/uploads rejects anonymous requests", async () => {
    app = await buildTestApp();
    const boundary = "test-boundary";
    const body = buildMultipartBody(
      [{ name: "file", filename: "a.txt", contentType: "text/plain", body: "hello" }],
      boundary
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body
    });
    expect(response.statusCode).toBe(401);
  });

  it("POST /api/uploads stores files under os.tmpdir and returns absolute paths", async () => {
    app = await buildTestApp();
    const cookieHeader = await loginAndGetCookie(app);
    const boundary = "test-boundary";
    const body = buildMultipartBody(
      [
        { name: "file", filename: "hello.txt", contentType: "text/plain", body: "hi" },
        { name: "file", filename: "data.json", contentType: "application/json", body: '{"a":1}' }
      ],
      boundary
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: {
        cookie: cookieHeader,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload: body
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { paths: string[] };
    expect(payload.paths).toHaveLength(2);

    for (const [idx, expected] of ["hello.txt", "data.json"].entries()) {
      const stored = payload.paths[idx];
      createdPaths.push(stored);
      expect(path.isAbsolute(stored)).toBe(true);
      expect(stored.endsWith(expected)).toBe(true);
      expect(path.basename(stored)).toMatch(/^[0-9a-f]{16}-/);
      const content = await readFile(stored, "utf8");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("POST /api/uploads sanitizes risky filenames", async () => {
    app = await buildTestApp();
    const cookieHeader = await loginAndGetCookie(app);
    const boundary = "test-boundary";
    const body = buildMultipartBody(
      [
        {
          name: "file",
          filename: "../../etc/passwd..",
          contentType: "text/plain",
          body: "noop"
        }
      ],
      boundary
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: {
        cookie: cookieHeader,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload: body
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { paths: string[] };
    expect(payload.paths).toHaveLength(1);
    const stored = payload.paths[0];
    createdPaths.push(stored);
    expect(stored).not.toContain("..");
    expect(path.basename(stored)).toMatch(/^[0-9a-f]{16}-/);
  });

  it("POST /api/uploads rejects non-multipart bodies", async () => {
    app = await buildTestApp();
    const cookieHeader = await loginAndGetCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      payload: { nope: true }
    });
    expect(response.statusCode).toBe(400);
  });

  it("POST /api/uploads rejects requests with no files attached", async () => {
    app = await buildTestApp();
    const cookieHeader = await loginAndGetCookie(app);
    const boundary = "test-boundary";
    const body = Buffer.from(`--${boundary}--\r\n`);
    const response = await app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: {
        cookie: cookieHeader,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload: body
    });
    expect(response.statusCode).toBe(400);
  });
});
