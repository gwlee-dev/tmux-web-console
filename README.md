# tmux-web-console

Node-only web UI and JSON API for controlling tmux sessions, windows, and panes remotely.

## What this baseline does

- exposes a browser UI from a single Node server
- lists tmux sessions, windows, and panes
- creates sessions
- creates windows inside a session
- sends commands to a pane with `tmux send-keys`
- kills sessions
- protects remote access with a shared API token
- uses only built-in Node modules, with **zero npm dependencies**

## Why this shape

You said:

- remote access is allowed
- Node only

So this starter avoids framework lock-in and keeps the attack surface small while still giving you a real browser-controllable baseline.

## Security model

Remote tmux control is powerful, so this starter is intentionally opinionated:

- if `HOST` is not localhost, `API_TOKEN` is required
- every control endpoint except `/api/health` requires the token
- commands are sent through `execFile('tmux', args)` instead of shell string interpolation
- the browser stores the token only in `localStorage`

This is enough for a first private deployment, but **not enough for internet exposure** without a reverse proxy, TLS, rate limiting, and stronger auth.

## Project structure

```txt
public/
  index.html      # minimal browser UI
  app.js          # browser-side session/pane controls
  styles.css      # styling
src/
  server.js       # HTTP server, auth, routes, static serving
  tmux.js         # tmux command bridge
test/
  server.test.js  # lightweight API tests
```

## Environment

Copy `.env.example` values into your runtime environment:

```bash
HOST=0.0.0.0
PORT=4317
API_TOKEN=change-me
CORS_ORIGIN=*
```

## Run

```bash
npm start
```

Then open:

```txt
http://<host>:4317
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
5. add a proper pane viewer using PTY or controlled tmux capture APIs
