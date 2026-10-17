import { describe, expect, test } from "vite-plus/test";
import {
  keptDurationMs,
  nextPlayableMs,
  screenTimeMs,
  shortTimeMs,
} from "../../src/edit/playback.ts";

const ranges = [
  { startMs: 1000, endMs: 2000 },
  { startMs: 3000, endMs: 3500 },
];

describe("nextPlayableMs", () => {
  test("keeps a time that is inside a kept range", () => {
    expect(nextPlayableMs(ranges, 1500)).toBe(1500);
  });

  test("jumps over a cut to the start of the next kept range", () => {
    expect(nextPlayableMs(ranges, 2000)).toBe(3000);
    expect(nextPlayableMs(ranges, 2500)).toBe(3000);
  });

  test("jumps to the first kept range from before the trim", () => {
    expect(nextPlayableMs(ranges, 0)).toBe(1000);
  });

  test("returns null after the last kept range", () => {
    expect(nextPlayableMs(ranges, 3500)).toBeNull();
    expect(nextPlayableMs([], 0)).toBeNull();
  });
});

describe("keptDurationMs", () => {
  test("adds up the kept ranges", () => {
    expect(keptDurationMs(ranges)).toBe(1500);
  });
});

describe("shortTimeMs", () => {
  test("gives the position in the finished short for a camera time", () => {
    expect(shortTimeMs(ranges, 1000)).toBe(0);
    expect(shortTimeMs(ranges, 1500)).toBe(500);
    expect(shortTimeMs(ranges, 3200)).toBe(1200);
  });

  test("counts a time inside a cut as the end of what came before", () => {
    expect(shortTimeMs(ranges, 2500)).toBe(1000);
  });
});

describe("screenTimeMs", () => {
  test("shifts the camera time by the offset of the screen recording", () => {
    expect(screenTimeMs(1000, 42)).toBe(958);
    expect(screenTimeMs(1000, -120)).toBe(1120);
  });

  test("never goes before the start of the screen recording", () => {
    expect(screenTimeMs(10, 42)).toBe(0);
  });
});
