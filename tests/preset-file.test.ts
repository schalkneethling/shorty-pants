import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { ShortError } from "../src/errors.ts";
import { readPreset } from "../src/preset-file.ts";
import { defaultPreset } from "../src/schemas/preset.ts";

let shortsRoot: string;

beforeEach(() => {
  shortsRoot = realpathSync(mkdtempSync(join(tmpdir(), "shorty-pants-preset-")));
});

afterEach(() => {
  rmSync(shortsRoot, { recursive: true, force: true });
});

describe("readPreset", () => {
  test("uses the default preset when the shorts root has no preset.json", async () => {
    await expect(readPreset(shortsRoot)).resolves.toEqual(defaultPreset);
  });

  test("reads preset.json from the shorts root", async () => {
    const preset = { ...defaultPreset, pauseThresholdMs: 900 };
    writeFileSync(join(shortsRoot, "preset.json"), JSON.stringify(preset));
    await expect(readPreset(shortsRoot)).resolves.toEqual(preset);
  });

  test("fills in the accent color for a preset written before it existed", async () => {
    const { accentColor: _accentColor, ...captionsWithoutAccent } = defaultPreset.captions;
    writeFileSync(
      join(shortsRoot, "preset.json"),
      JSON.stringify({ ...defaultPreset, captions: captionsWithoutAccent }),
    );
    const preset = await readPreset(shortsRoot);
    expect(preset.captions.accentColor).toBe(defaultPreset.captions.accentColor);
  });

  test("explains a preset.json that is not valid", async () => {
    writeFileSync(join(shortsRoot, "preset.json"), JSON.stringify({ version: 2 }));
    const reading = readPreset(shortsRoot);
    await expect(reading).rejects.toBeInstanceOf(ShortError);
    await expect(reading).rejects.toThrow("preset.json is not valid");
  });

  test("explains a preset.json that is not JSON", async () => {
    writeFileSync(join(shortsRoot, "preset.json"), "{ nope");
    await expect(readPreset(shortsRoot)).rejects.toThrow("is not valid JSON");
  });
});
