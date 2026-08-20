import { test, expect } from "@playwright/test";
import { POSTGRES_URL, resetDatabase } from "./helpers/db";
import { connectToPostgres, runQuery } from "./helpers/app";

/**
 * The query workspace: history, saved queries, run-selection, cancellation.
 *
 * History had been recorded in the store since before this phase but was never
 * rendered anywhere, so none of it was reachable.
 */

test.skip(!POSTGRES_URL, "E2E_POSTGRES_URL is not set");

test.beforeEach(async () => {
  await resetDatabase();
});

function openWorkspace(page: import("@playwright/test").Page) {
  return page
    .getByRole("button", { name: "Query history and saved queries" })
    .click();
}

async function typeQuery(page: import("@playwright/test").Page, sql: string) {
  await page.getByRole("tab", { name: "Query", exact: true }).click();
  const editor = page.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}

test("a run appears in history with its timing and row count", async ({
  page,
}) => {
  await connectToPostgres(page);
  await runQuery(page, "SELECT id FROM users LIMIT 3");

  await openWorkspace(page);

  const panel = page.getByRole("dialog");
  await expect(panel.getByText("History (1)")).toBeVisible();
  await expect(panel.getByText("SELECT id FROM users LIMIT 3")).toBeVisible();
  await expect(panel.getByText(/\d+ms/)).toBeVisible();
  await expect(panel.getByText("3 rows")).toBeVisible();
});

test("a failed run is recorded as failed with its error", async ({ page }) => {
  await connectToPostgres(page);
  await runQuery(page, "SELECT * FROM nonexistent_table_xyz");

  await openWorkspace(page);

  const panel = page.getByRole("dialog");
  await expect(panel.getByText(/nonexistent_table_xyz/).first()).toBeVisible();
  await expect(panel.getByText(/does not exist/)).toBeVisible();
});

test("clicking a history entry loads it into the editor", async ({ page }) => {
  await connectToPostgres(page);
  await runQuery(page, "SELECT 123 AS marker");

  // Replace the editor contents so the load is observable.
  await typeQuery(page, "SELECT 999 AS other");

  await openWorkspace(page);
  await page.getByRole("dialog").getByText("SELECT 123 AS marker").click();

  // Panel closes and the editor shows the loaded query.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByTestId("editor").getByText("SELECT 123 AS marker")
  ).toBeVisible();
});

test("history survives a reload", async ({ page }) => {
  await connectToPostgres(page);
  await runQuery(page, "SELECT 7 AS lucky");

  await page.reload();
  await expect(page.getByRole("tab", { name: "Data" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("tab", { name: "Query", exact: true }).click();

  await openWorkspace(page);
  await expect(
    page.getByRole("dialog").getByText("SELECT 7 AS lucky")
  ).toBeVisible();
});

test("clearing history empties the panel", async ({ page }) => {
  await connectToPostgres(page);
  await runQuery(page, "SELECT 1 AS a");

  await openWorkspace(page);
  const panel = page.getByRole("dialog");
  await panel.getByRole("button", { name: "Clear history" }).click();

  await expect(panel.getByText("No queries run yet.")).toBeVisible();
});

test.describe("saved queries", () => {
  test("saving from the toolbar keeps a named query", async ({ page }) => {
    await connectToPostgres(page);
    await typeQuery(page, "SELECT count(*) FROM orders");

    await page.getByRole("button", { name: "Save query" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Save query")).toBeVisible();
    await dialog.getByLabel("Name").fill("Order total");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    await openWorkspace(page);
    const panel = page.getByRole("dialog");
    await panel.getByRole("tab", { name: /^Saved/ }).click();
    await expect(panel.getByText("Order total")).toBeVisible();
  });

  test("a saved query loads back into the editor", async ({ page }) => {
    await connectToPostgres(page);
    await typeQuery(page, "SELECT count(*) FROM orders");
    await page.getByRole("button", { name: "Save query" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("Order total");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save", exact: true })
      .click();

    await typeQuery(page, "SELECT 0 AS replaced");

    await openWorkspace(page);
    const panel = page.getByRole("dialog");
    await panel.getByRole("tab", { name: /^Saved/ }).click();
    await panel.getByText("Order total").click();

    await expect(
      page.getByTestId("editor").getByText("SELECT count(*) FROM orders")
    ).toBeVisible();
  });

  test("a saved query can be deleted", async ({ page }) => {
    await connectToPostgres(page);
    await typeQuery(page, "SELECT 1 AS keeper");
    await page.getByRole("button", { name: "Save query" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("Keeper");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save", exact: true })
      .click();

    await openWorkspace(page);
    const panel = page.getByRole("dialog");
    await panel.getByRole("tab", { name: /^Saved/ }).click();
    await panel.getByRole("button", { name: "Delete Keeper" }).click();

    await expect(panel.getByText(/Nothing saved yet/)).toBeVisible();
  });
});

test("running a selection executes only the highlighted text", async ({
  page,
}) => {
  await connectToPostgres(page);
  await typeQuery(page, "SELECT 1 AS first;\nSELECT 2 AS second;");

  // Select just the first line.
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Shift+End");

  await expect(page.getByRole("button", { name: "Run selection" })).toBeVisible();

  const ran = page.waitForRequest(
    (r) => new URL(r.url()).pathname === "/api/query"
  );
  await page.getByRole("button", { name: "Run selection" }).click();
  const request = await ran;

  const body = request.postDataJSON();
  expect(body.query).toContain("first");
  expect(body.query).not.toContain("second");
});

test("a result from a selection says so", async ({ page }) => {
  // Running a fragment can return a valid answer to a query the user did not
  // think they ran — `select * from "User"` truncated to `select * from User`
  // resolves the USER keyword and returns the current role. The result must say
  // that only the selection ran.
  await connectToPostgres(page);
  await typeQuery(page, "SELECT 1 AS first;\nSELECT 2 AS second;");

  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Shift+End");

  const ran = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/query"
  );
  await page.getByRole("button", { name: "Run selection" }).click();
  await ran;

  await expect(page.getByText("Ran selection only")).toBeVisible();
});

test("a result from the whole editor does not claim it was a selection", async ({
  page,
}) => {
  await connectToPostgres(page);
  await runQuery(page, "SELECT 1 AS only");

  await expect(page.getByText("1 row", { exact: true })).toBeVisible();
  await expect(page.getByText("Ran selection only")).toHaveCount(0);
});

test("a long-running query can be cancelled", async ({ page }) => {
  await connectToPostgres(page);
  await typeQuery(page, "SELECT pg_sleep(20)");

  await page.getByRole("button", { name: "Run" }).click();

  // The Run button becomes Cancel while a run is in flight.
  const cancel = page.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeVisible();

  const cancelled = page.waitForResponse((r) =>
    r.url().includes("/api/query/cancel")
  );
  await cancel.click();
  expect((await cancelled).status()).toBe(200);

  // The query comes back as cancelled, well inside the 20s it asked for.
  await expect(page.getByText(/cancel/i).first()).toBeVisible({
    timeout: 15_000,
  });
});
