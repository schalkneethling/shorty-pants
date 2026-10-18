import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { runCommand } from "../../src/commands.ts";
import { computeKeepRanges } from "../../src/edit/cut-list.ts";
import { layoutGeometry } from "../../src/edit/layout-geometry.ts";
import { keptDurationMs } from "../../src/edit/playback.ts";
import { buildPieceCommand, type PieceSources } from "../../src/render/ffmpeg-command.ts";
import { renderOverlays } from "../../src/render/overlays.ts";
import { renderShort } from "../../src/render/render.ts";
import { defaultPreset } from "../../src/schemas/preset.ts";
import {
  createEditorWorkspace,
  createShortFolder,
  openEditor,
  transcript,
  webRoot,
  words,
} from "./editor-workspace.ts";

// Locally the tests can name a preinstalled Chromium; in CI, Playwright's own is used.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

// "positioning" stays, the pause after "ignores" is cut, and the layouts
// change from split to face at "ignores" and to circle at "the".
const dressedShort = {
  headline: { text: "Anchor positioning ignores scroll", accent: "scroll" },
  segments: [
    { fromWord: 0, layout: "split" },
    { fromWord: 2, layout: "face" },
    { fromWord: 3, layout: "circle" },
  ],
};

interface ProbedStream {
  codec_type: string;
  codec_name: string;
  duration?: string;
  nb_frames?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  pix_fmt?: string;
}

function probe(path: string): { streams: ProbedStream[]; format: { duration: string } } {
  return JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,duration,nb_frames:format=duration",
        "-of",
        "json",
        path,
      ],
      { encoding: "utf8" },
    ),
  );
}

let workspace: string;
let shortFolder: string;

test.beforeEach(() => {
  ({ workspace, shortFolder } = createShortFolder({ short: dressedShort }));
});

test.afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

test("renders a 1080 × 1920 short at 30 frames per second in H.264 and AAC", async () => {
  test.setTimeout(60_000);
  const result = await renderShort({ shortFolder, webRoot, run: runCommand, executablePath });

  const { streams, format } = probe(result.videoPath);
  const video = streams.find((stream) => stream.codec_type === "video")!;
  const audio = streams.find((stream) => stream.codec_type === "audio")!;
  expect(video).toMatchObject({
    codec_name: "h264",
    width: 1080,
    height: 1920,
    r_frame_rate: "30/1",
    pix_fmt: "yuv420p",
  });
  expect(audio.codec_name).toBe("aac");
  // Kept: 200–1900 ms and 2500–3500 ms.
  expect(result.durationMs).toBe(2700);
  expect(Number(format.duration)).toBeCloseTo(2.7, 1);
  expect(Number(audio.duration)).toBeCloseTo(2.7, 1);
});

test("keeps the frames, the sound and the short's time together across many cuts", async () => {
  test.setTimeout(120_000);
  // Twenty short words, every other one cut, with the layout changing four
  // times: about ten pieces, each a fraction of a second.
  const manyWords = Array.from({ length: 20 }, (_, index) => ({
    text: `word${index}`,
    startMs: 200 + index * 180,
    endMs: 300 + index * 180,
  }));
  rmSync(workspace, { recursive: true, force: true });
  ({ workspace, shortFolder } = createShortFolder({
    transcript: { ...transcript, words: manyWords },
    short: {
      headline: dressedShort.headline,
      trim: { startMs: 100, endMs: 3900 },
      removedWords: manyWords.flatMap((_, index) => (index % 2 === 1 ? [[index, index]] : [])),
      segments: [
        { fromWord: 0, layout: "split" },
        { fromWord: 4, layout: "circle" },
        { fromWord: 8, layout: "face" },
        { fromWord: 12, layout: "split" },
        { fromWord: 16, layout: "circle" },
      ],
    },
  }));
  const short = JSON.parse(readFileSync(join(shortFolder, "short.json"), "utf8"));
  const keepRanges = computeKeepRanges({ words: manyWords, ...short });
  expect(keepRanges.length).toBeGreaterThanOrEqual(8);

  const result = await renderShort({ shortFolder, webRoot, run: runCommand, executablePath });

  // Rounding each piece to whole frames would add up; the grid keeps the
  // short within half a frame of the kept time.
  expect(Math.abs(result.durationMs - keptDurationMs(keepRanges))).toBeLessThanOrEqual(1000 / 60);
  const { streams } = probe(result.videoPath);
  const video = streams.find((stream) => stream.codec_type === "video")!;
  const audio = streams.find((stream) => stream.codec_type === "audio")!;
  expect(Number(video.nb_frames)).toBe((result.durationMs * 30) / 1000);
  // The sound lasts as long as the picture, to within a frame.
  expect(Math.abs(Number(audio.duration) - Number(video.duration))).toBeLessThan(1 / 30);

  // Reading the whole file reports no timestamps that run backwards. FFmpeg
  // writes its warnings to stderr.
  const decode = spawnSync("ffmpeg", ["-v", "warning", "-i", result.videoPath, "-f", "null", "-"], {
    encoding: "utf8",
  });
  expect(decode.status).toBe(0);
  expect(decode.stderr).toBe("");
});

