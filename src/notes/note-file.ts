import { parse, stringify } from "yaml";
import { parseNoteFrontMatter, type NoteFrontMatter } from "../schemas/note.ts";

const fence = "---\n";

export interface NoteFile {
  frontMatter: NoteFrontMatter;
  body: string;
}

/** Writes a note as Markdown with YAML front matter. */
export function serializeNoteFile(frontMatter: NoteFrontMatter, body: string): string {
  return `${fence}${stringify(frontMatter)}${fence}${body}`;
}

/** Reads a note written by serializeNoteFile, and validates its front matter. */
export function parseNoteFile(text: string): NoteFile {
  const closingFence = text.indexOf(`\n${fence}`, fence.length - 1);
  const hasFrontMatter = text.startsWith(fence) && closingFence !== -1;
  if (!hasFrontMatter) {
    throw new Error("The note has no YAML front matter.");
  }

  const yamlText = text.slice(fence.length, closingFence + 1);
  const body = text.slice(closingFence + 1 + fence.length);
  const result = parseNoteFrontMatter(parse(yamlText) ?? {});

  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`The note front matter is not valid. ${problems.join(" ")}`);
  }

  return { frontMatter: result.data, body };
}
