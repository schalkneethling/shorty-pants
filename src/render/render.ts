import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { chunkCaptions, keptWords } from "../edit/captions.ts";
import { computeKeepRanges } from "../edit/cut-list.ts";
import { layoutGeometry, type Size } from "../edit/layout-geometry.ts";
import { shortTimeMs } from "../edit/playback.ts";
import { makeSeekableCopies } from "../edit/seekable-copies.ts";
import { layoutChanges } from "../edit/segments.ts";
import { CommandNotFoundError, type CommandRunner } from "../commands.ts";
import { ShortError } from "../errors.ts";
import { readValidatedJson } from "../json-file.ts";
import { readPreset } from "../preset-file.ts";
import { frame } from "../schemas/frame.ts";
import { parseRecordedTakes } from "../schemas/recorded-takes.ts";
import { parseShortProject } from "../schemas/short-project.ts";
import { parseTranscript } from "../schemas/transcript.ts";
import { buildFinalCommand, buildPieceCommand } from "./ffmpeg-command.ts";
import { renderOverlays, type CaptionImage } from "./overlays.ts";
import {
  captionCues,
  captionFrames,
  captionFramesBetween,
  framePieces,
  renderPieces,
  splitCuesAtLayoutChanges,
} from "./timeline.ts";
import { imageConcatList, toWebVtt, uploadText, videoConcatList } from "./text-outputs.ts";

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
  const pieces = framePieces(
    renderPieces({ words: transcript.words, keepRanges, segments: short.segments }),
  );
  // The short's length on the frame grid, which every output follows.
  const frames = pieces.reduce((total, piece) => total + piece.frames, 0);
  const durationMs = (frames * 1000) / frame.fps;
  if (frames === 0) {
    throw new ShortError("The edits cut everything. Bring back some words in short edit.");
  }
  if (durationMs > shortsLimitMs) {
    throw new ShortError(
      `The short is ${formatLength(durationMs)} long, and Shorts can be up to 3:00. Cut it down in short edit.`,
    );
  }

  // The seekable copies let FFmpeg jump to each piece instead of decoding
  // the recordings from the start.
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
  // Captions move to the new layout's area at the moment the picture changes.
  const layoutChangesInShort = layoutChanges(transcript.words, short.segments).map((change) => ({
    fromMs: shortTimeMs(keepRanges, change.fromMs),
    layout: change.layout,
  }));
  const cues = splitCuesAtLayoutChanges(captionCues(chunks, keepRanges), layoutChangesInShort);

  const outputDir = join(shortFolder, "out");
  // Everything the render makes on the way, removed when it ends.
  const workDir = join(outputDir, "render");
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  const videoPath = join(outputDir, "short.mp4");
  // FFmpeg writes to a separate file that is renamed once it is complete, so
  // an interrupted render never leaves a short.mp4 that looks finished.
  const partialVideoPath = join(outputDir, "short.partial.mp4");

  try {
    /** The image file for a caption state; the lists refer to it by name. */
    const captionFile = (cue: { chunkIndex: number; wordIndex: number; layout: string }) =>
      `caption-${cue.chunkIndex}-${cue.wordIndex}-${cue.layout}.png`;
    const uniqueCues = [...new Map(cues.map((cue) => [captionFile(cue), cue])).values()];
    const captionImages: CaptionImage[] = uniqueCues.map((cue) => {
      const chunk = chunks[cue.chunkIndex]!;
      return {
        file: join(workDir, captionFile(cue)),
        words: chunk.words.map((word) => word.text),
        wordIndex: cue.wordIndex,
        area: layoutGeometry(cue.layout, preset.safeZones).captions,
      };
    });
    const circleCamera = layoutGeometry("circle", preset.safeZones).camera;
    const overlays = await renderOverlays({
      webRoot: options.webRoot,
      outputDir: workDir,
      preset,
      headline: { ...headline, area: layoutGeometry("split", preset.safeZones).headline },
      captions: captionImages,
      circleMaskSize: { width: circleCamera.width, height: circleCamera.height },
      executablePath: options.executablePath,
    });

    const sources = {
      cameraPath,
      screenPath,
      cameraSize,
      screenSize,
      screenOffsetMs: recordedTakes.takes.screenOffsetMs,
      screenCrop: short.screenCrop,
      safeZones: preset.safeZones,
      circleMaskPath: overlays.circleMask,
    };
    const allCaptionFrames = captionFrames(cues, durationMs);
    const frameMs = 1000 / frame.fps;
    const pieceFiles: { file: string; durationMs: number }[] = [];
    for (const [index, piece] of pieces.entries()) {
      const name = `piece-${String(index).padStart(4, "0")}`;
      // Each piece draws the captions of its own stretch of the short. The
      // lists name images next to them, which the concat demuxer finds
      // without full paths.
      const captionsListPath = join(workDir, `${name}.ffconcat`);
      const pieceStartMs = piece.firstFrame * frameMs;
      const pieceEndMs = (piece.firstFrame + piece.frames) * frameMs;
      await writeFile(
        captionsListPath,
        imageConcatList(
          captionFramesBetween(allCaptionFrames, pieceStartMs, pieceEndMs).map((captionFrame) => ({
            file:
              captionFrame.image === null
                ? basename(overlays.blank)
                : captionFile(captionFrame.image),
            durationMs: captionFrame.durationMs,
          })),
        ),
      );
      // NUT keeps exact timestamps, where Matroska rounds them to milliseconds.
      const file = `${name}.nut`;
      const { args } = buildPieceCommand(
        piece,
        sources,
        { headlineImagePath: overlays.headline, captionsListPath },
        join(workDir, file),
      );
      await runTool(run, "ffmpeg", args);
      pieceFiles.push({ file, durationMs: piece.frames * frameMs });
    }
    const piecesListPath = join(workDir, "pieces.ffconcat");
    await writeFile(piecesListPath, videoConcatList(pieceFiles));

    const { args } = buildFinalCommand({ piecesListPath, frames, outputPath: partialVideoPath });
    await runTool(run, "ffmpeg", args);
    await rename(partialVideoPath, videoPath);
  } finally {
    await rm(partialVideoPath, { force: true });
    await rm(workDir, { recursive: true, force: true });
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

  return { durationMs, videoPath, captionsPath, uploadPath };
}
