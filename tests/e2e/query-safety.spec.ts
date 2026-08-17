import { test, expect } from "@playwright/test";
import { POSTGRES_URL, resetDatabase, rowCount } from "./helpers/db";
import { connectToPostgres, enableWrites } from "./helpers/app";

/**
 * Confirmation gates on destructive statements, and the production treatment.
 */

test.skip(!POSTGRES_URL, "E2E_POSTGRES_URL is not set");

test.beforeEach(async () => {
  await resetDatabase();
});

/** Type SQL into the editor without running it. */
async function typeQuery(page: import("@playwright/test").Page, sql: string) {
  await page.getByRole("tab", { name: "Query", exact: true }).click();
  const editor = page.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
  await expect(page.getByRole("button", { name: "Run" })).toBeEnabled();
}

test("a SELECT runs without any confirmation", async ({ page }) => {
  await connectToPostgres(page);
  await typeQuery(page, "SELECT count(*) FROM users");

  const ran = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/query"
  );
  await page.getByRole("button", { name: "Run" }).click();
  await ran;

  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Singular — the results header pluralizes.
  await expect(page.getByText("1 row", { exact: true })).toBeVisible();
});

test("an unscoped DELETE demands the verb be typed", async ({ page }) => {
  await connectToPostgres(page);
  await enableWrites(page);
  await typeQuery(page, "DELETE FROM orders");

  await page.getByRole("button", { name: "Run" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Dangerous operation")).toBeVisible();
  await expect(
    dialog.getByText(/No WHERE clause .* deletes every row/)
  ).toBeVisible();

  // The confirm button stays disabled until the verb is typed exactly.
  const confirm = dialog.getByRole("button", { name: "Run DELETE" });
  await expect(confirm).toBeDisabled();

  await dialog.getByLabel(/Type DELETE to confirm/).fill("delete me");
  await expect(confirm).toBeDisabled();

  await dialog.getByLabel(/Type DELETE to confirm/).fill("delete");
  await expect(confirm).toBeEnabled();

  // Nothing has run yet.
  expect(await rowCount("orders")).toBe(300);
});

test("cancelling a dangerous statement leaves the data alone", async ({
  page,
}) => {
  await connectToPostgres(page);
  await enableWrites(page);
  await typeQuery(page, "DELETE FROM orders");

  await page.getByRole("button", { name: "Run" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await rowCount("orders")).toBe(300);
});

test("confirming a dangerous statement runs it", async ({ page }) => {
  await connectToPostgres(page);
  await enableWrites(page);
  await typeQuery(page, "DELETE FROM orders");

  await page.getByRole("button", { name: "Run" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Type DELETE to confirm/).fill("DELETE");

  const ran = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/query"
  );
  await dialog.getByRole("button", { name: "Run DELETE" }).click();
  await ran;

  expect(await rowCount("orders")).toBe(0);
});

test("a scoped DELETE shows an estimated row count", async ({ page }) => {
  await connectToPostgres(page);
  await enableWrites(page);
  await typeQuery(page, "DELETE FROM orders WHERE user_id = 1");

  const analyzed = page.waitForResponse((r) =>
    r.url().includes("/api/query/analyze")
  );
  await page.getByRole("button", { name: "Run" }).click();
  await analyzed;

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Confirm write")).toBeVisible();
  await expect(dialog.getByText(/Estimated rows affected/)).toBeVisible();
  // Presented as approximate — it is a planner estimate, not a count.
  await expect(dialog.getByText(/planner estimate, not an exact count/)).toBeVisible();

  expect(await rowCount("orders")).toBe(300);
});

test("estimating never executes the statement", async ({ page }) => {
  // Plain EXPLAIN plans without running. EXPLAIN ANALYZE would have deleted
  // these rows just to build the preview.
  await connectToPostgres(page);
  await enableWrites(page);
  await typeQuery(page, "DELETE FROM orders");

  const analyzed = page.waitForResponse((r) =>
    r.url().includes("/api/query/analyze")
  );
  await page.getByRole("button", { name: "Run" }).click();
  await analyzed;

  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await rowCount("orders")).toBe(300);
});

test.describe("production connections", () => {
  test("are marked with a persistent stripe and badge", async ({ page }) => {
    await connectToPostgres(page, "Prod DB", "production");

    await expect(page.getByText(/Production — Prod DB/)).toBeVisible();
    await expect(
      page.getByText("Production", { exact: true }).first()
    ).toBeVisible();
  });

  test("require a reason before write access is granted", async ({ page }) => {
    await connectToPostgres(page, "Prod DB", "production");

    await page.locator("#readonly-mode").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("This is a production connection.")).toBeVisible();

    const confirm = dialog.getByRole("button", { name: /^Enable for/ });
    await expect(confirm).toBeDisabled();

    await dialog.getByLabel(/Reason/).fill("fixing a stuck order");
    await expect(confirm).toBeEnabled();
  });

  test("name the environment in the dangerous-statement dialog", async ({
    page,
  }) => {
    await connectToPostgres(page, "Prod DB", "production");
    await enableWrites(page, { reason: "cleanup" });
    await typeQuery(page, "DELETE FROM orders");

    await page.getByRole("button", { name: "Run" }).click();

    await expect(
      page.getByRole("dialog").getByText(/Running against PRODUCTION — Prod DB/)
    ).toBeVisible();
  });

  test("a development connection gets no stripe", async ({ page }) => {
    await connectToPostgres(page, "Dev DB", "development");

    await expect(page.getByText(/Production —/)).toHaveCount(0);
    await expect(
      page.getByText("Development", { exact: true }).first()
    ).toBeVisible();
  });
});

test("write access is granted for a bounded window", async ({ page }) => {
  await connectToPostgres(page);

  await page.locator("#readonly-mode").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const granted = page.waitForResponse(
    (r) => r.url().includes("/api/settings") && r.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: /^Enable for 15 min$/ }).click();
  const response = await granted;

  const body = await response.json();
  expect(body.readOnly).toBe(false);
  expect(body.writeExpiresAt).toBeGreaterThan(Date.now());

  // The header counts the grant down.
  await expect(page.getByText(/writes \d+:\d\d/)).toBeVisible();
});
