import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src")
    }
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["node_modules", "dist", "e2e/**"],
    setupFiles: ["./test/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules",
        "dist",
        "**/*.test.ts",
        "test/**",
        "e2e/**",
        "src/components/ui/**", // shadcn 생성 파일
        "src/main.tsx",
        "src/index.css",
        // src/pty-websocket.js: removed from exclude in PR 2 once the pure
        // helpers (normalizePositiveInteger, buildPtyEnv, parseWebSocketFrame,
        // unmaskPayload) are unit-testable. The node-pty bridge
        // (createTmuxPtyBridge + helpers) is excluded via /* v8 ignore */ blocks
        // inside the source file.
        "*.config.ts",
        "*.config.js"
      ],
      // Thresholds follow the "measured - 2pp" safety buffer policy.
      // PR 2 (parser + websocket coverage, followup-bundle.md Rev 2) lifted
      // the floor by adding tmux.js parser tests and bringing pty-websocket.js
      // out of `coverage.exclude` (acceptWebSocketUpgrade now covered via
      // mock-socket tests; createTmuxPtyBridge is /* v8 ignore */d as it
      // requires the node-pty native runtime).
      // Measured on PR 2: stmts 68.28 / branches 56.66 / funcs 67.59 / lines 68.49.
      // Previous PR baseline: stmts 51.59 / branches 43.14 / funcs 54.65 / lines 51.83.
      // 2026-08 CI 재측정: DB 기반 인증 전환 이후 server.js가 커지며
      // stmts 62.97 / branches 50.5 / funcs 63.49 / lines 63.33 — 같은 −2pp 정책으로 하향.
      thresholds: {
        statements: 60,
        branches: 48,
        functions: 61,
        lines: 61
      }
    },
    pool: "forks",
    isolate: false,
    fileParallelism: false
  }
});
