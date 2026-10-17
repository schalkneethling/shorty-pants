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
  return page.getByRole("listbox", { name: "Transcript" }).getByRole("option");
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

for (const colorScheme of ["light", "dark"] as const) {
  test(`keeps cut, selected and trimmed words readable in the ${colorScheme} color scheme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openEditor(page);
    // "Anchor" ends at 700 ms, so a trim start of 800 ms leaves it outside the trim.
    await page.getByRole("slider", { name: "Trim start" }).fill("800");
    await words(page).nth(1).click();
    await page.keyboard.press("Delete");
    await expect(words(page).nth(1)).toHaveAccessibleName("positioning (cut)");
    await expect(words(page).first()).toHaveAccessibleName("Anchor (outside the trim)");

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("cuts a selected word with Delete and brings it back with Delete", async ({ page }) => {
  await openEditor(page);
  const word = words(page).nth(1);

  await word.click();
  await expect(word).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Delete");
  await expect(word).toHaveAccessibleName("positioning (cut)");
  await expect(page.getByRole("status")).toHaveText("Cut positioning.");
  await expect.poll(() => savedShort().removedWords).toEqual([[1, 1]]);

  await page.keyboard.press("Delete");
  await expect(word).toHaveAccessibleName("positioning");
  await expect(page.getByRole("status")).toHaveText("Restored positioning.");
  await expect.poll(() => savedShort().removedWords).toEqual([]);
});

test("moves the selection with the arrow keys, so Delete cuts the word in focus", async ({
  page,
}) => {
  await openEditor(page);
  await words(page).first().click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(words(page).first()).toHaveAttribute("aria-selected", "false");
  await expect(words(page).nth(2)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Delete");
  await expect(page.getByRole("status")).toHaveText("Cut ignores.");
  await expect.poll(() => savedShort().removedWords).toEqual([[2, 2]]);
});

test("keeps the editor open and says so when a change could not be saved", async ({ page }) => {
  await page.route("**/api/short", (route) =>
    route.fulfill({ status: 500, body: "The disk is full." }),
  );
  await openEditor(page);
  await words(page).nth(1).click();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("status")).toContainText("could not be saved");

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("status")).toContainText("could not be saved");
  await expect(page.getByRole("button", { name: "Done" })).toBeEnabled();

  let isDone = false;
  void server.done.then(() => {
    isDone = true;
  });
  await page.waitForTimeout(200);
  expect(isDone).toBe(false);
});

test("moves between words with the arrow keys and extends the selection with Shift", async ({
  page,
}) => {
  await openEditor(page);
  await words(page).first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(words(page).nth(1)).toBeFocused();

  await page.keyboard.press("Shift+ArrowRight");
  await expect(words(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(words(page).nth(2)).toHaveAttribute("aria-selected", "true");
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
  await expect(page.getByRole("status")).toHaveText("Cut positioning.");

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
  // A slow frame can sample a moment just inside a cut, before the jump over
  // it. Playback never moves on inside the cut, though: the next sample is
  // always past it, so no two samples in a row fall inside one.
  const keptRanges = [
    { startMs: 200, endMs: 800 },
    { startMs: 1300, endMs: 1900 },
    { startMs: 2500, endMs: 3500 },
  ];
  const isKept = (time: number) =>
    keptRanges.some((range) => time >= range.startMs - 1 && time <= range.endMs + 1);
  const playedOnInsideACut = samples.some(
    (time, index) => index > 0 && !isKept(time) && !isKept(samples[index - 1]!),
  );
  expect(playedOnInsideACut).toBe(false);
  // Playback reaches the last kept part and stops near the end of the trim.
  expect(samples.some((time) => time >= 2500)).toBe(true);
  expect(samples.filter((time) => time > 3501).length).toBeLessThanOrEqual(1);
});

test("pauses the preview when the tab is hidden", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // Played to the end, the preview would stop by itself after about three
  // seconds, so the pause has to come well before that.
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible({ timeout: 1000 });
  const pausedAtMs = await page
    .locator("#camera-video")
    .evaluate((video: HTMLVideoElement) => (video.paused ? video.currentTime * 1000 : null));
  expect(pausedAtMs).not.toBeNull();
  expect(pausedAtMs).toBeLessThan(3000);
});

test("does not report an error when the preview is paused as it starts", async ({ page }) => {
  // As in a browser that is still loading the video, play() stays pending
  // until pause() interrupts it with an AbortError.
  await page.addInitScript(() => {
    const interruptPlay = new WeakMap<HTMLMediaElement, () => void>();
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      return new Promise<void>((_resolve, reject) => {
        interruptPlay.set(this, () =>
          reject(new DOMException("The play() request was interrupted.", "AbortError")),
        );
      });
    };
    const pauseDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "pause")!;
    const pause = pauseDescriptor.value as (this: HTMLMediaElement) => void;
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      interruptPlay.get(this)?.();
      pause.call(this);
    };
  });
  await openEditor(page);
  const playButton = page.locator("#play-button");
  await playButton.click();
  await expect(playButton).toHaveText("Pause");
  await playButton.click();
  await expect(playButton).toHaveText("Play");
  await expect(page.getByRole("status")).toHaveText(/^Ready\./);
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
