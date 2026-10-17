import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { CommandNotFoundError, type CommandRunner } from "../commands.ts";
import { ShortError } from "../errors.ts";
import { parseRecordedTakes } from "../schemas/recorded-takes.ts";
import { parseTranscript, type Transcript } from "../schemas/transcript.ts";
import { parseWhisperWords } from "./whisper-json.ts";

const installHints: Record<string, string> = {
  ffmpeg: "Install it with brew install ffmpeg.",
  ffprobe: "It comes with ffmpeg: brew install ffmpeg.",
};

export interface TranscribeOptions {
  shortFolder: string;
  modelPath: string;
  whisperBinary: string;
  language: string;
  run: CommandRunner;
}

function modelDownloadHint(modelPath: string): string {
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${basename(modelPath)}`;
  return `Download it with: curl --create-dirs -L -o "${modelPath}" ${url}`;
}

async function runTool(options: TranscribeOptions, command: string, args: string[]) {
  try {
    return await options.run(command, args);
  } catch (error) {
    if (error instanceof CommandNotFoundError) {
      const hint = installHints[command] ?? "Install whisper.cpp with brew install whisper-cpp.";
      throw new ShortError(`${command} was not found. ${hint}`);
    }
    throw error;
  }
}

async function readRecordedTakes(shortFolder: string) {
  const takesPath = join(shortFolder, "takes.json");
  if (!existsSync(takesPath)) {
    throw new ShortError(`No recorded take in ${shortFolder}. Record one with short record.`);
  }
  const result = parseRecordedTakes(JSON.parse(await readFile(takesPath, "utf8")));
  if (!result.success) {
    throw new ShortError(`${takesPath} is not valid. ${result.error.message}`);
  }
  return result.data;
}

/**
 * Transcribes the camera track of a short with whisper.cpp and writes
 * transcript.json: every word with its start and end in the camera track.
 */
export async function transcribeShort(options: TranscribeOptions): Promise<Transcript> {
  const { shortFolder, modelPath, language } = options;
  const recorded = await readRecordedTakes(shortFolder);
  if (!existsSync(modelPath)) {
    throw new ShortError(
      `The whisper model ${modelPath} does not exist. ${modelDownloadHint(modelPath)}`,
    );
  }

  // whisper-cli cannot read WebM, so the camera's audio becomes a 16 kHz mono WAV first.
  const audioPath = join(shortFolder, "takes", "audio.wav");
  await runTool(options, "ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    join(shortFolder, recorded.takes.cam),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    audioPath,
  ]);

  // Browser recordings do not store their duration, but the WAV file does.
  const probe = await runTool(options, "ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    audioPath,
  ]);
  const durationMs = Math.round(Number.parseFloat(probe.stdout) * 1000);
  if (!Number.isFinite(durationMs)) {
    throw new ShortError(`ffprobe did not report a duration for ${audioPath}.`);
  }

  const outputBase = join(shortFolder, "takes", "whisper");
  await rm(`${outputBase}.json`, { force: true });
  // -ml 1 with -sow makes every segment a single word with its own times.
  await runTool(options, options.whisperBinary, [
    "-m",
    modelPath,
    "-f",
    audioPath,
    "-l",
    language,
    "-ml",
    "1",
    "-sow",
    "-oj",
    "-of",
    outputBase,
    "-np",
  ]);

  let words;
  try {
    words = parseWhisperWords(JSON.parse(await readFile(`${outputBase}.json`, "utf8")));
  } catch (error) {
    throw new ShortError(error instanceof Error ? error.message : String(error));
  }

  // whisper can place the last word slightly past the end of the audio.
  const wordsInsideRecording = words
    .filter((word) => word.startMs < durationMs)
    .map((word) => ({ ...word, endMs: Math.min(word.endMs, durationMs) }));

  const transcript: Transcript = {
    version: 1,
    model: basename(modelPath),
    language,
    durationMs,
    words: wordsInsideRecording,
  };
  const validated = parseTranscript(transcript);
  if (!validated.success) {
    throw new ShortError(`The transcript is not valid. ${validated.error.message}`);
  }

  await writeFile(join(shortFolder, "transcript.json"), `${JSON.stringify(transcript, null, 2)}\n`);
  return transcript;
}
