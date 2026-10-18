import { describe, expect, test } from "vite-plus/test";
import {
  buildFinalCommand,
  buildPieceCommand,
  scaleAndCrop,
  type PieceSources,
} from "../../src/render/ffmpeg-command.ts";
import { defaultPreset } from "../../src/schemas/preset.ts";

const sources: PieceSources = {
  cameraPath: "/short/takes/cam.preview.webm",
  screenPath: "/short/takes/screen.preview.webm",
  cameraSize: { width: 1280, height: 720 },
  screenSize: { width: 1920, height: 1080 },
  screenOffsetMs: 40,
  screenCrop: undefined,
  safeZones: defaultPreset.safeZones,
  circleMaskPath: "/short/out/render/circle-mask.png",
};

function filterGraph(args: string[]): string[] {
  return args[args.indexOf("-filter_complex") + 1]!.split(";");
}

/** Each input file with the options before it, such as ["-ss", "0.200", "-t", "1.100"]. */
function inputsOf(args: string[]): { options: string[]; file: string }[] {
  const inputs: { options: string[]; file: string }[] = [];
  let options: string[] = [];
  for (let index = args.indexOf("-y") + 1; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "-filter_complex") {
      break;
    }
    if (arg === "-i") {
      inputs.push({ options, file: args[index + 1]! });
      options = [];
      index += 1;
    } else {
      options.push(arg);
    }
  }
  return inputs;
}

const splitPiece = {
  startMs: 200,
  endMs: 1300,
  layout: "split" as const,
  firstFrame: 0,
  frames: 33,
};
const facePiece = {
  startMs: 1300,
  endMs: 1900,
  layout: "face" as const,
  firstFrame: 33,
  frames: 18,
};
const circlePiece = {
  startMs: 2500,
  endMs: 3500,
  layout: "circle" as const,
  firstFrame: 51,
  frames: 30,
};

const overlays = {
  headlineImagePath: "/short/out/render/headline.png",
  captionsListPath: "/short/out/render/captions-0.ffconcat",
};

describe("buildPieceCommand", () => {
  const { args } = buildPieceCommand(
    splitPiece,
    sources,
    overlays,
    "/short/out/render/piece-0.nut",
  );
  const graph = filterGraph(args);

  test("reads the overlays and only the piece's part of the camera and of the window, which started 40 ms later", () => {
    expect(inputsOf(args)).toEqual([
      { options: [], file: overlays.headlineImagePath },
      { options: ["-f", "concat"], file: overlays.captionsListPath },
      { options: ["-ss", "0.200", "-t", "1.100"], file: sources.cameraPath },
      { options: ["-ss", "0.160", "-t", "1.100"], file: sources.screenPath },
    ]);
  });

  test("draws the piece on a black frame exactly as long as its frames", () => {
    expect(graph).toContain("color=c=black:s=1080x1920:r=30:d=1.100[background]");
  });

  test("starts the camera on the frame grid without moving it ahead of its sound", () => {
    expect(graph).toContain("[2:v]fps=30:start_time=0,scale=1536:864,crop=1080:864:228:0[camera]");
  });

  test("makes the sound exactly as long as the frames, padding or trimming the end", () => {
    expect(graph).toContain("[2:a]aresample=48000,apad,atrim=end=1.100,asetpts=N/SR/TB[audio]");
  });

  test("keeps the picture when a recording has no more frames, rather than ending the piece", () => {
    expect(graph).toContain("[background][screen]overlay=0:0[withscreen]");
    expect(graph).toContain("[withscreen][camera]overlay=0:1056[composed]");
    expect(graph.some((statement) => statement.includes("shortest"))).toBe(false);
  });

  test("draws the headline, which stays to the end, and the piece's captions over it", () => {
    expect(graph).toContain("[composed][0:v]overlay=0:0[headlined]");
    expect(graph).toContain("[headlined][1:v]overlay=0:0:eof_action=pass,format=yuv420p[video]");
  });

  test("encodes exactly the piece's frames in H.264 at 30 per second, and keeps the sound as it is", () => {
    expect(args.slice(args.indexOf("-map"))).toEqual([
      "-map",
      "[video]",
      "-map",
      "[audio]",
      "-frames:v",
      "33",
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
      "30",
      "-c:a",
      "pcm_s16le",
      "/short/out/render/piece-0.nut",
    ]);
  });

  test("leaves the window out of a face piece", () => {
    const face = buildPieceCommand(facePiece, sources, overlays, "piece.nut");
    expect(inputsOf(face.args).map((input) => input.file)).toEqual([
      overlays.headlineImagePath,
      overlays.captionsListPath,
      sources.cameraPath,
    ]);
    expect(filterGraph(face.args)).toContain("[background][camera]overlay=0:0[composed]");
  });

  test("cuts the camera into a circle with a mask as long as the piece", () => {
    const circle = buildPieceCommand(circlePiece, sources, overlays, "piece.nut");
    expect(inputsOf(circle.args)[4]).toEqual({
      options: ["-loop", "1", "-framerate", "30", "-t", "1.000"],
      file: sources.circleMaskPath,
    });
    expect(filterGraph(circle.args)).toContain("[camera][4:v]alphamerge[cameracut]");
  });

  test("pads the window with black when the piece starts before its recording", () => {
    const early = buildPieceCommand(
      splitPiece,
      { ...sources, screenOffsetMs: 500 },
      overlays,
      "piece.nut",
    );
    expect(inputsOf(early.args)[3]).toEqual({
      options: ["-ss", "0.000", "-t", "0.800"],
      file: sources.screenPath,
    });
    expect(
      filterGraph(early.args).some((statement) =>
        statement.startsWith("[3:v]tpad=start_duration=0.300:color=black,fps=30:start_time=0,"),
      ),
    ).toBe(true);
  });

  test("shows black where the window would be when the piece ends before its recording starts", () => {
    const early = buildPieceCommand(
      splitPiece,
      { ...sources, screenOffsetMs: 2000 },
      overlays,
      "piece.nut",
    );
    expect(inputsOf(early.args).map((input) => input.file)).not.toContain(sources.screenPath);
  });
});

