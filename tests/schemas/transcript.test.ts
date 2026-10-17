import { describe, expect, test } from "vite-plus/test";
import { parseTranscript } from "../../src/schemas/transcript.ts";

function validTranscript() {
  return {
    version: 1,
    model: "ggml-small.en.bin",
    language: "en",
    durationMs: 5000,
    words: [
      { text: "Anchor", startMs: 0, endMs: 320 },
      { text: "positioning", startMs: 320, endMs: 910 },
    ],
  };
}

describe("parseTranscript", () => {
  test("accepts a transcript with words in order", () => {
    expect(parseTranscript(validTranscript()).success).toBe(true);
  });

  test("accepts a transcript without words, for a silent take", () => {
    expect(parseTranscript({ ...validTranscript(), words: [] }).success).toBe(true);
  });

  test("rejects a word that ends before it starts", () => {
    const transcript = validTranscript();
    transcript.words[1] = { text: "positioning", startMs: 910, endMs: 320 };
    expect(parseTranscript(transcript).success).toBe(false);
  });

  test("rejects words that are out of order", () => {
    const transcript = validTranscript();
    transcript.words.reverse();
    expect(parseTranscript(transcript).success).toBe(false);
  });

  test("rejects a word that ends after the recording", () => {
    const transcript = validTranscript();
    transcript.durationMs = 500;
    expect(parseTranscript(transcript).success).toBe(false);
  });
});
