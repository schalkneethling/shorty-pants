import { describe, expect, test } from "vite-plus/test";
import {
  captionCues,
  captionFrames,
  captionFramesBetween,
  frameCount,
  framePieces,
  renderPieces,
  splitCuesAtLayoutChanges,
} from "../../src/render/timeline.ts";
import { chunkCaptions } from "../../src/edit/captions.ts";
import { computeKeepRanges } from "../../src/edit/cut-list.ts";
import { keptDurationMs } from "../../src/edit/playback.ts";

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

  test("keeps a piece shorter than one frame, so the frame grid still counts its time", () => {
    const segments = [
      { fromWord: 0, layout: "split" as const },
      { fromWord: 2, layout: "face" as const },
    ];
    // The kept range ends 10 ms after the layout change at 1300.
    const ranges = [{ startMs: 200, endMs: 1310 }];
    expect(renderPieces({ words, keepRanges: ranges, segments })).toEqual([
      { startMs: 200, endMs: 1300, layout: "split" },
      { startMs: 1300, endMs: 1310, layout: "face" },
    ]);
  });

  test("gives the short as many frames as its kept time, however many slivers the cuts leave", () => {
    // A short filler word just after each kept word is cut, which leaves a
    // 20 ms sliver of padding after it.
    const wordsWithFillers = Array.from({ length: 40 }, (_, index) => [
      { text: `word${index}`, startMs: 1000 * index, endMs: 1000 * index + 400 },
      { text: "um", startMs: 1000 * index + 420, endMs: 1000 * index + 480 },
    ]).flat();
    const removedWords = wordsWithFillers.flatMap((_, index) =>
      index % 2 === 1 ? [[index, index] as [number, number]] : [],
    );
    const ranges = computeKeepRanges({
      words: wordsWithFillers,
      trim: { startMs: 0, endMs: 40_000 },
      removedWords,
      pauseThresholdMs: 600,
    });
    const pieces = framePieces(
      renderPieces({
        words: wordsWithFillers,
        keepRanges: ranges,
        segments: [{ fromWord: 0, layout: "split" }],
      }),
    );
    const frames = pieces.reduce((total, piece) => total + piece.frames, 0);
    expect(frames).toBe(frameCount(keptDurationMs(ranges)));
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
      { chunkIndex: 0, wordIndex: 0, startMs: 100, endMs: 500, layout: "split" as const },
      { chunkIndex: 0, wordIndex: 1, startMs: 500, endMs: 900, layout: "split" as const },
      { chunkIndex: 1, wordIndex: 0, startMs: 1200, endMs: 1500, layout: "face" as const },
    ];
    expect(captionFrames(cues, 2000)).toEqual([
      { image: null, durationMs: 100 },
      { image: { chunkIndex: 0, wordIndex: 0, layout: "split" }, durationMs: 400 },
      { image: { chunkIndex: 0, wordIndex: 1, layout: "split" }, durationMs: 400 },
      { image: null, durationMs: 300 },
      { image: { chunkIndex: 1, wordIndex: 0, layout: "face" }, durationMs: 300 },
      { image: null, durationMs: 500 },
    ]);
  });

  test("is one blank frame for a short without captions", () => {
    expect(captionFrames([], 1500)).toEqual([{ image: null, durationMs: 1500 }]);
  });
});

describe("framePieces", () => {
  test("puts every piece on one 30 fps grid, so the frames add up to the short's length", () => {
    // Three pieces of 917 ms: 2751 ms in all, which is 82.53 frames.
    const pieces = [0, 1, 2].map((index) => ({
      startMs: index * 2000,
      endMs: index * 2000 + 917,
      layout: "split" as const,
    }));
    const framed = framePieces(pieces);
    expect(framed.map((piece) => piece.frames)).toEqual([28, 27, 28]);
    expect(framed.reduce((total, piece) => total + piece.frames, 0)).toBe(frameCount(2751));
  });

  test("leaves out a piece that gets no frame on the grid, without moving the ones after it", () => {
    const framed = framePieces([
      { startMs: 0, endMs: 1000, layout: "split" },
      { startMs: 5000, endMs: 5010, layout: "face" },
      { startMs: 8000, endMs: 9000, layout: "circle" },
    ]);
    expect(framed.map((piece) => [piece.layout, piece.frames])).toEqual([
      ["split", 30],
      ["circle", 30],
    ]);
  });
});

describe("frameCount", () => {
  test("is the number of frames at 30 per second, rounded to the nearest", () => {
    expect(frameCount(1000)).toBe(30);
    expect(frameCount(2751)).toBe(83);
    expect(frameCount(16)).toBe(0);
  });
});

describe("splitCuesAtLayoutChanges", () => {
  test("splits a cue where the layout changes, so the caption moves with the picture", () => {
    const cues = [{ chunkIndex: 0, wordIndex: 1, startMs: 1000, endMs: 2000 }];
    const changes = [
      { fromMs: 0, layout: "split" as const },
      { fromMs: 1400, layout: "face" as const },
    ];
    expect(splitCuesAtLayoutChanges(cues, changes)).toEqual([
      { chunkIndex: 0, wordIndex: 1, startMs: 1000, endMs: 1400, layout: "split" },
      { chunkIndex: 0, wordIndex: 1, startMs: 1400, endMs: 2000, layout: "face" },
    ]);
  });

  test("gives a cue without a change inside it the layout in force", () => {
    const cues = [{ chunkIndex: 2, wordIndex: 0, startMs: 3000, endMs: 3500 }];
    const changes = [
      { fromMs: 0, layout: "split" as const },
      { fromMs: 1400, layout: "circle" as const },
    ];
    expect(splitCuesAtLayoutChanges(cues, changes)).toEqual([
      { chunkIndex: 2, wordIndex: 0, startMs: 3000, endMs: 3500, layout: "circle" },
    ]);
  });
});

describe("framePieces, where each piece falls in the short", () => {
  test("gives each piece its first frame in the short", () => {
    const framed = framePieces([
      { startMs: 0, endMs: 917, layout: "split" },
      { startMs: 2000, endMs: 2917, layout: "face" },
    ]);
    expect(framed.map((piece) => piece.firstFrame)).toEqual([0, 28]);
  });
});

describe("captionFramesBetween", () => {
  const frames = [
    { image: null, durationMs: 100 },
    { image: { chunkIndex: 0, wordIndex: 0, layout: "split" as const }, durationMs: 400 },
    { image: { chunkIndex: 0, wordIndex: 1, layout: "split" as const }, durationMs: 400 },
    { image: null, durationMs: 1100 },
  ];

  test("keeps the part of the caption sequence inside a stretch of the short", () => {
    expect(captionFramesBetween(frames, 300, 700)).toEqual([
      { image: { chunkIndex: 0, wordIndex: 0, layout: "split" }, durationMs: 200 },
      { image: { chunkIndex: 0, wordIndex: 1, layout: "split" }, durationMs: 200 },
    ]);
  });

  test("covers the whole stretch, with a blank past the end of the sequence", () => {
    expect(captionFramesBetween(frames, 1900, 2200)).toEqual([
      { image: null, durationMs: 100 },
      { image: null, durationMs: 200 },
    ]);
  });
});
