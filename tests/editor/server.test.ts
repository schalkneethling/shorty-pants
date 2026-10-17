import { request } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { startEditorServer, type EditorServer } from "../../src/editor/server.ts";
import { defaultPreset } from "../../src/schemas/preset.ts";

const token = "editor-token-0123456789";
const cameraPreview = Buffer.from("0123456789abcdef");
let workspace: string;
let shortFolder: string;
let server: EditorServer;

const recordedTakes = {
  version: 1,
  recordedAt: "2026-10-17T13:45:00.000Z",
  takes: { cam: "takes/cam.webm", screen: "takes/screen.webm", screenOffsetMs: 42 },
};
const transcript = {
  version: 1,
  model: "ggml-small.en.bin",
  language: "en",
  durationMs: 4000,
  words: [
    { text: "Anchor", startMs: 500, endMs: 800 },
    { text: "positioning", startMs: 850, endMs: 1300 },
    { text: "scroll", startMs: 1400, endMs: 1800 },
  ],
};
const shortProject = {
  version: 1,
  takes: recordedTakes.takes,
  trim: { startMs: 400, endMs: 1900 },
  removedWords: [],
  pauseThresholdMs: 600,
  headline: { text: "Anchor positioning ignores scroll", accent: "scroll" },
  segments: [{ fromWord: 0, layout: "split" }],
};

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  bytes: Buffer;
  json: () => unknown;
}

function rawRequest(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<RawResponse> {
  const { port } = new URL(server.url);
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: options.headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const bytes = Buffer.concat(chunks);
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            bytes,
            json: () => JSON.parse(bytes.toString("utf8")),
          });
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}

const authorized = { authorization: `Bearer ${token}` };

function saveShort(body: unknown) {
  return rawRequest("/api/short", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { ...authorized, "content-type": "application/json" },
  });
}

function readShort() {
  return JSON.parse(readFileSync(join(shortFolder, "short.json"), "utf8"));
}

beforeEach(async () => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "shorty-pants-editor-")));
  const webRoot = join(workspace, "web");
  mkdirSync(join(webRoot, "editor"), { recursive: true });
  writeFileSync(join(webRoot, "editor", "index.html"), "<!doctype html><title>Editor</title>");
  shortFolder = join(workspace, "2026-10-17-anchor-scroll");
  mkdirSync(join(shortFolder, "takes"), { recursive: true });
  writeFileSync(join(shortFolder, "takes.json"), JSON.stringify(recordedTakes));
  writeFileSync(join(shortFolder, "transcript.json"), JSON.stringify(transcript));
  writeFileSync(join(shortFolder, "short.json"), JSON.stringify(shortProject));
  writeFileSync(join(shortFolder, "takes", "cam.preview.webm"), cameraPreview);
  writeFileSync(join(shortFolder, "takes", "screen.preview.webm"), "screen");

  server = await startEditorServer({ shortFolder, webRoot, token, preset: defaultPreset });
});

afterEach(async () => {
  await server.close();
  rmSync(workspace, { recursive: true, force: true });
});

describe("the editor page", () => {
  test("is served with the token in the URL fragment", async () => {
    const page = new URL(server.url);
    expect(page.pathname).toBe("/editor/");
    expect(page.hash).toBe(`#token=${token}`);
    const response = await rawRequest("/editor/");
    expect(response.bytes.toString()).toContain("<title>Editor</title>");
  });
});

describe("GET /api/project", () => {
  test("requires the session token", async () => {
    expect((await rawRequest("/api/project")).status).toBe(401);
  });

  test("returns the take, the transcript, short.json and the media addresses", async () => {
    const response = await rawRequest("/api/project", { headers: authorized });
    expect(response.status).toBe(200);
    expect(response.json()).toEqual({
      recordedTakes,
      transcript,
      short: shortProject,
      preset: defaultPreset,
      media: {
        cam: `/media/${token}/cam.webm`,
        screen: `/media/${token}/screen.webm`,
      },
    });
  });
});

