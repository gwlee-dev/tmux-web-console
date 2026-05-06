import type { FastifyInstance } from "fastify";
// @ts-expect-error -- src/server.js is native ESM JS, no .d.ts emitted.
import { createApp } from "../src/server.js";
import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import bcrypt from "bcryptjs";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
 * Seed the SQLite test database with users for credential-based auth tests.
 * Uses bcrypt cost factor 1 for speed in tests.
 */
async function seedTestUser(
  dbUrl: string,
  users: Array<{ username: string; password: string; role?: string }>
) {
  const adapter = new PrismaLibSql({ url: dbUrl });
  const prisma = new PrismaClient({ adapter });
  try {
    await prisma.$connect();
    for (const u of users) {
      const passwordHash = await bcrypt.hash(u.password, 1); // low rounds for speed
      await prisma.user.upsert({
        where: { username: u.username },
        update: {},
        create: { username: u.username, passwordHash, role: u.role ?? "admin" }
      });
    }
  } finally {
    await prisma.$disconnect();
  }
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
        content: "\x1b[32mline one\x1b[0m\nline two",
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
 *
 * Creates an isolated SQLite database for each call so tests don't share
 * state. The DB is migrated and seeded with auth credentials derived from
 * `configOverrides.authUsername` / `configOverrides.authPassword` (or the
 * defaults "admin" / "secret-pass") so credential-based auth tests continue
 * to work after the auth system moved to DB-backed verification.
 */
export async function buildTestApp(
  options: BuildTestAppOptions = {}
): Promise<FastifyInstance> {
  const { configOverrides = {}, tmuxOverrides = {}, createAppOptions = {} } = options;
  const fakeTmux = makeFakeTmux(tmuxOverrides);

  // Create a unique temp SQLite DB path for this test run.
  const testDbPath = path.join(
    os.tmpdir(),
    `tmux-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const testDbUrl = `file:${testDbPath}`;

  // Set DATABASE_URL *before* createApp() so the db plugin picks it up.
  process.env.DATABASE_URL = testDbUrl;

  // Run Prisma migrations against the fresh temp DB.
  execSync("npx prisma migrate deploy", {
    cwd: "/Users/gwlee/Repositories/tmux-web-console",
    env: { ...process.env, DATABASE_URL: testDbUrl },
    stdio: "pipe"
  });

  // Backward-compat shim: seed the credentials the tests use for login.
  // After the auth rewrite, the DB is the source of truth — config values for
  // authUsername/authPassword are ignored at login time.
  const authUser =
    (configOverrides.authUsername as string | undefined) ?? "admin";
  const authPass =
    (configOverrides.authPassword as string | undefined) ?? "secret-pass";
  await seedTestUser(testDbUrl, [
    { username: authUser, password: authPass, role: "admin" }
  ]);

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

  const fastifyApp = app as FastifyInstance;

  // Clean up the temp DB files when the app closes (called in afterEach).
  fastifyApp.addHook("onClose", async () => {
    try {
      fs.unlinkSync(testDbPath);
    } catch { /* ignore */ }
    try {
      fs.unlinkSync(`${testDbPath}-wal`);
    } catch { /* ignore */ }
    try {
      fs.unlinkSync(`${testDbPath}-shm`);
    } catch { /* ignore */ }
  });

  return fastifyApp;
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
