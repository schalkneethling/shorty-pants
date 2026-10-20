import { describe, expect, test } from "vite-plus/test";
import {
  clampCrop,
  coverPlacement,
  layoutGeometry,
  minimumSafeArea,
  safeArea,
  visibleSource,
  type Rect,
} from "../../src/edit/layout-geometry.ts";
import { defaultPreset, frame } from "../../src/schemas/preset.ts";
import { layoutSchema } from "../../src/schemas/layout.ts";

function isInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function overlaps(first: Rect, second: Rect): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  );
}

const presetsToCheck = [
  defaultPreset.safeZones,
  { top: 0, bottom: 0, left: 0, right: 0 },
  { top: 400, bottom: 600, left: 120, right: 240 },
  // The smallest safe area a preset may have.
  {
    top: 500,
    bottom: 1920 - 500 - minimumSafeArea.height,
    left: 300,
    right: 1080 - 300 - minimumSafeArea.width,
  },
];

describe("safeArea", () => {
  test("is the part of the frame that the safe zones leave uncovered", () => {
    expect(safeArea(defaultPreset.safeZones)).toEqual({
      x: 48,
      y: 240,
      width: 840,
      height: 1200,
    });
  });
});

describe("layoutGeometry", () => {
  test("split puts the window above the camera, and together they fill the frame", () => {
    const geometry = layoutGeometry("split", defaultPreset.safeZones);
    expect(geometry.screen).toEqual({ x: 0, y: 0, width: frame.width, height: 1056 });
    expect(geometry.camera).toEqual({ x: 0, y: 1056, width: frame.width, height: 864 });
    expect(geometry.cameraShape).toBe("rectangle");
  });

  test("face fills the frame with the camera and shows no window", () => {
    const geometry = layoutGeometry("face", defaultPreset.safeZones);
    expect(geometry.screen).toBeNull();
    expect(geometry.camera).toEqual({ x: 0, y: 0, width: frame.width, height: frame.height });
  });

  test("circle fills the frame with the window and puts a round camera on top", () => {
    const geometry = layoutGeometry("circle", defaultPreset.safeZones);
    expect(geometry.screen).toEqual({ x: 0, y: 0, width: frame.width, height: frame.height });
    expect(geometry.cameraShape).toBe("circle");
    expect(geometry.camera.width).toBe(geometry.camera.height);
  });

  for (const safeZones of presetsToCheck) {
    for (const layout of layoutSchema.options) {
      test(`keeps the ${layout} overlays out of the safe zones ${JSON.stringify(safeZones)}`, () => {
        const geometry = layoutGeometry(layout, safeZones);
        const area = safeArea(safeZones);
        expect(isInside(geometry.headline, area)).toBe(true);
        expect(isInside(geometry.captions, area)).toBe(true);
        expect(overlaps(geometry.headline, geometry.captions)).toBe(false);
        if (geometry.cameraShape === "circle") {
          expect(isInside(geometry.camera, area)).toBe(true);
          expect(overlaps(geometry.camera, geometry.captions)).toBe(false);
          expect(overlaps(geometry.camera, geometry.headline)).toBe(false);
        }
      });
    }
  }
});

describe("clampCrop", () => {
  const source = { width: 320, height: 240 };

  test("keeps a crop that fits as it is", () => {
    const crop = { x: 10, y: 20, width: 100, height: 50 };
    expect(clampCrop(crop, source)).toEqual(crop);
  });

  test("shrinks a crop that runs past the right and bottom edges", () => {
    expect(clampCrop({ x: 300, y: 200, width: 100, height: 100 }, source)).toEqual({
      x: 300,
      y: 200,
      width: 20,
      height: 40,
    });
  });

  test("brings a crop from a larger recording inside a smaller one", () => {
    expect(clampCrop({ x: 0, y: 0, width: 1920, height: 1080 }, source)).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 240,
    });
    expect(clampCrop({ x: 500, y: 500, width: 10, height: 10 }, source)).toEqual({
      x: 319,
      y: 239,
      width: 1,
      height: 1,
    });
  });
});

