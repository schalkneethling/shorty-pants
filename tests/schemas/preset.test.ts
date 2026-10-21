import { describe, expect, test } from "vite-plus/test";
import { defaultPreset, parsePreset } from "../../src/schemas/preset.ts";

describe("parsePreset", () => {
  test("accepts the default preset", () => {
    expect(parsePreset(defaultPreset).success).toBe(true);
  });

  test("the default preset uses Noto Sans with white text on dark purple", () => {
    expect(defaultPreset.captions.fontFamily).toBe("Noto Sans");
    expect(defaultPreset.captions.textColor).toBe("#ffffff");
    expect(defaultPreset.captions.backgroundColor).toBe("#2e1065");
  });

  test("the default preset uses the split layout and three words per caption", () => {
    expect(defaultPreset.defaultLayout).toBe("split");
    expect(defaultPreset.captions.wordsPerChunk).toBe(3);
  });

  // How far the Shorts player's own interface reaches into the frame on each
  // side, in frame pixels. The phone player covers more than desktop on every
  // side, so these come from a Short playing on YouTube for Android.
  const measuredPhoneOverlay = { top: 247, bottom: 331, left: 61, right: 155 };

  test.each(["top", "bottom", "left", "right"] as const)(
    "the default %s safe zone covers the measured phone overlay, with a small margin",
    (side) => {
      const measured = measuredPhoneOverlay[side];
      expect(defaultPreset.safeZones[side]).toBeGreaterThanOrEqual(measured);
      expect(defaultPreset.safeZones[side]).toBeLessThanOrEqual(measured + 32);
    },
  );

  test("the default desktop safe zones cover the measured desktop overlay, and nothing at the top or right", () => {
    // On desktop, the channel row, the title and a linked video pill reach
    // about 270 pixels up, the text starts about 40 pixels in, and the
    // buttons sit outside the video.
    expect(defaultPreset.desktopSafeZones).toEqual({ top: 0, bottom: 288, left: 48, right: 0 });
  });

  test("gives a preset without desktop safe zones the default ones", () => {
    const { desktopSafeZones: _omitted, ...presetWithoutDesktopZones } = defaultPreset;
    const result = parsePreset(presetWithoutDesktopZones);
    expect(result.success && result.data.desktopSafeZones).toEqual(defaultPreset.desktopSafeZones);
  });

  test("rejects a color that is not a six-digit hex value", () => {
    const preset = {
      ...defaultPreset,
      captions: { ...defaultPreset.captions, textColor: "white" },
    };
    const result = parsePreset(preset);
    expect(result.success).toBe(false);
  });

  test("rejects a caption chunk of zero words", () => {
    const preset = {
      ...defaultPreset,
      captions: { ...defaultPreset.captions, wordsPerChunk: 0 },
    };
    expect(parsePreset(preset).success).toBe(false);
  });

  test("rejects safe zones that cover the whole frame vertically", () => {
    const preset = {
      ...defaultPreset,
      safeZones: { ...defaultPreset.safeZones, top: 1000, bottom: 920 },
    };
    const result = parsePreset(preset);
    expect(result.success).toBe(false);
  });

  test("rejects safe zones that leave too little height for the headline, captions and camera", () => {
    const preset = {
      ...defaultPreset,
      safeZones: { ...defaultPreset.safeZones, top: 700, bottom: 800 },
    };
    const result = parsePreset(preset);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("888");
  });

  test("rejects safe zones that leave too little width for the circle camera", () => {
    const preset = {
      ...defaultPreset,
      safeZones: { ...defaultPreset.safeZones, left: 400, right: 400 },
    };
    expect(parsePreset(preset).success).toBe(false);
  });
});
