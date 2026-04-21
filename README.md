# tmux-web-console

Fastify-based web UI and JSON API for controlling tmux sessions, windows, and panes remotely.

## What this baseline does

- exposes a browser UI from a single Node server
- lists tmux sessions, windows, and panes
- creates sessions
- creates windows inside a session
- sends commands to a pane with `tmux send-keys`
- kills sessions
- protects remote access with a shared API token
- serves the browser app through Fastify

## Stack choice

You clarified that `fastify` or `next.js` is allowed.

This project now uses **Fastify** instead of raw `node:http` because this app is currently much more API/server heavy than page-framework heavy.

Why Fastify here:

- cleaner routing and response handling
- built-in request injection for tests
- easy static asset serving for the current lightweight UI
- lower overhead than introducing a full Next.js app before SSR/RSC-style needs exist

## Security model

Remote tmux control is powerful, so this starter is intentionally opinionated:

- if `HOST` is not localhost, `API_TOKEN` is required
- every control endpoint except `/api/health` requires the token
- commands are sent through `execFile('tmux', args)` instead of shell string interpolation
- the browser stores the token only in `localStorage`

This is enough for a first private deployment, but **not enough for internet exposure** without TLS, rate limiting, stronger auth, and proxy hardening.

## Project structure

```txt
public/
  index.html      # minimal browser UI
  app.js          # browser-side session/pane controls
  styles.css      # styling
src/
  server.js       # Fastify server, auth, routes, static serving
  tmux.js         # tmux command bridge
test/
  server.test.js  # API tests using Fastify inject
```

## Environment

Copy `.env.example` values into your runtime environment:

```bash
HOST=0.0.0.0
PORT=4317
API_TOKEN=change-me
CORS_ORIGIN=*
```

## Install

```bash
npm install
```

## Run

```bash
HOST=0.0.0.0 PORT=4317 API_TOKEN=change-me npm start
```

Then open:

```txt
http://<host>:4317
```

## Verify

```bash
npm test
npm run check
```

## Available endpoints

- `GET /api/health`
- `GET /api/tree`
- `GET /api/sessions`
- `POST /api/sessions`
- `DELETE /api/sessions/:name`
- `POST /api/windows`
- `POST /api/commands`

## Example requests

Create a session:

```bash
curl -X POST http://127.0.0.1:4317/api/sessions \
  -H 'content-type: application/json' \
  -H 'x-api-token: change-me' \
  -d '{"name":"dev"}'
```

Send a command to a pane:

```bash
curl -X POST http://127.0.0.1:4317/api/commands \
  -H 'content-type: application/json' \
  -H 'x-api-token: change-me' \
  -d '{"targetPane":"%1","command":"htop","enter":true}'
```

## Next steps I recommend

1. add HTTPS + reverse proxy in front of this
2. replace shared-token auth with user accounts or SSO
3. add streaming updates for pane output and session changes
4. add per-command authorization / audit logging
5. add a proper pane viewer using tmux capture APIs or streaming transport
