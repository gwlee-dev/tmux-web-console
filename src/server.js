import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tmux from './tmux.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

function json(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload, null, 2));
}

function noContent(response, extraHeaders = {}) {
  response.writeHead(204, extraHeaders);
  response.end();
}

function getCorsHeaders(config) {
  return {
    'access-control-allow-origin': config.corsOrigin,
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-api-token',
  };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function getTokenFromRequest(request) {
  const bearer = request.headers.authorization;
  if (bearer?.startsWith('Bearer ')) {
    return bearer.slice('Bearer '.length).trim();
  }

  return request.headers['x-api-token'];
}

function isLocalHost(host) {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

async function serveStatic(response, filePath) {
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
    }[ext] ?? 'application/octet-stream';

    response.writeHead(200, { 'content-type': contentType });
    response.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      json(response, 404, { error: 'Not found' });
      return;
    }

    json(response, 500, { error: error.message || 'Failed to serve static asset' });
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

export function createServer({
  tmuxClient = tmux,
  config: configOverrides = {},
} = {}) {
  const config = createConfig(configOverrides);

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const corsHeaders = getCorsHeaders(config);

    if (request.method === 'OPTIONS') {
      noContent(response, corsHeaders);
      return;
    }

    try {
      if (url.pathname === '/' && request.method === 'GET') {
        await serveStatic(response, path.join(publicDir, 'index.html'));
        return;
      }

      if (url.pathname === '/app.js' && request.method === 'GET') {
        await serveStatic(response, path.join(publicDir, 'app.js'));
        return;
      }

      if (url.pathname === '/styles.css' && request.method === 'GET') {
        await serveStatic(response, path.join(publicDir, 'styles.css'));
        return;
      }

      if (url.pathname === '/api/health' && request.method === 'GET') {
        json(response, 200, {
          ok: true,
          host: config.host,
          port: config.port,
          authRequired: Boolean(config.apiToken),
        }, corsHeaders);
        return;
      }

      if (config.apiToken) {
        const requestToken = getTokenFromRequest(request);
        if (!requestToken || requestToken !== config.apiToken) {
          json(response, 401, { error: 'Unauthorized' }, corsHeaders);
          return;
        }
      }

      if (url.pathname === '/api/tree' && request.method === 'GET') {
        const tree = await tmuxClient.getTree();
        json(response, 200, { sessions: tree }, corsHeaders);
        return;
      }

      if (url.pathname === '/api/sessions' && request.method === 'GET') {
        const sessions = await tmuxClient.listSessions();
        json(response, 200, { sessions }, corsHeaders);
        return;
      }

      if (url.pathname === '/api/sessions' && request.method === 'POST') {
        const body = await readJsonBody(request);
        const name = validateRequiredString(body.name, 'name');
        const result = await tmuxClient.createSession(name);
        json(response, 201, result, corsHeaders);
        return;
      }

      if (url.pathname.startsWith('/api/sessions/') && request.method === 'DELETE') {
        const name = decodeURIComponent(url.pathname.replace('/api/sessions/', ''));
        const result = await tmuxClient.killSession(name);
        json(response, 200, result, corsHeaders);
        return;
      }

      if (url.pathname === '/api/windows' && request.method === 'POST') {
        const body = await readJsonBody(request);
        const sessionName = validateRequiredString(body.sessionName, 'sessionName');
        const name = validateRequiredString(body.name, 'name');
        const result = await tmuxClient.createWindow(sessionName, name);
        json(response, 201, result, corsHeaders);
        return;
      }

      if (url.pathname === '/api/commands' && request.method === 'POST') {
        const body = await readJsonBody(request);
        const targetPane = validateRequiredString(body.targetPane, 'targetPane');
        const command = validateRequiredString(body.command, 'command');
        const enter = body.enter !== false;

        if (command.length > 2048) {
          json(response, 400, { error: 'command must be 2048 characters or fewer' }, corsHeaders);
          return;
        }

        const result = await tmuxClient.sendCommand(targetPane, command, enter);
        json(response, 200, result, corsHeaders);
        return;
      }

      json(response, 404, { error: 'Not found' }, corsHeaders);
    } catch (error) {
      const statusCode = error.statusCode ?? 500;
      json(response, statusCode, { error: error.message || 'Internal server error' }, corsHeaders);
    }
  });

  return { server, config };
}

export async function startServer(options = {}) {
  const { server, config } = createServer(options);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  console.log(`tmux-web-console listening on http://${config.host}:${config.port}`);
  console.log(config.apiToken ? 'API token auth is enabled.' : 'API token auth is disabled for local-only access.');

  return { server, config };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  startServer().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
