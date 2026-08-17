import { defineConfig, devices } from "@playwright/test";

/**
 * E2E configuration.
 *
 * Requires a PostgreSQL fixture database. Locally:
 *   docker compose --profile with-db up -d postgres
 *   E2E_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/testdb npm run test:e2e
 *
 * The app is built and served in production mode rather than dev, so tests
 * exercise the same bundle that ships and don't race Next's on-demand
 * compilation on first hit.
 */
const PORT = Number(process.env.E2E_PORT ?? 3123);

export default defineConfig({
  testDir: "./tests/e2e",
  // Each spec drives a stateful server-side connection cache, so keep them
  // sequential rather than fighting over shared adapter state.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      // The API rate limiter keys on client IP, and the whole suite arrives from
      // one address. At the default 100 req/min it trips partway through and
      // later specs fail at connect with a 429 that the UI reports only as
      // "Redirecting...". Raise it so the suite tests the app, not the limiter.
      RATE_LIMIT_MAX_REQUESTS: "1000000",
    },
  },
});
