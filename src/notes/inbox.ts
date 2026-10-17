import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ShortError } from "../errors.ts";
import { git, GitError, tryGit, type GitResult } from "../git.ts";
import { noteIdSchema, type NoteFrontMatter } from "../schemas/note.ts";
import { createNoteId } from "./note-id.ts";
import { parseNoteFile, serializeNoteFile } from "./note-file.ts";

const shortsFolder = ".shorts";
const excludeLine = `/${shortsFolder}/`;
const noteExtension = ".md";

interface RepositoryLocation {
  // The worktree the command runs in: its branch, commit and changes are the ones noted.
  workTreeRoot: string;
  // The main worktree. Notes live here, so every worktree of the repository shares them.
  storeRoot: string;
  // The .git folder shared by all worktrees.
  commonDir: string;
}

async function locateRepository(cwd: string): Promise<RepositoryLocation> {
  const topLevel = await tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!topLevel.ok) {
    throw new ShortError(`${cwd} is not inside a Git repository.`);
  }

  const workTreeRoot = topLevel.stdout;
  const commonDir = await git(workTreeRoot, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  // In a bare repository there is no main worktree, so the current one holds the notes.
  const hasMainWorkTree = basename(commonDir) === ".git";
  const storeRoot = hasMainWorkTree ? dirname(commonDir) : workTreeRoot;

  return { workTreeRoot, storeRoot, commonDir };
}

function notesFolder(location: RepositoryLocation): string {
  return join(location.storeRoot, shortsFolder, "notes");
}

// Restored worktrees live inside the .git folder, where test runners, type
// checkers and linters in the project do not look for files.
function worktreePathFor(location: RepositoryLocation, noteId: string): string {
  return join(location.commonDir, "shorts", "worktrees", noteId);
}

function snapshotRefFor(noteId: string): string {
  return `refs/shorts/${noteId}`;
}

// Every note keeps its commit reachable, so rewriting the branch later cannot
// let Git's garbage collection delete it.
function baseRefFor(noteId: string): string {
  return `refs/shorts/base/${noteId}`;
}

/**
 * Keeps .shorts/ out of Git through .git/info/exclude, which applies to this
 * clone only, so the project's own .gitignore never changes.
 */
async function excludeShortsFolder(location: RepositoryLocation): Promise<void> {
  const excludePath = await git(location.workTreeRoot, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "info/exclude",
  ]);

  const existing = existsSync(excludePath) ? await readFile(excludePath, "utf8") : "";
  const alreadyExcluded = existing.split("\n").includes(excludeLine);
  if (alreadyExcluded) {
    return;
  }

  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  await mkdir(dirname(excludePath), { recursive: true });
  await appendFile(excludePath, `${separator}${excludeLine}\n`);
}