describe("PUT /api/short", () => {
  test("saves the trim and the cuts, and keeps everything else in short.json", async () => {
    const response = await saveShort({
      trim: { startMs: 450, endMs: 1850 },
      removedWords: [[1, 1]],
    });
    expect(response.status).toBe(200);
    expect(readShort()).toEqual({
      ...shortProject,
      trim: { startMs: 450, endMs: 1850 },
      removedWords: [[1, 1]],
    });
    expect(response.json()).toEqual(readShort());
  });

  test("saves the pause threshold", async () => {
    await saveShort({ pauseThresholdMs: 800 });
    expect(readShort().pauseThresholdMs).toBe(800);
  });

  test("refuses a trim that ends before it starts, and leaves short.json alone", async () => {
    const response = await saveShort({ trim: { startMs: 1000, endMs: 900 } });
    expect(response.status).toBe(400);
    expect(readShort()).toEqual(shortProject);
  });

  test("refuses a trim that ends after the recording", async () => {
    const response = await saveShort({ trim: { startMs: 0, endMs: 4001 } });
    expect(response.status).toBe(400);
  });

  test("refuses cuts of words that do not exist", async () => {
    const response = await saveShort({ removedWords: [[2, 3]] });
    expect(response.status).toBe(400);
  });

  test("saves the headline, the screen crop and the segments", async () => {
    const changes = {
      headline: { text: "Anchors ignore scroll", accent: "scroll" },
      screenCrop: { x: 100, y: 50, width: 640, height: 900 },
      segments: [
        { fromWord: 0, layout: "face" },
        { fromWord: 2, layout: "circle" },
      ],
    };
    const response = await saveShort(changes);
    expect(response.status).toBe(200);
    expect(readShort()).toEqual({ ...shortProject, ...changes });
  });

  test("removes the screen crop when it is set to null", async () => {
    await saveShort({ screenCrop: { x: 0, y: 0, width: 640, height: 900 } });
    await saveShort({ screenCrop: null });
    expect(readShort()).not.toHaveProperty("screenCrop");
  });

  test("refuses an accent that is not a word of the headline", async () => {
    const response = await saveShort({ headline: { text: "Anchors ignore scroll", accent: "x" } });
    expect(response.status).toBe(400);
  });

  test("refuses a segment that starts after the last word", async () => {
    const response = await saveShort({
      segments: [
        { fromWord: 0, layout: "split" },
        { fromWord: 3, layout: "face" },
      ],
    });
    expect(response.status).toBe(400);
    expect(readShort()).toEqual(shortProject);
  });

  test("refuses fields the editor does not own", async () => {
    const response = await saveShort({ takes: { cam: "elsewhere.webm" } });
    expect(response.status).toBe(400);
    expect(readShort()).toEqual(shortProject);
  });
});

describe("POST /api/done", () => {
  test("refuses API requests for another host name, to block DNS rebinding", async () => {
    const response = await rawRequest("/api/project", {
      headers: { ...authorized, host: "evil.example" },
    });
    expect(response.status).toBe(403);
  });

  test("keeps the last of several saves that arrive together", async () => {
    const responses = await Promise.all(
      [400, 410, 420, 430].map((startMs) => saveShort({ trim: { startMs, endMs: 1900 } })),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect([400, 410, 420, 430]).toContain(readShort().trim.startMs);
  });

  test("resolves the done promise", async () => {
    const response = await rawRequest("/api/done", { method: "POST", headers: authorized });
    expect(response.status).toBe(204);
    await expect(server.done).resolves.toBeUndefined();
  });
});

describe("media", () => {
  test("serves a whole preview track and says that ranges are supported", async () => {
    const response = await rawRequest(`/media/${token}/cam.webm`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("video/webm");
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.bytes.equals(cameraPreview)).toBe(true);
  });

  test("serves a byte range, which video elements use to seek", async () => {
    const response = await rawRequest(`/media/${token}/cam.webm`, {
      headers: { range: "bytes=2-5" },
    });
    expect(response.status).toBe(206);
    expect(response.headers["content-range"]).toBe(`bytes 2-5/${cameraPreview.length}`);
    expect(response.bytes.toString()).toBe("2345");
  });

  test("serves an open-ended byte range", async () => {
    const response = await rawRequest(`/media/${token}/cam.webm`, {
      headers: { range: "bytes=12-" },
    });
    expect(response.status).toBe(206);
    expect(response.bytes.toString()).toBe("cdef");
  });

  test("serves the last bytes for a suffix range", async () => {
    const response = await rawRequest(`/media/${token}/cam.webm`, {
      headers: { range: "bytes=-4" },
    });
    expect(response.status).toBe(206);
    expect(response.headers["content-range"]).toBe(`bytes 12-15/${cameraPreview.length}`);
    expect(response.bytes.toString()).toBe("cdef");
  });

  test("refuses a range it cannot read", async () => {
    const response = await rawRequest(`/media/${token}/cam.webm`, {
      headers: { range: "bytes=five-ten" },
    });
    expect(response.status).toBe(416);
  });

  test("refuses requests for another host name, to block DNS rebinding", async () => {
    const response = await rawRequest(`/media/${token}/cam.webm`, {
      headers: { host: "evil.example" },
    });
    expect(response.status).toBe(403);
  });

  test("refuses a range past the end of the file", async () => {
    const response = await rawRequest(`/media/${token}/cam.webm`, {
      headers: { range: "bytes=100-200" },
    });
    expect(response.status).toBe(416);
    expect(response.headers["content-range"]).toBe(`bytes */${cameraPreview.length}`);
  });

  test("needs the session token in the path", async () => {
    expect((await rawRequest("/media/wrong-token/cam.webm")).status).toBe(404);
  });

  test("serves only the camera and screen tracks", async () => {
    expect((await rawRequest(`/media/${token}/takes.json`)).status).toBe(404);
  });
});
