import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ShortError } from "./errors.ts";

const execFileAsync = promisify(execFile);

/** A git command failed. The message carries git's own explanation. */
export class GitError extends ShortError {
  override name = "GitError";
}

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

// Only the final newline is removed. Trimming more would corrupt paths and
// file names that start or end with whitespace.
function withoutFinalNewline(text: string | undefined): string {
  return (text ?? "").replace(/\n$/, "");
}

/**
 * Runs git with the given arguments, without a shell, and reports failure
 * through `ok` instead of throwing, because several git commands use a
 * non-zero exit code to answer a question rather than to report an error.
 */
export async function tryGit(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, stdout: withoutFinalNewline(stdout), stderr: withoutFinalNewline(stderr) };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: string; stderr?: string };
    if (failure.code === "ENOENT") {
      throw new ShortError("git was not found. Install Git and make sure it is on your PATH.");
    }
    return {
      ok: false,
      stdout: withoutFinalNewline(failure.stdout),
      stderr: withoutFinalNewline(failure.stderr),
    };
  }
}

/** Runs git and returns its output, or throws a GitError with git's own message. */
export async function git(cwd: string, args: string[]): Promise<string> {
  const result = await tryGit(cwd, args);
  if (!result.ok) {
    const details = result.stderr.trim() === "" ? "git gave no details." : result.stderr.trim();
    throw new GitError(`git ${args[0]} failed. ${details}`);
  }
  return result.stdout;
}
