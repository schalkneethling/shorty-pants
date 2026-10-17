import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { run, type CliContext } from "../../src/cli.ts";
import { CommandFailedError } from "../../src/commands.ts";
import { editShort } from "../../src/editor/edit.ts";
import { createFakeCommands, type FakeCommands } from "../helpers/fake-commands.ts";

let workspace: string;
let shortFolder: string;
let webRoot: string;
let commands: FakeCommands;

const transcript = {
  version: 1,
  model: "ggml-small.en.bin",
  language: "en",
  durationMs: 4000,
  words: [
    { text: "Anchor", startMs: 500, endMs: 800 },
    { text: "positioning", startMs: 850, endMs: 1300 },
    { text: "scroll", startMs: 2400, endMs: 2800 },
  ],
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

function authorizedFetch(
  url: string,
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
) {
  const page = new URL(url);
  const token = new URLSearchParams(page.hash.slice(1)).get("token");
  return fetch(new URL(path, page), {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
  });
}

/** Plays the part of the browser: cuts a word, then says the editing is done. */
async function editInBrowser(url: string) {
  await authorizedFetch(url, "/api/short", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ removedWords: [[1, 1]] }),
  });
  await authorizedFetch(url, "/api/done", { method: "POST" });
}

function context(overrides: Partial<CliContext> = {}): Partial<CliContext> {
  return {
    cwd: workspace,
    environment: {},
    webRoot,
    runCommand: commands.run,
    openUrl: editInBrowser,
    ...overrides,
  };
}

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "shorty-pants-edit-")));
  webRoot = join(workspace, "dist-web");
  mkdirSync(join(webRoot, "editor"), { recursive: true });
  writeFileSync(join(webRoot, "editor", "index.html"), "<!doctype html><title>Editor</title>");
  shortFolder = join(workspace, "shorts", "2026-10-17-anchor-scroll");
  mkdirSync(join(shortFolder, "takes"), { recursive: true });
  writeFileSync(join(shortFolder, "takes", "cam.webm"), "camera");
  writeFileSync(join(shortFolder, "takes", "screen.webm"), "screen");
  writeFileSync(
    join(shortFolder, "takes.json"),
    JSON.stringify({
      version: 1,
      recordedAt: "2026-10-17T13:45:00.000Z",
      takes: { cam: "takes/cam.webm", screen: "takes/screen.webm", screenOffsetMs: 42 },
    }),
  );
  writeFileSync(join(shortFolder, "transcript.json"), JSON.stringify(transcript));
  commands = createFakeCommands();
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("short edit", () => {
  test("makes seekable preview copies of both recordings without re-encoding", async () => {
    const { io } = createIo();
    await run(["edit", shortFolder], io, context());
    expect(commands.calls).toEqual(
      ["cam", "screen"].map((track) => ({
        command: "ffmpeg",
        args: [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          join(shortFolder, "takes", `${track}.webm`),
          "-c",
          "copy",
          join(shortFolder, "takes", `${track}.preview.partial.webm`),
        ],
      })),
    );
    for (const track of ["cam", "screen"]) {
      expect(existsSync(join(shortFolder, "takes", `${track}.preview.webm`))).toBe(true);
      expect(existsSync(join(shortFolder, "takes", `${track}.preview.partial.webm`))).toBe(false);
    }
  });

  test("leaves no preview behind when ffmpeg stops partway", async () => {
    const stopsPartway: typeof commands.run = async (command, args) => {
      writeFileSync(args.at(-1)!, "half a video");
      throw new CommandFailedError(`${command} was interrupted`);
    };
    const { io, output } = createIo();
    expect(await run(["edit", shortFolder], io, context({ runCommand: stopsPartway }))).toBe(1);
    expect(output.stderr).toContain("interrupted");
    expect(existsSync(join(shortFolder, "takes", "cam.preview.webm"))).toBe(false);
    expect(existsSync(join(shortFolder, "takes", "cam.preview.partial.webm"))).toBe(false);
  });

  test("reuses preview copies that are newer than the recordings", async () => {
    for (const track of ["cam", "screen"]) {
      const preview = join(shortFolder, "takes", `${track}.preview.webm`);
      writeFileSync(preview, "preview");
      const later = new Date(Date.now() + 60_000);
      utimesSync(preview, later, later);
    }
    const { io } = createIo();
    await run(["edit", shortFolder], io, context());
    expect(commands.calls).toEqual([]);
  });

  test("creates short.json, saves the edits and reports the short's length", async () => {
    const { io, output } = createIo();
    const exitCode = await run(["edit", "shorts/2026-10-17-anchor-scroll"], io, context());

    expect(exitCode).toBe(0);
    const saved = JSON.parse(readFileSync(join(shortFolder, "short.json"), "utf8"));
    expect(saved.removedWords).toEqual([[1, 1]]);
    expect(saved.trim).toEqual({ startMs: 400, endMs: 2900 });
    expect(output.stdout).toMatch(
      /The editor is open at http:\/\/127\.0\.0\.1:\d+\/editor\/#token=/,
    );
    expect(output.stdout).toContain("1 cut");
    expect(output.stdout).toContain("The short is 0:01 long");
  });

  test("keeps an existing short.json", async () => {
    const existing = {
      version: 1,
      takes: { cam: "takes/cam.webm", screen: "takes/screen.webm", screenOffsetMs: 42 },
      trim: { startMs: 0, endMs: 4000 },
      removedWords: [],
      pauseThresholdMs: 900,
      segments: [{ fromWord: 0, layout: "split" }],
    };
    writeFileSync(join(shortFolder, "short.json"), JSON.stringify(existing));
    const { io } = createIo();
    await run(["edit", shortFolder], io, context());
    const saved = JSON.parse(readFileSync(join(shortFolder, "short.json"), "utf8"));
    expect(saved.pauseThresholdMs).toBe(900);
    expect(saved.trim).toEqual({ startMs: 0, endMs: 4000 });
  });

  test("refuses a short.json whose cuts no longer match the transcript", async () => {
    const stale = {
      version: 1,
      takes: { cam: "takes/cam.webm", screen: "takes/screen.webm", screenOffsetMs: 42 },
      trim: { startMs: 0, endMs: 4000 },
      // The transcript has three words, so index 7 is from an older transcript.
      removedWords: [[5, 7]],
      pauseThresholdMs: 600,
      segments: [{ fromWord: 0, layout: "split" }],
    };
    writeFileSync(join(shortFolder, "short.json"), JSON.stringify(stale));
    const { io, output } = createIo();
    expect(await run(["edit", shortFolder], io, context())).toBe(1);
    expect(output.stderr).toContain("does not match transcript.json");
  });

  test("refuses a short.json whose trim ends after the recording", async () => {
    const stale = {
      version: 1,
      takes: { cam: "takes/cam.webm", screen: "takes/screen.webm", screenOffsetMs: 42 },
      trim: { startMs: 0, endMs: 9000 },
      removedWords: [],
      pauseThresholdMs: 600,
      segments: [{ fromWord: 0, layout: "split" }],
    };
    writeFileSync(join(shortFolder, "short.json"), JSON.stringify(stale));
    const { io, output } = createIo();
    expect(await run(["edit", shortFolder], io, context())).toBe(1);
    expect(output.stderr).toContain("does not match transcript.json");
  });

  test("explains a short.json that is not valid JSON", async () => {
    writeFileSync(join(shortFolder, "short.json"), "{ not json");
    const { io, output } = createIo();
    expect(await run(["edit", shortFolder], io, context())).toBe(1);
    expect(output.stderr).toContain("is not valid JSON");
  });

  test("asks for a transcript first", async () => {
    rmSync(join(shortFolder, "transcript.json"));
    const { io, output } = createIo();
    expect(await run(["edit", shortFolder], io, context())).toBe(1);
    expect(output.stderr).toContain("short transcribe");
    expect(existsSync(join(shortFolder, "short.json"))).toBe(false);
  });

  test("reports a missing editor page", async () => {
    const { io, output } = createIo();
    expect(
      await run(["edit", shortFolder], io, context({ webRoot: join(workspace, "missing") })),
    ).toBe(1);
    expect(output.stderr).toContain("The editor page is missing");
  });

  test("without a folder is a usage error, and --help prints the usage", async () => {
    const usage = createIo();
    expect(await run(["edit"], usage.io, context())).toBe(2);
    expect(usage.output.stderr).toContain("Usage: short edit");

    const help = createIo();
    expect(await run(["edit", "--help"], help.io, context())).toBe(0);
    expect(help.output.stdout).toContain("Usage: short edit");
  });
});

describe("editShort", () => {
  test("stops waiting and closes the server when the signal aborts", async () => {
    const controller = new AbortController();
    let editorUrl = "";
    const result = await editShort({
      shortFolder,
      webRoot,
      run: commands.run,
      signal: controller.signal,
      onReady: (url) => {
        editorUrl = url;
        controller.abort();
      },
    });
    expect(result.outcome).toBe("cancelled");
    await expect(fetch(editorUrl)).rejects.toThrow();
  });
});
