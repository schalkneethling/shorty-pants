import { z } from "zod";

/** The three layouts a segment can use. */
export const layoutSchema = z.enum(["split", "face", "circle"]);

export type Layout = z.infer<typeof layoutSchema>;
