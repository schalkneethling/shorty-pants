import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { parseWhisperWords } from "../../src/transcribe/whisper-json.ts";

// Shaped like the output of whisper-cli 1.9.5 with -ojf: segments with their
// tokens, each token with offsets in milliseconds. Token times are refined
// from the audio energy, so there are gaps between words where nobody speaks.
const fixture: unknown = JSON.parse(
  readFileSync(new URL("../fixtures/whisper-full.json", import.meta.url), "utf8"),
);

function token(text: string, from?: number, to?: number) {
  return from === undefined ? { text } : { text, offsets: { from, to } };
}

function output(...tokens: ReturnType<typeof token>[]) {
  return { transcription: [{ offsets: { from: 0, to: 10_000 }, text: "", tokens }] };
}

describe("parseWhisperWords", () => {
  test("builds words from tokens and keeps the pauses between them", () => {
    const words = parseWhisperWords(fixture);
    expect(words.slice(0, 2)).toEqual([
      { text: "Anchor", startMs: 0, endMs: 300 },
      { text: "positioning", startMs: 320, endMs: 900 },
    ]);
    expect(words[4]!.startMs - words[3]!.endMs).toBe(1450);
  });

  test("joins tokens without a leading space to the word they belong to", () => {
    const words = parseWhisperWords(fixture);
    expect(words[3]).toEqual({ text: "scroll.", startMs: 1350, endMs: 1750 });
  });

  test("leaves out special tokens, sound markers and music symbols", () => {
    const texts = parseWhisperWords(fixture).map((word) => word.text);
    expect(texts).toEqual(["Anchor", "positioning", "ignores", "scroll.", "“Here's”", "why"]);
  });

  test("attaches opening punctuation to the next word without changing its start", () => {
    const words = parseWhisperWords(fixture);
    expect(words[4]).toEqual({ text: "“Here's”", startMs: 3200, endMs: 3550 });
  });

  test("attaches closing punctuation to the previous word without stretching it", () => {
    const words = parseWhisperWords(output(token(" so", 0, 300), token(" —", 900, 1500)));
    expect(words).toEqual([{ text: "so—", startMs: 0, endMs: 300 }]);
  });

  test("keeps the text of a token without times and takes the times from the others", () => {
    const words = parseWhisperWords(output(token(" Hello", 100, 400), token(",")));
    expect(words).toEqual([{ text: "Hello,", startMs: 100, endMs: 400 }]);
  });

  test("only looks for the end of a sound marker in the segment where it starts", () => {
    const input = {
      transcription: [
        {
          offsets: { from: 0, to: 1000 },
          text: "",
          tokens: [token(" (so", 0, 300), token(" anyway", 300, 700)],
        },
        {
          offsets: { from: 1000, to: 2000 },
          text: "",
          tokens: [token(" this", 1000, 1300), token(" works)", 1300, 1700)],
        },
      ],
    };
    expect(parseWhisperWords(input).map((word) => word.text)).toEqual([
      "(so",
      "anyway",
      "this",
      "works)",
    ]);
  });

  test("returns no words for an empty transcription", () => {
    expect(parseWhisperWords({ transcription: [] })).toEqual([]);
  });

  test("explains that full JSON output is needed when segments have no tokens", () => {
    const input = { transcription: [{ offsets: { from: 0, to: 300 }, text: " Hello" }] };
    expect(() => parseWhisperWords(input)).toThrow(/-ojf/);
  });

  test("rejects output that does not look like whisper-cli JSON", () => {
    expect(() => parseWhisperWords({ segments: [] })).toThrow(/whisper/i);
  });
});
