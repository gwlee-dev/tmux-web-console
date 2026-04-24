import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL: "http://127.0.0.1:4317",
    trace: "on-first-retry",
    screenshot: "on"
  },
  webServer: {
    command: process.env.CI ? "node src/server.js" : "yarn dev",
    url: "http://127.0.0.1:4317/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 120000 : 60000,
    env: {
      HOST: "127.0.0.1",
      PORT: "4317",
      AUTH_USERNAME: "admin",
      AUTH_PASSWORD: "change-me",
      SESSION_SECRET: "e2e-test-session-secret-xxxxxxxxxxxxxxxxxx",
      COOKIE_SECURE: "false",
      CORS_ORIGIN: "*"
    }
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] }
    }
  ]
});
