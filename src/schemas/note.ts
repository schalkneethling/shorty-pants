import { z } from "zod";

const noteIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase slug, such as 2026-10-17-anchor-scroll.");

/** The YAML front matter of a note in .shorts/notes/. */
export const noteFrontMatterSchema = z
  .object({
    id: noteIdSchema,
    title: z.string().trim().min(1),
    createdAt: z.iso.datetime(),
    repository: z.string().min(1),
    // Null when HEAD is detached.
    branch: z.string().min(1).nullable(),
    commit: z.string().regex(/^[0-9a-f]{40}$/, "Use the full 40-character commit SHA."),
    // Null when the working tree had no uncommitted changes.
    snapshotRef: z.string().nullable(),
    // Untracked files are not part of the snapshot, so their paths are listed instead.
    untracked: z.array(z.string().min(1)),
  })
  .refine((note) => note.snapshotRef === null || note.snapshotRef === `refs/shorts/${note.id}`, {
    message: "The snapshot ref must be refs/shorts/<note id>.",
    path: ["snapshotRef"],
  });

export type NoteFrontMatter = z.infer<typeof noteFrontMatterSchema>;

export function parseNoteFrontMatter(input: unknown) {
  return noteFrontMatterSchema.safeParse(input);
}
