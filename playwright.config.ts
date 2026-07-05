import { defineConfig, devices } from "@playwright/test";

/**
 * Cross-browser matrix for durable-local.
 *
 *  {chromium,firefox,webkit}-lifecycle : open → set → reload → same value,
 *                                        then update, reset, destroy.
 *  {chromium,firefox,webkit}-cross-tab : Tab A commits revision N, Tab B
 *                                        observes revision N. Reconciles
 *                                        against IDB on pageshow (bfcache).
 *  chromium-unsupported                : IDB stubbed away → UNSUPPORTED
 *                                        typed error, describeStorage still
 *                                        reports honestly.
 *
 * There is no memory adapter and no fake-IDB in the e2e matrix; the whole
 * point of these tests is that the real browser IDB behaves like the docs
 * say it does.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  webServer: {
    command:
      "pnpm exec vite --config tests/e2e/fixtures/vite.config.ts --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/lifecycle.html",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium-lifecycle",
      testMatch: /lifecycle\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox-lifecycle",
      testMatch: /lifecycle\.spec\.ts$/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit-lifecycle",
      testMatch: /lifecycle\.spec\.ts$/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "chromium-cross-tab",
      testMatch: /cross-tab\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox-cross-tab",
      testMatch: /cross-tab\.spec\.ts$/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit-cross-tab",
      testMatch: /cross-tab\.spec\.ts$/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "chromium-unsupported",
      testMatch: /unsupported\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
