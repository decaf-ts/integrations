import { defineConfig } from "@playwright/test";

/**
 * Playwright config for BI dashboard embed plugin e2e tests.
 *
 * Tests live in the current directory and are matched by `*.e2e.test.ts`.
 * Each test file manages its own Docker lifecycle (build, up, down) via the
 * shared helpers in `helpers.ts`.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.e2e\.test\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report" }]],
  use: {
    trace: "on-first-retry",
    video: "on",
    screenshot: "on",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        channel: "chromium",
        launchOptions: {
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
      },
    },
  ],
});
