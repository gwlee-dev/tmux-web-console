import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

async function startTestServer(overrides = {}) {
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

  const { server } = createServer({
    tmuxClient: fakeTmux,
    config: {
      host: '127.0.0.1',
      port: 0,
      apiToken: 'test-token',
      corsOrigin: '*',
      ...overrides,
    },
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('health endpoint is public', async () => {
  const app = await startTestServer();

  try {
    const response = await fetch(`${app.baseUrl}/api/health`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.authRequired, true);
  } finally {
    await app.close();
  }
});

test('tree endpoint requires token and returns sessions when authorized', async () => {
  const app = await startTestServer();

  try {
    const unauthorized = await fetch(`${app.baseUrl}/api/tree`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${app.baseUrl}/api/tree`, {
      headers: { 'x-api-token': 'test-token' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.sessions[0].name, 'alpha');
  } finally {
    await app.close();
  }
});

test('command endpoint validates and forwards payload', async () => {
  const app = await startTestServer();

  try {
    const response = await fetch(`${app.baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-token': 'test-token',
      },
      body: JSON.stringify({ targetPane: '%1', command: 'pwd', enter: true }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload, {
      ok: true,
      targetPane: '%1',
      command: 'pwd',
      enter: true,
    });
  } finally {
    await app.close();
  }
});
