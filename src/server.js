import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tmux from './tmux.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../dist');

function getTokenFromRequest(request) {
  const bearer = request.headers.authorization;
  if (typeof bearer === 'string' && bearer.startsWith('Bearer ')) {
    return bearer.slice('Bearer '.length).trim();
  }

  return request.headers['x-api-token'];
}

function isLocalHost(host) {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
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
  const apiToken = overrides.apiToken ?? process.env.API_TOKEN ?? '';
  const corsOrigin = overrides.corsOrigin ?? process.env.CORS_ORIGIN ?? '*';

  if (!Number.isInteger(port) || port < 0) {
    throw new Error('PORT must be a non-negative integer');
  }

  if (!apiToken && !isLocalHost(host)) {
    throw new Error('API_TOKEN is required when binding to a non-local host');
  }

  return { host, port, apiToken, corsOrigin };
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
    reply.header('access-control-allow-headers', 'content-type,authorization,x-api-token');

    if (request.method === 'OPTIONS') {
      reply.code(204).send();
      return reply;
    }

    if (request.url === '/api/health') {
      return;
    }

    if (!request.url.startsWith('/api/')) {
      return;
    }

    if (config.apiToken) {
      const requestToken = getTokenFromRequest(request);
      if (!requestToken || requestToken !== config.apiToken) {
        reply.code(401).send({ error: 'Unauthorized' });
        return reply;
      }
    }
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
    authRequired: Boolean(config.apiToken),
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
  console.log(config.apiToken ? 'API token auth is enabled.' : 'API token auth is disabled for local-only access.');

  return { app, config };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  startServer().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
