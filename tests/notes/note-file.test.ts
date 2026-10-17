import { describe, expect, test } from "vite-plus/test";
import { parseNoteFile, serializeNoteFile } from "../../src/notes/note-file.ts";
import type { NoteFrontMatter } from "../../src/schemas/note.ts";

const frontMatter: NoteFrontMatter = {
  id: "2026-10-17-anchor-scroll",
  title: 'Anchor positioning: "scroll" is ignored',
  createdAt: "2026-10-17T13:45:00.000Z",
  repository: "/Users/schalk/dev/css-console",
  branch: "main",
  commit: "3d3c42e5aac5ba805825da76410c181273ba90b1",
  snapshotRef: "refs/shorts/2026-10-17-anchor-scroll",
  untracked: ["demo/anchor.html"],
};

describe("note files", () => {
  test("round-trip front matter and body", () => {
    const text = serializeNoteFile(frontMatter, "Try it in a scroll container.\n");
    const parsed = parseNoteFile(text);
    expect(parsed).toEqual({ frontMatter, body: "Try it in a scroll container.\n" });
  });

  test("start with a YAML front matter block", () => {
    const text = serializeNoteFile(frontMatter, "");
    expect(text.startsWith("---\nid: 2026-10-17-anchor-scroll\n")).toBe(true);
  });

  test("reject a file without front matter", () => {
    expect(() => parseNoteFile("Just some text\n")).toThrow(/front matter/);
  });

  test("reject front matter that does not match the note schema", () => {
    const text = "---\nid: Not A Slug\n---\n";
    expect(() => parseNoteFile(text)).toThrow(/id/);
  });
});
