import { Page, expect } from "@playwright/test";
import { POSTGRES_URL } from "./db";

/**
 * Drive the connection form and land in the studio.
 *
 * Goes through the real UI rather than seeding localStorage, because the
 * connect → reconnect → read-only handshake is exactly what the specs need to
 * exercise.
 */
export async function connectToPostgres(
  page: Page,
  name = "E2E Postgres",
  environment?: "development" | "staging" | "production"
): Promise<void> {
  await page.goto("/");

  await page.locator("#connection-name").fill(name);
  await page.locator("#connection-string").fill(POSTGRES_URL!);

  if (environment) {
    await page.locator("#environment").click();
    await page
      .getByRole("option", {
        name: environment.charAt(0).toUpperCase() + environment.slice(1),
      })
      .click();
  }

  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await page.waitForURL("**/studio", { timeout: 30_000 });
  await expect(page.getByRole("tab", { name: "Data" })).toBeVisible({
    timeout: 30_000,
  });
}

/** The read-only switch in the studio header. */
export function readOnlySwitch(page: Page) {
  return page.locator("#readonly-mode");
}

/**
 * Flip read-only off and wait for the server to confirm.
 *
 * Enabling writes goes through a dialog that time-boxes the grant, so this walks
 * that dialog rather than just clicking the switch.
 */
export async function enableWrites(
  page: Page,
  options: { reason?: string } = {}
): Promise<void> {
  await readOnlySwitch(page).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  if (options.reason) {
    await dialog.getByLabel(/Reason/).fill(options.reason);
  }

  const settingsResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/settings") &&
      response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: /^Enable for/ }).click();
  await settingsResponse;

  await expect(readOnlySwitch(page)).toHaveAttribute("data-state", "unchecked");
}

/** Turn read-only back on. Immediate — no dialog. */
export async function disableWrites(page: Page): Promise<void> {
  const settingsResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/settings") &&
      response.request().method() === "POST"
  );
  await readOnlySwitch(page).click();
  await settingsResponse;
  await expect(readOnlySwitch(page)).toHaveAttribute("data-state", "checked");
}

/** Open a table from the sidebar and wait for its rows to load. */
export async function openTable(page: Page, table: string): Promise<void> {
  const dataResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/data") && response.status() === 200
  );
  await page.getByRole("button", { name: table, exact: true }).first().click();
  await dataResponse;
}

/** Run a query in the Query tab and wait for the response. */
export async function runQuery(
  page: Page,
  sql: string
): Promise<number> {
  // exact, or it also matches the per-query sub-tabs ("Query 1", "Query 2").
  await page.getByRole("tab", { name: "Query", exact: true }).click();

  const editor = page.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();

  // insertText inserts the whole string as one input event, the way a paste
  // does. keyboard.type() would be slow and would trip Monaco's auto-closing
  // quotes and brackets, rewriting the SQL as it goes.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);

  await expect(page.getByRole("button", { name: "Run" })).toBeEnabled();

  // Must not match /api/query/analyze, which is a different request.
  const queryResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/query"
  );
  await page.getByRole("button", { name: "Run" }).click();
  await confirmIfGated(page);
  return (await queryResponse).status();
}

/**
 * Clear the destructive-statement confirmation if it appears.
 *
 * Writes are gated once write access is enabled, so a helper that just clicks
 * Run would hang waiting for a request the dialog is holding back. Read-only
 * mode skips the gate, in which case there is nothing to dismiss.
 */
async function confirmIfGated(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");

  const appeared = await dialog
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;

  // A "dangerous" statement requires the verb typed out; the placeholder is the
  // word it wants.
  const verbInput = dialog.locator("#confirm-verb");
  if (await verbInput.count()) {
    const required = await verbInput.getAttribute("placeholder");
    await verbInput.fill(required ?? "");
  }

  await dialog.getByRole("button", { name: /^Run/ }).click();
}
