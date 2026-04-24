// Vitest global setup for tmux-web-console test suite.
//
// Vitest injects `process.env.BASE_URL = "/"` into test workers for Vite's
// import.meta.env compatibility. That can shadow env vars the Fastify server
// reads at bootstrap time. Strip the injected value so dotenv / environment
// loading works consistently during tests.
delete process.env.BASE_URL;

// Tests run against createApp() with a fake tmux client — the real tmux binary
// must not be invoked. Flag this so src/server.js / src/tmux.js can assert on
// it if needed in future hardening.
process.env.TMUX_WEB_CONSOLE_TEST ??= "1";
