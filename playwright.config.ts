import { defineConfig, devices } from "@playwright/test";

// The recorder needs Chromium's media capture APIs, so Chromium is the only
// browser. Fake devices stand in for the camera, the microphone and the
// shared window, and the permission prompts are accepted automatically.
const fakeMediaArguments = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--auto-select-desktop-capture-source=Entire screen",
];

export default defineConfig({
  testDir: "tests/e2e",
  // The overlay snapshots come from the bundled font and the same Chromium on
  // every platform, so one set of images serves them all.
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFileName}/{arg}{ext}",
  forbidOnly: Boolean(process.env.CI),
  // Recording encodes video in software. Tests running side by side compete
  // for the CPU and can starve the encoder, so they run one at a time.
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: fakeMediaArguments,
          // Lets a machine with a preinstalled Chromium of another version run the tests.
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
        },
      },
    },
  ],
});
