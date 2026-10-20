import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { startRecorderServer, type RecorderServer } from "../../src/recorder/server.ts";
import { coverPlacement, layoutGeometry } from "../../src/edit/layout-geometry.ts";
import { defaultPreset, type Preset } from "../../src/schemas/preset.ts";

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
    preset: defaultPreset,
  });
});

test.afterEach(async () => {
  await server.close();
  rmSync(workspace, { recursive: true, force: true });
});

/** Replaces the server with one that has another preset. */
async function restartServerWith(preset: Preset) {
  await server.close();
  server = await startRecorderServer({
    shortFolder,
    webRoot,
    token: "e2e-token-0123456789",
    now: () => new Date("2026-10-17T13:45:00.000Z"),
    preset,
  });
}

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

/** Ends the current window share the way the browser's own controls would. */
async function endWindowShare(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const preview = document.getElementById("screen-preview") as HTMLVideoElement;
    const track = (preview.srcObject as MediaStream).getVideoTracks()[0]!;
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
}

async function setUpSources(page: import("@playwright/test").Page) {
  await page.goto(server.url);
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await page.getByRole("button", { name: "Choose window" }).click();
  await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled();
}

test("lays the page out with spacing between its parts", async ({ page }) => {
  await page.goto(server.url);
  const spacing = await page.locator("main").evaluate((main) => {
    const style = getComputedStyle(main);
    return { gap: style.rowGap, padding: style.paddingBlockStart };
  });
  expect(spacing).toEqual({ gap: "16px", padding: "16px" });
});

test("uploads a take once even when the share ends while it is being saved", async ({ page }) => {
  const uploads: string[] = [];
  let releaseCamera: () => void = () => {};
  const cameraHeld = new Promise<void>((resolve) => {
    releaseCamera = resolve;
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/takes/")) {
      uploads.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  await page.route("**/api/takes/cam", async (route) => {
    await cameraHeld;
    await route.continue();
  });

  await setUpSources(page);
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.locator("#elapsed")).toHaveText("0:01", { timeout: 10_000 });
  await page.getByRole("button", { name: "Stop" }).click();
  await expect.poll(() => uploads.length).toBe(1);

  await endWindowShare(page);
  releaseCamera();

  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 15_000 });
  expect(uploads).toEqual(["PUT /api/takes/cam", "PUT /api/takes/screen", "POST /api/takes/done"]);
});

test("stops the previous share when another window is chosen", async ({ page }) => {
  await setUpSources(page);
  await page.evaluate(() => {
    const preview = document.getElementById("screen-preview") as HTMLVideoElement;
    (window as unknown as { firstShare: MediaStreamTrack }).firstShare = (
      preview.srcObject as MediaStream
    ).getVideoTracks()[0]!;
  });

  await page.getByRole("button", { name: "Choose another window" }).click();
  const firstShareState = () =>
    page.evaluate(
      () => (window as unknown as { firstShare: MediaStreamTrack }).firstShare.readyState,
    );
  await expect.poll(firstShareState).toBe("ended");

  // The old share ending later must not affect the new one.
  await page.evaluate(() =>
    (window as unknown as { firstShare: MediaStreamTrack }).firstShare.dispatchEvent(
      new Event("ended"),
    ),
  );
  await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled();
});

