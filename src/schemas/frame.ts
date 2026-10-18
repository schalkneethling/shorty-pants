// Kept apart from the Zod schemas, so the browser pages can use it without Zod.

/** The Shorts frame: 1080 × 1920 pixels at a constant 30 frames per second. */
export const frame = {
  width: 1080,
  height: 1920,
  fps: 30,
} as const;
