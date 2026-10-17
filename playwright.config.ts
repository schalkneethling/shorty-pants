import { defineConfig, devices } from "@playwright/test";

// The recorder and editor need Chromium's media capture APIs, so Chromium is
// the only browser for now.
export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
