import type { CaptionChunk } from "../../src/edit/captions.ts";
import {
  coverPlacement,
  layoutGeometry,
  type Rect,
  type Size,
} from "../../src/edit/layout-geometry.ts";
import { isSameWord, splitHeadlineWords } from "../../src/schemas/headline-words.ts";
import { applyPreset, captionBand, headlineBand, placeElement } from "../shared/overlay-content.ts";
import type { Layout } from "../../src/schemas/layout-names.ts";
import type { Preset } from "../../src/schemas/preset.ts";
import type { ShortProject } from "../../src/schemas/short-project.ts";

export interface PreviewElements {
  frame: HTMLElement;
  screenSlot: HTMLElement;
  cameraSlot: HTMLElement;
  screenVideo: HTMLVideoElement;
  cameraVideo: HTMLVideoElement;
  headline: HTMLElement;
  captions: HTMLElement;
  safeZones: HTMLElement;
}

type Headline = NonNullable<ShortProject["headline"]>;
type ScreenCrop = NonNullable<ShortProject["screenCrop"]>;

/** The size of a video's frames, or null before its metadata has loaded. */
function videoSize(video: HTMLVideoElement): Size | null {
  const hasSize = video.videoWidth > 0 && video.videoHeight > 0;
  return hasSize ? { width: video.videoWidth, height: video.videoHeight } : null;
}

/** Places a video inside its slot so that the crop, or the whole video, fills the slot. */
function placeVideo(video: HTMLVideoElement, slot: Rect, crop: Rect | undefined) {
  const source = videoSize(video);
  if (source === null) {
    return;
  }
  const placement = coverPlacement(source, crop ?? { x: 0, y: 0, ...source }, slot);
  placeElement(video, placement);
}

/**
 * Draws the preview frame: the two recordings in the current layout, the
 * headline, the caption being said, and the safe zone guides.
 */
export function createPreview(elements: PreviewElements, preset: Preset) {
  let currentLayout: Layout = preset.defaultLayout;
  let currentCrop: ScreenCrop | undefined;

  const { frame } = elements;
  applyPreset(frame, preset);

  function draw() {
    const geometry = layoutGeometry(currentLayout, preset.safeZones);
    frame.dataset.layout = currentLayout;

    elements.screenSlot.hidden = geometry.screen === null;
    if (geometry.screen !== null) {
      placeElement(elements.screenSlot, geometry.screen);
      placeVideo(elements.screenVideo, geometry.screen, currentCrop);
    }
    placeElement(elements.cameraSlot, geometry.camera);
    elements.cameraSlot.classList.toggle("is-circle", geometry.cameraShape === "circle");
    placeVideo(elements.cameraVideo, geometry.camera, undefined);
    placeElement(elements.headline, geometry.headline);
    placeElement(elements.captions, geometry.captions);
  }

  // The videos can only be placed once their sizes are known.
  elements.screenVideo.addEventListener("loadedmetadata", draw);
  elements.cameraVideo.addEventListener("loadedmetadata", draw);
  draw();

  return {
    showLayout(layout: Layout, crop: ScreenCrop | undefined) {
      const hasChanged = layout !== currentLayout || crop !== currentCrop;
      currentLayout = layout;
      currentCrop = crop;
      if (hasChanged) {
        draw();
      }
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
      elements.safeZones.hidden = !isVisible;
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
