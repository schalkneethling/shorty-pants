import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { run, type CliContext } from "../../src/cli.ts";
import { recordShort } from "../../src/recorder/record.ts";

let workspace: string;
let webRoot: string;

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

/** Plays the part of the browser: uploads both tracks and finishes the take. */
async function recordTake(url: string, screenOffsetMs = 42) {
  const pageUrl = new URL(url);
  const token = new URLSearchParams(pageUrl.hash.slice(1)).get("token");
  const headers = { authorization: `Bearer ${token}` };

  for (const track of ["cam", "screen"]) {
    await fetch(new URL(`/api/takes/${track}`, pageUrl), {
      method: "PUT",
      headers: { ...headers, "content-type": "video/webm" },
      body: `${track} bytes`,
    });
  }
  await fetch(new URL("/api/takes/done", pageUrl), {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ screenOffsetMs }),
  });
}

function createContext(overrides: Partial<CliContext> = {}) {
  const opened: string[] = [];
  const context: CliContext = {
    cwd: workspace,
    now: () => new Date(2026, 9, 17, 13, 45),
    environment: {},
    webRoot,
    openUrl: async (url) => {
      opened.push(url);
      await recordTake(url);
    },
    ...overrides,
  };
  return { context, opened };
}

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "shorty-pants-record-")));
  webRoot = join(workspace, "dist-web");
  mkdirSync(join(webRoot, "recorder"), { recursive: true });
  writeFileSync(join(webRoot, "recorder", "index.html"), "<!doctype html><title>Recorder</title>");
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("short record", () => {
  test("opens the recorder and saves the take in a new folder under shorts/", async () => {
    const { io, output } = createIo();
    const { context, opened } = createContext();

    const exitCode = await run(["record", "Anchor", "scroll"], io, context);

    const folder = join(workspace, "shorts", "2026-10-17-anchor-scroll");
    expect(exitCode).toBe(0);
    expect(opened).toHaveLength(1);
    expect(output.stdout).toContain(opened[0]!);
    expect(output.stdout).toContain(`Saved the take in ${folder}`);
    expect(existsSync(join(folder, "takes.json"))).toBe(true);
    expect(existsSync(join(folder, "takes", "cam.webm"))).toBe(true);
  });

  test("names an untitled short after the date", async () => {
    const { io } = createIo();
    const { context } = createContext();
    await run(["record"], io, context);
    expect(existsSync(join(workspace, "shorts", "2026-10-17-short", "takes.json"))).toBe(true);
  });

  test("never reuses an existing short folder", async () => {
    mkdirSync(join(workspace, "shorts", "2026-10-17-scroll"), { recursive: true });
    const { io } = createIo();
    const { context } = createContext();
    await run(["record", "Scroll"], io, context);
    expect(existsSync(join(workspace, "shorts", "2026-10-17-scroll-2", "takes.json"))).toBe(true);
  });

  test("uses --root as the shorts root", async () => {
    const { io } = createIo();
    const { context } = createContext();
    const root = join(workspace, "elsewhere");
    await run(["record", "--root", root, "Scroll"], io, context);
    expect(existsSync(join(root, "2026-10-17-scroll", "takes.json"))).toBe(true);
  });

  test("uses SHORTY_PANTS_SHORTS_ROOT when --root is not given", async () => {
    const { io } = createIo();
    const root = join(workspace, "from-environment");
    const { context } = createContext({ environment: { SHORTY_PANTS_SHORTS_ROOT: root } });
    await run(["record", "Scroll"], io, context);
    expect(existsSync(join(root, "2026-10-17-scroll", "takes.json"))).toBe(true);
  });

  test("with --no-open only prints the address", async () => {
    const { io, output } = createIo();
    let printedUrl = "";
    const { context, opened } = createContext({
      openUrl: async () => {
        throw new Error("openUrl must not be called");
      },
    });
    const capture = {
      stdout: (text: string) => {
        io.stdout(text);
        const match = /(http:\/\/127\.0\.0\.1:\d+\/recorder\/#token=\S+)/.exec(text);
        if (match !== null && printedUrl === "") {
          printedUrl = match[1]!;
          void recordTake(printedUrl);
        }
      },
      stderr: io.stderr,
    };

    expect(await run(["record", "--no-open", "Quiet"], capture, context)).toBe(0);
    expect(opened).toHaveLength(0);
    expect(output.stdout).toContain("Saved the take");
  });

  test("reports a missing recorder page", async () => {
    const { io, output } = createIo();
    const { context } = createContext({ webRoot: join(workspace, "missing") });
    expect(await run(["record"], io, context)).toBe(1);
    expect(output.stderr).toContain("The recorder page is missing");
  });

  test("rejects an unknown option", async () => {
    const { io, output } = createIo();
    const { context } = createContext();
    expect(await run(["record", "--fast"], io, context)).toBe(2);
    expect(output.stderr).toContain("Usage: short record");
  });
});

describe("recordShort", () => {
  test("stops waiting and closes the server when the signal aborts", async () => {
    const controller = new AbortController();
    let recorderUrl = "";
    const result = await recordShort({
      shortsRoot: join(workspace, "shorts"),
      title: "Cancelled",
      now: () => new Date(2026, 9, 17, 13, 45),
      webRoot,
      signal: controller.signal,
      onReady: (url) => {
        recorderUrl = url;
        controller.abort();
      },
    });

    expect(result).toEqual({
      outcome: "cancelled",
      folder: join(workspace, "shorts", "2026-10-17-cancelled"),
    });
    await expect(fetch(recorderUrl)).rejects.toThrow();
  });
});
