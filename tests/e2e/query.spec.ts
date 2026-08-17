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
