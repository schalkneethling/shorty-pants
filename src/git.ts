import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
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
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: failure.stdout?.trim() ?? "",
      stderr: failure.stderr?.trim() ?? "",
    };
  }
}

/** Runs git and returns its trimmed output, or throws with git's own message. */
export async function git(cwd: string, args: string[]): Promise<string> {
  const result = await tryGit(cwd, args);
  if (!result.ok) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}
