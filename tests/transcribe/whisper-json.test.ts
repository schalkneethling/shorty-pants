import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { parseWhisperWords } from "../../src/transcribe/whisper-json.ts";

// Shaped like the output of whisper-cli 1.9.5 with -oj -ml 1 -sow: one
// segment per word, offsets in milliseconds, and text with a leading space.
const fixture: unknown = JSON.parse(
  readFileSync(new URL("../fixtures/whisper-words.json", import.meta.url), "utf8"),
);

describe("parseWhisperWords", () => {
  test("turns word segments into words with start and end times", () => {
    const words = parseWhisperWords(fixture);
    expect(words.slice(0, 3)).toEqual([
      { text: "Anchor", startMs: 0, endMs: 320 },
      { text: "positioning", startMs: 320, endMs: 910 },
      { text: "ignores", startMs: 910, endMs: 1380 },
    ]);
  });

  test("attaches punctuation to the word before it", () => {
    const words = parseWhisperWords(fixture);
    expect(words[3]).toEqual({ text: "scroll.", startMs: 1380, endMs: 1800 });
  });

  test("leaves out non-speech markers and empty segments", () => {
    const texts = parseWhisperWords(fixture).map((word) => word.text);
    expect(texts).toEqual(["Anchor", "positioning", "ignores", "scroll.", "Here's", "why"]);
  });

  test("returns no words for an empty transcription", () => {
    const empty = { ...(fixture as object), transcription: [] };
    expect(parseWhisperWords(empty)).toEqual([]);
  });

  test("keeps punctuation that comes before any word as a word of its own", () => {
    const input = {
      transcription: [
        { offsets: { from: 0, to: 100 }, text: " -" },
        { offsets: { from: 100, to: 400 }, text: " so" },
      ],
    };
    expect(parseWhisperWords(input)).toEqual([
      { text: "-", startMs: 0, endMs: 100 },
      { text: "so", startMs: 100, endMs: 400 },
    ]);
  });

  test("rejects output that does not look like whisper-cli JSON", () => {
    expect(() => parseWhisperWords({ segments: [] })).toThrow(/whisper/i);
  });

  test("rejects a segment that ends before it starts", () => {
    const input = { transcription: [{ offsets: { from: 500, to: 400 }, text: " backwards" }] };
    expect(() => parseWhisperWords(input)).toThrow(/whisper/i);
  });
});
