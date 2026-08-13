import { test, expect } from "@playwright/test";
import { POSTGRES_URL, resetDatabase } from "./helpers/db";
import { connectToPostgres, openTable } from "./helpers/app";

test.skip(!POSTGRES_URL, "E2E_POSTGRES_URL is not set");

test.beforeAll(async () => {
  await resetDatabase();
});

test("connects to PostgreSQL and lists the schema", async ({ page }) => {
  await connectToPostgres(page);

  // Sidebar shows the fixture tables and the view.
  await expect(page.getByRole("button", { name: "users", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "orders", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "active_users", exact: true })
  ).toBeVisible();
});

test("filtering the sidebar narrows the table list", async ({ page }) => {
  await connectToPostgres(page);

  await page.getByPlaceholder("Filter tables...").fill("order");

  await expect(page.getByRole("button", { name: "orders", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "users", exact: true })
  ).toHaveCount(0);
});

test("opening a table shows its rows", async ({ page }) => {
  await connectToPostgres(page);
  await openTable(page, "users");

  await expect(page.getByRole("cell", { name: "user1@example.com" })).toBeVisible();
  // Fixture has 120 users; the toolbar reports the total.
  await expect(page.getByText(/120/).first()).toBeVisible();
});

test("disconnecting returns to the connection screen", async ({ page }) => {
  await connectToPostgres(page);

  await page.getByRole("button", { name: "Disconnect" }).click();

  await page.waitForURL((url) => !url.pathname.startsWith("/studio"));
  await expect(page.locator("#connection-string")).toBeVisible();
});
