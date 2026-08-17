import { test, expect } from "@playwright/test";
import { POSTGRES_URL, resetDatabase, rowCount, queryScalar } from "./helpers/db";
import {
  connectToPostgres,
  disableWrites,
  enableWrites,
  openTable,
  readOnlySwitch,
  runQuery,
} from "./helpers/app";

/**
 * The read-only guarantees, exercised through the browser.
 *
 * The API-level proofs live in tests/integration; these cover the part that was
 * actually broken — the UI and the server disagreeing about who may write.
 */

test.skip(!POSTGRES_URL, "E2E_POSTGRES_URL is not set");

test.beforeEach(async () => {
  await resetDatabase();
});

test("a new connection opens read-only", async ({ page }) => {
  await connectToPostgres(page);

  await expect(readOnlySwitch(page)).toHaveAttribute("data-state", "checked");

  await openTable(page, "users");
  await expect(page.getByRole("button", { name: "Edit row" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete row" })).toHaveCount(0);
});

test("enabling writes reveals the row actions", async ({ page }) => {
  await connectToPostgres(page);
  await enableWrites(page);
  await openTable(page, "users");

  expect(await page.getByRole("button", { name: "Edit row" }).count()).toBeGreaterThan(0);
});

test("read-only refuses a write query and surfaces the error", async ({ page }) => {
  await connectToPostgres(page);

  const status = await runQuery(page, "DELETE FROM users");

  expect(status).toBe(403);
  await expect(page.getByText(/not allowed in read-only mode/i)).toBeVisible();
  expect(await rowCount("users")).toBe(120);
});

test("read-only refuses a write smuggled after a SELECT", async ({ page }) => {
  await connectToPostgres(page);

  const status = await runQuery(page, "SELECT 1; DROP TABLE users;");

  expect(status).toBe(403);
  expect(await rowCount("users")).toBe(120);
});

test("a write succeeds once writes are enabled", async ({ page }) => {
  await connectToPostgres(page);
  await enableWrites(page);

  const status = await runQuery(
    page,
    "UPDATE users SET name = 'renamed' WHERE id = 1"
  );

  expect(status).toBe(200);
  expect(await queryScalar("SELECT name FROM users WHERE id = 1")).toBe("renamed");
});

test.describe("state survives a reload without the UI and server disagreeing", () => {
  test("write access is preserved across a reload", async ({ page }) => {
    await connectToPostgres(page);
    await enableWrites(page);

    await page.reload();
    await expect(page.getByRole("tab", { name: "Data" })).toBeVisible({
      timeout: 30_000,
    });

    // The switch must still read "writes enabled"...
    await expect(readOnlySwitch(page)).toHaveAttribute("data-state", "unchecked");

    // ...and the server must actually agree.
    const status = await runQuery(
      page,
      "UPDATE users SET name = 'after-reload' WHERE id = 2"
    );
    expect(status).toBe(200);
    expect(await queryScalar("SELECT name FROM users WHERE id = 2")).toBe(
      "after-reload"
    );
  });

  test("read-only is preserved across a reload", async ({ page }) => {
    // The original defect: enabling read-only, then reloading, left the shield
    // showing in the header while the server had quietly re-enabled writes.
    await connectToPostgres(page);
    await enableWrites(page);

    // Turn read-only back on (immediate — only enabling writes is gated).
    await disableWrites(page);

    await page.reload();
    await expect(page.getByRole("tab", { name: "Data" })).toBeVisible({
      timeout: 30_000,
    });

    await expect(readOnlySwitch(page)).toHaveAttribute("data-state", "checked");

    const status = await runQuery(page, "DELETE FROM users WHERE id = 3");
    expect(status).toBe(403);
    expect(await rowCount("users")).toBe(120);
  });
});
