import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { parseTranscript } from "../../src/schemas/transcript.ts";
import { transcribeShort } from "../../src/transcribe/transcribe.ts";
import { createFakeCommands } from "../helpers/fake-commands.ts";

let workspace: string;
let shortFolder: string;
let modelPath: string;

function writeTake() {
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
}

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "shorty-pants-transcribe-")));
  shortFolder = join(workspace, "2026-10-17-anchor-scroll");
  modelPath = join(workspace, "ggml-small.en.bin");
  writeFileSync(modelPath, "model");
  writeTake();
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function transcribe(overrides: Partial<Parameters<typeof transcribeShort>[0]> = {}) {
  const commands = createFakeCommands();
  return {
    commands,
    result: transcribeShort({
      shortFolder,
      modelPath,
      whisperBinary: "whisper-cli",
      language: "en",
      run: commands.run,
      ...overrides,
    }),
  };
}

describe("transcribeShort", () => {
  test("extracts 16 kHz mono audio from the camera track for whisper", async () => {
    const { commands, result } = transcribe();
    await result;
    const audioPath = join(shortFolder, "takes", "audio.wav");
    expect(commands.calls[0]).toEqual({
      command: "ffmpeg",
      args: [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        join(shortFolder, "takes", "cam.webm"),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        audioPath,
      ],
    });
  });

  test("runs whisper-cli with one word per segment and JSON output", async () => {
    const { commands, result } = transcribe();
    await result;
    const whisperCall = commands.calls.find((call) => call.command === "whisper-cli");
    expect(whisperCall?.args).toEqual([
      "-m",
      modelPath,
      "-f",
      join(shortFolder, "takes", "audio.wav"),
      "-l",
      "en",
      "-ml",
      "1",
      "-sow",
      "-oj",
      "-of",
      join(shortFolder, "takes", "whisper"),
      "-np",
    ]);
  });

  test("writes transcript.json with the words, the model and the duration", async () => {
    const { result } = transcribe();
    const transcript = await result;

    const written = JSON.parse(readFileSync(join(shortFolder, "transcript.json"), "utf8"));
    expect(written).toEqual(transcript);
    expect(parseTranscript(written).success).toBe(true);
    expect(transcript.model).toBe("ggml-small.en.bin");
    expect(transcript.language).toBe("en");
    expect(transcript.durationMs).toBe(5000);
    expect(transcript.words.map((word) => word.text)).toEqual([
      "Anchor",
      "positioning",
      "ignores",
      "scroll.",
      "Here's",
      "why",
    ]);
  });

  test("keeps word times inside the recording when whisper overshoots the end", async () => {
    const commands = createFakeCommands({ durationSeconds: "4.400000" });
    const transcript = await transcribeShort({
      shortFolder,
      modelPath,
      whisperBinary: "whisper-cli",
      language: "en",
      run: commands.run,
    });
    expect(transcript.words.at(-1)).toEqual({ text: "why", startMs: 4250, endMs: 4400 });
  });

  test("reports a folder without a recorded take", async () => {
    rmSync(join(shortFolder, "takes.json"));
    const { result } = transcribe();
    await expect(result).rejects.toThrow(/No recorded take in .*short record/);
  });

  test("reports a missing model with the command that downloads it", async () => {
    const { result } = transcribe({ modelPath: join(workspace, "missing.bin") });
    await expect(result).rejects.toThrow(/whisper model .*missing\.bin.*curl/s);
  });

  test("reports a missing ffmpeg with how to install it", async () => {
    const commands = createFakeCommands({ missing: ["ffmpeg"] });
    const result = transcribeShort({
      shortFolder,
      modelPath,
      whisperBinary: "whisper-cli",
      language: "en",
      run: commands.run,
    });
    await expect(result).rejects.toThrow(/ffmpeg was not found.*brew install ffmpeg/);
  });

  test("reports a missing whisper-cli with how to install it", async () => {
    const commands = createFakeCommands({ missing: ["whisper-cli"] });
    const result = transcribeShort({
      shortFolder,
      modelPath,
      whisperBinary: "whisper-cli",
      language: "en",
      run: commands.run,
    });
    await expect(result).rejects.toThrow(/whisper-cli was not found.*brew install whisper-cpp/);
    expect(existsSync(join(shortFolder, "transcript.json"))).toBe(false);
  });

  test("reports whisper output it cannot read without writing a transcript", async () => {
    const commands = createFakeCommands({ whisperOutput: "{}" });
    const result = transcribeShort({
      shortFolder,
      modelPath,
      whisperBinary: "whisper-cli",
      language: "en",
      run: commands.run,
    });
    await expect(result).rejects.toThrow(/not in the expected format/);
    expect(existsSync(join(shortFolder, "transcript.json"))).toBe(false);
  });
});
