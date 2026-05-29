import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration.
 * Targets the Vite dev server (port 4731) for browser-based tests.
 * Note: Full Tauri integration tests require the Tauri test driver
 * (see https://tauri.app/v2/guides/testing/webdriver/).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { outputFolder: "e2e-report" }], ["list"]],

  use: {
    baseURL: "http://localhost:4731",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Start Vite dev server before running tests
  webServer: {
    command: "bun run dev",
    url: "http://localhost:4731",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
