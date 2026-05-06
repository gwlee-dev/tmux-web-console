import Fastify from 'fastify';
import FastifyVite from '@fastify/vite';
import fastifyMultipart from '@fastify/multipart';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptWebSocketUpgrade, createTmuxPtyBridge, rejectWebSocketUpgrade } from './pty-websocket.js';
import swaggerPlugin from './plugins/swagger.js';
import tmux from './tmux.js';

const UPLOAD_ROOT_DIRNAME = 'tmux-web-console-uploads';
const UPLOAD_FILE_LIMIT_BYTES = 20 * 1024 * 1024;    // 20 MB per file
const UPLOAD_TOTAL_LIMIT_BYTES = 50 * 1024 * 1024;   // 50 MB per request
const UPLOAD_TTL_MS = 60 * 60 * 1000;                // 1 hour
const SAFE_FILENAME_RE = /[^A-Za-z0-9._-]+/g;

const USER_SETTING_KEYS = ['terminalFontSize', 'theme', 'debugMode', 'scrollSensitivity']
const SYSTEM_SETTING_KEYS = ['sessionTimeoutSeconds', 'paneHistoryLines', 'paneStreamIntervalMs']
const SETTING_DEFAULTS = {
  terminalFontSize: '14',
  theme: 'system',
  debugMode: 'false',
  scrollSensitivity: '5',
  sessionTimeoutSeconds: '28800',
  paneHistoryLines: '200',
  paneStreamIntervalMs: '1000',
}

function sanitizeUploadFilename(raw) {
  const base = path.basename(raw || 'upload');
  const cleaned = base
    .replace(SAFE_FILENAME_RE, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .slice(0, 120);
  return cleaned || 'upload';
}

function uploadUserDir(username) {
  const safe = username.replace(SAFE_FILENAME_RE, '_').slice(0, 64) || 'user';
  return path.join(os.tmpdir(), UPLOAD_ROOT_DIRNAME, safe);
}

async function cleanupStaleUploads(dir, ttlMs = UPLOAD_TTL_MS) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  const cutoff = Date.now() - ttlMs;
  await Promise.all(
    entries.map(async (name) => {
      const filePath = path.join(dir, name);
      try {
        const info = await stat(filePath);
        if (info.mtimeMs < cutoff) {
          await rm(filePath, { force: true, recursive: false });
        }
      } catch {
        /* ignore */
      }
    }),
  );
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const SESSION_COOKIE_NAME = 'tmux_web_console_session';

function isLocalHost(host) {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) {
    return {};
  }

  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const separatorIndex = chunk.indexOf('=');
        if (separatorIndex === -1) {
          return [chunk, ''];
        }

        return [chunk.slice(0, separatorIndex), decodeURIComponent(chunk.slice(separatorIndex + 1))];
      }),
  );
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.path) {
    parts.push(`Path=${options.path}`);
  }

  if (typeof options.maxAge === 'number') {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.httpOnly) {
    parts.push('HttpOnly');
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  if (options.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function signValue(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeStringEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function buildSessionCookie(user, config) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.username,
      uid: user.uid,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + config.sessionTtlSeconds,
      nonce: randomBytes(16).toString('hex'),
    }),
  ).toString('base64url');
  const signature = signValue(payload, config.sessionSecret);

  return `${payload}.${signature}`;
}

function readAuthenticatedUser(request, config) {
  const cookies = parseCookies(request.headers.cookie);
  const rawValue = cookies[SESSION_COOKIE_NAME];

  if (!rawValue) {
    return null;
  }

  const [payload, signature] = rawValue.split('.');
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = signValue(payload, config.sessionSecret);
  if (!safeStringEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof decoded?.sub !== 'string' || typeof decoded?.exp !== 'number') {
      return null;
    }

    if (decoded.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    // Old cookies without uid field force re-login
    if (!decoded.uid) {
      return null;
    }

    return { username: decoded.sub, uid: decoded.uid, role: decoded.role };
  } catch {
    return null;
  }
}

