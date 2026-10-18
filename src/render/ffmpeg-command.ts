import { coverPlacement, layoutGeometry, type Rect, type Size } from "../edit/layout-geometry.ts";
import { frame } from "../schemas/frame.ts";
import type { Preset } from "../schemas/preset.ts";
import type { FramedPiece, RenderPiece } from "./timeline.ts";

/** The recordings and settings that every piece is cut from. */
export interface PieceSources {
  // The seekable copies of the recordings.
  cameraPath: string;
  screenPath: string;
  cameraSize: Size;
  screenSize: Size;
  // Positive when the screen recorder started after the camera recorder.
  screenOffsetMs: number;
  screenCrop: Rect | undefined;
  safeZones: Preset["safeZones"];
  // A white circle on black, the size of the circle camera.
  circleMaskPath: string;
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/** Rounds up to an even number, which H.264 in 4:2:0 color needs. */
function evenAtLeast(value: number): number {
  return Math.ceil(value / 2) * 2;
}

/**
 * The scale and crop filters that make the cropped part of a source cover a
 * slot, the same placement the preview draws with CSS.
 */
export function scaleAndCrop(source: Size, crop: Rect | undefined, slot: Rect): string {
  const placement = coverPlacement(source, crop ?? { x: 0, y: 0, ...source }, slot);
  const width = evenAtLeast(placement.width);
  const height = evenAtLeast(placement.height);
  const cropX = Math.min(Math.max(Math.round(-placement.x), 0), width - slot.width);
  const cropY = Math.min(Math.max(Math.round(-placement.y), 0), height - slot.height);
  return `scale=${width}:${height},crop=${slot.width}:${slot.height}:${cropX}:${cropY}`;
}

/** Where a piece's window footage comes from in the window recording. */
function screenRange(
  piece: RenderPiece,
  screenOffsetMs: number,
): { startMs: number; durationMs: number; blackLeadMs: number } | null {
  const startMs = piece.startMs - screenOffsetMs;
  const endMs = piece.endMs - screenOffsetMs;
  if (endMs <= 0) {
    return null;
  }
  // Before the window recording starts, the window's slot shows black.
  const blackLeadMs = Math.max(-startMs, 0);
  return { startMs: Math.max(startMs, 0), durationMs: endMs - Math.max(startMs, 0), blackLeadMs };
}

const audioSampleRate = 48_000;

const commonArgs = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"];

/**
 * The FFmpeg command for one piece: its part of the recordings, placed in its
 * layout, with the headline and the piece's captions drawn over it, exactly
 * its number of frames, and sound of the same length. Pieces are rendered
 * one at a time, so only one piece is decoded at once, and their picture is
 * encoded only once.
 *
 * Seeking with -ss before each input decodes only the piece's part. The
 * first frame after a seek can come a little after the seek point; starting
 * the frame grid at 0 repeats it there, rather than moving it earlier, so the
 * picture stays in step with the sound.
 */
export function buildPieceCommand(
  piece: FramedPiece,
  sources: PieceSources,
  overlays: { headlineImagePath: string; captionsListPath: string },
  outputPath: string,
): { args: string[] } {
  const geometry = layoutGeometry(piece.layout, sources.safeZones);
  const pieceSeconds = seconds((piece.frames * 1000) / frame.fps);
  const inputArgs: string[][] = [];
  /** Adds an input and returns its index in the command. */
  const addInput = (args: string[]) => inputArgs.push(args) - 1;
  const frameGrid = `fps=${frame.fps}:start_time=0`;

  const headlineInput = addInput(["-i", overlays.headlineImagePath]);
  const captionsInput = addInput(["-f", "concat", "-i", overlays.captionsListPath]);
  const cameraInput = addInput([
    "-ss",
    seconds(piece.startMs),
    "-t",
    seconds(piece.endMs - piece.startMs),
    "-i",
    sources.cameraPath,
  ]);
  const graph = [
    `color=c=black:s=${frame.width}x${frame.height}:r=${frame.fps}:d=${pieceSeconds}[background]`,
    `[${cameraInput}:v]${frameGrid},${scaleAndCrop(sources.cameraSize, undefined, geometry.camera)}[camera]`,
    // The sound is padded with silence or trimmed to exactly the frames' length.
    `[${cameraInput}:a]aresample=${audioSampleRate},apad,atrim=end=${pieceSeconds},asetpts=N/SR/TB[audio]`,
  ];

  // Overlays keep showing a recording's last frame when it has no more, so a
  // window that stopped changing never cuts the piece short.
  let base = "background";
  const range = geometry.screen === null ? null : screenRange(piece, sources.screenOffsetMs);
  if (geometry.screen !== null && range !== null) {
    const screenInput = addInput([
      "-ss",
      seconds(range.startMs),
      "-t",
      seconds(range.durationMs),
      "-i",
      sources.screenPath,
    ]);
    const blackLead =
      range.blackLeadMs > 0 ? `tpad=start_duration=${seconds(range.blackLeadMs)}:color=black,` : "";
    graph.push(
      `[${screenInput}:v]${blackLead}${frameGrid},${scaleAndCrop(sources.screenSize, sources.screenCrop, geometry.screen)}[screen]`,
      `[background][screen]overlay=${geometry.screen.x}:${geometry.screen.y}[withscreen]`,
    );
    base = "withscreen";
  }

  let camera = "camera";
  if (geometry.cameraShape === "circle") {
    // The mask repeats for exactly the piece's length. A mask without an end
    // would keep the circle camera from ever ending, and the overlay would
    // wait for it forever.
    const maskInput = addInput([
      "-loop",
      "1",
      "-framerate",
      String(frame.fps),
      "-t",
      pieceSeconds,
      "-i",
      sources.circleMaskPath,
    ]);
    graph.push(`[camera][${maskInput}:v]alphamerge[cameracut]`);
    camera = "cameracut";
  }
  graph.push(
    `[${base}][${camera}]overlay=${geometry.camera.x}:${geometry.camera.y}[composed]`,
    // The headline is a single image; overlay keeps showing an input's last frame.
    `[composed][${headlineInput}:v]overlay=0:0[headlined]`,
    `[headlined][${captionsInput}:v]overlay=0:0:eof_action=pass,format=yuv420p[video]`,
  );

  return {
    args: [
      ...commonArgs,
      ...inputArgs.flat(),
      "-filter_complex",
      graph.join(";"),
      "-map",
      "[video]",
      "-map",
      "[audio]",
      "-frames:v",
      String(piece.frames),
      "-c:v",
      "libx264",
      // YouTube encodes every upload again, so a faster preset with a lower
      // CRF gives it a high-quality source in a fraction of the time.
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(frame.fps),
      "-c:a",
      "pcm_s16le",
      outputPath,
    ],
  };
}

/**
 * The FFmpeg command that joins the rendered pieces, whose picture is copied
 * as it is, and brings the sound of the whole short to YouTube's loudness.
 */
export function buildFinalCommand(input: {
  piecesListPath: string;
  frames: number;
  outputPath: string;
}): { args: string[] } {
  const samples = (input.frames * audioSampleRate) / frame.fps;
  // YouTube plays at about -14 LUFS. loudnorm works in 100 ms blocks and
  // drops a last partial block, so the sound is padded first and trimmed back
  // to the picture's exact length after. Its output timestamps do not follow
  // its samples either, so they are counted again from the samples.
  const audioFilter = [
    "apad=pad_dur=0.5",
    "loudnorm=I=-14:TP=-1.5:LRA=11",
    `aresample=${audioSampleRate}`,
    "asetpts=N/SR/TB",
    `atrim=end_sample=${samples}`,
  ].join(",");
  return {
    args: [
      ...commonArgs,
      "-f",
      "concat",
      "-i",
      input.piecesListPath,
      "-map",
      "0:v",
      "-map",
      "0:a",
      "-c:v",
      "copy",
      "-af",
      audioFilter,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      input.outputPath,
    ],
  };
}
