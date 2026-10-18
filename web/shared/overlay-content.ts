// What the editor preview and the render page both draw, so the two match.
import type { Rect } from "../../src/edit/layout-geometry.ts";
import { isSameWord } from "../../src/schemas/headline-words.ts";
import type { Preset } from "../../src/schemas/preset.ts";

/** Hands a rectangle in frame pixels to the layout CSS. */
export function placeElement(element: HTMLElement, rect: Rect) {
  element.style.setProperty("--x", String(rect.x));
  element.style.setProperty("--y", String(rect.y));
  element.style.setProperty("--width", String(rect.width));
  element.style.setProperty("--height", String(rect.height));
}

/** Gives the frame the preset's caption colors and safe zones. */
export function applyPreset(frame: HTMLElement, preset: Preset) {
  frame.style.setProperty("--caption-text", preset.captions.textColor);
  frame.style.setProperty("--caption-background", preset.captions.backgroundColor);
  frame.style.setProperty("--caption-accent", preset.captions.accentColor);
  for (const [side, pixels] of Object.entries(preset.safeZones)) {
    frame.style.setProperty(`--safe-${side}`, String(pixels));
  }
}

/**
 * The headline's text band, with the first use of the accent word in a mark.
 * The text is split into words and the gaps between them, so the accent can
 * be wrapped without changing the rest.
 */
export function headlineBand(headline: { text: string; accent: string }): HTMLSpanElement {
  const band = document.createElement("span");
  let isAccentMarked = false;
  for (const part of headline.text.split(/([^\p{L}\p{M}\p{N}'-]+)/u)) {
    const isAccent = !isAccentMarked && isSameWord(part, headline.accent);
    if (isAccent) {
      const mark = document.createElement("mark");
      mark.textContent = part;
      band.append(mark);
      isAccentMarked = true;
    } else {
      band.append(part);
    }
  }
  return band;
}

/** A caption chunk's text band, with the word being said lit. */
export function captionBand(words: string[], currentIndex: number): HTMLSpanElement {
  const band = document.createElement("span");
  words.forEach((word, index) => {
    if (index > 0) {
      band.append(" ");
    }
    const wordElement = document.createElement("span");
    wordElement.textContent = word;
    wordElement.classList.toggle("is-current", index === currentIndex);
    band.append(wordElement);
  });
  return band;
}
