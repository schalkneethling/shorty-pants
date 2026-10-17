import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { startRecorderServer, type RecorderServer } from "../../src/recorder/server.ts";

// The built pages; the test:e2e script builds them before Playwright runs.
const webRoot = resolve(import.meta.dirname, "..", "..", "dist-web");

let workspace: string;
let shortFolder: string;
let server: RecorderServer;

test.beforeEach(async () => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "shorty-pants-e2e-")));
  shortFolder = join(workspace, "2026-10-17-anchor-scroll");
  server = await startRecorderServer({
    shortFolder,
    webRoot,
    token: "e2e-token-0123456789",
    now: () => new Date("2026-10-17T13:45:00.000Z"),
  });
});

test.afterEach(async () => {
  await server.close();
  rmSync(workspace, { recursive: true, force: true });
});

test("shows the three beats and has no accessibility violations", async ({ page }) => {
  await page.goto(server.url);

  await expect(page.getByRole("heading", { level: 1, name: "Record a short" })).toBeVisible();
  const beats = page.getByRole("region", { name: "Three beats" }).getByRole("listitem");
  await expect(beats).toHaveText(["What surprised me", "Show it", "Why it happens"]);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("has no accessibility violations in the dark color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(server.url);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("starts with only the camera and window buttons available", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.getByRole("button", { name: "Turn on camera" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Choose window" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Start recording" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Stop" })).toBeDisabled();
});

test("records the camera and one window as two tracks and saves the take", async ({ page }) => {
  await page.goto(server.url);

  await page.getByRole("button", { name: "Turn on camera" }).click();
  await page.getByRole("button", { name: "Choose window" }).click();
  const record = page.getByRole("button", { name: "Start recording" });
  await expect(record).toBeEnabled();

  await record.click();
  await expect(page.getByRole("status")).toContainText("Recording");
  await expect(page.locator("#elapsed")).toHaveText("0:02", { timeout: 10_000 });
  await page.getByRole("button", { name: "Stop" }).click();

  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 15_000 });
  const takes = await server.saved;

  expect(Number.isInteger(takes.takes.screenOffsetMs)).toBe(true);
  expect(statSync(join(shortFolder, "takes", "cam.webm")).size).toBeGreaterThan(0);
  expect(statSync(join(shortFolder, "takes", "screen.webm")).size).toBeGreaterThan(0);
  const written = JSON.parse(readFileSync(join(shortFolder, "takes.json"), "utf8"));
  expect(written).toEqual(takes);

  if (process.env.KEEP_E2E_TAKES !== undefined) {
    cpSync(shortFolder, process.env.KEEP_E2E_TAKES, { recursive: true });
  }
});

test("explains the problem when the page is opened without its session token", async ({ page }) => {
  await page.goto(server.url.replace(/#.*$/, ""));
  await expect(page.getByRole("status")).toContainText("Open the recorder with short record");
  await expect(page.getByRole("button", { name: "Turn on camera" })).toBeDisabled();
});

test("explains a failed upload and lets the take be recorded again", async ({ page }) => {
  let failNextUpload = true;
  await page.route("**/api/takes/cam", async (route) => {
    if (failNextUpload) {
      failNextUpload = false;
      await route.fulfill({ status: 500, body: "Disk full." });
      return;
    }
    await route.continue();
  });

  await page.goto(server.url);
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await page.getByRole("button", { name: "Choose window" }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.locator("#elapsed")).toHaveText("0:01", { timeout: 10_000 });
  await page.getByRole("button", { name: "Stop" }).click();

  await expect(page.getByRole("status")).toContainText(
    "The take could not be saved. The server refused the camera track. Disk full.",
  );
  const record = page.getByRole("button", { name: "Start recording" });
  await expect(record).toBeEnabled();

  await record.click();
  await expect(page.locator("#elapsed")).toHaveText("0:01", { timeout: 10_000 });
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 15_000 });
});
