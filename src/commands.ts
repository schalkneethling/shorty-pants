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

export const runCommand: CommandRunner = async (command, args) => {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout };
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: string };
    if (failure.code === "ENOENT") {
      throw new CommandNotFoundError(command);
    }
    const details = failure.stderr?.trim().split("\n").slice(-5).join("\n") ?? "";
    throw new CommandFailedError(`${command} failed. ${details}`.trim());
  }
};
