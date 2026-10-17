import { describe, expect, test } from "vite-plus/test";
import { parseNoteFrontMatter } from "../../src/schemas/note.ts";

function validNote() {
  return {
    id: "2026-10-17-anchor-scroll",
    title: "Anchor positioning ignores the scroll container",
    createdAt: "2026-10-17T13:45:00.000Z",
    repository: "/Users/schalk/dev/css-console",
    branch: "main",
    commit: "3d3c42e5aac5ba805825da76410c181273ba90b1",
    snapshotRef: "refs/shorts/2026-10-17-anchor-scroll",
    untracked: ["demo/anchor.html"],
  };
}

describe("parseNoteFrontMatter", () => {
  test("accepts a note with a snapshot", () => {
    expect(parseNoteFrontMatter(validNote()).success).toBe(true);
  });

  test("accepts a note without a snapshot, for a clean working tree", () => {
    const note = { ...validNote(), snapshotRef: null, untracked: [] };
    expect(parseNoteFrontMatter(note).success).toBe(true);
  });

  test("accepts a detached HEAD, which has no branch", () => {
    const note = { ...validNote(), branch: null };
    expect(parseNoteFrontMatter(note).success).toBe(true);
  });

  test("rejects a commit that is not a full SHA", () => {
    const note = { ...validNote(), commit: "3d3c42e" };
    expect(parseNoteFrontMatter(note).success).toBe(false);
  });

  test("rejects a snapshot ref that does not match the note id", () => {
    const note = { ...validNote(), snapshotRef: "refs/shorts/some-other-note" };
    const result = parseNoteFrontMatter(note);
    expect(result.success).toBe(false);
  });

  test("rejects a timestamp that is not ISO 8601", () => {
    const note = { ...validNote(), createdAt: "17 October 2026" };
    expect(parseNoteFrontMatter(note).success).toBe(false);
  });

  test("rejects an id that is not a lowercase slug", () => {
    const note = { ...validNote(), id: "Anchor Scroll!" };
    expect(parseNoteFrontMatter(note).success).toBe(false);
  });
});
