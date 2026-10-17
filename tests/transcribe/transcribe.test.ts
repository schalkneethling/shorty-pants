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
import { transcribeShort, type TranscribeOptions } from "../../src/transcribe/transcribe.ts";
import { createFakeCommands, type FakeCommands } from "../helpers/fake-commands.ts";

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

function transcribe(
  overrides: Partial<TranscribeOptions> = {},
  commands: FakeCommands = createFakeCommands(),
) {
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
  test("extracts 16 kHz mono audio from the camera track, aligned to the start of the video", async () => {
    const { commands, result } = transcribe();
    await result;
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
        "-af",
        "aresample=async=1:first_pts=0",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        join(shortFolder, "takes", "audio.wav"),
      ],
    });
  });

  test("runs whisper-cli with full JSON output, which has the token times", async () => {
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
      "-ojf",
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
      "“Here's”",
      "why",
    ]);
  });

  test("keeps word times inside the recording when whisper overshoots the end", async () => {
    const { result } = transcribe({}, createFakeCommands({ durationSeconds: "3.800000" }));
    const transcript = await result;
    expect(transcript.words.at(-1)).toEqual({ text: "why", startMs: 3600, endMs: 3800 });
  });

  test("reports a folder without a recorded take", async () => {
    rmSync(join(shortFolder, "takes.json"));
    const { result } = transcribe();
    await expect(result).rejects.toThrow(/No recorded take in .*short record/);
  });

  test("reports a takes.json that is not valid JSON", async () => {
    writeFileSync(join(shortFolder, "takes.json"), "{bad");
    const { result } = transcribe();
    await expect(result).rejects.toThrow(/takes\.json is not valid/);
  });

  test("reports a missing model with a download command that is safe to paste", async () => {
    const missing = join(workspace, "it's here", "ggml-small.en.bin");
    const { result } = transcribe({ modelPath: missing });
    await expect(result).rejects.toThrow(
      `curl --fail --create-dirs -L -o '${join(workspace, "it'\\''s here", "ggml-small.en.bin")}' 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin'`,
    );
  });

  test("does not invent a download address for a model it does not know", async () => {
    const { result } = transcribe({ modelPath: join(workspace, "my-model.bin") });
    await expect(result).rejects.toThrow(
      /does not exist\. Download a ggml model from https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp/,
    );
    await expect(
      transcribe({ modelPath: join(workspace, "my-model.bin") }).result,
    ).rejects.not.toThrow(/curl/);
  });

  test("reports a missing ffmpeg with how to install it", async () => {
    const { result } = transcribe({}, createFakeCommands({ missing: ["ffmpeg"] }));
    await expect(result).rejects.toThrow(/ffmpeg was not found.*brew install ffmpeg/);
  });

  test("reports a missing whisper-cli with how to install it", async () => {
    const { result } = transcribe({}, createFakeCommands({ missing: ["whisper-cli"] }));
    await expect(result).rejects.toThrow(/whisper-cli was not found.*brew install whisper-cpp/);
    expect(existsSync(join(shortFolder, "transcript.json"))).toBe(false);
  });

  test("names SHORTY_PANTS_WHISPER_BIN when a custom whisper binary is missing", async () => {
    const { result } = transcribe(
      { whisperBinary: "/opt/whisper/bin/whisper-cli" },
      createFakeCommands({ missing: ["/opt/whisper/bin/whisper-cli"] }),
    );
    await expect(result).rejects.toThrow(/was not found\. Check SHORTY_PANTS_WHISPER_BIN/);
  });

  test("reports whisper-cli finishing without writing its output", async () => {
    const { result } = transcribe({}, createFakeCommands({ whisperWritesNothing: true }));
    await expect(result).rejects.toThrow(/whisper-cli finished without writing .*whisper\.json/);
  });

  test("reports whisper output it cannot read without writing a transcript", async () => {
    const { result } = transcribe({}, createFakeCommands({ whisperOutput: "{}" }));
    await expect(result).rejects.toThrow(/not in the expected format/);
    expect(existsSync(join(shortFolder, "transcript.json"))).toBe(false);
  });

  test("refuses to replace the transcript once short.json refers to its words", async () => {
    writeFileSync(join(shortFolder, "short.json"), "{}");
    const { commands, result } = transcribe();
    await expect(result).rejects.toThrow(/short\.json .*--force/);
    expect(commands.calls).toEqual([]);
  });

  test("replaces the transcript when short.json exists and replacing is allowed", async () => {
    writeFileSync(join(shortFolder, "short.json"), "{}");
    const { result } = transcribe({ replaceEditedTranscript: true });
    await expect(result).resolves.toMatchObject({ durationMs: 5000 });
  });
});
