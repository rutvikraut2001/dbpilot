import { test, expect } from "@playwright/test";
import { POSTGRES_URL, resetDatabase, queryScalar, rowCount } from "./helpers/db";
import { connectToPostgres, enableWrites, openTable } from "./helpers/app";

test.skip(!POSTGRES_URL, "E2E_POSTGRES_URL is not set");

test.beforeEach(async () => {
  await resetDatabase();
});

test("paginates through a table", async ({ page }) => {
  await connectToPostgres(page);
  await openTable(page, "users");

  await expect(page.getByRole("cell", { name: "user1@example.com" })).toBeVisible();
  await expect(page.getByText("Page 1")).toBeVisible();

  const nextPage = page.waitForResponse(
    (r) => r.url().includes("/api/data") && r.status() === 200
  );
  await page.getByRole("button", { name: "Next page" }).click();
  await nextPage;

  // 120 rows at the default page size of 50 → page 2 starts at user51.
  await expect(page.getByRole("cell", { name: "user51@example.com" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "user1@example.com" })
  ).toHaveCount(0);
});

test("sorts by a column", async ({ page }) => {
  await connectToPostgres(page);
  await openTable(page, "users");

  const sorted = page.waitForResponse(
    (r) => r.url().includes("sortBy=id") && r.status() === 200
  );
  await page.getByRole("button", { name: "id", exact: true }).click();
  await sorted;

  // First click sorts ascending; sort again for descending.
  const descending = page.waitForResponse(
    (r) => r.url().includes("sortOrder=desc") && r.status() === 200
  );
  await page.getByRole("button", { name: "id", exact: true }).click();
  await descending;

  await expect(page.getByRole("cell", { name: "user120@example.com" })).toBeVisible();
});

test("following a foreign key opens a filtered tab", async ({ page }) => {
  await connectToPostgres(page);
  await openTable(page, "orders");

  // orders.user_id is a FK to users.id; the cell renders a follow button.
  const filtered = page.waitForResponse(
    (r) => r.url().includes("filters=") && r.status() === 200
  );
  await page.getByRole("button", { name: /^Open users where id = / }).first().click();
  await filtered;

  // A second data tab opens, scoped to the referenced row. The badge names the
  // referenced column (users.id), not the referencing one.
  await expect(page.getByRole("button", { name: /^users id=\d+$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "users" })).toBeVisible();
  await expect(page.getByText("1 rows")).toBeVisible();
});

test("editing a row through the UI persists to the database", async ({ page }) => {
  await connectToPostgres(page);
  await enableWrites(page);
  await openTable(page, "users");

  await page.getByRole("button", { name: "Edit row" }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("name", { exact: true }).fill("Edited By E2E");

  const saved = page.waitForResponse(
    (r) => r.url().includes("/api/data") && r.request().method() === "PUT"
  );
  await dialog.getByRole("button", { name: "Save Changes" }).click();
  await saved;

  expect(await queryScalar("SELECT name FROM users WHERE id = 1")).toBe(
    "Edited By E2E"
  );
});

test("deleting a row through the UI removes it from the database", async ({
  page,
}) => {
  await connectToPostgres(page);
  await enableWrites(page);
  await openTable(page, "users");

  await page.getByRole("button", { name: "Delete row" }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const deleted = page.waitForResponse(
    (r) => r.url().includes("/api/data") && r.request().method() === "DELETE"
  );
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await deleted;

  expect(await rowCount("users")).toBe(119);
});
