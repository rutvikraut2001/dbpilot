import { test, expect } from "@playwright/test";
import { POSTGRES_URL, resetDatabase } from "./helpers/db";
import { connectToPostgres, openTable, runQuery } from "./helpers/app";

/**
 * Failures must be visible and recoverable.
 *
 * Every case here previously produced either a blank panel or a message that
 * actively misled — "No data found" / "No tables found" for a request that had
 * failed outright.
 */

test.skip(!POSTGRES_URL, "E2E_POSTGRES_URL is not set");

test.beforeEach(async () => {
  await resetDatabase();
});

test("a failed row load says so and offers a retry", async ({ page }) => {
  await connectToPostgres(page);

  // Fail the next data request.
  await page.route("**/api/data?*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "relation does not exist" }),
    })
  );

  await page.getByRole("button", { name: "users", exact: true }).first().click();

  await expect(page.getByText("Could not load rows")).toBeVisible();
  await expect(page.getByText("relation does not exist")).toBeVisible();
  // Crucially, NOT the empty-table message.
  await expect(page.getByText("This table is empty")).toHaveCount(0);

  // Retry works once the failure clears.
  await page.unroute("**/api/data?*");
  const reloaded = page.waitForResponse(
    (r) => r.url().includes("/api/data") && r.status() === 200
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await reloaded;

  await expect(page.getByRole("cell", { name: "user1@example.com" })).toBeVisible();
});

test("an empty table reads as empty, not as an error", async ({ page }) => {
  await connectToPostgres(page);
  await openTable(page, "users");

  // Empty the table out from under the UI, then refresh.
  const { queryScalar } = await import("./helpers/db");
  await queryScalar("DELETE FROM orders RETURNING 1");
  await queryScalar("DELETE FROM users RETURNING 1");

  const refreshed = page.waitForResponse(
    (r) => r.url().includes("/api/data") && r.status() === 200
  );
  // exact, or this also matches the sidebar's "Refresh tables" control.
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await refreshed;

  await expect(page.getByText("This table is empty")).toBeVisible();
  await expect(page.getByText("Could not load rows")).toHaveCount(0);
});

test("a failed table list says so and offers a retry", async ({ page }) => {
  await page.route("**/api/tables?*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "permission denied for schema public" }),
    })
  );

  await connectToPostgres(page);

  await expect(page.getByText("Could not load tables")).toBeVisible();
  await expect(page.getByText("permission denied for schema public")).toBeVisible();
  // Was previously indistinguishable from an empty database.
  await expect(page.getByText("No tables found")).toHaveCount(0);

  await page.unroute("**/api/tables?*");
  const reloaded = page.waitForResponse(
    (r) => r.url().includes("/api/tables") && r.status() === 200
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await reloaded;

  await expect(page.getByRole("button", { name: "users", exact: true })).toBeVisible();
});

test("a rate-limited request explains itself", async ({ page }) => {
  await connectToPostgres(page);

  await page.route("**/api/data?*", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "Retry-After": "60" },
      body: JSON.stringify({ error: "Too many requests." }),
    })
  );

  await page.getByRole("button", { name: "users", exact: true }).first().click();

  await expect(page.getByText("Could not load rows")).toBeVisible();
  await expect(page.getByText(/Too many requests.*Retry in 60s/)).toBeVisible();
});

test("an unreachable server is reported, not swallowed", async ({ page }) => {
  await connectToPostgres(page);

  await page.route("**/api/data?*", (route) => route.abort("failed"));

  await page.getByRole("button", { name: "users", exact: true }).first().click();

  await expect(page.getByText("Could not load rows")).toBeVisible();
  await expect(page.getByText(/Could not reach the server/)).toBeVisible();
});

test("a rate-limited query reports the limit rather than a generic failure", async ({
  page,
}) => {
  await connectToPostgres(page);

  await page.route("**/api/query", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "Retry-After": "30" },
      body: JSON.stringify({ error: "Too many requests." }),
    })
  );

  await runQuery(page, "SELECT 1");

  await expect(page.getByText(/Too many requests.*Retry in 30s/)).toBeVisible();
  await expect(page.getByText("Failed to execute query")).toHaveCount(0);
});
