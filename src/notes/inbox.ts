import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ShortError } from "../errors.ts";
import { git, tryGit } from "../git.ts";
import type { NoteFrontMatter } from "../schemas/note.ts";
import { createNoteId } from "./note-id.ts";
import { parseNoteFile, serializeNoteFile } from "./note-file.ts";

const shortsFolder = ".shorts";
const excludeLine = `/${shortsFolder}/`;

function notesFolder(repositoryRoot: string): string {
  return join(repositoryRoot, shortsFolder, "notes");
}

async function findRepositoryRoot(cwd: string): Promise<string> {
  const result = await tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!result.ok) {
    throw new ShortError(`${cwd} is not inside a Git repository.`);
  }
  return result.stdout;
}

/**
 * Keeps .shorts/ out of Git for this clone only, through .git/info/exclude,
 * so the project's own .gitignore never changes.
 */
async function excludeShortsFolder(repositoryRoot: string): Promise<void> {
  const relativeExcludePath = await git(repositoryRoot, [
    "rev-parse",
    "--git-path",
    "info/exclude",
  ]);
  const excludePath = resolve(repositoryRoot, relativeExcludePath);

  const existing = existsSync(excludePath) ? await readFile(excludePath, "utf8") : "";
  const alreadyExcluded = existing.split("\n").includes(excludeLine);
  if (alreadyExcluded) {
    return;
  }

  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  await mkdir(join(excludePath, ".."), { recursive: true });
  await appendFile(excludePath, `${separator}${excludeLine}\n`);
}

async function currentBranch(repositoryRoot: string): Promise<string | null> {
  // symbolic-ref fails when HEAD is detached, which means there is no branch.
  const result = await tryGit(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return result.ok ? result.stdout : null;
}

async function currentCommit(repositoryRoot: string): Promise<string> {
  const result = await tryGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]);
  if (!result.ok) {
    throw new ShortError("The repository has no commits yet, so there is nothing to snapshot.");
  }
  return result.stdout;
}

async function untrackedFiles(repositoryRoot: string): Promise<string[]> {
  const output = await git(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return output.split("\0").filter((path) => path.length > 0);
}

async function readNotes(repositoryRoot: string): Promise<NoteFrontMatter[]> {
  const folder = notesFolder(repositoryRoot);
  if (!existsSync(folder)) {
    return [];
  }

  const fileNames = (await readdir(folder)).filter((name) => name.endsWith(".md"));
  return Promise.all(
    fileNames.map(async (name) => {
      const path = join(folder, name);
      try {
        return parseNoteFile(await readFile(path, "utf8")).frontMatter;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new ShortError(`Could not read the note ${path}. ${reason}`);
      }
    }),
  );
}

export interface CaptureNoteOptions {
  cwd: string;
  title: string;
  now: () => Date;
}

/**
 * Saves an idea as a note in .shorts/notes/, together with the branch, the
 * commit, and a snapshot of uncommitted changes. The working tree is left
 * exactly as it was.
 */
export async function captureNote({
  cwd,
  title,
  now,
}: CaptureNoteOptions): Promise<NoteFrontMatter> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  await excludeShortsFolder(repositoryRoot);

  const existingIds = (await readNotes(repositoryRoot)).map((note) => note.id);
  const createdAt = now();
  const id = createNoteId(title, createdAt, existingIds);
  const commit = await currentCommit(repositoryRoot);

  // stash create builds a commit from uncommitted changes without touching
  // the working tree or the stash list. It prints nothing when there are none.
  const snapshotCommit = await git(repositoryRoot, ["stash", "create", `short note ${id}`]);
  let snapshotRef: string | null = null;
  if (snapshotCommit !== "") {
    snapshotRef = `refs/shorts/${id}`;
    // A ref keeps Git's garbage collection from deleting the snapshot commit.
    await git(repositoryRoot, [
      "update-ref",
      "-m",
      `short note ${id}`,
      snapshotRef,
      snapshotCommit,
    ]);
  }

  const note: NoteFrontMatter = {
    id,
    title: title.trim(),
    createdAt: createdAt.toISOString(),
    repository: repositoryRoot,
    branch: await currentBranch(repositoryRoot),
    commit,
    snapshotRef,
    untracked: await untrackedFiles(repositoryRoot),
  };

  await mkdir(notesFolder(repositoryRoot), { recursive: true });
  await writeFile(join(notesFolder(repositoryRoot), `${id}.md`), serializeNoteFile(note, ""));
  return note;
}

/** Returns the notes in the current repository, newest first. */
export async function listNotes({ cwd }: { cwd: string }): Promise<NoteFrontMatter[]> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  const notes = await readNotes(repositoryRoot);
  return notes.toSorted((first, second) => second.createdAt.localeCompare(first.createdAt));
}

export interface RestoredNote {
  note: NoteFrontMatter;
  worktreePath: string;
  // Untracked files are not part of the snapshot, so they are not restored.
  missingUntracked: string[];
}

/**
 * Restores a note's commit and snapshot in a new worktree under
 * .shorts/worktrees/, leaving the current working tree alone.
 */
export async function restoreNote({
  cwd,
  noteId,
}: {
  cwd: string;
  noteId: string;
}): Promise<RestoredNote> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  const note = (await readNotes(repositoryRoot)).find((candidate) => candidate.id === noteId);
  if (note === undefined) {
    throw new ShortError(`No note with the id "${noteId}". Run "short notes" to see the notes.`);
  }

  const worktreePath = join(repositoryRoot, shortsFolder, "worktrees", note.id);
  if (existsSync(worktreePath)) {
    throw new ShortError(`A worktree for this note already exists at ${worktreePath}.`);
  }

  await git(repositoryRoot, ["worktree", "add", "--quiet", "--detach", worktreePath, note.commit]);
  if (note.snapshotRef !== null) {
    await git(worktreePath, ["stash", "apply", "--quiet", note.snapshotRef]);
  }

  return { note, worktreePath, missingUntracked: note.untracked };
}