function setSessionCookie(reply, user, config) {
  reply.header(
    'set-cookie',
    serializeCookie(SESSION_COOKIE_NAME, buildSessionCookie(user, config), {
      path: '/',
      maxAge: config.sessionTtlSeconds,
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.cookieSecure,
    }),
  );
}

function clearSessionCookie(reply, config) {
  reply.header(
    'set-cookie',
    serializeCookie(SESSION_COOKIE_NAME, '', {
      path: '/',
      maxAge: 0,
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.cookieSecure,
    }),
  );
}

function csrfGuard(request, reply, done) {
  const secFetch = request.headers['sec-fetch-site'];
  // absent = same-origin request from non-supporting browser → allow
  if (secFetch && secFetch !== 'same-origin' && secFetch !== 'none') {
    return reply.code(403).send({ error: 'CSRF check failed' });
  }
  done();
}

async function readJsonBody(request) {
  if (request.body == null) {
    return {};
  }

  if (typeof request.body === 'object') {
    return request.body;
  }

  try {
    return JSON.parse(request.body);
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function validateRequiredString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    const error = new Error(`${fieldName} is required`);
    error.statusCode = 400;
    throw error;
  }

  return value.trim();
}

function validateNonEmptyRawString(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    const error = new Error(`${fieldName} is required`);
    error.statusCode = 400;
    throw error;
  }

  return value;
}

function validatePositiveIntegerField(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    const error = new Error(`${fieldName} must be a positive integer`);
    error.statusCode = 400;
    throw error;
  }

  return value;
}

function createConfig(overrides = {}) {
  const host = overrides.host ?? process.env.HOST ?? '0.0.0.0';
  const port = Number(overrides.port ?? process.env.PORT ?? 4317);
  const dev = overrides.dev ?? process.argv.includes('--dev');
  const corsOrigin = overrides.corsOrigin ?? process.env.CORS_ORIGIN ?? '*';
  const authUsername = overrides.authUsername ?? process.env.AUTH_USERNAME ?? (dev ? 'admin' : '');
  const authPassword = overrides.authPassword ?? process.env.AUTH_PASSWORD ?? (dev ? 'change-me' : '');
  const sessionSecret = overrides.sessionSecret ?? process.env.SESSION_SECRET ?? (dev ? 'dev-session-secret' : '');
  const sessionTtlSeconds = Number(overrides.sessionTtlSeconds ?? process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 8);
  const cookieSecure = parseBoolean(overrides.cookieSecure ?? process.env.COOKIE_SECURE, false);
  const paneHistoryLines = parsePositiveInteger(overrides.paneHistoryLines ?? process.env.PANE_HISTORY_LINES, 200);
  const paneStreamIntervalMs = parsePositiveInteger(overrides.paneStreamIntervalMs ?? process.env.PANE_STREAM_INTERVAL_MS, 1000);
  const httpsKeyPath = overrides.httpsKeyPath ?? process.env.HTTPS_KEY ?? '';
  const httpsCertPath = overrides.httpsCertPath ?? process.env.HTTPS_CERT ?? '';

  if (!Number.isInteger(port) || port < 0) {
    throw new Error('PORT must be a non-negative integer');
  }

  if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds <= 0) {
    throw new Error('SESSION_TTL_SECONDS must be a positive integer');
  }

  if (!sessionSecret) {
    throw new Error('SESSION_SECRET is required');
  }

  // HTTPS 는 둘 다 (key + cert) 있을 때만 활성화. 한 쪽만 설정하면 명백한
  // misconfiguration 이므로 즉시 throw.
  if ((httpsKeyPath && !httpsCertPath) || (!httpsKeyPath && httpsCertPath)) {
    throw new Error('HTTPS_KEY and HTTPS_CERT must be set together');
  }

  let https = null;
  if (httpsKeyPath && httpsCertPath) {
    try {
      https = {
        key: readFileSync(httpsKeyPath),
        cert: readFileSync(httpsCertPath),
      };
    } catch (error) {
      throw new Error(`Failed to read HTTPS cert/key: ${error.message}`);
    }
  }

  return {
    host,
    port,
    dev,
    corsOrigin,
    authUsername,
    authPassword,
    sessionSecret,
    sessionTtlSeconds,
    cookieSecure,
    paneHistoryLines,
    paneStreamIntervalMs,
    https,
  };
}

