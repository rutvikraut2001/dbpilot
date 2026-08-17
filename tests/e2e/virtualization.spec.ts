import { test, expect } from "@playwright/test";
import { POSTGRES_URL, resetDatabase } from "./helpers/db";
import { connectToPostgres, openTable, runQuery } from "./helpers/app";

/**
 * Pins the virtualization contract: the number of rows in the DOM stays bounded
 * regardless of how many rows the result contains.
 *
 * Without this, a regression that reverts to rendering every row would still
 * pass every other test — just slowly enough to make the app unusable on real
 * data — so the assertion is on mounted row count, not on timing.
 */

test.skip(!POSTGRES_URL, "E2E_POSTGRES_URL is not set");

/** Rows actually mounted in the results/data table, excluding spacer rows. */
async function mountedRowCount(page: import("@playwright/test").Page) {
  return page.locator("tbody tr:not([aria-hidden='true'])").count();
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("a 5000-row query result mounts only a small window of rows", async ({
  page,
}) => {
  await connectToPostgres(page);

  const status = await runQuery(
    page,
    "SELECT i AS id, 'row ' || i AS label FROM generate_series(1, 5000) AS i"
  );
  expect(status).toBe(200);

  await expect(page.getByText("5000 rows")).toBeVisible();
  await expect(page.getByRole("cell", { name: "row 1", exact: true })).toBeVisible();

  // The window is sized to the viewport plus overscan — nowhere near 5000.
  const mounted = await mountedRowCount(page);
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(200);
});

test("scrolling the results renders later rows without growing the DOM", async ({
  page,
}) => {
  await connectToPostgres(page);

  await runQuery(
    page,
    "SELECT i AS id, 'row ' || i AS label FROM generate_series(1, 5000) AS i"
  );
  await expect(page.getByRole("cell", { name: "row 1", exact: true })).toBeVisible();

  const before = await mountedRowCount(page);

  // Scroll the results a long way down by wheeling over them, so the test
  // doesn't depend on which element happens to be the scroll container.
  await page.getByRole("cell", { name: "row 1", exact: true }).hover();
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 4000);
  }

  await expect(
    page.getByRole("cell", { name: "row 1", exact: true })
  ).toHaveCount(0);

  const after = await mountedRowCount(page);
  expect(after).toBeLessThan(200);
  expect(Math.abs(after - before)).toBeLessThan(60);
});

test("a 500-row data page mounts only a small window of rows", async ({
  page,
}) => {
  await connectToPostgres(page);
  await openTable(page, "users");

  // Raise the page size to the API ceiling.
  const resized = page.waitForResponse(
    (r) => r.url().includes("pageSize=500") && r.status() === 200
  );
  await page.getByRole("combobox").last().click();
  await page.getByRole("option", { name: "500" }).click();
  await resized;

  // The fixture has 120 users, so all of them are on one page now.
  await expect(page.getByText("Page 1")).toBeVisible();

  const mounted = await mountedRowCount(page);
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(120);
});
