import { readFileSync, writeFileSync } from "node:fs";
import { CommandNotFoundError, type CommandRunner } from "../../src/commands.ts";

const whisperFixture = readFileSync(
  new URL("../fixtures/whisper-full.json", import.meta.url),
  "utf8",
);

export interface FakeCommands {
  run: CommandRunner;
  calls: { command: string; args: string[] }[];
}

/**
 * Stands in for ffmpeg, ffprobe and whisper-cli: each one writes or prints
 * what the real tool would, so the pipeline can be tested without them.
 */
export function createFakeCommands(
  options: {
    durationSeconds?: string;
    missing?: string[];
    whisperOutput?: string;
    // whisper-cli exits with 0 without writing anything when it does not know a flag.
    whisperWritesNothing?: boolean;
  } = {},
): FakeCommands {
  const calls: { command: string; args: string[] }[] = [];
  const run: CommandRunner = async (command, args) => {
    calls.push({ command, args });
    if (options.missing?.includes(command)) {
      throw new CommandNotFoundError(command);
    }
    if (command === "ffmpeg") {
      writeFileSync(args.at(-1)!, "RIFF fake wav");
      return { stdout: "" };
    }
    if (command === "ffprobe") {
      return { stdout: `${options.durationSeconds ?? "5.000000"}\n` };
    }
    if (options.whisperWritesNothing) {
      return { stdout: "" };
    }
    const outputBase = args[args.indexOf("-of") + 1]!;
    writeFileSync(`${outputBase}.json`, options.whisperOutput ?? whisperFixture);
    return { stdout: "" };
  };
  return { run, calls };
}
