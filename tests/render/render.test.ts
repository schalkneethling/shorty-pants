import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { run, type CliContext } from "../../src/cli.ts";
import { createFakeCommands, type FakeCommands } from "../helpers/fake-commands.ts";

let workspace: string;
let shortFolder: string;
let commands: FakeCommands;

const takes = { cam: "takes/cam.webm", screen: "takes/screen.webm", screenOffsetMs: 40 };
const transcript = {
  version: 1,
  model: "ggml-small.en.bin",
  language: "en",
  durationMs: 4000,
  words: [
    { text: "Anchor", startMs: 300, endMs: 700 },
    { text: "scroll.", startMs: 800, endMs: 1300 },
  ],
};
const short = {
  version: 1,
  takes,
  trim: { startMs: 200, endMs: 1400 },
  removedWords: [],
  pauseThresholdMs: 600,
  headline: { text: "Anchor scroll", accent: "scroll" },
  segments: [{ fromWord: 0, layout: "split" }],
};

function createIo() {
  const output = { stdout: "", stderr: "" };
  return {
    output,
    io: {
      stdout: (text: string) => {
        output.stdout += text;
      },
      stderr: (text: string) => {
        output.stderr += text;
      },
    },
  };
}

function context(): Partial<CliContext> {
  return {
    cwd: workspace,
    environment: {},
    webRoot: join(workspace, "dist-web"),
    runCommand: commands.run,
  };
}

function writeShort(changes: Record<string, unknown>) {
  writeFileSync(join(shortFolder, "short.json"), JSON.stringify({ ...short, ...changes }));
}

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "shorty-pants-render-")));
  mkdirSync(join(workspace, "dist-web", "render"), { recursive: true });
  writeFileSync(
    join(workspace, "dist-web", "render", "index.html"),
    "<!doctype html><title>Render</title>",
  );
  shortFolder = join(workspace, "shorts", "2026-10-18-anchor-scroll");
  mkdirSync(join(shortFolder, "takes"), { recursive: true });
  writeFileSync(
    join(shortFolder, "takes.json"),
    JSON.stringify({ version: 1, recordedAt: "2026-10-18T09:00:00.000Z", takes }),
  );
  writeFileSync(join(shortFolder, "transcript.json"), JSON.stringify(transcript));
  writeShort({});
  commands = createFakeCommands();
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("short render", () => {
  test("asks for a headline first", async () => {
    writeShort({ headline: undefined });
    const { io, output } = createIo();
    expect(await run(["render", shortFolder], io, context())).toBe(1);
    expect(output.stderr).toContain("has no headline yet");
    expect(output.stderr).toContain("short edit");
    expect(commands.calls).toEqual([]);
  });

  test("refuses a short that is longer than three minutes", async () => {
    writeFileSync(
      join(shortFolder, "transcript.json"),
      JSON.stringify({
        ...transcript,
        durationMs: 200_000,
        words: [
          { text: "Anchor", startMs: 300, endMs: 700 },
          { text: "scroll.", startMs: 190_000, endMs: 190_500 },
        ],
      }),
    );
    // A long pause threshold keeps the gap between the two words.
    writeShort({ trim: { startMs: 0, endMs: 200_000 }, pauseThresholdMs: 200_000 });
    const { io, output } = createIo();
    expect(await run(["render", shortFolder], io, context())).toBe(1);
    expect(output.stderr).toContain("Shorts can be up to 3:00");
    expect(commands.calls).toEqual([]);
  });

  test("asks for a transcript first", async () => {
    rmSync(join(shortFolder, "transcript.json"));
    const { io, output } = createIo();
    expect(await run(["render", shortFolder], io, context())).toBe(1);
    expect(output.stderr).toContain("short transcribe");
  });

  test("reports a missing render page", async () => {
    rmSync(join(workspace, "dist-web"), { recursive: true });
    const { io, output } = createIo();
    expect(await run(["render", shortFolder], io, context())).toBe(1);
    expect(output.stderr).toContain("The render page is missing");
  });

  test("without a folder is a usage error, and --help prints the usage", async () => {
    const usage = createIo();
    expect(await run(["render"], usage.io, context())).toBe(2);
    expect(usage.output.stderr).toContain("Usage: short render");

    const help = createIo();
    expect(await run(["render", "--help"], help.io, context())).toBe(0);
    expect(help.output.stdout).toContain("Usage: short render");
  });
});
