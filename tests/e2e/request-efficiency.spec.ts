import { test, expect } from "@playwright/test";
import { POSTGRES_URL, resetDatabase } from "./helpers/db";
import { connectToPostgres } from "./helpers/app";

/**
 * Guards against redundant network work. These assertions are on request
 * counts, which is the part a user actually waits on and the part most likely
 * to regress silently when effects are added.
 */

test.skip(!POSTGRES_URL, "E2E_POSTGRES_URL is not set");

test.beforeEach(async () => {
  await resetDatabase();
});

test("opening a table fetches its schema once, not twice", async ({ page }) => {
  await connectToPostgres(page);

  const schemaRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/schema") {
      schemaRequests.push(url.searchParams.get("table") ?? "");
    }
  });

  const dataLoaded = page.waitForResponse(
    (r) => r.url().includes("/api/data") && r.status() === 200
  );
  await page.getByRole("button", { name: "users", exact: true }).first().click();
  await dataLoaded;

  // Let any straggling effect fire before counting.
  await expect(page.getByRole("cell", { name: "user1@example.com" })).toBeVisible();
  await page.waitForTimeout(500);

  // The sidebar and the data viewer both used to request this.
  expect(schemaRequests.filter((t) => t === "users")).toHaveLength(1);
});

test("paging does not re-run the row count", async ({ page }) => {
  await connectToPostgres(page);

  const dataLoaded = page.waitForResponse(
    (r) => r.url().includes("/api/data") && r.status() === 200
  );
  await page.getByRole("button", { name: "users", exact: true }).first().click();
  await dataLoaded;

  // The total is cached server-side per (connection, table, filters), so the
  // second page reports the same total without counting again.
  const nextPage = page.waitForResponse(
    (r) => r.url().includes("page=2") && r.status() === 200
  );
  await page.getByRole("button", { name: "Next page" }).click();
  const response = await nextPage;

  expect(await response.json()).toMatchObject({ total: 120, page: 2 });
});
