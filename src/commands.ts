import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ShortError } from "./errors.ts";

const execFileAsync = promisify(execFile);

/** Runs an external program without a shell and returns its output. */
export type CommandRunner = (command: string, args: string[]) => Promise<{ stdout: string }>;

/** The program is not installed, or not on the PATH. */
export class CommandNotFoundError extends Error {
  override name = "CommandNotFoundError";

  readonly command: string;

  constructor(command: string) {
    super(`${command} was not found.`);
    this.command = command;
  }
}

/** The program ran but exited with an error. The message carries its error output. */
export class CommandFailedError extends ShortError {
  override name = "CommandFailedError";
}

/**
 * The most useful part of a program's error output. Tools such as whisper-cli
 * print their usage text after the error, so lines that mention an error come
 * first; otherwise the last few lines are used.
 */
function describeFailure(stderr: string, exitCode: unknown): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const errorLines = lines.filter((line) => /\berror\b/i.test(line));
  const chosen = errorLines.length > 0 ? errorLines : lines.slice(-5);
  return chosen.length > 0 ? chosen.join("\n") : `It stopped with exit code ${String(exitCode)}.`;
}

export const runCommand: CommandRunner = async (command, args) => {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout };
  } catch (error) {
    const failure = error as { code?: unknown; signal?: unknown; stderr?: string };
    if (failure.code === "ENOENT") {
      throw new CommandNotFoundError(command);
    }
    const exitCode = failure.signal ?? failure.code;
    throw new CommandFailedError(
      `${command} failed. ${describeFailure(failure.stderr ?? "", exitCode)}`,
    );
  }
};