async function getPaneSnapshot(tmuxClient, paneId, historyLines) {
  return tmuxClient.capturePane(paneId, historyLines, { includeAnsi: true });
}

export async function createApp({
  tmuxClient = tmux,
  config: configOverrides = {},
  ptyBridgeFactory = createTmuxPtyBridge,
  viteEnabled = true,
} = {}) {
  const config = createConfig(configOverrides);
  const app = Fastify({ logger: false, ...(config.https ? { https: config.https } : {}) });
  const activePtyConnections = new Set();

  app.decorate('tmuxClient', tmuxClient);
  app.decorate('runtimeConfig', config);

  await app.register((await import('./plugins/db.js')).default);

  // Register Swagger before any routes so `onRoute` collects every schema.
  await app.register(swaggerPlugin);

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: UPLOAD_FILE_LIMIT_BYTES,
      files: 20,
      fields: 0,
    },
  });

  // Swagger schema 는 문서 전용. Fastify/AJV 자동 body/params/query 검증을
  // 비활성화하여 기존 validateRequiredString / validateNonEmptyRawString /
  // validatePositiveIntegerField 가 단일 검증원(single source of truth)으로
  // 남도록 한다. (plan Phase 4 결정: trim 동작 + 에러 응답 형식 보존.)
  app.setValidatorCompiler(() => () => true);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('access-control-allow-origin', config.corsOrigin);
    reply.header('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
    reply.header('access-control-allow-headers', 'content-type');

    if (request.method === 'OPTIONS') {
      reply.code(204).send();
      return reply;
    }

    if (
      request.url === '/api/health' ||
      request.url === '/api/login' ||
      request.url === '/api/setup/status' ||
      request.url === '/api/setup'
    ) {
      return;
    }

    if (!request.url.startsWith('/api/')) {
      return;
    }

    const user = readAuthenticatedUser(request, config);
    if (!user) {
      reply.code(401).send({ error: '로그인이 필요합니다.' });
      return reply;
    }

    request.authenticatedUser = user;
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    reply.code(statusCode).send({ error: error.message || 'Internal server error' });
  });

  const handlePtyUpgrade = async (request, socket, head) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname !== '/api/pty/socket') {
      return;
    }

    const user = readAuthenticatedUser({ headers: request.headers }, config);
    if (!user) {
      rejectWebSocketUpgrade(socket, 401, '로그인이 필요합니다.');
      return;
    }

    const paneId = requestUrl.searchParams.get('paneId');
    if (!paneId) {
      rejectWebSocketUpgrade(socket, 400, 'paneId is required');
      return;
    }

    const cols = parsePositiveInteger(requestUrl.searchParams.get('cols'), 120);
    const rows = parsePositiveInteger(requestUrl.searchParams.get('rows'), 32);

    try {
      const bridge = await ptyBridgeFactory(app.tmuxClient, { paneId, cols, rows });
      const connection = acceptWebSocketUpgrade(request, socket, head);
      if (!connection) {
        bridge.destroy();
        return;
      }

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) {
          return;
        }

        cleanedUp = true;
        activePtyConnections.delete(cleanup);
        bridge.destroy();
        connection.close();
      };

      activePtyConnections.add(cleanup);

      const unsubscribeData = bridge.onData((data) => {
        connection.sendJson({ type: 'output', data });
      });

      const unsubscribeExit = bridge.onExit(({ exitCode, signal }) => {
        connection.sendJson({ type: 'exit', exitCode, signal });
        unsubscribeData();
        unsubscribeExit();
        cleanup();
      });

      connection.onText((rawMessage) => {
        try {
          const message = JSON.parse(rawMessage);

          if (message.type === 'input' && typeof message.data === 'string') {
            bridge.write(message.data);
            return;
          }

          if (message.type === 'resize') {
            bridge.resize(message.cols, message.rows);
          }
        } catch {}
      });

      connection.onClose(() => {
        unsubscribeData();
        unsubscribeExit();
        cleanup();
      });

      connection.onError(() => {
        unsubscribeData();
        unsubscribeExit();
        cleanup();
      });

      connection.sendJson({
        type: 'ready',
        paneId,
        sessionName: bridge.metadata.sessionName,
        windowId: bridge.metadata.windowId,
        windowName: bridge.metadata.windowName,
      });
    } catch (error) {
      console.error('PTY upgrade failed:', error);
      rejectWebSocketUpgrade(socket, error.statusCode ?? 500, error.message || 'PTY WebSocket 연결에 실패했습니다.');
    }
  };

  app.server.on('upgrade', handlePtyUpgrade);

  app.addHook('onClose', async () => {
    app.server.off('upgrade', handlePtyUpgrade);
    for (const cleanup of [...activePtyConnections]) {
      cleanup();
    }
  });

  app.get(
    '/api/health',
    {
      schema: {
        tags: ['Health'],
        summary: '서버 상태 점검',
        response: {
          200: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              host: { type: 'string' },
              port: { type: 'integer' },
              dev: { type: 'boolean' },
              authMode: { type: 'string' },
              cookieSecure: { type: 'boolean' },
              paneHistoryLines: { type: 'integer' },
              paneStreamIntervalMs: { type: 'integer' },
            },
          },
        },
      },
    },
    async () => ({
      ok: true,
      host: config.host,
      port: config.port,
      dev: config.dev,
      authMode: 'credentials',
      cookieSecure: config.cookieSecure,
      paneHistoryLines: config.paneHistoryLines,
      paneStreamIntervalMs: config.paneStreamIntervalMs,
    }),
  );

  app.get('/api/setup/status', {
    schema: {
      tags: ['setup'],
      summary: 'Check if initial setup is required',
      response: {
        200: {
          type: 'object',
          properties: { needsSetup: { type: 'boolean' } },
        },
      },
    },
  }, async (request) => {
    const count = await request.server.db.user.count();
    return { needsSetup: count === 0 };
  });

  app.post('/api/setup', {
    schema: {
      tags: ['setup'],
      summary: 'Create the first admin user (only works when no users exist)',
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 2, maxLength: 64 },
          password: { type: 'string', minLength: 8 },
          displayName: { type: 'string', maxLength: 128 },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            user: { type: 'object', properties: { username: { type: 'string' } } },
          },
        },
        409: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { username, password, displayName } = request.body;
    const count = await request.server.db.user.count();
    if (count > 0) return reply.code(409).send({ error: 'Setup already completed' });
    const { default: bcrypt } = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await request.server.db.user.create({
      data: { username, passwordHash, displayName: displayName || null, role: 'admin' },
    });
    setSessionCookie(reply, { username: user.username, uid: user.id, role: user.role }, config);
    return reply.code(201).send({ user: { username: user.username } });
  });

  app.post('/api/login', {
    schema: {
      tags: ['Auth'],
      summary: '관리자 로그인',
      body: {
        type: 'object',
        // 'required' 의도적 생략 — validateRequiredString 이 단일 검증원
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: { username: { type: 'string' }, role: { type: 'string' } },
            },
          },
        },
        401: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const body = await readJsonBody(request);
    const username = validateRequiredString(body.username, 'username');
    const password = validateRequiredString(body.password, 'password');

    const { default: bcrypt } = await import('bcryptjs');
    const user = await request.server.db.user.findUnique({ where: { username } });
    if (!user || !user.passwordHash) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    setSessionCookie(reply, { username: user.username, uid: user.id, role: user.role }, config);
    return reply.send({ user: { username: user.username, role: user.role } });
  });

  app.post('/api/logout', {
    schema: {
      tags: ['Auth'],
      summary: '로그아웃',
      response: {
        200: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
        },
      },
    },
    preHandler: csrfGuard,
  }, async (_request, reply) => {
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  app.get('/api/auth/me', {
    schema: {
      tags: ['Auth'],
      summary: '현재 사용자 조회',
      response: {
        200: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                username: { type: 'string' },
                role: { type: 'string' },
                displayName: { type: 'string' },
                avatarUrl: { type: 'string' },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const dbUser = await request.server.db.user.findUnique({
      where: { username: request.authenticatedUser.username },
    });
    if (!dbUser) return reply.code(401).send({ error: 'User not found' });
    return { user: { username: dbUser.username, role: dbUser.role, displayName: dbUser.displayName, avatarUrl: dbUser.avatarUrl } };
  });

  app.get('/api/tree', {
    schema: {
      tags: ['Sessions'],
      summary: '세션/윈도우/패널 트리 조회',
      // fast-json-stringify 가 중첩 속성을 제거하지 않도록 response 는 문서용만 기술.
    },
  }, async () => {
    const sessions = await app.tmuxClient.getTree();
    return { sessions };
  });

  app.get('/api/panes/:paneId', {
    schema: {
      tags: ['Panes'],
      summary: '패널 스냅샷 조회',
      params: {
        type: 'object',
        properties: { paneId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: { lines: { type: 'integer' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            targetPane: { type: 'string' },
            content: { type: 'string' },
            lineCount: { type: 'integer' },
            historyLines: { type: 'integer' },
            capturedAt: { type: 'string' },
            includesAnsi: { type: 'boolean' },
          },
        },
      },
    },
  }, async (request) => {
    const paneId = request.params.paneId;
    const historyLines = parsePositiveInteger(request.query?.lines, config.paneHistoryLines);
    return getPaneSnapshot(app.tmuxClient, paneId, historyLines);
  });

  app.post('/api/panes/:paneId/input', {
    schema: {
      tags: ['Panes'],
      summary: '패널에 입력 전송',
      params: {
        type: 'object',
        properties: { paneId: { type: 'string' } },
      },
      body: {
        type: 'object',
        // 'required' 의도적 생략 — validateNonEmptyRawString 이 단일 검증원
        properties: { input: { type: 'string' } },
      },
    },
  }, async (request) => {
    const paneId = request.params.paneId;
    const body = await readJsonBody(request);
    const input = validateNonEmptyRawString(body.input, 'input');

    if (input.length > 4096) {
      const error = new Error('input must be 4096 characters or fewer');
      error.statusCode = 400;
      throw error;
    }

    return app.tmuxClient.sendInput(paneId, input);
  });

  app.post('/api/panes/:paneId/resize', {
    schema: {
      tags: ['Panes'],
      summary: '패널 크기 조정',
      params: {
        type: 'object',
        properties: { paneId: { type: 'string' } },
      },
      body: {
        type: 'object',
        // 'required' 의도적 생략 — validatePositiveIntegerField 가 단일 검증원
        properties: {
          cols: { type: 'integer' },
          rows: { type: 'integer' },
        },
      },
    },
  }, async (request) => {
    const paneId = request.params.paneId;
    const body = await readJsonBody(request);
    const cols = validatePositiveIntegerField(body.cols, 'cols');
    const rows = validatePositiveIntegerField(body.rows, 'rows');

    return app.tmuxClient.resizePane(paneId, cols, rows);
  });

  app.get('/api/panes/:paneId/stream', {
    schema: {
      tags: ['Panes'],
      summary: '패널 스냅샷 SSE 스트림',
      description: 'Server-Sent Events 로 pane snapshot 을 주기적으로 푸시합니다.',
      params: {
        type: 'object',
        properties: { paneId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: { lines: { type: 'integer' } },
      },
    },
  }, async (request, reply) => {
    const paneId = request.params.paneId;
    const historyLines = parsePositiveInteger(request.query?.lines, config.paneHistoryLines);

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    let lastPayload = '';
    let closed = false;

    const writeEvent = (eventName, payload) => {
      reply.raw.write(`event: ${eventName}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const sendSnapshot = async (force = false) => {
      try {
        const snapshot = await getPaneSnapshot(app.tmuxClient, paneId, historyLines);
        const serialized = JSON.stringify(snapshot);
        if (force || serialized !== lastPayload) {
          lastPayload = serialized;
          writeEvent('snapshot', snapshot);
        }
      } catch (error) {
        writeEvent('stream-error', {
          error: error.message || '패널 출력을 가져오지 못했습니다.',
        });
      }
    };

    const intervalId = setInterval(() => {
      void sendSnapshot();
    }, config.paneStreamIntervalMs);
    const heartbeatId = setInterval(() => {
      reply.raw.write(': keep-alive\n\n');
    }, 15000);

    const cleanup = () => {
      if (closed) {
        return;
      }

      closed = true;
      clearInterval(intervalId);
      clearInterval(heartbeatId);
    };

    request.raw.on('close', cleanup);
    await sendSnapshot(true);
  });

  app.get('/api/sessions', {
    schema: {
      tags: ['Sessions'],
      summary: '세션 목록 조회',
    },
  }, async () => {
    const sessions = await app.tmuxClient.listSessions();
    return { sessions };
  });

  app.post('/api/sessions', {
    schema: {
      tags: ['Sessions'],
      summary: '세션 생성',
      body: {
        type: 'object',
        // 'required' 의도적 생략 — validateRequiredString 이 단일 검증원
        properties: { name: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const body = await readJsonBody(request);
    const name = validateRequiredString(body.name, 'name');
    const result = await app.tmuxClient.createSession(name);
    reply.code(201);
    return result;
  });

  app.delete('/api/sessions/:name', {
    schema: {
      tags: ['Sessions'],
      summary: '세션 종료',
      params: {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
    },
  }, async (request) => {
    const name = request.params.name;
    const result = await app.tmuxClient.killSession(name);
    return result;
  });

  app.patch('/api/sessions/:name', {
    schema: {
      tags: ['Sessions'],
      summary: '세션 이름 변경',
      params: {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      body: {
        type: 'object',
        // 'required' 의도적 생략 — validateRequiredString 이 단일 검증원
        properties: { name: { type: 'string' } },
      },
    },
  }, async (request) => {
    const name = request.params.name;
    const body = await readJsonBody(request);
    const nextName = validateRequiredString(body.name, 'name');
    const result = await app.tmuxClient.renameSession(name, nextName);
    return result;
  });

  app.post('/api/windows', {
    schema: {
      tags: ['Windows'],
      summary: '윈도우 생성',
      body: {
        type: 'object',
        // 'required' 의도적 생략 — validateRequiredString 이 단일 검증원
        properties: {
          sessionName: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const body = await readJsonBody(request);
    const sessionName = validateRequiredString(body.sessionName, 'sessionName');
    const name = validateRequiredString(body.name, 'name');
    const result = await app.tmuxClient.createWindow(sessionName, name);
    reply.code(201);
    return result;
  });

  app.delete('/api/windows/:id', {
    schema: {
      tags: ['Windows'],
      summary: '윈도우 종료',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request) => {
    const windowId = validateRequiredString(request.params.id, 'id');
    const result = await app.tmuxClient.killWindow(windowId);
    return result;
  });

  app.post('/api/commands', {
    schema: {
      tags: ['Commands'],
      summary: '명령 전송',
      body: {
        type: 'object',
        // 'required' 의도적 생략 — validateRequiredString 이 단일 검증원
        properties: {
          targetPane: { type: 'string' },
          command: { type: 'string' },
          enter: { type: 'boolean' },
        },
      },
    },
  }, async (request) => {
    const body = await readJsonBody(request);
    const targetPane = validateRequiredString(body.targetPane, 'targetPane');
    const command = validateRequiredString(body.command, 'command');
    const enter = body.enter !== false;

    if (command.length > 2048) {
      const error = new Error('command must be 2048 characters or fewer');
      error.statusCode = 400;
      throw error;
    }

    const result = await app.tmuxClient.sendCommand(targetPane, command, enter);
    return result;
  });

  app.post('/api/uploads', {
    schema: {
      tags: ['Uploads'],
      summary: '파일 업로드 (tmp 경로 반환)',
      description:
        'multipart/form-data 로 파일을 받아 OS tmp 디렉토리에 저장하고, 터미널에서 참조 가능한 절대 경로 배열을 반환한다. 사용자 이름 단위 하위 디렉토리를 쓰며 1시간이 지난 파일은 요청 시 정리된다.',
      consumes: ['multipart/form-data'],
      response: {
        200: {
          type: 'object',
          properties: {
            paths: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!request.isMultipart()) {
      const error = new Error('multipart/form-data required');
      error.statusCode = 400;
      throw error;
    }

    const username = request.authenticatedUser.username;
    const userDir = uploadUserDir(username);
    await mkdir(userDir, { recursive: true });
    // lazy TTL cleanup of this user's directory.
    await cleanupStaleUploads(userDir);

    const paths = [];
    let totalBytes = 0;

    try {
      for await (const part of request.files()) {
        const filename = sanitizeUploadFilename(part.filename);
        const unique = `${randomBytes(8).toString('hex')}-${filename}`;
        const destination = path.join(userDir, unique);
        const chunks = [];
        let fileBytes = 0;

        for await (const chunk of part.file) {
          fileBytes += chunk.length;
          totalBytes += chunk.length;
          if (part.file.truncated || fileBytes > UPLOAD_FILE_LIMIT_BYTES) {
            const error = new Error('file exceeds per-file size limit');
            error.statusCode = 413;
            throw error;
          }
          if (totalBytes > UPLOAD_TOTAL_LIMIT_BYTES) {
            const error = new Error('total upload size exceeds request limit');
            error.statusCode = 413;
            throw error;
          }
          chunks.push(chunk);
        }

        if (part.file.truncated) {
          const error = new Error('file exceeds per-file size limit');
          error.statusCode = 413;
          throw error;
        }

        await writeFile(destination, Buffer.concat(chunks));
        paths.push(destination);
      }
    } catch (err) {
      // clean up any partially-written files on failure
      await Promise.all(
        paths.map((p) => rm(p, { force: true }).catch(() => {})),
      );
      throw err;
    }

    if (paths.length === 0) {
      const error = new Error('no files uploaded');
      error.statusCode = 400;
      throw error;
    }

    reply.code(200);
    return { paths };
  });

  app.get('/api/settings', {
    schema: {
      tags: ['settings'],
      summary: 'Get current user and system settings',
      response: {
        200: { type: 'object', properties: { settings: { type: 'object', additionalProperties: { type: 'string' } } } },
      },
    },
  }, async (request, reply) => {
    const user = request.authenticatedUser  // { username, uid, role }
    const userSettings = await request.server.db.userSetting.findMany({
      where: { userId: user.uid },
    })
    const result = { ...SETTING_DEFAULTS }
    for (const s of userSettings) {
      result[s.key] = s.value
    }
    if (user.role === 'admin') {
      const sysSettings = await request.server.db.systemSetting.findMany()
      for (const s of sysSettings) {
        result[s.key] = s.value
      }
    }
    return { settings: result }
  });

  app.patch('/api/settings', {
    schema: {
      tags: ['settings'],
      summary: 'Update settings',
      body: {
        type: 'object',
        properties: {
          settings: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.authenticatedUser
    const { settings } = request.body
    if (!settings || typeof settings !== 'object') {
      return reply.code(400).send({ error: 'settings object required' })
    }
    for (const [key, value] of Object.entries(settings)) {
      if (USER_SETTING_KEYS.includes(key)) {
        await request.server.db.userSetting.upsert({
          where: { userId_key: { userId: user.uid, key } },
          update: { value: String(value), updatedAt: new Date() },
          create: { userId: user.uid, key, value: String(value) },
        })
      } else if (SYSTEM_SETTING_KEYS.includes(key)) {
        if (user.role !== 'admin') {
          return reply.code(403).send({ error: `Setting "${key}" requires admin role` })
        }
        await request.server.db.systemSetting.upsert({
          where: { key },
          update: { value: String(value), updatedAt: new Date() },
          create: { key, value: String(value) },
        })
      } else {
        return reply.code(400).send({ error: `Unknown setting key: "${key}"` })
      }
    }
    return reply.send({ message: 'Settings updated' })
  });

  app.patch('/api/users/me', {
    schema: {
      tags: ['users'],
      summary: 'Update current user profile',
      body: {
        type: 'object',
        properties: {
          displayName: { type: 'string', maxLength: 128 },
          email: { type: 'string', maxLength: 256 },
          avatarUrl: { type: 'string', maxLength: 512 },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.authenticatedUser
    const { displayName, email, avatarUrl } = request.body
    const updated = await request.server.db.user.update({
      where: { id: user.uid },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(email !== undefined && { email }),
        ...(avatarUrl !== undefined && { avatarUrl }),
      },
      select: { username: true, displayName: true, email: true, avatarUrl: true, role: true },
    })
    return { user: updated }
  });

  app.patch('/api/users/me/password', {
    schema: {
      tags: ['users'],
      summary: 'Change current user password',
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword: { type: 'string', minLength: 8 },
          newPasswordConfirm: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { currentPassword, newPassword, newPasswordConfirm } = request.body
    if (newPasswordConfirm && newPassword !== newPasswordConfirm) {
      return reply.code(400).send({ error: '새 비밀번호가 일치하지 않습니다' })
    }
    const user = request.authenticatedUser
    const dbUser = await request.server.db.user.findUnique({ where: { id: user.uid } })
    if (!dbUser || !dbUser.passwordHash) return reply.code(401).send({ error: 'Cannot change password' })
    const { default: bcrypt } = await import('bcryptjs')
    const valid = await bcrypt.compare(currentPassword, dbUser.passwordHash)
    if (!valid) return reply.code(401).send({ error: '현재 비밀번호가 올바르지 않습니다' })
    const passwordHash = await bcrypt.hash(newPassword, 12)
    await request.server.db.user.update({ where: { id: user.uid }, data: { passwordHash } })
    return { message: '비밀번호가 변경되었습니다' }
  });

  app.delete('/api/users/me', {
    schema: {
      tags: ['users'],
      summary: 'Delete own account',
      response: {
        204: { type: 'null' },
        403: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const user = request.authenticatedUser
    if (user.role === 'admin') {
      const adminCount = await request.server.db.user.count({ where: { role: 'admin' } })
      if (adminCount <= 1) {
        return reply.code(403).send({ error: '마지막 관리자 계정은 삭제할 수 없습니다' })
      }
    }
    await request.server.db.user.delete({ where: { id: user.uid } })
    clearSessionCookie(reply, config)
    return reply.code(204).send()
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && viteEnabled) {
      return reply.html();
    }

    reply.code(404).send({ error: 'Not found' });
  });

  return { app, config, viteEnabled };
}

async function bootstrapAuth(app) {
  const userCount = await app.db.user.count();
  const envUser = process.env.AUTH_USERNAME;
  const envPass = process.env.AUTH_PASSWORD;

  if (envUser && envPass && userCount === 0) {
    const { default: bcrypt } = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(envPass, 12);
    await app.db.user.create({
      data: { username: envUser, passwordHash, role: 'admin' },
    });
    console.log(`[setup] Seeded admin user "${envUser}" from env vars. IMPORTANT: Remove AUTH_USERNAME/AUTH_PASSWORD from environment and manage users via the UI.`);
  } else if (envUser && userCount > 0) {
    console.warn('[setup] AUTH_USERNAME env is set but users already exist — env credentials are IGNORED. Manage users via the UI.');
  }
}

export async function startServer(options = {}) {
  const { app, config, viteEnabled } = await createApp(options);
  if (viteEnabled) {
    await app.register(FastifyVite, {
      root: projectRoot,
      dev: config.dev,
      spa: true,
    });
    await app.vite.ready();
  }
  await app.listen({ port: config.port, host: config.host });
  await bootstrapAuth(app);

  const scheme = config.https ? 'https' : 'http';
  console.log(`tmux-web-console listening on ${scheme}://${config.host}:${config.port}`);
  console.log(config.dev ? 'Fastify + Vite development mode is enabled.' : 'Production bundle mode is enabled.');
  console.log(config.cookieSecure ? 'Secure cookie mode is enabled.' : 'Secure cookie mode is disabled. Enable COOKIE_SECURE=true behind HTTPS.');
  console.log(`Live pane capture keeps ${config.paneHistoryLines} lines with a ${config.paneStreamIntervalMs}ms refresh interval.`);

  return { app, config };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  startServer().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
