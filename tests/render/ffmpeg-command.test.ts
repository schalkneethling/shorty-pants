import { describe, expect, test } from "vite-plus/test";
import {
  buildRenderCommand,
  scaleAndCrop,
  type RenderInputs,
} from "../../src/render/ffmpeg-command.ts";
import { defaultPreset } from "../../src/schemas/preset.ts";

const inputs: RenderInputs = {
  cameraPath: "/short/takes/cam.webm",
  screenPath: "/short/takes/screen.webm",
  cameraSize: { width: 1280, height: 720 },
  screenSize: { width: 1920, height: 1080 },
  screenOffsetMs: 40,
  screenCrop: undefined,
  safeZones: defaultPreset.safeZones,
  pieces: [
    { startMs: 200, endMs: 1300, layout: "split" },
    { startMs: 1300, endMs: 1900, layout: "face" },
    { startMs: 2500, endMs: 3500, layout: "circle" },
  ],
  headlineImagePath: "/short/out/overlays/headline.png",
  captionsListPath: "/short/out/overlays/captions.ffconcat",
  circleMaskPath: "/short/out/overlays/circle-mask.png",
  outputPath: "/short/out/short.mp4",
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

describe("buildRenderCommand", () => {
  const { args } = buildRenderCommand(inputs);
  const graph = filterGraph(args);

  test("reads the headline, the caption images, and each piece's part of the recordings", () => {
    expect(inputsOf(args)).toEqual([
      { options: [], file: inputs.headlineImagePath },
      { options: ["-f", "concat", "-safe", "0"], file: inputs.captionsListPath },
      // Split, 200–1300 ms: the camera, and the window 40 ms later in its recording.
      { options: ["-ss", "0.200", "-t", "1.100"], file: inputs.cameraPath },
      { options: ["-ss", "0.160", "-t", "1.100"], file: inputs.screenPath },
      // Face, 1300–1900 ms: the camera only.
      { options: ["-ss", "1.300", "-t", "0.600"], file: inputs.cameraPath },
      // Circle, 2500–3500 ms: the camera, the window and the mask.
      { options: ["-ss", "2.500", "-t", "1.000"], file: inputs.cameraPath },
      { options: ["-ss", "2.460", "-t", "1.000"], file: inputs.screenPath },
      { options: ["-loop", "1"], file: inputs.circleMaskPath },
    ]);
  });

  test("scales and crops each piece's camera into its slot, and keeps its sound", () => {
    expect(graph).toContain(
      "[2:v]setpts=PTS-STARTPTS,fps=30,scale=1536:864,crop=1080:864:228:0[camera0]",
    );
    expect(graph).toContain("[2:a]asetpts=PTS-STARTPTS[audio0]");
  });

  test("scales and crops the window into its slot", () => {
    expect(graph).toContain(
      "[3:v]setpts=PTS-STARTPTS,fps=30,scale=1878:1056,crop=1080:1056:399:0[screen0]",
    );
  });

  test("leaves the window out of a face piece", () => {
    expect(graph.some((statement) => statement.endsWith("[screen1]"))).toBe(false);
  });

  test("cuts the camera into a circle with the mask in a circle piece", () => {
    expect(graph).toContain("[camera2][7:v]alphamerge[camera2cut]");
  });

  test("joins the pieces, then adds the headline and the captions over all of them", () => {
    expect(graph).toContain(
      "[piece0][audio0][piece1][audio1][piece2][audio2]concat=n=3:v=1:a=1[joined][joinedaudio]",
    );
    // The headline is one image, which the overlay keeps showing to the end.
    expect(graph).toContain("[joined][0:v]overlay=0:0[headlined]");
    expect(graph).toContain("[headlined][1:v]overlay=0:0:eof_action=pass,format=yuv420p[video]");
  });

  test("brings the sound to the loudness YouTube plays at", () => {
    expect(graph).toContain("[joinedaudio]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[audio]");
  });

  test("encodes H.264 and AAC at a constant 30 frames per second, ready to stream", () => {
    const output = args.slice(args.indexOf("-map"));
    expect(output).toEqual([
      "-map",
      "[video]",
      "-map",
      "[audio]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      inputs.outputPath,
    ]);
  });

  test("pads the window with black when a piece starts before its recording", () => {
    const early = buildRenderCommand({
      ...inputs,
      screenOffsetMs: 500,
      pieces: [{ startMs: 200, endMs: 1300, layout: "split" }],
    });
    expect(inputsOf(early.args)[3]).toEqual({
      options: ["-ss", "0.000", "-t", "0.800"],
      file: inputs.screenPath,
    });
    expect(
      filterGraph(early.args).some((statement) =>
        statement.startsWith(
          "[3:v]setpts=PTS-STARTPTS,tpad=start_duration=0.300:color=black,fps=30,",
        ),
      ),
    ).toBe(true);
  });

  test("shows black where the window would be when a piece ends before its recording starts", () => {
    const early = buildRenderCommand({
      ...inputs,
      screenOffsetMs: 2000,
      pieces: [{ startMs: 200, endMs: 1300, layout: "split" }],
    });
    expect(inputsOf(early.args).map((input) => input.file)).not.toContain(inputs.screenPath);
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
