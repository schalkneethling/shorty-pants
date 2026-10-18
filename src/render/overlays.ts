import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import type { Rect, Size } from "../edit/layout-geometry.ts";
import { ShortError } from "../errors.ts";
import { frame } from "../schemas/frame.ts";
import type { Preset } from "../schemas/preset.ts";
import { HttpError, startLocalServer } from "../server/local-server.ts";

export interface CaptionImage {
  file: string;
  words: string[];
  wordIndex: number;
  area: Rect;
}

export interface OverlayRequest {
  webRoot: string;
  outputDir: string;
  preset: Preset;
  headline: { text: string; accent: string; area: Rect };
  captions: CaptionImage[];
  circleMaskSize: Size;
  // A Chrome or Chromium binary. Without one, Playwright's own Chromium is
  // used, then an installed Google Chrome.
  executablePath?: string;
}

/**
 * What web/render/render.ts offers the code below, which runs in the page.
 * The CLI is compiled without the DOM types, so this describes the parts it uses.
 */
interface OverlayPageGlobal {
  overlayPage?: {
    usePreset(preset: Preset): void;
    showHeadline(text: string, accent: string, area: Rect): void;
    showCaption(words: string[], wordIndex: number, area: Rect): void;
    showNothing(): void;
    sizeCircleMask(size: Size): void;
  };
  document: { fonts: { load(font: string): Promise<unknown>; ready: Promise<unknown> } };
}

// Playwright sends each callback below to the page as source text, so they
// cannot call helpers from this file; each one reaches the page's functions
// through globalThis itself. The type assertions vanish when compiled.
type PageGlobal = Required<OverlayPageGlobal>;

export interface OverlayFiles {
  headline: string;
  blank: string;
  circleMask: string;
}

async function launchBrowser(executablePath: string | undefined): Promise<Browser> {
  if (executablePath !== undefined) {
    try {
      return await chromium.launch({ executablePath });
    } catch (error) {
      const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
      throw new ShortError(
        `The browser at ${executablePath} could not be started. Check SHORTY_PANTS_CHROMIUM. ${reason}`,
      );
    }
  }
  try {
    return await chromium.launch();
  } catch {
    // Playwright's Chromium is not installed; an installed Chrome works too.
  }
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch {
    throw new ShortError(
      "Rendering needs Chrome or Chromium. Install Google Chrome, run npx playwright install chromium, or set SHORTY_PANTS_CHROMIUM to a Chromium binary.",
    );
  }
}

/**
 * Draws the headline, every caption state and the circle mask with the same
 * CSS as the editor preview, and saves them as images for FFmpeg to place.
 * The headline and captions are transparent images the size of the frame.
 */
export async function renderOverlays(request: OverlayRequest): Promise<OverlayFiles> {
  // The browser starts first: if it cannot, no server is left running to
  // keep the command from exiting.
  const browser = await launchBrowser(request.executablePath);
  let server: Awaited<ReturnType<typeof startLocalServer>> | undefined;
  try {
    server = await startLocalServer({
      webRoot: request.webRoot,
      page: "render",
      token: randomBytes(24).toString("base64url"),
      handleApi: () => Promise.reject(new HttpError(404, "Not found.")),
    });
    const page = await browser.newPage({
      viewport: { width: frame.width, height: frame.height },
      deviceScaleFactor: 1,
    });
    await page.goto(server.url);
    await page.waitForFunction(
      () => (globalThis as unknown as OverlayPageGlobal).overlayPage !== undefined,
    );
    await page.evaluate(
      (preset) => (globalThis as unknown as PageGlobal).overlayPage.usePreset(preset),
      request.preset,
    );
    // The text must be drawn in Noto Sans, not a fallback, before the first image.
    await page.evaluate(async () => {
      const { fonts } = (globalThis as unknown as PageGlobal).document;
      await fonts.load('700 64px "Noto Sans"');
      await fonts.ready;
    });

    const renderFrame = page.locator("#render-frame");
    const files: OverlayFiles = {
      headline: join(request.outputDir, "headline.png"),
      blank: join(request.outputDir, "blank.png"),
      circleMask: join(request.outputDir, "circle-mask.png"),
    };

    const { headline } = request;
    await page.evaluate(
      ({ text, accent, area }) =>
        (globalThis as unknown as PageGlobal).overlayPage.showHeadline(text, accent, area),
      headline,
    );
    await renderFrame.screenshot({ path: files.headline, omitBackground: true });

    for (const caption of request.captions) {
      await page.evaluate(
        ({ words, wordIndex, area }) =>
          (globalThis as unknown as PageGlobal).overlayPage.showCaption(words, wordIndex, area),
        caption,
      );
      await renderFrame.screenshot({ path: caption.file, omitBackground: true });
    }

    await page.evaluate(() => (globalThis as unknown as PageGlobal).overlayPage.showNothing());
    await renderFrame.screenshot({ path: files.blank, omitBackground: true });

    await page.evaluate(
      (size) => (globalThis as unknown as PageGlobal).overlayPage.sizeCircleMask(size),
      request.circleMaskSize,
    );
    await page.locator("#circle-mask").screenshot({ path: files.circleMask });
    return files;
  } finally {
    await browser.close();
    await server?.close();
  }
}
