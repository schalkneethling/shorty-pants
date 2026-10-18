import { coverPlacement, layoutGeometry, type Rect, type Size } from "../edit/layout-geometry.ts";
import { frame } from "../schemas/frame.ts";
import type { Preset } from "../schemas/preset.ts";
import type { RenderPiece } from "./timeline.ts";

export interface RenderInputs {
  cameraPath: string;
  screenPath: string;
  cameraSize: Size;
  screenSize: Size;
  // Positive when the screen recorder started after the camera recorder.
  screenOffsetMs: number;
  screenCrop: Rect | undefined;
  safeZones: Preset["safeZones"];
  pieces: RenderPiece[];
  // Full-frame transparent images drawn by the overlay page.
  headlineImagePath: string;
  // A concat demuxer list of full-frame caption images, timed for the short.
  captionsListPath: string;
  // A white circle on black, the size of the circle camera.
  circleMaskPath: string;
  outputPath: string;
}

const headlineInput = 0;
const captionsInput = 1;

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

/**
 * The FFmpeg command that cuts the recordings into the short, places them in
 * each piece's layout, and draws the headline and captions over everything.
 * Each piece opens its own part of the recordings, so FFmpeg seeks to it and
 * decodes only that part, rather than decoding every frame for every piece.
 */
export function buildRenderCommand(inputs: RenderInputs): { args: string[] } {
  const inputArgs: string[][] = [
    ["-i", inputs.headlineImagePath],
    ["-f", "concat", "-safe", "0", "-i", inputs.captionsListPath],
  ];
  /** Adds an input and returns its index in the command. */
  const addInput = (args: string[]) => inputArgs.push(args) - 1;

  const graph: string[] = [];
  const frameSize = `${frame.width}x${frame.height}`;

  inputs.pieces.forEach((piece, index) => {
    const geometry = layoutGeometry(piece.layout, inputs.safeZones);
    const durationMs = piece.endMs - piece.startMs;

    const cameraInput = addInput([
      "-ss",
      seconds(piece.startMs),
      "-t",
      seconds(durationMs),
      "-i",
      inputs.cameraPath,
    ]);
    graph.push(
      `color=c=black:s=${frameSize}:r=${frame.fps}:d=${seconds(durationMs)}[background${index}]`,
    );
    graph.push(
      `[${cameraInput}:v]setpts=PTS-STARTPTS,fps=${frame.fps},${scaleAndCrop(inputs.cameraSize, undefined, geometry.camera)}[camera${index}]`,
    );
    graph.push(`[${cameraInput}:a]asetpts=PTS-STARTPTS[audio${index}]`);

    let base = `background${index}`;
    const range = geometry.screen === null ? null : screenRange(piece, inputs.screenOffsetMs);
    if (geometry.screen !== null && range !== null) {
      const screenInput = addInput([
        "-ss",
        seconds(range.startMs),
        "-t",
        seconds(range.durationMs),
        "-i",
        inputs.screenPath,
      ]);
      const blackLead =
        range.blackLeadMs > 0
          ? `tpad=start_duration=${seconds(range.blackLeadMs)}:color=black,`
          : "";
      graph.push(
        `[${screenInput}:v]setpts=PTS-STARTPTS,${blackLead}fps=${frame.fps},${scaleAndCrop(inputs.screenSize, inputs.screenCrop, geometry.screen)}[screen${index}]`,
      );
      graph.push(
        `[${base}][screen${index}]overlay=${geometry.screen.x}:${geometry.screen.y}:shortest=1[withscreen${index}]`,
      );
      base = `withscreen${index}`;
    }

    let camera = `camera${index}`;
    if (geometry.cameraShape === "circle") {
      const maskInput = addInput(["-loop", "1", "-i", inputs.circleMaskPath]);
      graph.push(`[camera${index}][${maskInput}:v]alphamerge[camera${index}cut]`);
      camera = `camera${index}cut`;
    }
    graph.push(
      `[${base}][${camera}]overlay=${geometry.camera.x}:${geometry.camera.y}:shortest=1[piece${index}]`,
    );
  });

  const concatInputs = inputs.pieces.map((_, index) => `[piece${index}][audio${index}]`).join("");
  graph.push(`${concatInputs}concat=n=${inputs.pieces.length}:v=1:a=1[joined][joinedaudio]`);
  // The headline is a single image; overlay keeps showing an input's last frame.
  graph.push(`[joined][${headlineInput}:v]overlay=0:0[headlined]`);
  graph.push(`[headlined][${captionsInput}:v]overlay=0:0:eof_action=pass,format=yuv420p[video]`);
  // YouTube plays at about -14 LUFS; quieter or louder sound is turned up or down to match.
  graph.push("[joinedaudio]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[audio]");

  const args = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...inputArgs.flat(),
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[video]",
    "-map",
    "[audio]",
    "-c:v",
    "libx264",
    // YouTube encodes every upload again, so a faster preset with a lower CRF
    // gives it a high-quality source in a fraction of the time.
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(frame.fps),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    inputs.outputPath,
  ];
  return { args };
}
