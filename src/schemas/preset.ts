import { z } from "zod";
import { minimumSafeArea } from "../edit/layout-geometry.ts";
import { frame } from "./frame.ts";
import { layoutSchema } from "./layout.ts";

export { frame };

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color, such as #2e1065.");
const pixels = z.number().int().nonnegative();

const captionStyleSchema = z.object({
  fontFamily: z.string().trim().min(1),
  textColor: hexColor,
  backgroundColor: hexColor,
  // The headline's accent word and the caption word being said. Presets
  // written before it existed get the default.
  accentColor: hexColor.default("#facc15"),
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
  .refine((zones) => frame.height - zones.top - zones.bottom >= minimumSafeArea.height, {
    message: `The top and bottom safe zones must leave at least ${minimumSafeArea.height} pixels of height for the headline, the captions and the camera.`,
    path: ["bottom"],
  })
  .refine((zones) => frame.width - zones.left - zones.right >= minimumSafeArea.width, {
    message: `The left and right safe zones must leave at least ${minimumSafeArea.width} pixels of width for the camera.`,
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
    accentColor: "#facc15",
    wordsPerChunk: 3,
    maxChunkCharacters: 24,
  },
  defaultLayout: "split",
  pauseThresholdMs: 600,
  // The parts of the frame the Shorts player covers. Bottom and left come
  // from four Shorts playing on desktop YouTube: the channel row, the title
  // and a linked video pill reach about 270 pixels up (bottom 288 adds a
  // margin), and the text starts about 40 pixels in (left 48 adds a margin).
  // Top and right are estimates for the phone player, where the buttons and
  // the top bar sit over the video; on desktop nothing covers them. The phone
  // player has not been measured, so any of these may change once it is.
  safeZones: {
    top: 240,
    bottom: 288,
    left: 48,
    right: 192,
  },
};

export function parsePreset(input: unknown) {
  return presetSchema.safeParse(input);
}