describe("buildFinalCommand", () => {
  const { args } = buildFinalCommand({
    piecesListPath: "/short/out/render/pieces.ffconcat",
    frames: 81,
    outputPath: "/short/out/short.partial.mp4",
  });

  test("joins the pieces and copies their picture, which is already encoded", () => {
    expect(inputsOf(args)).toEqual([
      { options: ["-f", "concat"], file: "/short/out/render/pieces.ffconcat" },
    ]);
    expect(args.slice(args.indexOf("-c:v"), args.indexOf("-c:v") + 2)).toEqual(["-c:v", "copy"]);
  });

  test("brings the sound to YouTube's loudness, with fresh timestamps and the picture's length", () => {
    // 81 frames at 30 per second is 2.7 s, which is 129,600 samples at 48 kHz.
    expect(args[args.indexOf("-af") + 1]).toBe(
      "apad=pad_dur=0.5,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,asetpts=N/SR/TB,atrim=end_sample=129600",
    );
  });

  test("encodes the sound in AAC, in a file ready to stream", () => {
    expect(args.slice(args.indexOf("-c:a"))).toEqual([
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "/short/out/short.partial.mp4",
    ]);
  });
});

describe("scaleAndCrop", () => {
  test("scales the source to cover the slot, rounded up to even sizes, and crops the slot out of it", () => {
    // A 1280 × 720 camera in the 1080 × 864 camera slot of the split layout.
    expect(
      scaleAndCrop({ width: 1280, height: 720 }, undefined, {
        x: 0,
        y: 1056,
        width: 1080,
        height: 864,
      }),
    ).toBe("scale=1536:864,crop=1080:864:228:0");
  });

  test("keeps the crop inside the scaled source", () => {
    const filter = scaleAndCrop(
      { width: 1920, height: 1080 },
      { x: 1800, y: 1000, width: 120, height: 80 },
      { x: 0, y: 0, width: 1080, height: 1056 },
    );
    const [, scaleWidth, scaleHeight, cropWidth, cropHeight, cropX, cropY] =
      /^scale=(\d+):(\d+),crop=(\d+):(\d+):(\d+):(\d+)$/.exec(filter)!.map(Number);
    expect(cropX! + cropWidth!).toBeLessThanOrEqual(scaleWidth!);
    expect(cropY! + cropHeight!).toBeLessThanOrEqual(scaleHeight!);
  });
});
