import { describe, expect, test } from "vite-plus/test";
import { createShortProject } from "../../src/edit/short-project-defaults.ts";
import { defaultPreset } from "../../src/schemas/preset.ts";
import { parseShortProject } from "../../src/schemas/short-project.ts";

const recordedTakes = {
  version: 1 as const,
  recordedAt: "2026-10-17T13:45:00.000Z",
  takes: { cam: "takes/cam.webm", screen: "takes/screen.webm", screenOffsetMs: 42 },
};

const transcript = {
  version: 1 as const,
  model: "ggml-small.en.bin",
  language: "en",
  durationMs: 4000,
  words: [
    { text: "Anchor", startMs: 500, endMs: 800 },
    { text: "scroll", startMs: 900, endMs: 1300 },
  ],
};

describe("createShortProject", () => {
  test("starts with nothing removed, a trim around the words and the preset's settings", () => {
    expect(createShortProject({ recordedTakes, transcript, preset: defaultPreset })).toEqual({
      version: 1,
      takes: recordedTakes.takes,
      trim: { startMs: 400, endMs: 1400 },
      removedWords: [],
      pauseThresholdMs: 600,
      segments: [{ fromWord: 0, layout: "split" }],
    });
  });

  test("creates a valid short.json", () => {
    const project = createShortProject({ recordedTakes, transcript, preset: defaultPreset });
    expect(parseShortProject(project).success).toBe(true);
  });

  test("trims to the whole recording when nobody speaks", () => {
    const silent = { ...transcript, words: [] };
    const project = createShortProject({
      recordedTakes,
      transcript: silent,
      preset: defaultPreset,
    });
    expect(project.trim).toEqual({ startMs: 0, endMs: 4000 });
  });
});
