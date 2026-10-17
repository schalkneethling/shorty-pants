import type { KeepRange } from "./cut-list.ts";

/**
 * The camera time to play from: the time itself when it is kept, the start
 * of the next kept range when it falls in a cut, or null after the last one.
 */
export function nextPlayableMs(ranges: KeepRange[], cameraMs: number): number | null {
  for (const range of ranges) {
    if (cameraMs < range.startMs) {
      return range.startMs;
    }
    if (cameraMs < range.endMs) {
      return cameraMs;
    }
  }
  return null;
}

/** How long the finished short is. */
export function keptDurationMs(ranges: KeepRange[]): number {
  return ranges.reduce((total, range) => total + (range.endMs - range.startMs), 0);
}

/** Where a camera time falls in the finished short. */
export function shortTimeMs(ranges: KeepRange[], cameraMs: number): number {
  let elapsed = 0;
  for (const range of ranges) {
    if (cameraMs <= range.startMs) {
      break;
    }
    elapsed += Math.min(cameraMs, range.endMs) - range.startMs;
  }
  return elapsed;
}

/**
 * The screen recording's time for a camera time. screenOffsetMs is positive
 * when the screen recorder started after the camera recorder.
 */
export function screenTimeMs(cameraMs: number, screenOffsetMs: number): number {
  return Math.max(0, cameraMs - screenOffsetMs);
}
