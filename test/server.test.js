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
      apiToken: 'test-token',
      corsOrigin: '*',
      ...overrides,
    },
  });

  return app;
}

test('health endpoint is public', async (t) => {
  const app = buildTestApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.statusCode, 200);

  const payload = response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.authRequired, true);
});

test('tree endpoint requires token and returns sessions when authorized', async (t) => {
  const app = buildTestApp();
  t.after(() => app.close());

  const unauthorized = await app.inject({ method: 'GET', url: '/api/tree' });
  assert.equal(unauthorized.statusCode, 401);

  const response = await app.inject({
    method: 'GET',
    url: '/api/tree',
    headers: { 'x-api-token': 'test-token' },
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.sessions[0].name, 'alpha');
});

test('command endpoint validates and forwards payload', async (t) => {
  const app = buildTestApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/commands',
    headers: {
      'content-type': 'application/json',
      'x-api-token': 'test-token',
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