/**
 * Recordings that flash white and beep for the first 100 ms of every second,
 * so the picture and the sound can be lined up after the cuts.
 */
function writeFlashAndBeepTakes(folder: string, seconds: number) {
  const flashes = `color=c=black:s=320x180:r=30:d=${seconds}[black];color=c=white:s=320x180:r=30:d=${seconds}[white];[black][white]overlay=enable='lt(mod(t\\,1)\\,0.1)',format=yuv420p`;
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    flashes,
    "-f",
    "lavfi",
    "-i",
    `sine=f=1000:d=${seconds},volume=volume=0:enable='gte(mod(t\\,1)\\,0.1)'`,
    "-c:v",
    "libvpx",
    "-c:a",
    "libopus",
    join(folder, "takes", "cam.webm"),
  ]);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    flashes,
    "-c:v",
    "libvpx",
    join(folder, "takes", "screen.webm"),
  ]);
  rmSync(join(folder, "takes", "cam.preview.webm"), { force: true });
  rmSync(join(folder, "takes", "screen.preview.webm"), { force: true });
}

/** When the middle of the picture turns white, in seconds. */
function flashTimes(videoPath: string): number[] {
  const { stdout } = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      videoPath,
      "-vf",
      "crop=200:200:440:800,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const times: number[] = [];
  let frameTime = 0;
  let wasBright = false;
  for (const line of stdout.split("\n")) {
    const time = /pts_time:([\d.]+)/.exec(line);
    if (time !== null) {
      frameTime = Number(time[1]);
    }
    const brightness = /YAVG=([\d.]+)/.exec(line);
    if (brightness !== null) {
      const isBright = Number(brightness[1]) > 128;
      if (isBright && !wasBright) {
        times.push(frameTime);
      }
      wasBright = isBright;
    }
  }
  return times;
}

