import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { startEditorServer, type EditorServer } from "../../src/editor/server.ts";
import { createShortProject } from "../../src/edit/short-project-defaults.ts";
import { defaultPreset } from "../../src/schemas/preset.ts";

// The built pages; the test:e2e script builds them before Playwright runs.
const webRoot = resolve(import.meta.dirname, "..", "..", "dist-web");
const mediaFixtures = resolve(import.meta.dirname, "..", "fixtures", "media");

const recordedTakes = {
  version: 1 as const,
  recordedAt: "2026-10-17T13:45:00.000Z",
  takes: { cam: "takes/cam.webm", screen: "takes/screen.webm", screenOffsetMs: 40 },
};

// The 800 ms gap after "ignores" is a pause that the default threshold cuts.
const transcript = {
  version: 1 as const,
  model: "ggml-small.en.bin",
  language: "en",
  durationMs: 4000,
  words: [
    { text: "Anchor", startMs: 300, endMs: 700 },
    { text: "positioning", startMs: 800, endMs: 1300 },
    { text: "ignores", startMs: 1400, endMs: 1800 },
    { text: "the", startMs: 2600, endMs: 2800 },
    { text: "scroll", startMs: 2900, endMs: 3400 },
  ],
};

let workspace: string;
let shortFolder: string;
let server: EditorServer;

function savedShort() {
  return JSON.parse(readFileSync(join(shortFolder, "short.json"), "utf8"));
}

function words(page: Page) {
  return page.getByRole("group", { name: "Transcript" }).getByRole("button");
}

async function openEditor(page: Page) {
  await page.goto(server.url);
  await expect(words(page)).toHaveCount(transcript.words.length);
}

test.beforeEach(async () => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "shorty-pants-editor-e2e-")));
  shortFolder = join(workspace, "2026-10-17-anchor-scroll");
  mkdirSync(join(shortFolder, "takes"), { recursive: true });
  for (const track of ["cam", "screen"]) {
    copyFileSync(join(mediaFixtures, `${track}.webm`), join(shortFolder, "takes", `${track}.webm`));
    copyFileSync(
      join(mediaFixtures, `${track}.webm`),
      join(shortFolder, "takes", `${track}.preview.webm`),
    );
  }
  writeFileSync(join(shortFolder, "takes.json"), JSON.stringify(recordedTakes));
  writeFileSync(join(shortFolder, "transcript.json"), JSON.stringify(transcript));
  writeFileSync(
    join(shortFolder, "short.json"),
    JSON.stringify(createShortProject({ recordedTakes, transcript, preset: defaultPreset })),
  );
  server = await startEditorServer({ shortFolder, webRoot, token: "editor-e2e-token-0123" });
});

test.afterEach(async () => {
  await server.close();
  rmSync(workspace, { recursive: true, force: true });
});

test("shows the transcript as words and has no accessibility violations", async ({ page }) => {
  await openEditor(page);
  await expect(page.getByRole("heading", { level: 1, name: "Edit the short" })).toBeVisible();
  await expect(words(page)).toHaveText(transcript.words.map((word) => word.text));

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("has no accessibility violations in the dark color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openEditor(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("cuts a selected word with Delete and brings it back with Delete", async ({ page }) => {
  await openEditor(page);
  const word = words(page).nth(1);

  await word.click();
  await expect(word).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Delete");
  await expect(word).toHaveAccessibleName("positioning (cut)");
  await expect(page.getByRole("status")).toHaveText("Saved.");
  expect(savedShort().removedWords).toEqual([[1, 1]]);

  await page.keyboard.press("Delete");
  await expect(word).toHaveAccessibleName("positioning");
  await expect.poll(() => savedShort().removedWords).toEqual([]);
});

test("moves between words with the arrow keys and extends the selection with Shift", async ({
  page,
}) => {
  await openEditor(page);
  await words(page).first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(words(page).nth(1)).toBeFocused();

  await page.keyboard.press("Space");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(words(page).nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(words(page).nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(words(page).nth(2)).toBeFocused();

  await page.keyboard.press("Backspace");
  await expect.poll(() => savedShort().removedWords).toEqual([[1, 2]]);
});

test("keeps only one word in the tab order", async ({ page }) => {
  await openEditor(page);
  const tabStops = await words(page).evaluateAll(
    (buttons) => buttons.filter((button) => button.tabIndex === 0).length,
  );
  expect(tabStops).toBe(1);
});

test("moves the trim handles with the keyboard and saves them", async ({ page }) => {
  await openEditor(page);
  const trimStart = page.getByRole("slider", { name: "Trim start" });
  await expect(trimStart).toHaveValue("200");

  await trimStart.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(trimStart).toHaveAttribute("aria-valuetext", "0:00.2");
  await expect.poll(() => savedShort().trim.startMs).toBe(220);

  const trimEnd = page.getByRole("slider", { name: "Trim end" });
  await expect(trimEnd).toHaveValue("3500");
});

test("shows how long the short is, and updates it after a cut", async ({ page }) => {
  await openEditor(page);
  const length = page.getByText(/^The short is \d:\d\d long/);
  // Kept: 200–1900 ms and 2500–3500 ms.
  await expect(length).toHaveText(/^The short is 0:02 long/);

  await words(page).nth(1).click();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Delete");
  await expect(length).toHaveText(/^The short is 0:01 long/);
});

test("plays the preview without the cut words", async ({ page }) => {
  await openEditor(page);
  // Cut "positioning", from 800 to 1300 ms.
  await words(page).nth(1).click();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("status")).toHaveText("Saved.");

  await page.evaluate(() => {
    const camera = document.getElementById("camera-video") as HTMLVideoElement;
    const samples: number[] = [];
    (window as unknown as { samples: number[] }).samples = samples;
    const sample = () => {
      if (!camera.paused) {
        samples.push(camera.currentTime * 1000);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  // Playback stops by itself at the end of the trim.
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible({ timeout: 10_000 });

  const samples = await page.evaluate(() => (window as unknown as { samples: number[] }).samples);
  expect(samples.length).toBeGreaterThan(10);
  // A frame or two can land on either side of a jump, so the edges are left out.
  const insideCut = samples.filter((time) => time > 900 && time < 1200);
  expect(insideCut).toEqual([]);
  const insidePause = samples.filter((time) => time > 2000 && time < 2400);
  expect(insidePause).toEqual([]);
  expect(Math.max(...samples)).toBeLessThanOrEqual(3550);
});

test("tells the command line that editing is done", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("status")).toContainText("Done");
  await expect(server.done).resolves.toBeUndefined();
});

test("explains the problem when the page is opened without its session token", async ({ page }) => {
  await page.goto(server.url.replace(/#.*$/, ""));
  await expect(page.getByRole("status")).toContainText("Open the editor with short edit");
});
