import type { Rect, Size } from "../../src/edit/layout-geometry.ts";
import type { Preset } from "../../src/schemas/preset.ts";
import { applyPreset, captionBand, headlineBand, placeElement } from "../shared/overlay-content.ts";

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`The render page is missing #${id}.`);
  }
  return element;
}

const frame = requireElement("render-frame");
const headline = requireElement("headline");
const captions = requireElement("captions");
const circleMask = requireElement("circle-mask");

/** What short render calls, through Playwright, to draw each overlay image. */
const overlayPage = {
  usePreset(preset: Preset) {
    applyPreset(frame, preset);
  },

  /** Shows only the headline, so the frame's screenshot is the headline image. */
  showHeadline(text: string, accent: string, area: Rect) {
    captions.hidden = true;
    placeElement(headline, area);
    headline.replaceChildren(headlineBand({ text, accent }));
    headline.hidden = false;
  },

  /** Shows only one caption state, so the frame's screenshot is that caption's image. */
  showCaption(words: string[], currentIndex: number, area: Rect) {
    headline.hidden = true;
    placeElement(captions, area);
    captions.replaceChildren(captionBand(words, currentIndex));
    captions.hidden = false;
  },

  /** Shows nothing, for the image between captions. */
  showNothing() {
    headline.hidden = true;
    captions.hidden = true;
  },

  sizeCircleMask(size: Size) {
    circleMask.style.setProperty("--width", String(size.width));
    circleMask.style.setProperty("--height", String(size.height));
  },
};

declare global {
  interface Window {
    overlayPage: typeof overlayPage;
  }
}

window.overlayPage = overlayPage;
