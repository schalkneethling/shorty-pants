import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
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

test("crops the shared window and resets the crop", async ({ page }) => {
  await openEditor(page, workspace);
  const crop = page.getByRole("group", { name: "Screen crop" });
  const width = crop.getByRole("spinbutton", { name: "Width" });
  // The fixture window is 320 × 240.
  await expect(width).toBeEnabled();
  await expect(width).toHaveValue("320");

  await width.fill("160");
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
  await crop.getByRole("spinbutton", { name: "Left" }).fill("300");
  await expect
    .poll(() => workspace.savedShort().screenCrop)
    .toEqual({ x: 300, y: 0, width: 20, height: 240 });
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

test("uses the bundled Noto Sans for the headline and captions", async ({ page }) => {
  await openEditor(page, workspace);
  const loadedFaces = await page.evaluate(
    async () => (await document.fonts.load('700 48px "Noto Sans"')).length,
  );
  expect(loadedFaces).toBeGreaterThan(0);
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