test("asks for a new window when the share ended during a take that could not be saved", async ({
  page,
}) => {
  await page.route("**/api/takes/cam", (route) =>
    route.fulfill({ status: 500, body: "Disk full." }),
  );

  await setUpSources(page);
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.locator("#elapsed")).toHaveText("0:01", { timeout: 10_000 });
  await endWindowShare(page);

  await expect(page.getByRole("status")).toContainText("The take could not be saved.");
  await expect(page.getByRole("button", { name: "Start recording" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Choose window" })).toBeEnabled();
});

test("keeps keyboard focus on a control through the whole take", async ({ page }) => {
  await page.goto(server.url);
  const focusedId = () => page.evaluate(() => document.activeElement?.id ?? "");

  await page.getByRole("button", { name: "Turn on camera" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(focusedId).toBe("screen-button");

  await page.keyboard.press("Enter");
  await expect.poll(focusedId).toBe("record-button");

  await page.keyboard.press("Enter");
  await expect.poll(focusedId).toBe("stop-button");
  await expect(page.locator("#elapsed")).toHaveText("0:01", { timeout: 10_000 });

  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 15_000 });
  expect(await focusedId()).toBe("stop-button");
});

const splitGeometry = layoutGeometry("split", defaultPreset.safeZones);

/** The box of an element in the page, which the tests read in CSS pixels. */
async function boxOf(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (box === null) {
    throw new Error(`${selector} has no box.`);
  }
  return box;
}

/** The size of the shared window as the page sees it, and of its video in the frame. */
async function screenVideoMetrics(page: Page) {
  return page.evaluate(() => {
    const video = document.getElementById("screen-preview") as HTMLVideoElement;
    const frame = document.getElementById("preview-frame") as HTMLElement;
    return {
      source: { width: video.videoWidth, height: video.videoHeight },
      inlineSize: Number.parseFloat(getComputedStyle(video).inlineSize),
      frameWidth: frame.getBoundingClientRect().width,
    };
  });
}

async function waitForScreenSize(page: Page) {
  await expect
    .poll(async () => (await screenVideoMetrics(page)).source.width, { timeout: 10_000 })
    .toBeGreaterThan(0);
}

test.describe("the frame preview", () => {
  test("shows the camera and the window in a 9:16 frame in the preset's default layout", async ({
    page,
  }) => {
    await setUpSources(page);
    await waitForScreenSize(page);

    const frame = page.locator("#preview-frame");
    await expect(frame).toHaveAttribute("data-layout", "split");
    const frameBox = await boxOf(page, "#preview-frame");
    expect(frameBox.width / frameBox.height).toBeCloseTo(9 / 16, 2);

    const screenBox = await boxOf(page, "#screen-slot");
    expect(screenBox.height / frameBox.height).toBeCloseTo(1056 / 1920, 2);
    const cameraBox = await boxOf(page, "#camera-slot");
    expect(cameraBox.y).toBeCloseTo(screenBox.y + screenBox.height, 0);
    await expect(page.locator("#screen-preview")).toBeVisible();
    await expect(page.locator("#camera-preview")).toBeVisible();
    await expect(page.locator("figcaption")).toHaveText("Layout: Split");
  });

  test("uses the preset's default layout, here circle", async ({ page }) => {
    await restartServerWith({ ...defaultPreset, defaultLayout: "circle" });
    await setUpSources(page);

    await expect(page.locator("#preview-frame")).toHaveAttribute("data-layout", "circle");
    await expect(page.getByRole("radio", { name: "Circle cam" })).toBeChecked();
    const radius = await page.locator("#camera-slot").evaluate((slot) => {
      return getComputedStyle(slot).borderRadius;
    });
    expect(radius).toBe("50%");
  });

  test("places the window with the same placement as the editor and the render", async ({
    page,
  }) => {
    await setUpSources(page);
    await waitForScreenSize(page);

    const metrics = await screenVideoMetrics(page);
    const placement = coverPlacement(
      metrics.source,
      { x: 0, y: 0, ...metrics.source },
      splitGeometry.screen!,
    );
    expect(metrics.inlineSize).toBeCloseTo((placement.width * metrics.frameWidth) / 1080, 0);
  });

  test("places the window again when its size changes", async ({ page }) => {
    await setUpSources(page);
    await waitForScreenSize(page);
    const firstSize = (await screenVideoMetrics(page)).source;

    // Fake capture follows a request for another size, as a resized window does.
    await page.evaluate(async () => {
      const video = document.getElementById("screen-preview") as HTMLVideoElement;
      const track = (video.srcObject as MediaStream).getVideoTracks()[0]!;
      await track.applyConstraints({ width: 640, height: 640 });
    });
    await expect
      .poll(async () => (await screenVideoMetrics(page)).source.width, { timeout: 10_000 })
      .not.toBe(firstSize.width);

    const metrics = await screenVideoMetrics(page);
    const placement = coverPlacement(
      metrics.source,
      { x: 0, y: 0, ...metrics.source },
      splitGeometry.screen!,
    );
    expect(metrics.inlineSize).toBeCloseTo((placement.width * metrics.frameWidth) / 1080, 0);
    await expect(page.locator("#screen-fit")).toContainText(
      `${placement.scale.toFixed(2)} pixels of the short`,
    );
  });

  test("switches layouts with the arrow keys during a take, and the take still saves", async ({
    page,
  }) => {
    await setUpSources(page);
    await waitForScreenSize(page);
    const liveSize = (await screenVideoMetrics(page)).source;

    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.locator("#elapsed")).toHaveText("0:01", { timeout: 10_000 });

    await page.getByRole("radio", { name: "Split" }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("#preview-frame")).toHaveAttribute("data-layout", "face");
    await expect(page.locator("#screen-slot")).toBeHidden();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("#preview-frame")).toHaveAttribute("data-layout", "circle");
    await expect(page.locator("#screen-slot")).toBeVisible();

    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByRole("status")).toContainText("Saved", { timeout: 15_000 });
    await server.saved;

    // The recording is the window itself, whatever the preview showed.
    const recorded = readFileSync(join(shortFolder, "takes", "screen.webm")).toString("base64");
    const recordedSize = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const video = document.createElement("video");
      video.muted = true;
      const loaded = new Promise<void>((resolve, reject) => {
        video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        video.addEventListener("error", () => reject(new Error("The take did not load.")), {
          once: true,
        });
      });
      video.src = URL.createObjectURL(new Blob([bytes], { type: "video/webm" }));
      await loaded;
      return { width: video.videoWidth, height: video.videoHeight };
    }, recorded);
    expect(recordedSize).toEqual(liveSize);
  });

  test("keeps the preview layout out of the saved take", async ({ page }) => {
    await setUpSources(page);
    await page.getByRole("radio", { name: "Face" }).check();
    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.locator("#elapsed")).toHaveText("0:01", { timeout: 10_000 });
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByRole("status")).toContainText("Saved", { timeout: 15_000 });

    const written = JSON.parse(readFileSync(join(shortFolder, "takes.json"), "utf8"));
    expect(Object.keys(written.takes).sort()).toEqual(["cam", "screen", "screenOffsetMs"]);
    expect(JSON.stringify(written)).not.toContain("face");
  });

  test("shows the safe zones and the area outlines where the preset says, and hides them", async ({
    page,
  }) => {
    await setUpSources(page);
    const safeZones = page.getByRole("checkbox", { name: "Show safe zones" });
    const areas = page.getByRole("checkbox", { name: "Show headline and caption areas" });
    await expect(safeZones).toBeChecked();
    await expect(areas).toBeChecked();

    const frameBox = await boxOf(page, "#preview-frame");
    const pixel = frameBox.width / 1080;
    const topZone = await boxOf(page, ".safe-zone-top");
    expect(topZone.height).toBeCloseTo(defaultPreset.safeZones.top * pixel, 0);
    const bottomZone = await boxOf(page, ".safe-zone-bottom");
    expect(bottomZone.height).toBeCloseTo(defaultPreset.safeZones.bottom * pixel, 0);

    const headline = await boxOf(page, "#headline-area");
    expect(headline.x - frameBox.x).toBeCloseTo(splitGeometry.headline.x * pixel, 0);
    expect(headline.y - frameBox.y).toBeCloseTo(splitGeometry.headline.y * pixel, 0);
    expect(headline.width).toBeCloseTo(splitGeometry.headline.width * pixel, 0);
    const captions = await boxOf(page, "#captions-area");
    expect(captions.y - frameBox.y).toBeCloseTo(splitGeometry.captions.y * pixel, 0);
    expect(captions.height).toBeCloseTo(splitGeometry.captions.height * pixel, 0);

    await safeZones.uncheck();
    await expect(page.locator(".safe-zones")).toBeHidden();
    await expect(page.locator("#headline-area")).toBeVisible();
    await areas.uncheck();
    await expect(page.locator("#headline-area")).toBeHidden();
    await expect(page.locator("#captions-area")).toBeHidden();
    await safeZones.check();
    await areas.check();
    await expect(page.locator(".safe-zones")).toBeVisible();
    await expect(page.locator("#captions-area")).toBeVisible();
  });

  test("moves the area outlines with the layout", async ({ page }) => {
    await page.goto(server.url);
    await page.getByRole("radio", { name: "Circle cam" }).check();
    const circleGeometry = layoutGeometry("circle", defaultPreset.safeZones);
    const frameBox = await boxOf(page, "#preview-frame");
    const captions = await boxOf(page, "#captions-area");
    expect(captions.y - frameBox.y).toBeCloseTo(
      circleGeometry.captions.y * (frameBox.width / 1080),
      0,
    );
  });

  test("shows the frame in three view sizes", async ({ page }) => {
    await page.goto(server.url);
    const region = page.getByRole("region", { name: "Frame preview" });

    // Fit: the whole frame is visible in the window, and nothing scrolls.
    const viewport = page.viewportSize()!;
    const fitBox = await boxOf(page, "#preview-frame");
    expect(fitBox.height).toBeLessThanOrEqual(viewport.height);
    await expect(region).not.toHaveAttribute("tabindex", /.*/);

    await page.getByRole("radio", { name: "Phone size" }).check();
    expect((await boxOf(page, "#preview-frame")).width).toBeCloseTo(430, 0);

    await page.getByRole("radio", { name: "Actual pixels" }).check();
    expect((await boxOf(page, "#preview-frame")).width).toBeCloseTo(1080, 0);
    // The frame is wider than its area, so the area scrolls and a keyboard can reach it.
    await expect(region).toHaveAttribute("tabindex", "0");
    await region.focus();
    await expect(region).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => region.evaluate((area) => area.scrollLeft)).toBeGreaterThan(0);

    await page.getByRole("radio", { name: "Fit" }).check();
    await expect(region).not.toHaveAttribute("tabindex", /.*/);
  });

  test("keeps one output pixel per CSS pixel in the Actual pixels view", async ({ page }) => {
    await page.goto(server.url);
    await page.getByRole("radio", { name: "Actual pixels" }).check();
    const headlineWidth = (await boxOf(page, "#headline-area")).width;
    expect(headlineWidth).toBeCloseTo(splitGeometry.headline.width, 0);
  });

  test("says how the window fits once it is shared, and for each layout", async ({ page }) => {
    await page.goto(server.url);
    const readout = page.locator("#screen-fit");
    await expect(readout).toContainText("Choose a window");

    await setUpSources(page);
    await expect(readout).toContainText("Split: each recorded pixel of the window becomes");
    await expect(readout).toContainText("The short shows");

    await page.getByRole("radio", { name: "Face" }).check();
    await expect(readout).toHaveText("Face: the window is not shown in this layout.");
    await page.getByRole("radio", { name: "Circle cam" }).check();
    await expect(readout).toContainText("Circle cam: each recorded pixel of the window becomes");
  });

  test("names the layout and says that it only changes the preview", async ({ page }) => {
    await page.goto(server.url);
    await page.getByRole("radio", { name: "Face" }).check();
    await expect(page.locator("figcaption")).toHaveText("Layout: Face");
    const group = page.getByRole("group", { name: "Preview layout" });
    await expect(group).toContainText(
      "Changes only this preview. You choose a layout for each part of the short in the editor.",
    );
  });

  test("keeps recording possible when the preset cannot be loaded", async ({ page }) => {
    await page.route("**/api/preset", (route) => route.fulfill({ status: 500, body: "Broken." }));
    await page.goto(server.url);

    await expect(page.getByRole("status")).toContainText("frame preview");
    await expect(page.locator("#preview-frame")).toBeHidden();
    await expect(page.getByRole("group", { name: "Preview layout" })).toBeHidden();

    await page.getByRole("button", { name: "Turn on camera" }).click();
    // Later status messages replace the announcement, so the page keeps saying it.
    await expect(page.getByRole("status")).toContainText("Camera is on");
    await expect(page.getByText("The frame preview is not available.")).toBeVisible();
    await page.getByRole("button", { name: "Choose window" }).click();
    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.locator("#elapsed")).toHaveText("0:01", { timeout: 10_000 });
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByRole("status")).toContainText("Saved", { timeout: 15_000 });
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`has no accessibility violations with both sources on, in the ${colorScheme} color scheme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await setUpSources(page);
      await waitForScreenSize(page);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test("has no accessibility violations in the Actual pixels view", async ({ page }) => {
    await setUpSources(page);
    await waitForScreenSize(page);
    await page.getByRole("radio", { name: "Actual pixels" }).check();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
