import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chunkCaptions, keptWords } from "../edit/captions.ts";
import { computeKeepRanges } from "../edit/cut-list.ts";
import { layoutGeometry, type Size } from "../edit/layout-geometry.ts";
import { keptDurationMs, shortTimeMs } from "../edit/playback.ts";
import { makeSeekableCopies } from "../edit/seekable-copies.ts";
import { layoutAtTime } from "../edit/segments.ts";
import { CommandNotFoundError, type CommandRunner } from "../commands.ts";
import { ShortError } from "../errors.ts";
import { readValidatedJson } from "../json-file.ts";
import { readPreset } from "../preset-file.ts";
import { parseRecordedTakes } from "../schemas/recorded-takes.ts";
import { parseShortProject } from "../schemas/short-project.ts";
import { parseTranscript } from "../schemas/transcript.ts";
import { buildRenderCommand } from "./ffmpeg-command.ts";
import { renderOverlays, type CaptionImage } from "./overlays.ts";
import { captionCues, captionFrames, renderPieces } from "./timeline.ts";
import { toFfconcat, toWebVtt, uploadText } from "./text-outputs.ts";

// YouTube treats vertical videos of up to three minutes as Shorts.
const shortsLimitMs = 180_000;

export interface RenderOptions {
  shortFolder: string;
  webRoot: string;
  run: CommandRunner;
  executablePath?: string;
}

export interface RenderResult {
  durationMs: number;
  videoPath: string;
  captionsPath: string;
  uploadPath: string;
}

async function runTool(run: CommandRunner, command: string, args: string[]) {
  try {
    return await run(command, args);
  } catch (error) {
    if (error instanceof CommandNotFoundError) {
      throw new ShortError(`${command} was not found. Install ffmpeg with brew install ffmpeg.`);
    }
    throw error;
  }
}

/** The width and height of a recording's video. */
async function videoSize(run: CommandRunner, path: string): Promise<Size> {
  const { stdout } = await runTool(run, "ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    path,
  ]);
  const [width, height] = stdout.trim().split(",").map(Number);
  const isUsable = Number.isInteger(width) && Number.isInteger(height) && width! > 0 && height! > 0;
  if (!isUsable) {
    throw new ShortError(`ffprobe could not read the video size of ${path}.`);
  }
  return { width: width!, height: height! };
}

