import { describe, expect, test } from "vite-plus/test";
import { captionCues, captionFrames, renderPieces } from "../../src/render/timeline.ts";
import { chunkCaptions } from "../../src/edit/captions.ts";

const words = [
  { text: "Anchor", startMs: 300, endMs: 700 },
  { text: "positioning", startMs: 800, endMs: 1300 },
  { text: "ignores", startMs: 1400, endMs: 1800 },
  { text: "the", startMs: 2600, endMs: 2800 },
  { text: "scroll", startMs: 2900, endMs: 3400 },
];
const keepRanges = [
  { startMs: 200, endMs: 1900 },
  { startMs: 2500, endMs: 3500 },
];

describe("renderPieces", () => {
  test("gives each kept range the layout of its words", () => {
    expect(
      renderPieces({ words, keepRanges, segments: [{ fromWord: 0, layout: "split" }] }),
    ).toEqual([
      { startMs: 200, endMs: 1900, layout: "split" },
      { startMs: 2500, endMs: 3500, layout: "split" },
    ]);
  });

  test("splits a kept range where the layout changes, just before the word", () => {
    const segments = [
      { fromWord: 0, layout: "split" as const },
      { fromWord: 2, layout: "face" as const },
    ];
    // "ignores" starts at 1400; the change comes 100 ms before it, as the
    // padding kept around each word starts there.
    expect(renderPieces({ words, keepRanges, segments })).toEqual([
      { startMs: 200, endMs: 1300, layout: "split" },
      { startMs: 1300, endMs: 1900, layout: "face" },
      { startMs: 2500, endMs: 3500, layout: "face" },
    ]);
  });

  test("never moves a layout change before the end of the previous word", () => {
    const closeWords = [
      { text: "one", startMs: 0, endMs: 1000 },
      { text: "two", startMs: 1020, endMs: 1500 },
    ];
    const segments = [
      { fromWord: 0, layout: "split" as const },
      { fromWord: 1, layout: "circle" as const },
    ];
    expect(
      renderPieces({ words: closeWords, keepRanges: [{ startMs: 0, endMs: 1600 }], segments }),
    ).toEqual([
      { startMs: 0, endMs: 1000, layout: "split" },
      { startMs: 1000, endMs: 1600, layout: "circle" },
    ]);
  });

  test("leaves out a piece shorter than one frame", () => {
    const segments = [
      { fromWord: 0, layout: "split" as const },
      { fromWord: 2, layout: "face" as const },
    ];
    // The kept range ends 10 ms after the layout change at 1300.
    const ranges = [{ startMs: 200, endMs: 1310 }];
    expect(renderPieces({ words, keepRanges: ranges, segments })).toEqual([
      { startMs: 200, endMs: 1300, layout: "split" },
    ]);
  });
});

describe("captionCues", () => {
  const chunks = chunkCaptions(
    words.filter((word) => word.text !== "positioning"),
    { wordsPerChunk: 3, maxChunkCharacters: 24 },
    keepRanges,
  );

  test("times each word of each chunk in the short, so the current word can be lit", () => {
    const cues = captionCues(chunks, keepRanges);
    expect(cues[0]).toEqual({ chunkIndex: 0, wordIndex: 0, startMs: 100, endMs: 1200 });
    // Every cue starts where the one before it ends, or later.
    for (let index = 1; index < cues.length; index += 1) {
      expect(cues[index]!.startMs).toBeGreaterThanOrEqual(cues[index - 1]!.endMs);
    }
  });

  test("ends the last cue when the last chunk leaves the screen", () => {
    const cues = captionCues(chunks, keepRanges);
    // "scroll" ends at 3400, which is 2600 into the short.
    expect(cues.at(-1)!.endMs).toBe(2600);
  });
});

describe("captionFrames", () => {
  test("fills the gaps between cues with a blank frame, from the start to the end of the short", () => {
    const cues = [
      { chunkIndex: 0, wordIndex: 0, startMs: 100, endMs: 500 },
      { chunkIndex: 0, wordIndex: 1, startMs: 500, endMs: 900 },
      { chunkIndex: 1, wordIndex: 0, startMs: 1200, endMs: 1500 },
    ];
    expect(captionFrames(cues, 2000)).toEqual([
      { image: null, durationMs: 100 },
      { image: { chunkIndex: 0, wordIndex: 0 }, durationMs: 400 },
      { image: { chunkIndex: 0, wordIndex: 1 }, durationMs: 400 },
      { image: null, durationMs: 300 },
      { image: { chunkIndex: 1, wordIndex: 0 }, durationMs: 300 },
      { image: null, durationMs: 500 },
    ]);
  });

  test("is one blank frame for a short without captions", () => {
    expect(captionFrames([], 1500)).toEqual([{ image: null, durationMs: 1500 }]);
  });
});