/** When each beep starts, in seconds. */
function beepTimes(videoPath: string): number[] {
  const { stderr } = spawnSync(
    "ffmpeg",
    [
      "-v",
      "info",
      "-i",
      videoPath,
      "-vn",
      "-af",
      "silencedetect=n=-40dB:d=0.02",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  return [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((match) => Number(match[1]));
}

test("keeps the picture and the sound in step after many cuts", async () => {
  test.setTimeout(120_000);
  const seconds = 12;
  // A word over each flash and beep; every other one is cut.
  const beatWords = Array.from({ length: seconds - 1 }, (_, index) => ({
    text: `beat${index + 1}`,
    startMs: (index + 1) * 1000 - 50,
    endMs: (index + 1) * 1000 + 150,
  }));
  rmSync(workspace, { recursive: true, force: true });
  ({ workspace, shortFolder } = createShortFolder({
    transcript: { ...transcript, durationMs: seconds * 1000, words: beatWords },
    short: {
      headline: dressedShort.headline,
      trim: { startMs: 500, endMs: seconds * 1000 - 500 },
      removedWords: beatWords.flatMap((_, index) => (index % 2 === 1 ? [[index, index]] : [])),
      segments: [{ fromWord: 0, layout: "face" }],
    },
  }));
  writeFlashAndBeepTakes(shortFolder, seconds);

  const result = await renderShort({ shortFolder, webRoot, run: runCommand, executablePath });
  const flashes = flashTimes(result.videoPath);
  const beeps = beepTimes(result.videoPath);
  // One flash and one beep in each kept word. silencedetect also reports the
  // end of the file, so each flash is matched with its nearest beep.
  expect(flashes.length).toBe(6);
  for (const flash of flashes) {
    const nearestBeep = Math.min(...beeps.map((beep) => Math.abs(beep - flash)));
    // Within one and a half frames, after every cut.
    expect(nearestBeep).toBeLessThan(0.05);
  }
});

test("renders each piece with exactly its frames and 1600 samples of sound per frame", () => {
  const workDir = join(workspace, "pieces");
  mkdirSync(workDir);
  // An empty headline and no captions: this test is about the frames and the sound.
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black@0:s=1080x1920,format=rgba",
    "-frames:v",
    "1",
    join(workDir, "blank.png"),
  ]);
  // The circle mask is the size of the circle camera.
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=360x360",
    "-frames:v",
    "1",
    join(workDir, "mask.png"),
  ]);
  writeFileSync(
    join(workDir, "captions.ffconcat"),
    "ffconcat version 1.0\nfile 'blank.png'\nduration 5\n",
  );
  const sources: PieceSources = {
    cameraPath: join(shortFolder, "takes", "cam.preview.webm"),
    screenPath: join(shortFolder, "takes", "screen.preview.webm"),
    cameraSize: { width: 320, height: 180 },
    screenSize: { width: 320, height: 240 },
    screenOffsetMs: 40,
    screenCrop: undefined,
    safeZones: defaultPreset.safeZones,
    circleMaskPath: join(workDir, "mask.png"),
  };
  // Frame counts that are not multiples of 3 have lengths milliseconds cannot
  // hold, and the 2-frame piece is the kind a cut leaves behind.
  const pieces = [
    { startMs: 300, endMs: 1333, layout: "split" as const, firstFrame: 0, frames: 31 },
    { startMs: 1400, endMs: 1467, layout: "face" as const, firstFrame: 31, frames: 2 },
    { startMs: 2500, endMs: 3667, layout: "circle" as const, firstFrame: 33, frames: 35 },
  ];
  for (const [index, piece] of pieces.entries()) {
    const output = join(workDir, `piece-${index}.nut`);
    const { args } = buildPieceCommand(
      piece,
      sources,
      {
        headlineImagePath: join(workDir, "blank.png"),
        captionsListPath: join(workDir, "captions.ffconcat"),
      },
      output,
    );
    execFileSync("ffmpeg", args);
    const frames = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v",
        "-show_entries",
        "stream=nb_read_frames",
        "-of",
        "csv=p=0",
        output,
      ],
      { encoding: "utf8" },
    );
    expect(Number(frames.trim()), `frames of piece ${index}`).toBe(piece.frames);
    const sound = execFileSync(
      "ffmpeg",
      ["-v", "error", "-i", output, "-vn", "-f", "s16le", "-ac", "1", "-"],
      {
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    expect(sound.length / 2, `samples of piece ${index}`).toBe(piece.frames * 1600);
  }
});

test("explains a camera recording without sound", async () => {
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=320x180:r=30:d=4",
    "-c:v",
    "libvpx",
    join(shortFolder, "takes", "cam.webm"),
  ]);
  rmSync(join(shortFolder, "takes", "cam.preview.webm"), { force: true });
  await expect(
    renderShort({ shortFolder, webRoot, run: runCommand, executablePath }),
  ).rejects.toThrow("has no sound");
});

test("writes the captions as WebVTT and a title and description to upload with", async () => {
  test.setTimeout(60_000);
  const result = await renderShort({ shortFolder, webRoot, run: runCommand, executablePath });

  expect(readFileSync(result.captionsPath, "utf8")).toBe(
    [
      "WEBVTT",
      "",
      "1",
      "00:00:00.100 --> 00:00:01.200",
      "Anchor positioning",
      "",
      "2",
      "00:00:01.200 --> 00:00:02.600",
      "ignores the scroll",
      "",
    ].join("\n"),
  );
  expect(readFileSync(result.uploadPath, "utf8")).toContain(
    "Title\nAnchor positioning ignores scroll\n",
  );
});

