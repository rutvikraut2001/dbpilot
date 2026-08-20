import { test, expect } from "@playwright/test";
import { POSTGRES_URL, resetDatabase } from "./helpers/db";
import { connectToPostgres, runQuery } from "./helpers/app";

test.skip(!POSTGRES_URL, "E2E_POSTGRES_URL is not set");

test.beforeEach(async () => {
  await resetDatabase();
});

test("runs a SELECT and renders the result grid", async ({ page }) => {
  await connectToPostgres(page);

  const status = await runQuery(
    page,
    "SELECT id, email FROM users ORDER BY id LIMIT 3"
  );

  expect(status).toBe(200);
  await expect(page.getByText("3 rows")).toBeVisible();
  await expect(page.getByRole("cell", { name: "user1@example.com" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "user3@example.com" })).toBeVisible();
});

test("reports a syntax error without crashing the editor", async ({ page }) => {
  await connectToPostgres(page);

  await runQuery(page, "SELECT * FROM nonexistent_table_xyz");

  await expect(page.getByText("Error")).toBeVisible();
  await expect(page.getByText(/does not exist/i)).toBeVisible();

  // The editor still works afterwards.
  const status = await runQuery(page, "SELECT 1 AS ok");
  expect(status).toBe(200);
  await expect(page.getByRole("cell", { name: "1" }).first()).toBeVisible();
});

test("a failed query keeps the execution time the server measured", async ({
  page,
}) => {
  // The client used to treat any body carrying `error` as a thrown failure, so a
  // SQL error discarded the structured result: the results header showed no
  // timing and the history entry had no duration, even though the server had
  // reported one.
  await connectToPostgres(page);

  await runQuery(page, "SELECT name FROM orders");

  await expect(page.getByText("Error")).toBeVisible();
  await expect(page.getByText(/does not exist/)).toBeVisible();
  // Timing is rendered alongside the error rather than being dropped.
  await expect(page.getByText(/\d+ms/)).toBeVisible();

  const entry = await page.evaluate(() => {
    const raw = window.localStorage.getItem("db-studio-workspace");
    return raw ? JSON.parse(raw).state.queryHistory[0] : null;
  });

  expect(entry.success).toBe(false);
  expect(entry.error).toContain("does not exist");
  expect(typeof entry.durationMs).toBe("number");
});

test("reports rows returned and execution time", async ({ page }) => {
  await connectToPostgres(page);

  await runQuery(page, "SELECT * FROM users LIMIT 10");

  await expect(page.getByText("10 rows")).toBeVisible();
  await expect(page.getByText(/\d+ms/)).toBeVisible();
});

test("opens additional query tabs", async ({ page }) => {
  await connectToPostgres(page);
  await page.getByRole("tab", { name: "Query", exact: true }).click();

  await expect(page.getByRole("tab", { name: "Query 1" })).toBeVisible();

  await page.getByRole("button", { name: "New query tab" }).click();
  await expect(page.getByRole("tab", { name: "Query 2" })).toBeVisible();

  await page.getByRole("button", { name: "Close Query 2" }).click();
  await expect(page.getByRole("tab", { name: "Query 2" })).toHaveCount(0);
});

test("typing lands in the active query tab, not the one that was open first", async ({
  page,
}) => {
  // Regression test. Monaco's onDidChangeModelContent handler is registered once,
  // when the editor is created, so it used to capture the *first* render's
  // onChange — which closed over the query tab active at that moment. Typing in a
  // second tab therefore wrote into the first one, and the second stayed empty.
  await connectToPostgres(page);
  await page.getByRole("tab", { name: "Query", exact: true }).click();

  const editor = page.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.insertText("SELECT 'in tab one'");

  await page.getByRole("button", { name: "New query tab" }).click();
  await expect(page.getByRole("tab", { name: "Query 2" })).toBeVisible();
  await editor.click();
  await page.keyboard.insertText("SELECT 'in tab two'");

  const tabs = await page.evaluate(() => {
    const raw = window.localStorage.getItem("db-studio-workspace");
    return raw ? JSON.parse(raw).state.queryTabs : [];
  });

  expect(tabs[0].query).toBe("SELECT 'in tab one'");
  expect(tabs[1].query).toBe("SELECT 'in tab two'");
});
