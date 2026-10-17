import { frame } from "../schemas/frame.ts";
import type { Layout } from "../schemas/layout-names.ts";
import type { Preset } from "../schemas/preset.ts";

/** A rectangle in pixels, measured from the top-left corner. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

type SafeZones = Preset["safeZones"];

/** Where everything goes in the 1080 × 1920 frame for one layout. */
export interface LayoutGeometry {
  // The shared window, or null when the layout does not show it.
  screen: Rect | null;
  camera: Rect;
  cameraShape: "rectangle" | "circle";
  // The areas that the headline and the captions are placed in.
  headline: Rect;
  captions: Rect;
}

// The space kept between an overlay and the edge of the safe area.
const overlayMarginPx = 24;
const headlineHeightPx = 240;
const captionsHeightPx = 192;
const circleCameraSizePx = 360;
// In the split layout, the window takes the top 55 percent of the frame.
const splitScreenHeightPx = Math.round(frame.height * 0.55);

const fullFrame: Rect = { x: 0, y: 0, width: frame.width, height: frame.height };

/** The part of the frame that YouTube's own buttons and text leave uncovered. */
export function safeArea(safeZones: SafeZones): Rect {
  return {
    x: safeZones.left,
    y: safeZones.top,
    width: frame.width - safeZones.left - safeZones.right,
    height: frame.height - safeZones.top - safeZones.bottom,
  };
}

/** Keeps a value between a lowest and a highest value. */
function clamp(value: number, lowest: number, highest: number): number {
  return Math.min(Math.max(value, lowest), highest);
}

export function layoutGeometry(layout: Layout, safeZones: SafeZones): LayoutGeometry {
  const area = safeArea(safeZones);
  const areaBottom = area.y + area.height;
  const overlayX = area.x + overlayMarginPx;
  const overlayWidth = area.width - overlayMarginPx * 2;

  const headline: Rect = {
    x: overlayX,
    y: area.y + overlayMarginPx,
    width: overlayWidth,
    height: headlineHeightPx,
  };
  const highestCaptionsY = headline.y + headline.height + overlayMarginPx;
  const lowestCaptionsY = areaBottom - overlayMarginPx - captionsHeightPx;

  /** The captions area with its top at y, moved inside the safe area if needed. */
  function captionsAt(y: number): Rect {
    return {
      x: overlayX,
      y: clamp(y, highestCaptionsY, lowestCaptionsY),
      width: overlayWidth,
      height: captionsHeightPx,
    };
  }

  if (layout === "split") {
    return {
      screen: { x: 0, y: 0, width: frame.width, height: splitScreenHeightPx },
      camera: {
        x: 0,
        y: splitScreenHeightPx,
        width: frame.width,
        height: frame.height - splitScreenHeightPx,
      },
      cameraShape: "rectangle",
      headline,
      // Centered on the line between the window and the camera.
      captions: captionsAt(splitScreenHeightPx - captionsHeightPx / 2),
    };
  }

  if (layout === "face") {
    return {
      screen: null,
      camera: fullFrame,
      cameraShape: "rectangle",
      headline,
      captions: captionsAt(lowestCaptionsY),
    };
  }

  // Circle: the window fills the frame, and the camera sits in the bottom-left
  // corner of the safe area, with the captions above it.
  const camera: Rect = {
    x: overlayX,
    y: areaBottom - overlayMarginPx - circleCameraSizePx,
    width: circleCameraSizePx,
    height: circleCameraSizePx,
  };
  return {
    screen: fullFrame,
    camera,
    cameraShape: "circle",
    headline,
    captions: captionsAt(camera.y - overlayMarginPx - captionsHeightPx),
  };
}

/** Where a whole source video goes so that its crop fills a slot. */
export interface Placement {
  scale: number;
  // The position and size of the whole scaled source, relative to the slot.
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Scales a source video so that the cropped part covers the slot, centered
 * on the crop, like object-fit: cover applied to the crop alone. The source
 * is never moved so far that the slot would show an empty edge.
 */
export function coverPlacement(source: Size, crop: Rect, slot: Rect): Placement {
  const scale = Math.max(slot.width / crop.width, slot.height / crop.height);
  const width = source.width * scale;
  const height = source.height * scale;
  const cropCenterX = (crop.x + crop.width / 2) * scale;
  const cropCenterY = (crop.y + crop.height / 2) * scale;
  return {
    scale,
    x: clamp(slot.width / 2 - cropCenterX, slot.width - width, 0),
    y: clamp(slot.height / 2 - cropCenterY, slot.height - height, 0),
    width,
    height,
  };
}
