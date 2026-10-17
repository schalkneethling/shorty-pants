import { readFileSync, writeFileSync } from "node:fs";
import { CommandNotFoundError, type CommandRunner } from "../../src/commands.ts";

const whisperFixture = readFileSync(
  new URL("../fixtures/whisper-words.json", import.meta.url),
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
  options: { durationSeconds?: string; missing?: string[]; whisperOutput?: string } = {},
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
    const outputBase = args[args.indexOf("-of") + 1]!;
    writeFileSync(`${outputBase}.json`, options.whisperOutput ?? whisperFixture);
    return { stdout: "" };
  };
  return { run, calls };
}