describe("coverPlacement", () => {
  const source = { width: 1920, height: 1080 };

  test("scales a crop up until it covers the slot, and centers it", () => {
    // A 9:16 crop from the middle of a 16:9 window, shown in a 9:16 slot.
    const crop = { x: 672, y: 28, width: 576, height: 1024 };
    const slot = { x: 0, y: 0, width: 1080, height: 1920 };
    const placement = coverPlacement(source, crop, slot);
    expect(placement.scale).toBeCloseTo(1920 / 1024);
    // The crop's top-left corner lands on the slot's top-left corner.
    expect(placement.x).toBeCloseTo(-672 * placement.scale);
    expect(placement.y).toBeCloseTo(-28 * placement.scale);
    expect(placement.width).toBeCloseTo(1920 * placement.scale);
    expect(placement.height).toBeCloseTo(1080 * placement.scale);
  });

  test("covers the slot with the whole source when there is no crop", () => {
    const slot = { x: 0, y: 1056, width: 1080, height: 864 };
    const placement = coverPlacement(source, { x: 0, y: 0, ...source }, slot);
    expect(placement.scale).toBeCloseTo(864 / 1080);
    // The source is wider than the slot, so it is centered and its sides are cut.
    expect(placement.x).toBeCloseTo((1080 - 1920 * placement.scale) / 2);
    expect(placement.y).toBeCloseTo(0);
  });

  test("never moves the source so far that the slot shows an empty edge", () => {
    // A small crop in the top-left corner, shown in a wide slot.
    const crop = { x: 0, y: 0, width: 200, height: 400 };
    const slot = { x: 0, y: 0, width: 1080, height: 1056 };
    const placement = coverPlacement(source, crop, slot);
    expect(placement.x).toBeLessThanOrEqual(0);
    expect(placement.y).toBeLessThanOrEqual(0);
    expect(placement.x + placement.width).toBeGreaterThanOrEqual(slot.width);
    expect(placement.y + placement.height).toBeGreaterThanOrEqual(slot.height);
  });

  test("covers the slot even when the crop is larger than the source", () => {
    const slot = { x: 0, y: 0, width: 1080, height: 1056 };
    const placement = coverPlacement(source, { x: 0, y: 0, width: 4000, height: 1080 }, slot);
    expect(placement.x).toBeLessThanOrEqual(0);
    expect(placement.x + placement.width).toBeGreaterThanOrEqual(slot.width);
    expect(placement.y + placement.height).toBeGreaterThanOrEqual(slot.height);
  });
});

const defaultFullFrame: Rect = { x: 0, y: 0, width: frame.width, height: frame.height };

describe("visibleSource", () => {
  const splitScreen = layoutGeometry("split", defaultPreset.safeZones).screen!;
  const circleScreen = layoutGeometry("circle", defaultPreset.safeZones).screen!;

  function whole(source: { width: number; height: number }): Rect {
    return { x: 0, y: 0, ...source };
  }

  test("shows the middle of a 16:9 window in the split layout, and all of its height", () => {
    const source = { width: 1920, height: 1080 };
    const visible = visibleSource(source, whole(source), splitScreen);
    expect(visible.width).toBeCloseTo(1104.5, 1);
    expect(visible.height).toBeCloseTo(1080);
    expect(visible.x).toBeCloseTo((1920 - 1104.5) / 2, 1);
    expect(visible.y).toBeCloseTo(0);
  });

  test("shows less of the same window in the circle layout, which fills the frame", () => {
    const source = { width: 1920, height: 1080 };
    const visible = visibleSource(source, whole(source), circleScreen);
    expect(visible.width).toBeCloseTo(607.5, 1);
    expect(visible.height).toBeCloseTo(1080);
  });

  test("shows all of the width of a square window in the split layout, and cuts its height", () => {
    const source = { width: 1000, height: 1000 };
    const visible = visibleSource(source, whole(source), splitScreen);
    expect(visible.width).toBeCloseTo(1000);
    expect(visible.height).toBeCloseTo(977.8, 1);
  });

  test("shows the crop, not the whole window, when there is a crop", () => {
    const source = { width: 1920, height: 1080 };
    const crop = { x: 100, y: 100, width: 540, height: 960 };
    const visible = visibleSource(source, crop, defaultFullFrame);
    expect(visible.x).toBeCloseTo(100);
    expect(visible.y).toBeCloseTo(100);
    expect(visible.width).toBeCloseTo(540);
    expect(visible.height).toBeCloseTo(960);
  });

  test("always lies inside the source", () => {
    const sources = [
      { width: 1920, height: 1080 },
      { width: 1000, height: 1000 },
      { width: 640, height: 480 },
      { width: 400, height: 1200 },
      { width: 3456, height: 2234 },
    ];
    const slots = [splitScreen, circleScreen];
    for (const source of sources) {
      for (const slot of slots) {
        const visible = visibleSource(source, whole(source), slot);
        expect(isInside(visible, { x: 0, y: 0, ...source })).toBe(true);
      }
    }
  });
});
