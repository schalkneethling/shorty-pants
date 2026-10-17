import { describe, expect, test } from "vite-plus/test";
import { nextFocusIndex, selectionBetween } from "../../web/editor/selection.ts";

describe("selectionBetween", () => {
  test("selects every word from the anchor to the focus, in either direction", () => {
    expect(selectionBetween(2, 5)).toEqual([2, 3, 4, 5]);
    expect(selectionBetween(5, 2)).toEqual([2, 3, 4, 5]);
    expect(selectionBetween(3, 3)).toEqual([3]);
  });
});

describe("nextFocusIndex", () => {
  test("moves to the next and previous word with the arrow keys", () => {
    expect(nextFocusIndex(3, "ArrowRight", 10)).toBe(4);
    expect(nextFocusIndex(3, "ArrowDown", 10)).toBe(4);
    expect(nextFocusIndex(3, "ArrowLeft", 10)).toBe(2);
    expect(nextFocusIndex(3, "ArrowUp", 10)).toBe(2);
  });

  test("moves to the first and last word with Home and End", () => {
    expect(nextFocusIndex(3, "Home", 10)).toBe(0);
    expect(nextFocusIndex(3, "End", 10)).toBe(9);
  });

  test("stays inside the transcript", () => {
    expect(nextFocusIndex(0, "ArrowLeft", 10)).toBe(0);
    expect(nextFocusIndex(9, "ArrowRight", 10)).toBe(9);
  });

  test("ignores other keys", () => {
    expect(nextFocusIndex(3, "a", 10)).toBeNull();
  });
});
