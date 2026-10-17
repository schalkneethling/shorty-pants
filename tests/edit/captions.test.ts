import { describe, expect, test } from "vite-plus/test";
import { captionAt, chunkCaptions, keptWords } from "../../src/edit/captions.ts";

const style = { wordsPerChunk: 3, maxChunkCharacters: 24 };

/** Words 400 ms long with 100 ms between them, starting at 0. */
function timedWords(texts: string[]) {
  return texts.map((text, index) => ({
    text,
    startMs: index * 500,
    endMs: index * 500 + 400,
  }));
}

function chunkTexts(texts: string[]) {
  return chunkCaptions(timedWords(texts), style).map((chunk) =>
    chunk.words.map((word) => word.text).join(" "),
  );
}

describe("chunkCaptions", () => {
  test("puts three words in each chunk by default", () => {
    expect(chunkTexts(["one", "two", "three", "four", "five", "six"])).toEqual([
      "one two three",
      "four five six",
    ]);
  });

  test("starts a new chunk before a chunk grows past the character limit", () => {
    expect(chunkTexts(["positioning", "anchors", "everything", "now"])).toEqual([
      "positioning anchors",
      "everything now",
    ]);
  });

  test("starts a new chunk after the end of a sentence", () => {
    expect(chunkTexts(["It", "broke.", "Then", "it", "worked"])).toEqual([
      "It broke.",
      "Then it worked",
    ]);
  });

  test("never leaves one word on its own at the end of a sentence", () => {
    expect(chunkTexts(["It", "is", "really", "fast.", "Yes"])).toEqual([
      "It is",
      "really fast.",
      "Yes",
    ]);
  });

  test("treats the last word of the transcript as the end of a sentence", () => {
    expect(chunkTexts(["one", "two", "three", "four"])).toEqual(["one two", "three four"]);
  });

  test("keeps a sentence of one word as its own chunk", () => {
    expect(chunkTexts(["Wow.", "That", "is", "fast."])).toEqual(["Wow.", "That is fast."]);
  });

  test("times each chunk from its first word to its last", () => {
    const [first] = chunkCaptions(timedWords(["one", "two", "three", "four"]), style);
    expect(first).toMatchObject({ startMs: 0, endMs: 900 });
  });

  test("holds a chunk on screen across a short gap before the next one", () => {
    const [first, second] = chunkCaptions(
      timedWords(["one", "two", "three", "four", "five", "six"]),
      style,
    );
    // "three" ends at 1400 and "four" starts at 1500.
    expect(first!.displayEndMs).toBe(second!.startMs);
  });

  test("lets a chunk end with its last word before a long gap", () => {
    const words = [
      { text: "one", startMs: 0, endMs: 400 },
      { text: "two", startMs: 3000, endMs: 3400 },
    ];
    const [first] = chunkCaptions(words, { ...style, wordsPerChunk: 1 });
    expect(first!.displayEndMs).toBe(400);
  });
});

describe("keptWords", () => {
  const words = timedWords(["one", "two", "three"]);

  test("keeps the words whose middle falls inside a kept range", () => {
    // "two" runs from 500 to 900, so its middle at 700 is cut.
    const ranges = [
      { startMs: 0, endMs: 450 },
      { startMs: 950, endMs: 1500 },
    ];
    expect(keptWords(words, ranges).map((word) => word.text)).toEqual(["one", "three"]);
  });
});

describe("captionAt", () => {
  const chunks = chunkCaptions(timedWords(["one", "two", "three", "four"]), style);

  test("finds the chunk on screen and the word being said", () => {
    expect(captionAt(chunks, 600)).toEqual({ chunk: chunks[0], wordIndex: 1 });
  });

  test("keeps the last word lit between words", () => {
    // 450 is between "one" (ends at 400) and "two" (starts at 500).
    expect(captionAt(chunks, 450)).toEqual({ chunk: chunks[0], wordIndex: 0 });
  });

  test("shows nothing before the first chunk or after the last", () => {
    expect(captionAt(chunks, -1)).toBeNull();
    expect(captionAt(chunks, 99_999)).toBeNull();
  });
});
