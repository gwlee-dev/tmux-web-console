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
