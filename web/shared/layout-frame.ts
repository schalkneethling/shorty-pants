// What the editor preview and the recorder both draw, so the two match.
import {
  coverPlacement,
  layoutGeometry,
  type Rect,
  type Size,
} from "../../src/edit/layout-geometry.ts";
import type { Layout } from "../../src/schemas/layout-names.ts";
import type { Preset } from "../../src/schemas/preset.ts";
import { applyPreset, placeElement, showSafeZones } from "./overlay-content.ts";

export interface LayoutFrameElements {
  frame: HTMLElement;
  screenSlot: HTMLElement;
  cameraSlot: HTMLElement;
  screenVideo: HTMLVideoElement;
  cameraVideo: HTMLVideoElement;
  headline: HTMLElement;
  captions: HTMLElement;
  safeZones: HTMLElement;
}

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
 * Draws the frame's layout: the two videos in their slots, and the areas for
 * the headline and the captions. The page that owns the frame decides what
 * goes into those areas.
 */
export function createLayoutFrame(elements: LayoutFrameElements, preset: Preset) {
  let currentLayout: Layout = preset.defaultLayout;
  let currentCrop: Rect | undefined;

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

  // The videos can only be placed once their sizes are known. A shared window
  // changes size when it is resized, and the video says so with resize.
  for (const video of [elements.screenVideo, elements.cameraVideo]) {
    video.addEventListener("loadedmetadata", draw);
    video.addEventListener("resize", draw);
  }
  draw();

  return {
    showLayout(layout: Layout, crop: Rect | undefined) {
      const hasChanged = layout !== currentLayout || crop !== currentCrop;
      currentLayout = layout;
      currentCrop = crop;
      if (hasChanged) {
        draw();
      }
    },

    setSafeZonesVisible(isVisible: boolean) {
      elements.safeZones.hidden = !isVisible;
    },

    /**
     * Shows the guides for the desktop player or for the phone player. The
     * layout keeps to the phone zones either way, because they cover more.
     */
    showDesktopSafeZones(isDesktop: boolean) {
      showSafeZones(frame, isDesktop ? preset.desktopSafeZones : preset.safeZones);
    },
  };
}
