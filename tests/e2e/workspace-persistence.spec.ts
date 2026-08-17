import { test, expect } from "@playwright/test";
import { POSTGRES_URL, resetDatabase } from "./helpers/db";
import { connectToPostgres, openTable } from "./helpers/app";

/**
 * Open tabs, unsaved query text and the sidebar layout survive a reload.
 * Previously a refresh discarded all of it.
 */

test.skip(!POSTGRES_URL, "E2E_POSTGRES_URL is not set");

test.beforeEach(async () => {
  await resetDatabase();
});

async function waitForStudio(page: import("@playwright/test").Page) {
  await expect(page.getByRole("tab", { name: "Data" })).toBeVisible({
    timeout: 30_000,
  });
}

test("open data tabs survive a reload", async ({ page }) => {
  await connectToPostgres(page);
  await openTable(page, "users");
  await openTable(page, "orders");

  await expect(page.getByRole("button", { name: "Close tab users" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close tab orders" })).toBeVisible();

  await page.reload();
  await waitForStudio(page);

  await expect(page.getByRole("button", { name: "Close tab users" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close tab orders" })).toBeVisible();
});

test("unsaved query text survives a reload", async ({ page }) => {
  await connectToPostgres(page);
  await page.getByRole("tab", { name: "Query", exact: true }).click();

  const editor = page.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.insertText("SELECT 42 AS answer");

  // Give the store write a moment to reach localStorage.
  await expect(page.getByText("SELECT 42 AS answer")).toBeVisible();
  await page.waitForTimeout(300);

  await page.reload();
  await waitForStudio(page);
  await page.getByRole("tab", { name: "Query", exact: true }).click();

  await expect(page.getByText("SELECT 42 AS answer")).toBeVisible({
    timeout: 30_000,
  });
});

test("sidebar width and collapsed state survive a reload", async ({ page }) => {
  await connectToPostgres(page);

  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(page.getByPlaceholder("Filter tables...")).toHaveCount(0);
  await page.waitForTimeout(300);

  await page.reload();
  await waitForStudio(page);

  // Still collapsed.
  await expect(page.getByPlaceholder("Filter tables...")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show sidebar" })).toBeVisible();
});

test("query results are not persisted", async ({ page }) => {
  // Result sets can be thousands of rows; localStorage has a few megabytes.
  await connectToPostgres(page);
  await page.getByRole("tab", { name: "Query", exact: true }).click();

  const editor = page.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.insertText("SELECT email FROM users LIMIT 5");

  const ran = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/query"
  );
  await page.getByRole("button", { name: "Run" }).click();
  await ran;
  await expect(page.getByText("5 rows")).toBeVisible();

  const stored = await page.evaluate(() =>
    window.localStorage.getItem("db-studio-workspace")
  );
  expect(stored).toContain("SELECT email FROM users LIMIT 5");
  expect(stored).not.toContain("user1@example.com");
});

test("tabs from a different connection are not restored", async ({ page }) => {
  await connectToPostgres(page, "First DB");
  await openTable(page, "users");
  await expect(page.getByRole("button", { name: "Close tab users" })).toBeVisible();

  // Disconnect and connect again as a new connection (a fresh id).
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/studio"));

  await connectToPostgres(page, "Second DB");

  // The tab belonged to the previous connection, so it must not come back.
  await expect(page.getByRole("button", { name: "Close tab users" })).toHaveCount(0);
});
