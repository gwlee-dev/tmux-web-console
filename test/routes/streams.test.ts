import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import http from "node:http";
import { buildTestApp, loginAndGetCookie } from "../build-app.js";

interface SSEResult {
  statusCode: number;
  contentType: string;
  rawBody: string;
}

/**
 * GET /api/panes/:paneId/stream uses reply.hijack() + SSE semantics, so we
 * cannot use `app.inject` (which does not replay raw chunks written after
 * hijack). Instead, bind the app to an ephemeral port, issue a real HTTP
 * request, abort as soon as we observe the first `snapshot` event, and
 * return what we received for assertion.
 */
async function consumeFirstSnapshotEvent(
  app: FastifyInstance,
  cookieHeader: string,
  url: string
): Promise<SSEResult> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve bound address");
  }

  return new Promise<SSEResult>((resolve, reject) => {
    let rawBody = "";
    let settled = false;

    const request = http.get(
      {
        host: "127.0.0.1",
        port: address.port,
        path: url,
        headers: { cookie: cookieHeader }
      },
      (response) => {
        response.setEncoding("utf8");

        response.on("data", (chunk: string) => {
          rawBody += chunk;
          // SSE event terminator is "\n\n" — wait for the full first event
          // (both `event:` and `data:` lines have arrived) before resolving.
          if (
            !settled &&
            rawBody.includes("event: snapshot") &&
            rawBody.includes("data:") &&
            rawBody.includes("\n\n")
          ) {
            settled = true;
            request.destroy();
            resolve({
              statusCode: response.statusCode ?? 0,
              contentType: String(response.headers["content-type"] ?? ""),
              rawBody
            });
          }
        });

        response.on("end", () => {
          if (!settled) {
            settled = true;
            reject(new Error(`Stream ended before snapshot: ${rawBody}`));
          }
        });
      }
    );

    request.on("error", (error) => {
      // Destroying the socket triggers an error after we've resolved — ignore
      // those. Only reject if we haven't captured the snapshot yet.
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

describe("SSE stream routes", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("GET /api/panes/:paneId/stream emits an initial snapshot event", async () => {
    app = await buildTestApp();
    const cookieHeader = await loginAndGetCookie(app);

    const result = await consumeFirstSnapshotEvent(
      app,
      cookieHeader,
      "/api/panes/%251/stream"
    );

    expect(result.statusCode).toBe(200);
    expect(result.contentType).toContain("text/event-stream");
    expect(result.rawBody).toContain("event: snapshot");
    expect(result.rawBody).toContain('"targetPane":"%1"');
  });
});
