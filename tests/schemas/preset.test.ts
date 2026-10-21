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

  test("the default bottom safe zone covers the measured Shorts overlay, with a small margin", () => {
    // Measured from desktop Shorts: the channel row, the title and a linked
    // video pill reach about 270 pixels up from the bottom of the frame.
    const tallestMeasuredOverlay = 270;
    expect(defaultPreset.safeZones.bottom).toBeGreaterThanOrEqual(tallestMeasuredOverlay);
    expect(defaultPreset.safeZones.bottom).toBeLessThanOrEqual(tallestMeasuredOverlay + 32);
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
