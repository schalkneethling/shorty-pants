import type { CaptionChunk } from "../../src/edit/captions.ts";
import { isSameWord, splitHeadlineWords } from "../../src/schemas/headline-words.ts";
import { createLayoutFrame, type LayoutFrameElements } from "../shared/layout-frame.ts";
import { captionBand, headlineBand } from "../shared/overlay-content.ts";
import type { Layout } from "../../src/schemas/layout-names.ts";
import type { Preset } from "../../src/schemas/preset.ts";
import type { ShortProject } from "../../src/schemas/short-project.ts";

type Headline = NonNullable<ShortProject["headline"]>;
type ScreenCrop = NonNullable<ShortProject["screenCrop"]>;

/**
 * Draws the preview frame: the two recordings in the current layout, the
 * headline, the caption being said, and the safe zone guides.
 */
export function createPreview(elements: LayoutFrameElements, preset: Preset) {
  const layoutFrame = createLayoutFrame(elements, preset);

  return {
    showLayout(layout: Layout, crop: ScreenCrop | undefined) {
      layoutFrame.showLayout(layout, crop);
    },

    /** Draws the headline and returns whether all of it fits in its area. */
    showHeadline(headline: Headline | undefined): boolean {
      elements.headline.hidden = headline === undefined;
      if (headline === undefined) {
        elements.headline.replaceChildren();
        return true;
      }
      const band = headlineBand(headline);
      elements.headline.replaceChildren(band);
      // The area clips what does not fit, so taller content means lost text.
      return elements.headline.scrollHeight <= elements.headline.clientHeight;
    },

    showCaption(caption: { chunk: CaptionChunk; wordIndex: number } | null) {
      elements.captions.hidden = caption === null;
      if (caption === null) {
        elements.captions.replaceChildren();
        return;
      }
      const band = captionBand(
        caption.chunk.words.map((word) => word.text),
        caption.wordIndex,
      );
      elements.captions.replaceChildren(band);
    },

    setSafeZonesVisible(isVisible: boolean) {
      layoutFrame.setSafeZonesVisible(isVisible);
    },
  };
}

/** The words a headline's accent can be chosen from, each one once. */
export function accentChoices(text: string): string[] {
  const choices: string[] = [];
  for (const word of splitHeadlineWords(text)) {
    const isNew = !choices.some((choice) => isSameWord(choice, word));
    if (isNew) {
      choices.push(word);
    }
  }
  return choices;
}
