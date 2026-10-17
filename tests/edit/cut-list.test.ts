import { describe, expect, test } from "vite-plus/test";
import {
  computeKeepRanges,
  defaultTrim,
  type CutListInput,
  type KeepRange,
} from "../../src/edit/cut-list.ts";

// Five words. The 800 ms gap between the second and third word is a pause.
const words = [
  { text: "Anchor", startMs: 0, endMs: 300 },
  { text: "positioning", startMs: 350, endMs: 700 },
  { text: "ignores", startMs: 1500, endMs: 1800 },
  { text: "the", startMs: 1850, endMs: 2200 },
  { text: "scroll", startMs: 2250, endMs: 2600 },
];

function input(overrides: Partial<CutListInput> = {}): CutListInput {
  return {
    words,
    trim: { startMs: 0, endMs: 3000 },
    removedWords: [],
    pauseThresholdMs: 600,
    paddingMs: 100,
    ...overrides,
  };
}

function overlaps(range: KeepRange, word: { startMs: number; endMs: number }): boolean {
  return range.startMs < word.endMs && range.endMs > word.startMs;
}

describe("computeKeepRanges", () => {
  test("cuts a pause longer than the threshold and pads each word", () => {
    expect(computeKeepRanges(input())).toEqual([
      { startMs: 0, endMs: 800 },
      { startMs: 1400, endMs: 3000 },
    ]);
  });

  test("keeps the silence between a trim handle and the nearest word", () => {
    const trim = { startMs: 0, endMs: 5000 };
    expect(computeKeepRanges(input({ trim }))).toEqual([
      { startMs: 0, endMs: 800 },
      { startMs: 1400, endMs: 5000 },
    ]);
  });

  test("keeps a pause that is shorter than the threshold", () => {
    expect(computeKeepRanges(input({ pauseThresholdMs: 1000 }))).toEqual([
      { startMs: 0, endMs: 3000 },
    ]);
  });

  test("cuts a removed word without padding into it", () => {
    expect(computeKeepRanges(input({ removedWords: [[1, 1]] }))).toEqual([
      { startMs: 0, endMs: 350 },
      { startMs: 1400, endMs: 3000 },
    ]);
  });

  test("cuts a removed word in the middle of a sentence", () => {
    expect(computeKeepRanges(input({ removedWords: [[3, 3]] }))).toEqual([
      { startMs: 0, endMs: 800 },
      { startMs: 1400, endMs: 1850 },
      { startMs: 2200, endMs: 3000 },
    ]);
  });

  test("ends at the last kept word when the words after it are removed", () => {
    expect(computeKeepRanges(input({ removedWords: [[2, 4]] }))).toEqual([
      { startMs: 0, endMs: 800 },
    ]);
  });

  test("starts at the first kept word when the words before it are removed", () => {
    expect(computeKeepRanges(input({ removedWords: [[0, 1]] }))).toEqual([
      { startMs: 1400, endMs: 3000 },
    ]);
  });

  test("clips the ranges to the trim", () => {
    const trim = { startMs: 500, endMs: 2000 };
    expect(computeKeepRanges(input({ trim }))).toEqual([
      { startMs: 500, endMs: 800 },
      { startMs: 1400, endMs: 2000 },
    ]);
  });

  test("merges ranges whose padding overlaps", () => {
    // With a threshold of 0 every gap is a pause, but the 50 ms gaps are
    // smaller than the padding on both sides, so the ranges overlap.
    expect(computeKeepRanges(input({ pauseThresholdMs: 0 }))).toEqual([
      { startMs: 0, endMs: 800 },
      { startMs: 1400, endMs: 3000 },
    ]);
  });

  test("never brings back a removed word through the padding of a short kept word", () => {
    const shortWords = [
      { text: "so", startMs: 0, endMs: 300 },
      { text: "a", startMs: 300, endMs: 340 },
      { text: "um", startMs: 340, endMs: 700 },
      { text: "next", startMs: 700, endMs: 1000 },
    ];
    const ranges = computeKeepRanges(
      input({ words: shortWords, removedWords: [[2, 2]], trim: { startMs: 0, endMs: 1100 } }),
    );
    expect(ranges).toEqual([
      { startMs: 0, endMs: 340 },
      { startMs: 700, endMs: 1100 },
    ]);
  });

  test("never brings back a removed word, even with very large padding", () => {
    const shortWords = [
      { text: "a", startMs: 1000, endMs: 1300 },
      { text: "b", startMs: 1300, endMs: 1400 },
      { text: "c", startMs: 1400, endMs: 2000 },
    ];
    const ranges = computeKeepRanges(
      input({
        words: shortWords,
        removedWords: [[2, 2]],
        paddingMs: 5000,
        trim: { startMs: 0, endMs: 10_000 },
      }),
    );
    expect(ranges.some((range) => overlaps(range, shortWords[2]!))).toBe(false);
  });

  test("returns nothing when every word is removed", () => {
    expect(computeKeepRanges(input({ removedWords: [[0, 4]] }))).toEqual([]);
  });

  test("keeps the whole trim when it holds no words", () => {
    const trim = { startMs: 900, endMs: 1400 };
    expect(computeKeepRanges(input({ trim }))).toEqual([trim]);
  });

  test("keeps the whole trim for a take without words, such as a silent demo", () => {
    expect(computeKeepRanges(input({ words: [] }))).toEqual([{ startMs: 0, endMs: 3000 }]);
  });

  test("ignores removed word ranges past the last word", () => {
    expect(computeKeepRanges(input({ removedWords: [[10, 12]] }))).toEqual(
      computeKeepRanges(input()),
    );
  });

  test("returns ranges in order that never overlap, stay inside the trim and skip removed words", () => {
    const trim = { startMs: 100, endMs: 2500 };
    const removedWords: [number, number][] = [
      [3, 3],
      [1, 1],
      [1, 1],
    ];
    const ranges = computeKeepRanges(input({ trim, removedWords, pauseThresholdMs: 0 }));
    ranges.forEach((range, index) => {
      expect(range.endMs).toBeGreaterThan(range.startMs);
      expect(range.startMs).toBeGreaterThanOrEqual(trim.startMs);
      expect(range.endMs).toBeLessThanOrEqual(trim.endMs);
      expect(overlaps(range, words[1]!)).toBe(false);
      expect(overlaps(range, words[3]!)).toBe(false);
      const previous = ranges[index - 1];
      if (previous !== undefined) {
        expect(range.startMs).toBeGreaterThan(previous.endMs);
      }
    });
  });
});

describe("defaultTrim", () => {
  test("starts and ends just around the first and last words", () => {
    expect(defaultTrim({ words, durationMs: 4000 }, 100)).toEqual({ startMs: 0, endMs: 2700 });
  });

  test("never reaches past the end of the recording", () => {
    expect(defaultTrim({ words, durationMs: 2650 }, 100)).toEqual({ startMs: 0, endMs: 2650 });
  });

  test("covers the whole recording when there are no words", () => {
    expect(defaultTrim({ words: [], durationMs: 4000 }, 100)).toEqual({ startMs: 0, endMs: 4000 });
  });
});
