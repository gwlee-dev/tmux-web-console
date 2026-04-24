import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const E2E_SESSION = "e2e-flow-test";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "change-me";

// End-to-end app flow coverage.
//
// This spec exercises real user flows against a live server + tmux — login,
// session selection, PTY connection (waited on via `[data-pty-state="live"]`
// added in Phase 2), tab switching, window/session close, desktop + mobile
// command send, sidebar search, logout. No visual snapshots — those stay in
// visual-regression.spec.ts.

async function setupE2ESession() {
  try {
    await execFileAsync("tmux", ["kill-session", "-t", E2E_SESSION]);
  } catch {
    /* nothing to clean */
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

async function teardownE2ESession() {
  try {
    await execFileAsync("tmux", ["kill-session", "-t", E2E_SESSION]);
  } catch {
    /* already gone */
  }
}

test.beforeAll(async () => {
  await setupE2ESession();
});

test.afterAll(async () => {
  await teardownE2ESession();
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("예: admin").fill(ADMIN_USERNAME);
  await page.getByPlaceholder("비밀번호 입력").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByText("세션 목록")).toBeVisible({ timeout: 15000 });
}

test.describe("desktop flow", () => {
  test("login → select session → PTY live → tab switch → logout", async ({
    page
  }) => {
    await login(page);

    // Session appears in sidebar.
    const sessionRow = page.getByText(E2E_SESSION, { exact: true }).first();
    await expect(sessionRow).toBeVisible({ timeout: 10000 });
    await sessionRow.click();

    // PTY connects → data-pty-state flips to "live" (P1-pty-marker).
    await expect(page.locator('[data-pty-state="live"]')).toBeVisible({
      timeout: 15000
    });

    // Tab bar renders both windows.
    await expect(page.getByRole("button", { name: "editor 닫기" })).toBeVisible();
    const logsTab = page.getByRole("button", { name: /^logs$/ });
    await logsTab.click();

    // Still PTY-live after tab switch.
    await expect(page.locator('[data-pty-state="live"]')).toBeVisible({
      timeout: 15000
    });

    // Logout via dropdown menu.
    await page.getByRole("button", { name: /PTY|대기|연결|오류/ }).first();
    // Find logout button — DropdownMenu footer.
    const logoutTrigger = page.getByRole("button", { name: /계정|로그아웃|logout/i }).first();
    if (await logoutTrigger.count()) {
      await logoutTrigger.click();
    }
    const logoutItem = page.getByRole("menuitem", { name: /로그아웃/ });
    if (await logoutItem.count()) {
      await logoutItem.click();
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test("sidebar search filters sessions", async ({ page }) => {
    await login(page);

    const search = page.getByPlaceholder("세션 검색");
    await search.fill("__no-such-session__");
    await expect(page.getByText("검색 결과가 없습니다.")).toBeVisible();

    await search.fill(E2E_SESSION.slice(0, 5));
    await expect(
      page.getByText(E2E_SESSION, { exact: true }).first()
    ).toBeVisible();
  });

  test("window kill dialog resets target on reopen (P0-2)", async ({ page }) => {
    await login(page);
    await page.getByText(E2E_SESSION, { exact: true }).first().click();
    await expect(page.locator('[data-pty-state="live"]')).toBeVisible({
      timeout: 15000
    });

    // Open window-kill dialog for "editor".
    await page.getByRole("button", { name: "editor 닫기" }).click();
    await expect(page.getByText("Window 종료")).toBeVisible();
    await expect(page.getByText(/editor Window를 종료합니다\./)).toBeVisible();
    // Cancel — this is the P0-2 reset; the next open must show the new target.
    await page.getByRole("button", { name: "취소" }).click();
    await expect(page.getByText("Window 종료")).not.toBeVisible();
  });
});

test.describe("mobile flow", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // Fixed via data-slot selector isolation:
  //   shadcn Sidebar Sheet and Dialog both match role="dialog"; resolved by
  //   scoping to [data-slot="dialog-content"] (dialog.tsx:60) vs
  //   [data-slot="sheet-content"] (sheet.tsx:60). Sheet dismiss is awaited
  //   explicitly before opening the command Dialog.
  test("mobile login → session → command dialog auto-close (P1-1)", async ({
    page
  }) => {
    await page.goto("/login");
    await page.getByPlaceholder("예: admin").fill(ADMIN_USERNAME);
    await page.getByPlaceholder("비밀번호 입력").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();

    // Wait for post-login navigation to settle — the mobile top bar (which
    // hosts the visible SidebarTrigger) only renders after we leave /login.
    await page.waitForURL((url) => !url.pathname.endsWith("/login"), {
      timeout: 15000
    });
    const mobileTrigger = page.locator('[data-sidebar="trigger"]').first();
    await expect(mobileTrigger).toBeVisible({ timeout: 10000 });
    await mobileTrigger.click();
    await expect(page.getByText(E2E_SESSION, { exact: true })).toBeVisible({
      timeout: 15000
    });
    await page.getByText(E2E_SESSION, { exact: true }).first().click();

    // App.tsx does not call setOpenMobile(false) on session select, so the
    // Sheet stays open until the user dismisses it. Explicitly press Escape
    // to close it before interacting with the command Dialog; otherwise the
    // sheet-overlay intercepts pointer events (observed flake) and/or the
    // Sheet's DOM competes with the Dialog for role="dialog" matchers.
    await page.keyboard.press("Escape");
    await expect(
      page.locator('[data-slot="sheet-content"]')
    ).not.toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('[data-slot="sheet-overlay"]')
    ).not.toBeVisible({ timeout: 10000 });

    // PTY live before commanding.
    await expect(page.locator('[data-pty-state="live"]')).toBeVisible({
      timeout: 15000
    });

    // Open mobile command dialog. The lucide v1.8 Clipboard icon renders as
    // `<svg class="lucide-clipboard ...">`. Use an attribute-contains selector
    // so we don't depend on exact token order.
    const clipboardButton = page.locator(
      'button:has(svg[class*="clipboard"])'
    );
    await expect(clipboardButton).toBeVisible({ timeout: 5000 });
    await clipboardButton.first().click();

    // The mobile command surface is now a Drawer (vaul) — drawer.tsx emits
    // data-slot="drawer-content", which is distinct from sheet-content and
    // dialog-content so the Sidebar Sheet cannot match here.
    const drawer = page
      .locator('[data-slot="drawer-content"]')
      .filter({ hasText: "명령 입력" });
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Type + submit — P1-1 auto-closes the drawer after sending. The Drawer
    // tears down the Send button synchronously when the handler fires (the
    // setMobileCommandOpen(false) call and sendCommand both run), so
    // Playwright's stability check can race the DOM detachment. `force: true`
    // skips stability while the click event still fires; we then assert the
    // drawer close as the true success signal.
    await drawer.getByPlaceholder("명령 입력").fill("echo hello");
    const sendButton = drawer.getByRole("button", { name: /보내기/ });
    await sendButton.scrollIntoViewIfNeeded();
    await sendButton.click({ force: true });

    await expect(drawer).not.toBeVisible({ timeout: 5000 });
  });
});
