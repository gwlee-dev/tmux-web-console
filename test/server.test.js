import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

function buildTestApp(overrides = {}) {
  const fakeTmux = {
    async getTree() {
      return [
        {
          id: '$1',
          name: 'alpha',
          attached: 1,
          windows: [
            {
              id: '@1',
              index: 0,
              name: 'editor',
              panes: [
                {
                  id: '%1',
                  index: 0,
                  active: true,
                  title: 'editor',
                  currentCommand: 'zsh',
                  currentPath: '/tmp',
                },
              ],
            },
          ],
        },
      ];
    },
    async listSessions() {
      return [{ id: '$1', name: 'alpha', windows: 1, attached: 1 }];
    },
    async capturePane(targetPane, historyLines = 200) {
      return {
        targetPane,
        content: '\u001b[32mline one\u001b[0m\nline two',
        lineCount: 2,
        historyLines,
        capturedAt: '2026-04-21T03:00:00.000Z',
        includesAnsi: true,
      };
    },
    async createSession(name) {
      return { ok: true, name };
    },
    async killSession(name) {
      return { ok: true, name };
    },
    async createWindow(sessionName, name) {
      return { ok: true, sessionName, name };
    },
    async sendCommand(targetPane, command, enter) {
      return { ok: true, targetPane, command, enter };
    },
    async sendInput(targetPane, input) {
      return { ok: true, targetPane, inputLength: input.length };
    },
  };

  const { app } = createApp({
    tmuxClient: fakeTmux,
    config: {
      host: '127.0.0.1',
      port: 0,
      authUsername: 'admin',
      authPassword: 'secret-pass',
      sessionSecret: 'test-session-secret',
      cookieSecure: false,
      corsOrigin: '*',
      ...overrides,
    },
  });

  return app;
}

async function loginAndGetCookie(app) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: {
      username: 'admin',
      password: 'secret-pass',
    },
  });

  assert.equal(response.statusCode, 200);
  const cookies = response.cookies;
  assert.equal(cookies.length, 1);
  return `${cookies[0].name}=${cookies[0].value}`;
}

test('health endpoint is public', async (t) => {
  const app = buildTestApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.statusCode, 200);

  const payload = response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.authMode, 'credentials');
  assert.equal(payload.paneHistoryLines, 200);
});

test('login sets an httpOnly session cookie and protected endpoints require it', async (t) => {
  const app = buildTestApp();
  t.after(() => app.close());

  const unauthorized = await app.inject({ method: 'GET', url: '/api/tree' });
  assert.equal(unauthorized.statusCode, 401);

  const cookieHeader = await loginAndGetCookie(app);

  const meResponse = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: {
      cookie: cookieHeader,
    },
  });
  assert.equal(meResponse.statusCode, 200);
  assert.equal(meResponse.json().user.username, 'admin');

  const treeResponse = await app.inject({
    method: 'GET',
    url: '/api/tree',
    headers: {
      cookie: cookieHeader,
    },
  });
  assert.equal(treeResponse.statusCode, 200);
  assert.equal(treeResponse.json().sessions[0].name, 'alpha');
});

test('pane snapshot endpoint returns captured pane output after login', async (t) => {
  const app = buildTestApp();
  t.after(() => app.close());

  const cookieHeader = await loginAndGetCookie(app);
  const response = await app.inject({
    method: 'GET',
    url: '/api/panes/%251?lines=120',
    headers: {
      cookie: cookieHeader,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    targetPane: '%1',
    content: '\u001b[32mline one\u001b[0m\nline two',
    lineCount: 2,
    historyLines: 120,
    capturedAt: '2026-04-21T03:00:00.000Z',
    includesAnsi: true,
  });
});

test('pane input endpoint forwards terminal keystrokes after login', async (t) => {
  const app = buildTestApp();
  t.after(() => app.close());

  const cookieHeader = await loginAndGetCookie(app);
  const response = await app.inject({
    method: 'POST',
    url: '/api/panes/%251/input',
    headers: {
      cookie: cookieHeader,
      'content-type': 'application/json',
    },
    payload: {
      input: 'ls\r',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    targetPane: '%1',
    inputLength: 3,
  });
});

test('command endpoint validates and forwards payload after login', async (t) => {
  const app = buildTestApp();
  t.after(() => app.close());

  const cookieHeader = await loginAndGetCookie(app);
  const response = await app.inject({
    method: 'POST',
    url: '/api/commands',
    headers: {
      cookie: cookieHeader,
      'content-type': 'application/json',
    },
    payload: {
      targetPane: '%1',
      command: 'pwd',
      enter: true,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    targetPane: '%1',
    command: 'pwd',
    enter: true,
  });
});

test('logout clears the session cookie', async (t) => {
  const app = buildTestApp();
  t.after(() => app.close());

  const cookieHeader = await loginAndGetCookie(app);
  const response = await app.inject({
    method: 'POST',
    url: '/api/logout',
    headers: {
      cookie: cookieHeader,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.cookies[0].name, 'tmux_web_console_session');
  assert.equal(response.cookies[0].maxAge, 0);
});