test("draws the headline and a caption the same way every time", async () => {
  const outputDir = join(workspace, "overlays");
  mkdirSync(outputDir);
  const geometry = layoutGeometry("split", defaultPreset.safeZones);
  const captionFile = join(outputDir, "caption.png");
  const files = await renderOverlays({
    webRoot,
    outputDir,
    preset: defaultPreset,
    headline: { ...dressedShort.headline, area: geometry.headline },
    captions: [
      {
        file: captionFile,
        words: ["ignores", "the", "scroll"],
        wordIndex: 1,
        area: geometry.captions,
      },
    ],
    circleMaskSize: { width: 360, height: 360 },
    executablePath,
  });

  expect(readFileSync(files.headline)).toMatchSnapshot("headline.png", { maxDiffPixelRatio: 0.01 });
  expect(readFileSync(captionFile)).toMatchSnapshot("caption.png", { maxDiffPixelRatio: 0.01 });
  expect(readFileSync(files.circleMask)).toMatchSnapshot("circle-mask.png", {
    maxDiffPixelRatio: 0.01,
  });
});

test("explains a browser that cannot start, and leaves nothing running", async () => {
  const outputDir = join(workspace, "overlays");
  mkdirSync(outputDir);
  const geometry = layoutGeometry("split", defaultPreset.safeZones);
  await expect(
    renderOverlays({
      webRoot,
      outputDir,
      preset: defaultPreset,
      headline: { ...dressedShort.headline, area: geometry.headline },
      captions: [],
      circleMaskSize: { width: 360, height: 360 },
      executablePath: join(workspace, "no-such-browser"),
    }),
  ).rejects.toThrow("could not be started. Check SHORTY_PANTS_CHROMIUM.");
});

/** The mean difference of two images, from 0 for the same to 255 for opposite, at the first one's size. */
async function meanDifference(page: Page, first: Buffer, second: Buffer): Promise<number> {
  return page.evaluate(
    async ([firstUrl, secondUrl]) => {
      const load = async (url: string) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
      };
      const [a, b] = await Promise.all([load(firstUrl!), load(secondUrl!)]);
      const pixels = (image: HTMLImageElement) => {
        const canvas = new OffscreenCanvas(a.naturalWidth, a.naturalHeight);
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0, a.naturalWidth, a.naturalHeight);
        return context.getImageData(0, 0, a.naturalWidth, a.naturalHeight).data;
      };
      const [pixelsA, pixelsB] = [pixels(a), pixels(b)];
      let total = 0;
      let count = 0;
      for (let index = 0; index < pixelsA.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          total += Math.abs(pixelsA[index + channel]! - pixelsB[index + channel]!);
          count += 1;
        }
      }
      return total / count;
    },
    [
      `data:image/png;base64,${first.toString("base64")}`,
      `data:image/png;base64,${second.toString("base64")}`,
    ],
  );
}

/** Waits until both preview videos show the frame they were moved to. */
async function waitForPreviewFrames(page: Page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll("video")].every(
      (video) => !video.seeking && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
    ),
  );
  // One more animation frame, so the decoded frames are painted.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
}

test("renders what the editor preview shows", async ({ page }) => {
  test.setTimeout(90_000);
  const editor = await createEditorWorkspace({ short: dressedShort });
  try {
    const result = await renderShort({
      shortFolder: editor.shortFolder,
      webRoot,
      run: runCommand,
      executablePath,
    });
    await openEditor(page, editor);

    // A moment in each layout: the word is clicked in the preview, and the
    // same moment in the short is taken from the render.
    const samples = [
      { wordIndex: 0, shortSeconds: 0.12 },
      { wordIndex: 2, shortSeconds: 1.22 },
      { wordIndex: 4, shortSeconds: 2.12 },
    ];
    const renderedFrame = (seconds: number) =>
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-ss",
        String(seconds),
        "-i",
        result.videoPath,
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "-",
      ]);

    // Matching moments differ by under 10 here, from scaling and video
    // compression; moments in different layouts differ by over 100.
    for (const sample of samples) {
      await words(page).nth(sample.wordIndex).click();
      await waitForPreviewFrames(page);
      const preview = await page.locator("#preview-frame").screenshot();
      const difference = await meanDifference(page, preview, renderedFrame(sample.shortSeconds));
      expect(difference, `word ${sample.wordIndex}`).toBeLessThan(20);
    }

    // A control: the last preview against another layout's frame must not
    // pass, or the comparison would prove nothing.
    await words(page).nth(4).click();
    await waitForPreviewFrames(page);
    const circlePreview = await page.locator("#preview-frame").screenshot();
    const splitFrame = renderedFrame(samples[0]!.shortSeconds);
    expect(await meanDifference(page, circlePreview, splitFrame)).toBeGreaterThan(50);
  } finally {
    await editor.remove();
  }
});
