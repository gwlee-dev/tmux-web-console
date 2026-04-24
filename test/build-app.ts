import type { FastifyInstance } from "fastify";
// @ts-expect-error -- src/server.js is native ESM JS, no .d.ts emitted.
import { createApp } from "../src/server.js";

export interface FakeTmuxOverrides {
  getTree?: () => Promise<unknown>;
  listSessions?: () => Promise<unknown>;
  capturePane?: (...args: unknown[]) => Promise<unknown>;
  createSession?: (...args: unknown[]) => Promise<unknown>;
  killSession?: (...args: unknown[]) => Promise<unknown>;
  renameSession?: (...args: unknown[]) => Promise<unknown>;
  createWindow?: (...args: unknown[]) => Promise<unknown>;
  killWindow?: (...args: unknown[]) => Promise<unknown>;
  getPaneGeometry?: (...args: unknown[]) => Promise<unknown>;
  sendCommand?: (...args: unknown[]) => Promise<unknown>;
  sendInput?: (...args: unknown[]) => Promise<unknown>;
  resizePane?: (...args: unknown[]) => Promise<unknown>;
}

export interface BuildTestAppOptions {
  configOverrides?: Record<string, unknown>;
  tmuxOverrides?: FakeTmuxOverrides;
  createAppOptions?: Record<string, unknown>;
}

/**
 * Default fake tmux client — mirrors the fixture used by the original
 * node:test suite in test/server.test.js. Individual tests can override
 * any method via `tmuxOverrides`.
 */
export function makeFakeTmux(overrides: FakeTmuxOverrides = {}) {
  return {
    async getTree() {
      return [
        {
          id: "$1",
          name: "alpha",
          attached: 1,
          windows: [
            {
              id: "@1",
              index: 0,
              name: "editor",
              panes: [
                {
                  id: "%1",
                  index: 0,
                  active: true,
                  title: "editor",
                  currentCommand: "zsh",
                  currentPath: "/tmp"
                }
              ]
            }
          ]
        }
      ];
    },
    async listSessions() {
      return [{ id: "$1", name: "alpha", windows: 1, attached: 1 }];
    },
    async capturePane(
      targetPane: string,
      historyLines = 200,
      { includeAnsi = true }: { includeAnsi?: boolean } = {}
    ) {
      return {
        targetPane,
        content: "[32mline one[0m\nline two",
        lineCount: 2,
        historyLines,
        capturedAt: "2026-04-21T03:00:00.000Z",
        includesAnsi: includeAnsi
      };
    },
    async createSession(name: string) {
      return { ok: true, name };
    },
    async killSession(name: string) {
      return { ok: true, name };
    },
    async renameSession(name: string, nextName: string) {
      return { ok: true, name, nextName };
    },
    async createWindow(sessionName: string, name: string) {
      return { ok: true, sessionName, name };
    },
    async killWindow(windowId: string) {
      return { ok: true, windowId };
    },
    async getPaneGeometry() {
      return {
        sessionName: "alpha",
        windowId: "@1",
        windowName: "editor",
        width: 100,
        height: 30
      };
    },
    async sendCommand(targetPane: string, command: string, enter: boolean) {
      return { ok: true, targetPane, command, enter };
    },
    async sendInput(targetPane: string, input: string) {
      return { ok: true, targetPane, inputLength: input.length };
    },
    async resizePane(targetPane: string, cols: number, rows: number) {
      return {
        ok: true,
        targetPane,
        requestedCols: cols,
        requestedRows: rows,
        appliedCols: 100,
        appliedRows: 30,
        windowId: "@1",
        sessionName: "alpha"
      };
    },
    ...overrides
  };
}

/**
 * Build a Fastify app wired to a fake tmux client. Mirrors `buildTestApp`
 * from the original test/server.test.js node:test suite.
 */
export async function buildTestApp(
  options: BuildTestAppOptions = {}
): Promise<FastifyInstance> {
  const { configOverrides = {}, tmuxOverrides = {}, createAppOptions = {} } = options;
  const fakeTmux = makeFakeTmux(tmuxOverrides);

  const { app } = await createApp({
    tmuxClient: fakeTmux,
    viteEnabled: false,
    ...createAppOptions,
    config: {
      host: "127.0.0.1",
      port: 0,
      authUsername: "admin",
      authPassword: "secret-pass",
      sessionSecret: "test-session-secret",
      cookieSecure: false,
      corsOrigin: "*",
      ...configOverrides
    }
  });

  return app as FastifyInstance;
}

/**
 * Login with the default admin credentials and return a Cookie header value
 * usable on protected routes.
 */
export async function loginAndGetCookie(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/login",
    payload: {
      username: "admin",
      password: "secret-pass"
    }
  });

  if (response.statusCode !== 200) {
    throw new Error(
      `loginAndGetCookie failed: status=${response.statusCode} body=${response.body}`
    );
  }

  const cookies = response.cookies;
  if (cookies.length !== 1) {
    throw new Error(`loginAndGetCookie expected 1 cookie, got ${cookies.length}`);
  }

  return `${cookies[0].name}=${cookies[0].value}`;
}
