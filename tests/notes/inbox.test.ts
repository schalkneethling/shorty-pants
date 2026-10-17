import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { captureNote, listNotes, restoreNote } from "../../src/notes/inbox.ts";
import {
  createTestRepository,
  gitEnvironment,
  type TestRepository,
} from "../helpers/git-repository.ts";

const now = () => new Date("2026-10-17T13:45:00.000Z");
let repository: TestRepository;

beforeEach(() => {
  Object.assign(process.env, gitEnvironment);
  repository = createTestRepository();
});

afterEach(() => {
  repository.remove();
});

describe("captureNote", () => {
  test("writes a Markdown note with the branch and commit", async () => {
    const note = await captureNote({ cwd: repository.root, title: "Anchor scroll", now });

    expect(note.id).toBe("2026-10-17-anchor-scroll");
    expect(note.repository).toBe(repository.root);
    expect(note.branch).toBe("main");
    expect(note.commit).toBe(repository.git(["rev-parse", "HEAD"]));
    expect(note.snapshotRef).toBeNull();

    const notePath = join(repository.root, ".shorts", "notes", `${note.id}.md`);
    expect(readFileSync(notePath, "utf8")).toContain("title: Anchor scroll");
  });

  test("works from a subfolder of the repository", async () => {
    repository.git(["checkout", "--quiet", "-b", "feature"]);
    const subfolder = join(repository.root, "src", "components");
    mkdirSync(subfolder, { recursive: true });
    const note = await captureNote({ cwd: subfolder, title: "Sub", now });
    expect(note.branch).toBe("feature");
    expect(note.repository).toBe(repository.root);
  });

  test("snapshots uncommitted changes under refs/shorts without touching the working tree", async () => {
    repository.write("demo.css", ".anchor { position: fixed; }\n");

    const note = await captureNote({ cwd: repository.root, title: "Fixed anchors", now });

    expect(note.snapshotRef).toBe("refs/shorts/2026-10-17-fixed-anchors");
    const snapshotContents = repository.git(["show", `${note.snapshotRef}:demo.css`]);
    expect(snapshotContents).toBe(".anchor { position: fixed; }");
    expect(readFileSync(join(repository.root, "demo.css"), "utf8")).toBe(
      ".anchor { position: fixed; }\n",
    );
    expect(repository.git(["stash", "list"])).toBe("");
  });

  test("lists untracked files, because the snapshot does not include them", async () => {
    repository.write("new-demo.html", "<p>New</p>\n");
    const note = await captureNote({ cwd: repository.root, title: "Untracked", now });
    expect(note.untracked).toEqual(["new-demo.html"]);
  });

  test("keeps .shorts out of git status through .git/info/exclude", async () => {
    await captureNote({ cwd: repository.root, title: "Clean status", now });
    expect(repository.git(["status", "--porcelain"])).toBe("");

    const exclude = readFileSync(join(repository.root, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain("/.shorts/");
  });

  test("adds the exclude line only once", async () => {
    await captureNote({ cwd: repository.root, title: "First", now });
    await captureNote({ cwd: repository.root, title: "Second", now });
    const exclude = readFileSync(join(repository.root, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((line) => line === "/.shorts/")).toHaveLength(1);
  });

  test("records a detached HEAD as no branch", async () => {
    repository.git(["checkout", "--quiet", "--detach"]);
    const note = await captureNote({ cwd: repository.root, title: "Detached", now });
    expect(note.branch).toBeNull();
  });

  test("gives two notes with the same title different ids", async () => {
    const first = await captureNote({ cwd: repository.root, title: "Same", now });
    const second = await captureNote({ cwd: repository.root, title: "Same", now });
    expect(first.id).toBe("2026-10-17-same");
    expect(second.id).toBe("2026-10-17-same-2");
  });

  test("refuses to run outside a Git repository", async () => {
    const outside = join(repository.root, "..");
    await expect(captureNote({ cwd: outside, title: "Nowhere", now })).rejects.toThrow(
      /not inside a Git repository/,
    );
  });
});

describe("listNotes", () => {
  test("returns the notes in the repository, newest first", async () => {
    await captureNote({
      cwd: repository.root,
      title: "Older",
      now: () => new Date("2026-10-16T10:00:00.000Z"),
    });
    await captureNote({ cwd: repository.root, title: "Newer", now });

    const notes = await listNotes({ cwd: repository.root });
    expect(notes.map((note) => note.title)).toEqual(["Newer", "Older"]);
  });

  test("names the file when a note cannot be read", async () => {
    await captureNote({ cwd: repository.root, title: "Fine", now });
    writeFileSync(join(repository.root, ".shorts", "notes", "broken.md"), "no front matter\n");
    await expect(listNotes({ cwd: repository.root })).rejects.toThrow(/broken\.md/);
  });

  test("returns an empty list when there are no notes", async () => {
    expect(await listNotes({ cwd: repository.root })).toEqual([]);
  });
});

describe("restoreNote", () => {
  test("restores the commit and the snapshot in a new worktree", async () => {
    repository.write("demo.css", ".anchor { position: fixed; }\n");
    const note = await captureNote({ cwd: repository.root, title: "Fixed anchors", now });

    // Move on: commit something else and discard the change.
    repository.git(["checkout", "--quiet", "--", "demo.css"]);
    repository.write("later.txt", "later\n");
    repository.git(["add", "later.txt"]);
    repository.git(["commit", "--quiet", "--message", "Later work"]);

    const restored = await restoreNote({ cwd: repository.root, noteId: note.id });

    expect(restored.worktreePath).toBe(join(repository.root, ".shorts", "worktrees", note.id));
    expect(readFileSync(join(restored.worktreePath, "demo.css"), "utf8")).toBe(
      ".anchor { position: fixed; }\n",
    );
    expect(existsSync(join(restored.worktreePath, "later.txt"))).toBe(false);
    expect(repository.git(["status", "--porcelain"])).toBe("");
  });

  test("restores a note without a snapshot at its commit", async () => {
    const note = await captureNote({ cwd: repository.root, title: "Clean", now });
    const restored = await restoreNote({ cwd: repository.root, noteId: note.id });
    expect(readFileSync(join(restored.worktreePath, "demo.css"), "utf8")).toBe(
      ".anchor { position: absolute; }\n",
    );
  });

  test("reports untracked files that were not restored", async () => {
    repository.write("new-demo.html", "<p>New</p>\n");
    const note = await captureNote({ cwd: repository.root, title: "Untracked", now });
    const restored = await restoreNote({ cwd: repository.root, noteId: note.id });
    expect(restored.missingUntracked).toEqual(["new-demo.html"]);
  });

  test("refuses an unknown note id", async () => {
    await expect(
      restoreNote({ cwd: repository.root, noteId: "2026-10-17-missing" }),
    ).rejects.toThrow(/No note with the id "2026-10-17-missing"/);
  });

  test("refuses to restore the same note twice", async () => {
    const note = await captureNote({ cwd: repository.root, title: "Twice", now });
    await restoreNote({ cwd: repository.root, noteId: note.id });
    await expect(restoreNote({ cwd: repository.root, noteId: note.id })).rejects.toThrow(
      /already exists/,
    );
  });
});
