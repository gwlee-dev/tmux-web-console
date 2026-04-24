import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const E2E_SESSION = "e2e-test";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "change-me";

// Visual regression suite.
//
// - Phase 1 baseline (pre-fix): 4 stable snapshots (login desktop+mobile,
//   session list, session kill dialog).
// - Phase 5 update: P0-1 replaced dead setStatus with live toast calls, so
//   login-success + tree-load toasts now overlay the authenticated screens.
//   We mask `[data-sonner-toaster]` so the baselines remain deterministic,
//   then re-accept snapshots with `--update-snapshots`.
// - `.xterm` is always masked because xterm renders to a canvas with a
//   blinking cursor that is inherently time-dependent.

async function ensureE2ETmuxSession() {
  // Kill any stale e2e session, then create a fresh one with two windows so the
  // tab bar renders meaningfully in the sidebar screenshots.
  try {
    await execFileAsync("tmux", ["kill-session", "-t", E2E_SESSION]);
  } catch {
    // no stale session — that's fine.
  }
  await execFileAsync("tmux", [
    "new-session",
    "-d",
    "-s",
    E2E_SESSION,
    "-n",
    "editor"
  ]);
  await execFileAsync("tmux", [
    "new-window",
    "-t",
    `${E2E_SESSION}:`,
    "-n",
    "logs"
  ]);
}

async function teardownE2ETmuxSession() {
  try {
    await execFileAsync("tmux", ["kill-session", "-t", E2E_SESSION]);
  } catch {
    // already gone.
  }
}

test.beforeAll(async () => {
  await ensureE2ETmuxSession();
});

test.afterAll(async () => {
  await teardownE2ETmuxSession();
});

test.describe("baseline: login", () => {
  test("login screen renders", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("tmux 웹 콘솔 로그인")).toBeVisible();
    await expect(page).toHaveScreenshot("login.png", {
      animations: "disabled",
      fullPage: true
    });
  });
});

test.describe("baseline: authenticated shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("예: admin").fill(ADMIN_USERNAME);
    await page.getByPlaceholder("비밀번호 입력").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();
    // Post-login: sidebar renders "세션 목록" group label.
    await expect(page.getByText("세션 목록")).toBeVisible({ timeout: 15000 });
    // Allow time for /api/tree to populate.
    await expect(page.getByText(E2E_SESSION, { exact: true })).toBeVisible({
      timeout: 10000
    });
  });

  test("session list sidebar", async ({ page }) => {
    await expect(page).toHaveScreenshot("session-list.png", {
      animations: "disabled",
      fullPage: true,
      mask: [page.locator(".xterm"), page.locator("[data-sonner-toaster]")]
    });
  });

  test("session kill dialog", async ({ page }) => {
    const sessionRow = page.getByText(E2E_SESSION, { exact: true }).first();
    await sessionRow.hover();
    const killButton = page
      .locator(`[data-sidebar="menu-item"]`, { hasText: E2E_SESSION })
      .locator("button")
      .last();
    await killButton.click();
    await expect(page.getByText("세션 종료")).toBeVisible();
    await expect(page).toHaveScreenshot("dialog-session-kill.png", {
      animations: "disabled",
      fullPage: true,
      mask: [page.locator(".xterm"), page.locator("[data-sonner-toaster]")]
    });
  });
});

test.describe("baseline: mobile viewport", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("login screen on mobile", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("tmux 웹 콘솔 로그인")).toBeVisible();
    await expect(page).toHaveScreenshot("login-mobile.png", {
      animations: "disabled",
      fullPage: true
    });
  });
});
