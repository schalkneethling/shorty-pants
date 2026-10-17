import { z } from "zod";
import { layoutSchema } from "./layout.ts";

/** The Shorts frame: 1080 × 1920 pixels at a constant 30 frames per second. */
export const frame = {
  width: 1080,
  height: 1920,
  fps: 30,
} as const;

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color, such as #2e1065.");
const pixels = z.number().int().nonnegative();

const captionStyleSchema = z.object({
  fontFamily: z.string().trim().min(1),
  textColor: hexColor,
  backgroundColor: hexColor,
  wordsPerChunk: z.number().int().min(1).max(8),
  maxChunkCharacters: z.number().int().min(4),
});

const safeZonesSchema = z
  .object({
    top: pixels,
    bottom: pixels,
    left: pixels,
    right: pixels,
  })
  .refine((zones) => zones.top + zones.bottom < frame.height, {
    message: "The top and bottom safe zones must leave part of the frame uncovered.",
    path: ["bottom"],
  })
  .refine((zones) => zones.left + zones.right < frame.width, {
    message: "The left and right safe zones must leave part of the frame uncovered.",
    path: ["right"],
  });

/** Settings that are chosen once and reused for every short, stored as preset.json. */
export const presetSchema = z.object({
  version: z.literal(1),
  captions: captionStyleSchema,
  defaultLayout: layoutSchema,
  pauseThresholdMs: z.number().int().nonnegative(),
  // Areas that YouTube's own interface covers, in pixels of the 1080 × 1920 frame.
  safeZones: safeZonesSchema,
});

export type Preset = z.infer<typeof presetSchema>;

export const defaultPreset: Preset = {
  version: 1,
  captions: {
    fontFamily: "Noto Sans",
    textColor: "#ffffff",
    backgroundColor: "#2e1065",
    wordsPerChunk: 3,
    maxChunkCharacters: 24,
  },
  defaultLayout: "split",
  pauseThresholdMs: 600,
  // Approximate values for the Shorts player interface. To be checked against
  // a real upload in milestone 6, when the safe zone guides are built.
  safeZones: {
    top: 240,
    bottom: 480,
    left: 48,
    right: 192,
  },
};

export function parsePreset(input: unknown) {
  return presetSchema.safeParse(input);
}
