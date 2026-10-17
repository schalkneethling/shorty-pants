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
});
