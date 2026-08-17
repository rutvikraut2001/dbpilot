import { test, expect } from "@playwright/test";
import { POSTGRES_URL, resetDatabase, rowCount } from "./helpers/db";
import { connectToPostgres, enableWrites, openTable } from "./helpers/app";

test.skip(!POSTGRES_URL, "E2E_POSTGRES_URL is not set");

test.beforeEach(async () => {
  await resetDatabase();
});

test("deletes selected rows in a single request", async ({ page }) => {
  await connectToPostgres(page);
  await enableWrites(page);
  await openTable(page, "users");

  // Select three rows.
  const checkboxes = page.getByRole("checkbox", { name: "Select row" });
  for (let i = 0; i < 3; i++) {
    await checkboxes.nth(i).check();
  }

  await expect(page.getByRole("button", { name: "Delete (3)" })).toBeVisible();

  // The whole selection must go out as one request, not one per row — that
  // serial-loop behaviour is what this replaced.
  const bulkRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/data")) {
      bulkRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });

  await page.getByRole("button", { name: "Delete (3)" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const deleted = page.waitForResponse((r) =>
    r.url().includes("/api/data/bulk")
  );
  await dialog.getByRole("button", { name: /^Delete 3 rows$/ }).click();
  const response = await deleted;

  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    success: true,
    deleted: 3,
    failed: 0,
  });

  expect(await rowCount("users")).toBe(117);

  // Exactly one bulk call; no per-row DELETEs.
  expect(bulkRequests.filter((r) => r.includes("/api/data/bulk"))).toHaveLength(1);
  expect(bulkRequests.filter((r) => r.startsWith("DELETE"))).toHaveLength(0);
});

test("selecting the whole page deletes every row on it", async ({ page }) => {
  await connectToPostgres(page);
  await enableWrites(page);
  await openTable(page, "users");

  await page.getByRole("checkbox", { name: "Select all rows on page" }).check();

  const deleted = page.waitForResponse((r) =>
    r.url().includes("/api/data/bulk")
  );
  await page.getByRole("button", { name: /^Delete \(\d+\)$/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Delete \d+ rows$/ })
    .click();
  const response = await deleted;

  expect(response.status()).toBe(200);
  // Default page size is 50, so one page of the 120-row fixture.
  expect(await rowCount("users")).toBe(70);
});

test("bulk delete is refused in read-only mode", async ({ page }) => {
  await connectToPostgres(page);
  await openTable(page, "users");

  // Read-only hides row selection entirely, so there is nothing to bulk delete.
  await expect(
    page.getByRole("checkbox", { name: "Select row" })
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Delete \(/ })).toHaveCount(0);
  expect(await rowCount("users")).toBe(120);
});