async function currentBranch(workTreeRoot: string): Promise<string | null> {
  // symbolic-ref fails when HEAD is detached, which means there is no branch.
  const result = await tryGit(workTreeRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return result.ok ? result.stdout : null;
}

async function currentCommit(workTreeRoot: string): Promise<string> {
  const result = await tryGit(workTreeRoot, ["rev-parse", "--verify", "HEAD"]);
  if (!result.ok) {
    throw new ShortError("The repository has no commits yet, so there is nothing to snapshot.");
  }
  return result.stdout;
}

async function untrackedFiles(workTreeRoot: string): Promise<string[]> {
  const output = await git(workTreeRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return output.split("\0").filter((path) => path.length > 0);
}

/** Ids already in use, from note file names and from refs, so neither is ever reused. */
async function takenNoteIds(location: RepositoryLocation): Promise<string[]> {
  const folder = notesFolder(location);
  const fileIds = existsSync(folder)
    ? (await readdir(folder))
        .filter((name) => name.endsWith(noteExtension))
        .map((name) => name.slice(0, -noteExtension.length))
    : [];

  const refNames = await git(location.storeRoot, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/shorts/",
  ]);
  const refIds = refNames
    .split("\n")
    .filter((name) => name.length > 0)
    .map((name) => name.split("/").at(-1)!);

  return [...fileIds, ...refIds];
}

/** Creates a ref, and fails instead of overwriting one that already exists. */
async function createRef(
  workTreeRoot: string,
  ref: string,
  commit: string,
  message: string,
): Promise<void> {
  // An all-zero old value tells update-ref that the ref must not exist yet.
  // Its length matches the object format, SHA-1 or SHA-256.
  const mustNotExist = "0".repeat(commit.length);
  await git(workTreeRoot, ["update-ref", "-m", message, ref, commit, mustNotExist]);
}

export interface CaptureNoteOptions {
  cwd: string;
  title: string;
  now: () => Date;
}

/**
 * Saves an idea as a note in .shorts/notes/ of the main worktree, together
 * with the branch, the commit, and a snapshot of uncommitted changes in the
 * current worktree. The working tree is left exactly as it was.
 */
export async function captureNote({
  cwd,
  title,
  now,
}: CaptureNoteOptions): Promise<NoteFrontMatter> {
  const location = await locateRepository(cwd);
  await excludeShortsFolder(location);

  const createdAt = now();
  const id = createNoteId(title, createdAt, await takenNoteIds(location));
  const commit = await currentCommit(location.workTreeRoot);
  const message = `short note ${id}`;

  // stash create builds a commit from staged and unstaged changes without
  // touching the working tree or the stash list. It prints nothing when there
  // are no changes.
  const snapshotCommit = await git(location.workTreeRoot, ["stash", "create", message]);
  const snapshotRef = snapshotCommit === "" ? null : snapshotRefFor(id);

  await createRef(location.workTreeRoot, baseRefFor(id), commit, message);
  if (snapshotRef !== null) {
    await createRef(location.workTreeRoot, snapshotRef, snapshotCommit, message);
  }

  const note: NoteFrontMatter = {
    id,
    title: title.trim(),
    createdAt: createdAt.toISOString(),
    repository: location.workTreeRoot,
    branch: await currentBranch(location.workTreeRoot),
    commit,
    snapshotRef,
    untracked: await untrackedFiles(location.workTreeRoot),
  };

  await mkdir(notesFolder(location), { recursive: true });
  // The wx flag refuses to replace a note file that already exists.
  await writeFile(
    join(notesFolder(location), `${id}${noteExtension}`),
    serializeNoteFile(note, ""),
    {
      flag: "wx",
    },
  );
  return note;
}

async function readNote(path: string): Promise<NoteFrontMatter> {
  try {
    return parseNoteFile(await readFile(path, "utf8")).frontMatter;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ShortError(`Could not read the note ${path}. ${reason}`);
  }
}

/** Returns the notes of the repository, from any of its worktrees, newest first. */
export async function listNotes({ cwd }: { cwd: string }): Promise<NoteFrontMatter[]> {
  const location = await locateRepository(cwd);
  const folder = notesFolder(location);
  if (!existsSync(folder)) {
    return [];
  }

  const fileNames = (await readdir(folder)).filter((name) => name.endsWith(noteExtension));
  const notes = await Promise.all(fileNames.map((name) => readNote(join(folder, name))));
  return notes.toSorted((first, second) => second.createdAt.localeCompare(first.createdAt));
}

export interface RestoredNote {
  note: NoteFrontMatter;
  worktreePath: string;
  // Untracked files are not part of the snapshot, so they are not restored.
  missingUntracked: string[];
}

async function applySnapshot(worktreePath: string, snapshotRef: string): Promise<GitResult> {
  // --index restores staged changes as staged. It applies cleanly because the
  // worktree sits at the snapshot's own base commit; if it still fails, the
  // worktree is reset and the changes are applied without the staged state.
  const withIndex = await tryGit(worktreePath, [
    "stash",
    "apply",
    "--index",
    "--quiet",
    snapshotRef,
  ]);
  if (withIndex.ok) {
    return withIndex;
  }
  await tryGit(worktreePath, ["reset", "--hard", "--quiet"]);
  return tryGit(worktreePath, ["stash", "apply", "--quiet", snapshotRef]);
}

/**
 * Restores a note's commit and snapshot in a new worktree inside the .git
 * folder, leaving the current working tree alone.
 */
export async function restoreNote({
  cwd,
  noteId,
}: {
  cwd: string;
  noteId: string;
}): Promise<RestoredNote> {
  const location = await locateRepository(cwd);
  const notePath = join(notesFolder(location), `${noteId}${noteExtension}`);
  const isValidId = noteIdSchema.safeParse(noteId).success;
  if (!isValidId || !existsSync(notePath)) {
    throw new ShortError(`No note with the id "${noteId}". Run "short notes" to see the notes.`);
  }
  const note = await readNote(notePath);

  const commitExists = await tryGit(location.storeRoot, [
    "cat-file",
    "-e",
    `${note.commit}^{commit}`,
  ]);
  if (!commitExists.ok) {
    throw new ShortError(
      `The commit ${note.commit} for this note no longer exists in the repository.`,
    );
  }

  const worktreePath = worktreePathFor(location, note.id);
  if (existsSync(worktreePath)) {
    throw new ShortError(`A worktree for this note already exists at ${worktreePath}.`);
  }

  // Forget worktrees whose folders were deleted by hand, so the path can be reused.
  await git(location.storeRoot, ["worktree", "prune"]);
  await git(location.storeRoot, [
    "worktree",
    "add",
    "--quiet",
    "--detach",
    worktreePath,
    note.commit,
  ]);

  if (note.snapshotRef !== null) {
    const applied = await applySnapshot(worktreePath, note.snapshotRef);
    if (!applied.ok) {
      await tryGit(location.storeRoot, ["worktree", "remove", "--force", worktreePath]);
      throw new GitError(
        `Could not apply the snapshot ${note.snapshotRef}, so the worktree was removed. ${applied.stderr.trim()}`,
      );
    }
  }

  return { note, worktreePath, missingUntracked: note.untracked };
}
