import { z } from "zod";
import { takesSchema } from "./short-project.ts";

/**
 * What a recording session produces, stored as takes.json next to the
 * recordings. The editor turns it into short.json once the transcript exists.
 */
export const recordedTakesSchema = z.object({
  version: z.literal(1),
  recordedAt: z.iso.datetime(),
  takes: takesSchema,
});

export type RecordedTakes = z.infer<typeof recordedTakesSchema>;

export function parseRecordedTakes(input: unknown) {
  return recordedTakesSchema.safeParse(input);
}
