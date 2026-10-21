import { writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { defaultPreset } from "../../src/schemas/preset.ts";
import {
  createEditorWorkspace,
  openEditor,
  words,
  type EditorWorkspace,
} from "./editor-workspace.ts";

let workspace: EditorWorkspace;

test.beforeEach(async () => {
  workspace = await createEditorWorkspace();
});

test.afterEach(async () => {
  await workspace.remove();
});

function layoutGroup(page: Page) {
  return page.getByRole("group", { name: "Layout for the selected words" });
}

function previewFrame(page: Page) {
  return page.locator("#preview-frame");
}

test("gives the selected words their own layout and shows it in the preview", async ({ page }) => {
  await openEditor(page, workspace);
  await words(page).first().click();
  await page.keyboard.press("Shift+ArrowRight");
  await layoutGroup(page).getByRole("radio", { name: "Face" }).check();

  await expect
    .poll(() => workspace.savedShort().segments)
    .toEqual([
      { fromWord: 0, layout: "face" },
      { fromWord: 2, layout: "split" },
    ]);
  await expect(page.getByRole("status")).toHaveText("Face layout for 2 words.");
  // The preview is at the start of "Anchor", which now uses the face layout.
  await expect(previewFrame(page)).toHaveAttribute("data-layout", "face");
  await expect(words(page).nth(2)).toHaveAccessibleName("ignores (split layout starts)");

  await words(page).nth(2).click();
  await expect(layoutGroup(page).getByRole("radio", { name: "Split" })).toBeChecked();
  await expect(previewFrame(page)).toHaveAttribute("data-layout", "split");
});

test("checks no layout for a selection with several, so any layout can be applied", async ({
  page,
}) => {
  await openEditor(page, workspace);
  await words(page).first().click();
  await page.keyboard.press("Shift+ArrowRight");
  await layoutGroup(page).getByRole("radio", { name: "Face" }).check();

  await words(page).first().click();
  await page.keyboard.press("Shift+End");
  for (const name of ["Split", "Face", "Circle cam"]) {
    await expect(layoutGroup(page).getByRole("radio", { name })).not.toBeChecked();
  }
  await layoutGroup(page).getByRole("radio", { name: "Split" }).check();
  await expect
    .poll(() => workspace.savedShort().segments)
    .toEqual([{ fromWord: 0, layout: "split" }]);
});

test("changes the layout of a short whose transcript has no words", async ({ page }) => {
  await workspace.remove();
  workspace = await createEditorWorkspace({
    transcript: { version: 1, model: "m", language: "en", durationMs: 4000, words: [] },
  });
  await openEditor(page, workspace, 0);
  await layoutGroup(page).getByRole("radio", { name: "Face" }).check();
  await expect(page.getByRole("status")).toHaveText("Face layout for the short.");
  await expect
    .poll(() => workspace.savedShort().segments)
    .toEqual([{ fromWord: 0, layout: "face" }]);
});

test("shows the camera in a circle over the window in the circle layout", async ({ page }) => {
  await openEditor(page, workspace);
  await words(page).first().click();
  await page.keyboard.press("Shift+End");
  await layoutGroup(page).getByRole("radio", { name: "Circle cam" }).check();

  await expect(previewFrame(page)).toHaveAttribute("data-layout", "circle");
  await expect(page.locator("#camera-slot")).toHaveCSS("border-radius", "50%");
  await expect
    .poll(() => workspace.savedShort().segments)
    .toEqual([{ fromWord: 0, layout: "circle" }]);
});

test("saves the headline and its accent word, and shows them in the preview", async ({ page }) => {
  await openEditor(page, workspace);
  const headline = page.getByRole("textbox", { name: "Headline" });
  const accent = page.getByRole("combobox", { name: "Accent word" });

  await headline.fill("Anchors ignore scroll");
  // The last word is the accent until another one is chosen.
  await expect(accent).toHaveValue("scroll");
  await expect
    .poll(() => workspace.savedShort().headline)
    .toEqual({ text: "Anchors ignore scroll", accent: "scroll" });

  await accent.selectOption("ignore");
  await expect
    .poll(() => workspace.savedShort().headline)
    .toEqual({ text: "Anchors ignore scroll", accent: "ignore" });
  await expect(page.locator("#headline-preview")).toHaveText("Anchors ignore scroll");
  await expect(page.locator("#headline-preview mark")).toHaveText("ignore");

  await headline.fill("");
  await expect.poll(() => workspace.savedShort().headline).toBeUndefined();
  await expect(page.locator("#headline-preview")).toBeHidden();
});

test("keeps the chosen accent while its word is being edited", async ({ page }) => {
  await openEditor(page, workspace);
  const headline = page.getByRole("textbox", { name: "Headline" });
  const accent = page.getByRole("combobox", { name: "Accent word" });
  await headline.fill("Anchors ignore scroll");
  await accent.selectOption("ignore");

  // While the word is mistyped, the last word stands in for it.
  await headline.fill("Anchors ignor scroll");
  await expect(accent).toHaveValue("scroll");
  await headline.fill("Anchors ignore scroll");
  await expect(accent).toHaveValue("ignore");
  await expect
    .poll(() => workspace.savedShort().headline)
    .toEqual({ text: "Anchors ignore scroll", accent: "ignore" });
});

test("says when the headline is too long to fit", async ({ page }) => {
  await openEditor(page, workspace);
  const headline = page.getByRole("textbox", { name: "Headline" });
  await headline.fill("Anchor positioning ignores the scroll container completely");
  await expect(headline).toHaveAccessibleDescription(/too long/);
  await headline.fill("Anchors ignore scroll");
  await expect(headline).toHaveAccessibleDescription(/fits/);
});

test("crops the shared window and resets the crop", async ({ page }) => {
  await openEditor(page, workspace);
  const crop = page.getByRole("group", { name: "Screen crop" });
  const width = crop.getByRole("spinbutton", { name: "Width" });
  // The fixture window is 320 × 240.
  await expect(width).toBeEnabled();
  await expect(width).toHaveValue("320");

  await width.fill("160");
  await width.blur();
  await expect
    .poll(() => workspace.savedShort().screenCrop)
    .toEqual({ x: 0, y: 0, width: 160, height: 240 });

  await crop.getByRole("button", { name: "Reset crop" }).click();
  await expect(width).toHaveValue("320");
  await expect.poll(() => workspace.savedShort().screenCrop).toBeUndefined();
});

test("keeps the crop inside the window", async ({ page }) => {
  await openEditor(page, workspace);
  const crop = page.getByRole("group", { name: "Screen crop" });
  await expect(crop.getByRole("spinbutton", { name: "Width" })).toBeEnabled();
  const left = crop.getByRole("spinbutton", { name: "Left" });
  await left.fill("300");
  await left.blur();
  await expect
    .poll(() => workspace.savedShort().screenCrop)
    .toEqual({ x: 300, y: 0, width: 20, height: 240 });
  await expect(page.getByRole("status")).toHaveText(
    "The crop was changed to stay inside the window.",
  );
});

test("leaves the other crop values alone while a value is typed", async ({ page }) => {
  await openEditor(page, workspace);
  const crop = page.getByRole("group", { name: "Screen crop" });
  const width = crop.getByRole("spinbutton", { name: "Width" });
  await expect(width).toBeEnabled();

  await width.click();
  await width.press("End");
  for (let count = 0; count < 3; count += 1) {
    await width.press("Backspace");
  }
  await width.pressSequentially("160");
  await width.press("Tab");
  await expect(width).toHaveValue("160");
  await expect
    .poll(() => workspace.savedShort().screenCrop)
    .toEqual({ x: 0, y: 0, width: 160, height: 240 });
});

test("brings a crop saved for a larger recording inside the window", async ({ page }) => {
  const shortPath = join(workspace.shortFolder, "short.json");
  writeFileSync(
    shortPath,
    JSON.stringify({
      ...workspace.savedShort(),
      screenCrop: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  );
  await openEditor(page, workspace);
  const crop = page.getByRole("group", { name: "Screen crop" });
  await expect(crop.getByRole("spinbutton", { name: "Width" })).toHaveValue("320");
  await expect(crop.getByRole("spinbutton", { name: "Height" })).toHaveValue("240");
  await expect
    .poll(() => workspace.savedShort().screenCrop)
    .toEqual({ x: 0, y: 0, width: 320, height: 240 });
});

test("shows the caption chunk being said, with the current word lit", async ({ page }) => {
  await openEditor(page, workspace);
  const captions = page.locator("#captions-preview");

  await words(page).nth(3).click();
  await expect(captions).toHaveText("ignores the scroll");
  await expect(captions.locator(".is-current")).toHaveText("the");

  await words(page).first().click();
  await expect(captions).toHaveText("Anchor positioning");
});

test("shows and hides the safe zone guides", async ({ page }) => {
  await openEditor(page, workspace);
  const guides = page.locator("#safe-zones");
  await expect(guides).toBeHidden();
  await page.getByRole("checkbox", { name: "Show safe zones" }).check();
  await expect(guides).toBeVisible();
  await page.getByRole("checkbox", { name: "Show safe zones" }).uncheck();
  await expect(guides).toBeHidden();
});

test("switches the safe zone guides between the phone and the desktop player", async ({ page }) => {
  await openEditor(page, workspace);
  await page.getByRole("checkbox", { name: "Show safe zones" }).check();
  const desktopSwitch = page.getByRole("switch", { name: "Desktop safe zones" });
  await expect(desktopSwitch).not.toBeChecked();
  const bottomZone = page.locator(".safe-zone-bottom");
  const phoneHeight = (await bottomZone.boundingBox())!.height;

  await desktopSwitch.focus();
  await page.keyboard.press("Space");
  await expect(desktopSwitch).toBeChecked();
  const desktopHeight = (await bottomZone.boundingBox())!.height;
  expect(desktopHeight / phoneHeight).toBeCloseTo(
    defaultPreset.desktopSafeZones.bottom / defaultPreset.safeZones.bottom,
    2,
  );
});

test("draws the headline and captions in the bundled Noto Sans", async ({ page }) => {
  await openEditor(page, workspace);
  await page.getByRole("textbox", { name: "Headline" }).fill("Anchors ignore scroll");
  await words(page).first().click();
  const headline = page.locator("#headline-preview");
  await expect(headline).toBeVisible();
  await expect(page.locator("#captions-preview")).toBeVisible();

  await expect(headline).toHaveCSS("font-family", /^"Noto Sans"/);
  await expect(page.locator("#captions-preview")).toHaveCSS("font-family", /^"Noto Sans"/);
  const isBundledFaceReady = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some(
      (face) => face.family.replaceAll('"', "") === "Noto Sans" && face.status === "loaded",
    );
  });
  expect(isBundledFaceReady).toBe(true);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`has no accessibility violations with every control in use in the ${colorScheme} color scheme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openEditor(page, workspace);
    await page.getByRole("textbox", { name: "Headline" }).fill("Anchors ignore scroll");
    await page.getByRole("checkbox", { name: "Show safe zones" }).check();
    await words(page).first().click();
    await layoutGroup(page).getByRole("radio", { name: "Circle cam" }).check();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}
