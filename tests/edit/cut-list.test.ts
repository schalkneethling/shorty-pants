import { describe, expect, test } from "vite-plus/test";
import { computeKeepRanges, type CutListInput } from "../../src/edit/cut-list.ts";

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

describe("computeKeepRanges", () => {
  test("cuts a pause longer than the threshold and pads each word", () => {
    expect(computeKeepRanges(input())).toEqual([
      { startMs: 0, endMs: 800 },
      { startMs: 1400, endMs: 2700 },
    ]);
  });

  test("keeps a pause that is shorter than the threshold", () => {
    expect(computeKeepRanges(input({ pauseThresholdMs: 1000 }))).toEqual([
      { startMs: 0, endMs: 2700 },
    ]);
  });

  test("cuts a removed word without padding into it", () => {
    expect(computeKeepRanges(input({ removedWords: [[1, 1]] }))).toEqual([
      { startMs: 0, endMs: 350 },
      { startMs: 1400, endMs: 2700 },
    ]);
  });

  test("cuts a removed word in the middle of a sentence", () => {
    expect(computeKeepRanges(input({ removedWords: [[3, 3]] }))).toEqual([
      { startMs: 0, endMs: 800 },
      { startMs: 1400, endMs: 1850 },
      { startMs: 2200, endMs: 2700 },
    ]);
  });

  test("removes every word in an inclusive range", () => {
    expect(computeKeepRanges(input({ removedWords: [[2, 4]] }))).toEqual([
      { startMs: 0, endMs: 800 },
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
      { startMs: 1400, endMs: 2700 },
    ]);
  });

  test("returns nothing when every word is removed", () => {
    expect(computeKeepRanges(input({ removedWords: [[0, 4]] }))).toEqual([]);
  });

  test("returns nothing when the trim leaves no words", () => {
    expect(computeKeepRanges(input({ trim: { startMs: 900, endMs: 1400 } }))).toEqual([]);
  });

  test("returns nothing for a take without words", () => {
    expect(computeKeepRanges(input({ words: [] }))).toEqual([]);
  });

  test("ignores removed word ranges past the last word", () => {
    expect(computeKeepRanges(input({ removedWords: [[10, 12]] }))).toEqual(
      computeKeepRanges(input()),
    );
  });

  test("returns ranges in order that never overlap and stay inside the trim", () => {
    const trim = { startMs: 100, endMs: 2500 };
    const ranges = computeKeepRanges(input({ trim, removedWords: [[1, 1]], pauseThresholdMs: 0 }));
    ranges.forEach((range, index) => {
      expect(range.endMs).toBeGreaterThan(range.startMs);
      expect(range.startMs).toBeGreaterThanOrEqual(trim.startMs);
      expect(range.endMs).toBeLessThanOrEqual(trim.endMs);
      const previous = ranges[index - 1];
      if (previous !== undefined) {
        expect(range.startMs).toBeGreaterThan(previous.endMs);
      }
    });
  });
});
