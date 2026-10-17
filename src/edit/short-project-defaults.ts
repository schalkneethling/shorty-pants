import type { Preset } from "../schemas/preset.ts";
import type { RecordedTakes } from "../schemas/recorded-takes.ts";
import type { ShortProject } from "../schemas/short-project.ts";
import type { Transcript } from "../schemas/transcript.ts";
import { defaultTrim } from "./cut-list.ts";

/** The short.json a new short starts with, before any edits. */
export function createShortProject(input: {
  recordedTakes: RecordedTakes;
  transcript: Transcript;
  preset: Preset;
}): ShortProject {
  return {
    version: 1,
    takes: input.recordedTakes.takes,
    trim: defaultTrim(input.transcript),
    removedWords: [],
    pauseThresholdMs: input.preset.pauseThresholdMs,
    segments: [{ fromWord: 0, layout: input.preset.defaultLayout }],
  };
}
