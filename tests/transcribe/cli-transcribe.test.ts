import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { run, type CliContext } from "../../src/cli.ts";
import { createFakeCommands, type FakeCommands } from "../helpers/fake-commands.ts";

let workspace: string;
let shortFolder: string;
let commands: FakeCommands;

function createIo() {
  const output = { stdout: "", stderr: "" };
  return {
    output,
    io: {
      stdout: (text: string) => {
        output.stdout += text;
      },
      stderr: (text: string) => {
        output.stderr += text;
      },
    },
  };
}

function context(overrides: Partial<CliContext> = {}): Partial<CliContext> {
  return {
    cwd: workspace,
    environment: {},
    homeDirectory: join(workspace, "home"),
    runCommand: commands.run,
    ...overrides,
  };
}

const defaultModelPath = () =>
  join(workspace, "home", ".cache", "shorty-pants", "models", "ggml-small.en.bin");

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "shorty-pants-cli-transcribe-")));
  shortFolder = join(workspace, "shorts", "2026-10-17-anchor-scroll");
  mkdirSync(join(shortFolder, "takes"), { recursive: true });
  writeFileSync(join(shortFolder, "takes", "cam.webm"), "camera");
  writeFileSync(join(shortFolder, "takes", "screen.webm"), "screen");
  writeFileSync(
    join(shortFolder, "takes.json"),
    JSON.stringify({
      version: 1,
      recordedAt: "2026-10-17T13:45:00.000Z",
      takes: { cam: "takes/cam.webm", screen: "takes/screen.webm", screenOffsetMs: 42 },
    }),
  );
  mkdirSync(join(workspace, "home", ".cache", "shorty-pants", "models"), { recursive: true });
  writeFileSync(defaultModelPath(), "model");
  commands = createFakeCommands();
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("short transcribe", () => {
  test("transcribes a short folder given relative to the current folder", async () => {
    const { io, output } = createIo();
    const exitCode = await run(["transcribe", "shorts/2026-10-17-anchor-scroll"], io, context());
    expect(exitCode).toBe(0);
    expect(output.stdout).toContain("Transcribed 6 words");
    expect(existsSync(join(shortFolder, "transcript.json"))).toBe(true);
  });

  test("uses the small English model in the cache folder by default", async () => {
    const { io } = createIo();
    await run(["transcribe", shortFolder], io, context());
    const whisperCall = commands.calls.find((call) => call.command === "whisper-cli");
    expect(whisperCall?.args.slice(0, 2)).toEqual(["-m", defaultModelPath()]);
  });

  test("uses SHORTY_PANTS_WHISPER_MODEL and SHORTY_PANTS_WHISPER_BIN", async () => {
    const modelPath = join(workspace, "large-v3-turbo.bin");
    writeFileSync(modelPath, "model");
    const { io } = createIo();
    await run(
      ["transcribe", shortFolder],
      io,
      context({
        environment: {
          SHORTY_PANTS_WHISPER_MODEL: modelPath,
          SHORTY_PANTS_WHISPER_BIN: "/opt/homebrew/bin/whisper-cli",
        },
      }),
    );
    const whisperCall = commands.calls.find(
      (call) => call.command === "/opt/homebrew/bin/whisper-cli",
    );
    expect(whisperCall?.args.slice(0, 2)).toEqual(["-m", modelPath]);
  });

  test("lets --model and --language override the defaults", async () => {
    const modelPath = join(workspace, "ggml-small.bin");
    writeFileSync(modelPath, "model");
    const { io } = createIo();
    await run(["transcribe", shortFolder, "--model", modelPath, "--language", "af"], io, context());
    const whisperCall = commands.calls.find((call) => call.command === "whisper-cli");
    expect(whisperCall?.args.slice(0, 2)).toEqual(["-m", modelPath]);
    expect(whisperCall?.args.slice(4, 6)).toEqual(["-l", "af"]);
  });

  test("reports a missing model and exits with 1", async () => {
    rmSync(defaultModelPath());
    const { io, output } = createIo();
    expect(await run(["transcribe", shortFolder], io, context())).toBe(1);
    expect(output.stderr).toContain("curl");
  });

  test("without a folder is a usage error", async () => {
    const { io, output } = createIo();
    expect(await run(["transcribe"], io, context())).toBe(2);
    expect(output.stderr).toContain("Usage: short transcribe");
  });
});
