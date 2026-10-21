import { describe, expect, test } from "vite-plus/test";
import { defaultPreset } from "../../src/schemas/preset.ts";
import { describeScreenFit } from "../../web/recorder/screen-fit.ts";

const { safeZones } = defaultPreset;

describe("describeScreenFit", () => {
  test("describes the split layout for a 16:9 window", () => {
    expect(describeScreenFit({ width: 1920, height: 1080 }, "split", safeZones)).toBe(
      "Split: each recorded pixel of the window becomes 0.98 pixels of the short. " +
        "The short shows the middle 58% of the window's width and all of its height. " +
        "A window about as wide as it is tall would show all of it.",
    );
  });

  test("describes the circle layout for a 16:9 window", () => {
    expect(describeScreenFit({ width: 1920, height: 1080 }, "circle", safeZones)).toBe(
      "Circle cam: each recorded pixel of the window becomes 1.78 pixels of the short. " +
        "The short shows the middle 32% of the window's width and all of its height. " +
        "A window shaped like the short, 9 wide by 16 tall, would show all of it.",
    );
  });

  test("says that the face layout does not show the window", () => {
    expect(describeScreenFit({ width: 1920, height: 1080 }, "face", safeZones)).toBe(
      "Face: the window is not shown in this layout.",
    );
  });

  test("rounds the scale to two places and the share to whole percents", () => {
    // 1440 x 900 in the 1080 x 1056 slot: scale 1056 / 900 = 1.1733, width share 1080 / 1.1733 / 1440.
    const text = describeScreenFit({ width: 1440, height: 900 }, "split", safeZones);
    expect(text).toContain("becomes 1.17 pixels of the short");
    expect(text).toContain("the middle 64% of the window's width and all of its height");
  });

  test("leaves out the tip and says the height is cut when the sides are not", () => {
    const text = describeScreenFit({ width: 1000, height: 1000 }, "split", safeZones);
    expect(text).toContain(
      "The short shows all of the window's width and the middle 98% of its height.",
    );
    expect(text).not.toContain("would show all of it");
  });

  test("treats a share that rounds to 100% as all of it", () => {
    // 1080 x 1054 is 0.2% narrower than the split slot's shape, so a hair of
    // height is cut, which rounds to 100%.
    const text = describeScreenFit({ width: 1080, height: 1054 }, "split", safeZones);
    expect(text).toContain("The short shows all of the window.");
    expect(text).not.toContain("would show all of it");
  });

  test("states a scale of 1 with two places", () => {
    const text = describeScreenFit({ width: 1080, height: 1056 }, "split", safeZones);
    expect(text).toContain("becomes 1.00 pixels of the short");
    expect(text).toContain("The short shows all of the window.");
  });
});
