import { z } from "zod";
import { layoutSchema } from "./layout.ts";

const milliseconds = z.number().int().nonnegative();
const wordIndex = z.number().int().nonnegative();
const pixels = z.number().int().nonnegative();
const positivePixels = z.number().int().positive();

const takesSchema = z.object({
  cam: z.string().min(1),
  screen: z.string().min(1),
  // Negative when the screen recorder started before the camera recorder.
  screenOffsetMs: z.number().int(),
});

const trimSchema = z
  .object({
    startMs: milliseconds,
    endMs: milliseconds,
  })
  .refine((trim) => trim.endMs > trim.startMs, {
    message: "The trim end must come after the trim start.",
    path: ["endMs"],
  });

// An inclusive range of word indexes, such as [12, 19].
const removedWordRangeSchema = z
  .tuple([wordIndex, wordIndex])
  .refine(([fromWord, toWord]) => toWord >= fromWord, {
    message: "A removed word range must not end before it starts.",
  });

// Normalizing first makes precomposed and combining forms of the same word
// compare equal. Lowercasing can add combining marks (İ becomes i plus a dot),
// so marks count as part of a word.
function normalizeWord(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase();
}

function headlineWords(text: string): string[] {
  return normalizeWord(text).split(/[^\p{L}\p{M}\p{N}'-]+/u);
}

const headlineSchema = z
  .object({
    text: z.string().trim().min(1),
    accent: z.string().trim().min(1),
  })
  .refine((headline) => headlineWords(headline.text).includes(normalizeWord(headline.accent)), {
    message: "The accent must be one of the words in the headline.",
    path: ["accent"],
  });

const screenCropSchema = z.object({
  x: pixels,
  y: pixels,
  width: positivePixels,
  height: positivePixels,
});

const segmentSchema = z.object({
  // Segments start at a word index rather than a timestamp, so they stay
  // correct when words before them are removed.
  fromWord: wordIndex,
  layout: layoutSchema,
});

const segmentsSchema = z
  .array(segmentSchema)
  .min(1)
  .superRefine((segments, context) => {
    const firstSegment = segments[0];
    if (firstSegment !== undefined && firstSegment.fromWord !== 0) {
      context.addIssue({
        code: "custom",
        message: "The first segment must start at word 0.",
        path: [0, "fromWord"],
      });
    }

    for (let index = 1; index < segments.length; index += 1) {
      const previousStart = segments[index - 1]!.fromWord;
      const startsAfterPrevious = segments[index]!.fromWord > previousStart;
      if (!startsAfterPrevious) {
        context.addIssue({
          code: "custom",
          message: `Each segment must start after the previous one, which starts at word ${previousStart}.`,
          path: [index, "fromWord"],
        });
      }
    }
  });

/** The edit decisions for one short, stored as short.json. */
export const shortProjectSchema = z.object({
  version: z.literal(1),
  takes: takesSchema,
  trim: trimSchema,
  removedWords: z.array(removedWordRangeSchema),
  pauseThresholdMs: milliseconds,
  headline: headlineSchema,
  screenCrop: screenCropSchema,
  segments: segmentsSchema,
});

export type ShortProject = z.infer<typeof shortProjectSchema>;

export function parseShortProject(input: unknown) {
  return shortProjectSchema.safeParse(input);
}
