import { z } from "zod";

const milliseconds = z.number().int().nonnegative();

export const transcriptWordSchema = z
  .object({
    text: z.string().min(1),
    startMs: milliseconds,
    endMs: milliseconds,
  })
  .refine((word) => word.endMs >= word.startMs, {
    message: "A word must not end before it starts.",
    path: ["endMs"],
  });

export type TranscriptWord = z.infer<typeof transcriptWordSchema>;

/** The words of a take with their times in the camera track, stored as transcript.json. */
export const transcriptSchema = z
  .object({
    version: z.literal(1),
    // The model file name, so a transcript can be traced back to what made it.
    model: z.string().min(1),
    language: z.string().min(1),
    durationMs: milliseconds,
    words: z.array(transcriptWordSchema),
  })
  .superRefine((transcript, context) => {
    transcript.words.forEach((word, index) => {
      const previous = transcript.words[index - 1];
      if (previous !== undefined && word.startMs < previous.startMs) {
        context.addIssue({
          code: "custom",
          message: "Words must be in the order they were spoken.",
          path: ["words", index, "startMs"],
        });
      }
      if (word.endMs > transcript.durationMs) {
        context.addIssue({
          code: "custom",
          message: "A word must not end after the recording ends.",
          path: ["words", index, "endMs"],
        });
      }
    });
  });

export type Transcript = z.infer<typeof transcriptSchema>;

export function parseTranscript(input: unknown) {
  return transcriptSchema.safeParse(input);
}
