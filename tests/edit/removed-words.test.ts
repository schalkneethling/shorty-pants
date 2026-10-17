import { describe, expect, test } from "vite-plus/test";
import {
  removedIndexesToRanges,
  removedRangesToIndexes,
  toggleRemoved,
} from "../../src/edit/removed-words.ts";

describe("removedIndexesToRanges", () => {
  test("turns word indexes into inclusive ranges", () => {
    expect(removedIndexesToRanges(new Set([9, 1, 2, 3, 7, 10]))).toEqual([
      [1, 3],
      [7, 7],
      [9, 10],
    ]);
  });

  test("returns no ranges when nothing is removed", () => {
    expect(removedIndexesToRanges(new Set())).toEqual([]);
  });
});

describe("removedRangesToIndexes", () => {
  test("expands overlapping and unordered ranges into one set of indexes", () => {
    expect(
      [
        ...removedRangesToIndexes([
          [7, 8],
          [1, 3],
          [2, 4],
        ]),
      ].sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 7, 8]);
  });
});

describe("toggleRemoved", () => {
  test("cuts the selected words", () => {
    expect(toggleRemoved([[1, 1]], [4, 5])).toEqual([
      [1, 1],
      [4, 5],
    ]);
  });

  test("joins a cut that touches an existing one", () => {
    expect(toggleRemoved([[1, 3]], [4, 5])).toEqual([[1, 5]]);
  });

  test("restores the selected words when all of them are already cut", () => {
    expect(toggleRemoved([[1, 5]], [2, 3])).toEqual([
      [1, 1],
      [4, 5],
    ]);
  });

  test("cuts the whole selection when only part of it is cut", () => {
    expect(toggleRemoved([[2, 2]], [1, 3])).toEqual([[1, 3]]);
  });

  test("changes nothing for an empty selection", () => {
    expect(toggleRemoved([[2, 2]], [])).toEqual([[2, 2]]);
  });
});