function formatLength(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

/**
 * Renders out/short.mp4 from the recordings and the edits in short.json, with
 * out/captions.vtt for YouTube's caption track and out/upload.txt with a
 * suggested title and description.
 */
export async function renderShort(options: RenderOptions): Promise<RenderResult> {
  const { shortFolder, run } = options;
  if (!existsSync(join(options.webRoot, "render", "index.html"))) {
    throw new ShortError(
      `The render page is missing from ${options.webRoot}. Run "pnpm build" first.`,
    );
  }

  const recordedTakes = await readValidatedJson(
    join(shortFolder, "takes.json"),
    `No recorded take in ${shortFolder}. Record one with short record.`,
    parseRecordedTakes,
  );
  const transcript = await readValidatedJson(
    join(shortFolder, "transcript.json"),
    `${shortFolder} has no transcript yet. Run short transcribe "${shortFolder}" first.`,
    parseTranscript,
  );
  const short = await readValidatedJson(
    join(shortFolder, "short.json"),
    `${shortFolder} has no edits yet. Open it with short edit "${shortFolder}" first.`,
    parseShortProject,
  );
  const { headline } = short;
  if (headline === undefined) {
    throw new ShortError(
      `The short has no headline yet. Add one with short edit "${shortFolder}", then render again.`,
    );
  }
  const preset = await readPreset(dirname(shortFolder));

  const keepRanges = computeKeepRanges({ words: transcript.words, ...short });
  const durationMs = keptDurationMs(keepRanges);
  if (durationMs === 0) {
    throw new ShortError("The edits cut everything. Bring back some words in short edit.");
  }
  if (durationMs > shortsLimitMs) {
    throw new ShortError(
      `The short is ${formatLength(durationMs)} long, and Shorts can be up to 3:00. Cut it down in short edit.`,
    );
  }

  // The seekable copies let FFmpeg jump to each piece instead of decoding
  // the recordings from the start for every piece.
  const { cam: cameraPath, screen: screenPath } = await makeSeekableCopies(
    shortFolder,
    {
      cam: join(shortFolder, recordedTakes.takes.cam),
      screen: join(shortFolder, recordedTakes.takes.screen),
    },
    run,
  );
  const [cameraSize, screenSize] = await Promise.all([
    videoSize(run, cameraPath),
    videoSize(run, screenPath),
  ]);

  const words = keptWords(transcript.words, keepRanges);
  const chunks = chunkCaptions(words, preset.captions, keepRanges);
  const cues = captionCues(chunks, keepRanges);
  const outputDir = join(shortFolder, "out");
  const overlaysDir = join(outputDir, "overlays");
  await rm(overlaysDir, { recursive: true, force: true });
  await mkdir(overlaysDir, { recursive: true });

  // Each caption state is placed in the captions area of the layout of the
  // word being said, as in the preview, so a chunk that crosses a layout
  // change moves with the layout.
  const captionImages: CaptionImage[] = cues.map((cue) => {
    const chunk = chunks[cue.chunkIndex]!;
    const spokenWord = chunk.words[cue.wordIndex]!;
    const layout = layoutAtTime(transcript.words, short.segments, spokenWord.startMs);
    return {
      file: join(overlaysDir, `caption-${cue.chunkIndex}-${cue.wordIndex}.png`),
      words: chunk.words.map((word) => word.text),
      wordIndex: cue.wordIndex,
      area: layoutGeometry(layout, preset.safeZones).captions,
    };
  });
  const circleCamera = layoutGeometry("circle", preset.safeZones).camera;
  const overlays = await renderOverlays({
    webRoot: options.webRoot,
    outputDir: overlaysDir,
    preset,
    headline: { ...headline, area: layoutGeometry("split", preset.safeZones).headline },
    captions: captionImages,
    circleMaskSize: { width: circleCamera.width, height: circleCamera.height },
    executablePath: options.executablePath,
  });

  const captionsListPath = join(overlaysDir, "captions.ffconcat");
  const captionEntries = captionFrames(cues, durationMs).map((captionFrame) => ({
    file:
      captionFrame.image === null
        ? overlays.blank
        : join(
            overlaysDir,
            `caption-${captionFrame.image.chunkIndex}-${captionFrame.image.wordIndex}.png`,
          ),
    durationMs: captionFrame.durationMs,
  }));
  await writeFile(captionsListPath, toFfconcat(captionEntries));

  // FFmpeg writes to a separate file that is renamed once it is complete, so
  // an interrupted render never leaves a short.mp4 that looks finished.
  const videoPath = join(outputDir, "short.mp4");
  const partialVideoPath = join(outputDir, "short.partial.mp4");
  const { args } = buildRenderCommand({
    cameraPath,
    screenPath,
    cameraSize,
    screenSize,
    screenOffsetMs: recordedTakes.takes.screenOffsetMs,
    screenCrop: short.screenCrop,
    safeZones: preset.safeZones,
    pieces: renderPieces({ words: transcript.words, keepRanges, segments: short.segments }),
    headlineImagePath: overlays.headline,
    captionsListPath,
    circleMaskPath: overlays.circleMask,
    outputPath: partialVideoPath,
  });
  try {
    await runTool(run, "ffmpeg", args);
    await rename(partialVideoPath, videoPath);
  } finally {
    await rm(partialVideoPath, { force: true });
  }

  const captionsPath = join(outputDir, "captions.vtt");
  await writeFile(
    captionsPath,
    toWebVtt(
      chunks.map((chunk) => ({
        startMs: shortTimeMs(keepRanges, chunk.startMs),
        endMs: shortTimeMs(keepRanges, chunk.displayEndMs),
        text: chunk.words.map((word) => word.text).join(" "),
      })),
    ),
  );
  const uploadPath = join(outputDir, "upload.txt");
  await writeFile(
    uploadPath,
    uploadText({
      headline: headline.text,
      spokenText: words.map((word) => word.text).join(" "),
    }),
  );
  await rm(overlaysDir, { recursive: true, force: true });

  return { durationMs, videoPath, captionsPath, uploadPath };
}
