import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tmux from './tmux.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../dist');
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

function buildSessionCookie(username, config) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: username,
      exp: Math.floor(Date.now() / 1000) + config.sessionTtlSeconds,
      nonce: randomBytes(8).toString('hex'),
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

    return decoded.sub;
  } catch {
    return null;
  }
}

function setSessionCookie(reply, username, config) {
  reply.header(
    'set-cookie',
    serializeCookie(SESSION_COOKIE_NAME, buildSessionCookie(username, config), {
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

function createConfig(overrides = {}) {
  const host = overrides.host ?? process.env.HOST ?? '127.0.0.1';
  const port = Number(overrides.port ?? process.env.PORT ?? 4317);
  const corsOrigin = overrides.corsOrigin ?? process.env.CORS_ORIGIN ?? '*';
  const authUsername = overrides.authUsername ?? process.env.AUTH_USERNAME ?? '';
  const authPassword = overrides.authPassword ?? process.env.AUTH_PASSWORD ?? '';
  const sessionSecret = overrides.sessionSecret ?? process.env.SESSION_SECRET ?? '';
  const sessionTtlSeconds = Number(overrides.sessionTtlSeconds ?? process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 8);
  const cookieSecure = parseBoolean(overrides.cookieSecure ?? process.env.COOKIE_SECURE, false);

  if (!Number.isInteger(port) || port < 0) {
    throw new Error('PORT must be a non-negative integer');
  }

  if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds <= 0) {
    throw new Error('SESSION_TTL_SECONDS must be a positive integer');
  }

  if (!authUsername || !authPassword || !sessionSecret) {
    const errorMessage = 'AUTH_USERNAME, AUTH_PASSWORD, and SESSION_SECRET are required';
    if (!isLocalHost(host)) {
      throw new Error(errorMessage);
    }

    throw new Error(errorMessage);
  }

  return {
    host,
    port,
    corsOrigin,
    authUsername,
    authPassword,
    sessionSecret,
    sessionTtlSeconds,
    cookieSecure,
  };
}

export function createApp({
  tmuxClient = tmux,
  config: configOverrides = {},
} = {}) {
  const config = createConfig(configOverrides);
  const app = Fastify({ logger: false });

  app.decorate('tmuxClient', tmuxClient);
  app.decorate('runtimeConfig', config);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('access-control-allow-origin', config.corsOrigin);
    reply.header('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
    reply.header('access-control-allow-headers', 'content-type');

    if (request.method === 'OPTIONS') {
      reply.code(204).send();
      return reply;
    }

    if (request.url === '/api/health' || request.url === '/api/login') {
      return;
    }

    if (!request.url.startsWith('/api/')) {
      return;
    }

    const username = readAuthenticatedUser(request, config);
    if (!username) {
      reply.code(401).send({ error: '로그인이 필요합니다.' });
      return reply;
    }

    request.authenticatedUser = username;
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    reply.code(statusCode).send({ error: error.message || 'Internal server error' });
  });

  app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    index: ['index.html'],
  });

  app.get('/api/health', async () => ({
    ok: true,
    host: config.host,
    port: config.port,
    authMode: 'credentials',
    cookieSecure: config.cookieSecure,
  }));

  app.post('/api/login', async (request, reply) => {
    const body = await readJsonBody(request);
    const username = validateRequiredString(body.username, 'username');
    const password = validateRequiredString(body.password, 'password');

    const isUsernameValid = safeStringEqual(username, config.authUsername);
    const isPasswordValid = safeStringEqual(password, config.authPassword);

    if (!isUsernameValid || !isPasswordValid) {
      const error = new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
      error.statusCode = 401;
      throw error;
    }

    setSessionCookie(reply, config.authUsername, config);
    return {
      ok: true,
      user: {
        username: config.authUsername,
      },
    };
  });

  app.post('/api/logout', async (_request, reply) => {
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => ({
    authenticated: true,
    user: {
      username: request.authenticatedUser,
    },
  }));

  app.get('/api/tree', async () => {
    const sessions = await app.tmuxClient.getTree();
    return { sessions };
  });

  app.get('/api/sessions', async () => {
    const sessions = await app.tmuxClient.listSessions();
    return { sessions };
  });

  app.post('/api/sessions', async (request, reply) => {
    const body = await readJsonBody(request);
    const name = validateRequiredString(body.name, 'name');
    const result = await app.tmuxClient.createSession(name);
    reply.code(201);
    return result;
  });

  app.delete('/api/sessions/:name', async (request) => {
    const name = decodeURIComponent(request.params.name);
    const result = await app.tmuxClient.killSession(name);
    return result;
  });

  app.post('/api/windows', async (request, reply) => {
    const body = await readJsonBody(request);
    const sessionName = validateRequiredString(body.sessionName, 'sessionName');
    const name = validateRequiredString(body.name, 'name');
    const result = await app.tmuxClient.createWindow(sessionName, name);
    reply.code(201);
    return result;
  });

  app.post('/api/commands', async (request) => {
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

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      return reply.sendFile('index.html');
    }

    reply.code(404).send({ error: 'Not found' });
  });

  return { app, config };
}

export async function startServer(options = {}) {
  const { app, config } = createApp(options);
  await app.listen({ port: config.port, host: config.host });

  console.log(`tmux-web-console listening on http://${config.host}:${config.port}`);
  console.log(`Credential login is enabled for user ${config.authUsername}.`);
  console.log(config.cookieSecure ? 'Secure cookie mode is enabled.' : 'Secure cookie mode is disabled. Enable COOKIE_SECURE=true behind HTTPS.');

  return { app, config };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  startServer().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
