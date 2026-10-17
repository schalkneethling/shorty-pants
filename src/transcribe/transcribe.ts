import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { CommandNotFoundError, type CommandRunner } from "../commands.ts";
import { ShortError } from "../errors.ts";
import { parseRecordedTakes } from "../schemas/recorded-takes.ts";
import { parseTranscript, type Transcript } from "../schemas/transcript.ts";
import { parseWhisperWords } from "./whisper-json.ts";

const defaultWhisperBinary = "whisper-cli";

const installHints: Record<string, string> = {
  ffmpeg: "Install it with brew install ffmpeg.",
  ffprobe: "It comes with ffmpeg: brew install ffmpeg.",
  [defaultWhisperBinary]: "Install whisper.cpp with brew install whisper-cpp.",
};

// The model files that whisper.cpp publishes, such as ggml-small.en.bin or
// ggml-large-v3-turbo-q5_0.bin.
const publishedModelName =
  /^ggml-(tiny|base|small|medium|large-v1|large-v2|large-v3|large-v3-turbo)(\.en)?(-q5_0|-q5_1|-q8_0)?\.bin$/;

export interface TranscribeOptions {
  shortFolder: string;
  modelPath: string;
  whisperBinary: string;
  language: string;
  run: CommandRunner;
  // short.json refers to words by their position in transcript.json, so a new
  // transcript would make existing edits point at other words.
  replaceEditedTranscript?: boolean;
}

/** Quotes a value for a POSIX shell, so a pasted command cannot run anything else. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function modelDownloadHint(modelPath: string): string {
  const name = basename(modelPath);
  if (!publishedModelName.test(name)) {
    return "Download a ggml model from https://huggingface.co/ggerganov/whisper.cpp.";
  }
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${name}`;
  return `Download it with: curl --fail --create-dirs -L -o ${shellQuote(modelPath)} ${shellQuote(url)}`;
}

async function runTool(options: TranscribeOptions, command: string, args: string[]) {
  try {
    return await options.run(command, args);
  } catch (error) {
    if (error instanceof CommandNotFoundError) {
      const hint =
        installHints[command] ?? "Check SHORTY_PANTS_WHISPER_BIN, which names the whisper binary.";
      throw new ShortError(`${command} was not found. ${hint}`);
    }
    throw error;
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ShortError(`${path} is not valid JSON. ${reason}`);
  }
}

async function readRecordedTakes(shortFolder: string) {
  const takesPath = join(shortFolder, "takes.json");
  if (!existsSync(takesPath)) {
    throw new ShortError(`No recorded take in ${shortFolder}. Record one with short record.`);
  }
  const result = parseRecordedTakes(await readJson(takesPath));
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
  const hasEdits = existsSync(join(shortFolder, "short.json"));
  if (hasEdits && options.replaceEditedTranscript !== true) {
    throw new ShortError(
      `${join(shortFolder, "short.json")} refers to words in the current transcript by position, and a new transcript would move them. Use --force to replace it anyway.`,
    );
  }

  // whisper-cli cannot read WebM, so the camera's audio becomes a 16 kHz mono
  // WAV first. The resampler pads the start, so the audio lines up with the
  // video when the browser started the audio track a little later.
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
    "-af",
    "aresample=async=1:first_pts=0",
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

  // Full JSON output carries every token's time, refined from the audio, so
  // the silences between words survive.
  const outputBase = join(shortFolder, "takes", "whisper");
  const outputPath = `${outputBase}.json`;
  await rm(outputPath, { force: true });
  await runTool(options, options.whisperBinary, [
    "-m",
    modelPath,
    "-f",
    audioPath,
    "-l",
    language,
    "-ojf",
    "-of",
    outputBase,
    "-np",
  ]);
  // whisper-cli exits with 0 without writing anything when it does not know a flag.
  if (!existsSync(outputPath)) {
    throw new ShortError(
      `${options.whisperBinary} finished without writing ${outputPath}. Check that it is whisper.cpp 1.7 or newer.`,
    );
  }

  let words;
  try {
    words = parseWhisperWords(await readJson(outputPath));
  } catch (error) {
    throw error instanceof ShortError
      ? error
      : new ShortError(error instanceof Error ? error.message : String(error));
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
