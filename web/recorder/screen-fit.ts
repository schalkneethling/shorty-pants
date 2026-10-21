import {
  coverPlacement,
  layoutGeometry,
  visibleSource,
  type Size,
} from "../../src/edit/layout-geometry.ts";
import type { Layout } from "../../src/schemas/layout-names.ts";
import type { Preset } from "../../src/schemas/preset.ts";

const layoutLabels: Record<Layout, string> = {
  split: "Split",
  face: "Face",
  circle: "Circle cam",
};

/** The name of a layout as the page shows it. */
export function layoutLabel(layout: Layout): string {
  return layoutLabels[layout];
}

// What a window must look like to be shown whole, which depends on the slot.
const wholeWindowTips: Record<Layout, string | null> = {
  split: "A window about as wide as it is tall would show all of it.",
  face: null,
  circle: "A window shaped like the short, 9 wide by 16 tall, would show all of it.",
};

/** A share of a window's side, rounded to whole percents. 100 means all of it. */
function percentShown(visible: number, whole: number): number {
  return Math.round((visible / whole) * 100);
}

/**
 * Says how much of the shared window the short shows in a layout, and how
 * much each recorded pixel is scaled. The window is shown whole in the
 * editor and the render unless a crop is chosen later, so this has no crop.
 */
export function describeScreenFit(
  source: Size,
  layout: Layout,
  safeZones: Preset["safeZones"],
): string {
  const label = layoutLabels[layout];
  const slot = layoutGeometry(layout, safeZones).screen;
  if (slot === null) {
    return `${label}: the window is not shown in this layout.`;
  }

  const wholeWindow = { x: 0, y: 0, ...source };
  const { scale } = coverPlacement(source, wholeWindow, slot);
  const visible = visibleSource(source, wholeWindow, slot);
  const widthPercent = percentShown(visible.width, source.width);
  const heightPercent = percentShown(visible.height, source.height);

  const scaleSentence = `each recorded pixel of the window becomes ${scale.toFixed(2)} pixels of the short.`;
  const sidesAreCut = widthPercent < 100;
  const topAndBottomAreCut = heightPercent < 100;

  let shownSentence = "The short shows all of the window.";
  if (sidesAreCut) {
    shownSentence = `The short shows the middle ${widthPercent}% of the window's width and all of its height.`;
  } else if (topAndBottomAreCut) {
    shownSentence = `The short shows all of the window's width and the middle ${heightPercent}% of its height.`;
  }

  const tip = sidesAreCut ? wholeWindowTips[layout] : null;
  return [`${label}: ${scaleSentence}`, shownSentence, tip].filter(Boolean).join(" ");
}
