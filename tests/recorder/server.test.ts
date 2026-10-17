import { request } from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { startRecorderServer, type RecorderServer } from "../../src/recorder/server.ts";
import { parseRecordedTakes } from "../../src/schemas/recorded-takes.ts";

const token = "test-token-0123456789abcdef";
let workspace: string;
let shortFolder: string;
let server: RecorderServer;

interface RawResponse {
  status: number;
  body: string;
}

// fetch normalizes paths and forbids changing the Host header, so path and
// header tests use node:http directly.
function rawRequest(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: Buffer | string } = {},
): Promise<RawResponse> {
  const { port } = new URL(server.url);
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: options.headers },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}

function upload(track: string, body: Buffer, headers: Record<string, string> = {}) {
  return rawRequest(`/api/takes/${track}`, {
    method: "PUT",
    body,
    headers: { authorization: `Bearer ${token}`, "content-type": "video/webm", ...headers },
  });
}

function finish(body: unknown) {
  return rawRequest("/api/takes/done", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
}

beforeEach(async () => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "shorty-pants-server-")));
  const webRoot = join(workspace, "web");
  mkdirSync(join(webRoot, "recorder"), { recursive: true });
  writeFileSync(join(webRoot, "recorder", "index.html"), "<!doctype html><title>Recorder</title>");
  writeFileSync(join(workspace, "secret.txt"), "do not serve");
  shortFolder = join(workspace, "shorts", "2026-10-17-anchor-scroll");

  server = await startRecorderServer({
    shortFolder,
    webRoot,
    token,
    now: () => new Date("2026-10-17T13:45:00.000Z"),
    maxUploadBytes: 1024,
  });
});

afterEach(async () => {
  await server.close();
  rmSync(workspace, { recursive: true, force: true });
});

describe("startRecorderServer", () => {
  test("listens on the loopback address only", () => {
    expect(new URL(server.url).hostname).toBe("127.0.0.1");
  });

  test("puts the token in the URL fragment, which the browser never sends", () => {
    expect(new URL(server.url).hash).toBe(`#token=${token}`);
    expect(new URL(server.url).pathname).toBe("/recorder/");
  });

  test("serves the recorder page", async () => {
    const response = await rawRequest("/recorder/");
    expect(response.status).toBe(200);
    expect(response.body).toContain("<title>Recorder</title>");
  });

  test("does not serve files outside the web root", async () => {
    const response = await rawRequest("/recorder/../../secret.txt");
    expect(response.status).toBe(404);
    expect(response.body).not.toContain("do not serve");
  });

  test("refuses requests for another host name, to block DNS rebinding", async () => {
    const response = await rawRequest("/recorder/", { headers: { host: "evil.example" } });
    expect(response.status).toBe(403);
  });
});

describe("take uploads", () => {
  test("save a track to the short folder", async () => {
    const response = await upload("cam", Buffer.from("camera bytes"));
    expect(response.status).toBe(204);
    expect(readFileSync(join(shortFolder, "takes", "cam.webm"), "utf8")).toBe("camera bytes");
  });

  test("refuse an empty track", async () => {
    const response = await upload("cam", Buffer.alloc(0));
    expect(response.status).toBe(400);
    expect(existsSync(join(shortFolder, "takes", "cam.webm"))).toBe(false);
  });

  test("require the session token", async () => {
    const missing = await upload("cam", Buffer.from("x"), { authorization: "" });
    const wrong = await upload("cam", Buffer.from("x"), { authorization: "Bearer wrong" });
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(existsSync(join(shortFolder, "takes", "cam.webm"))).toBe(false);
  });

  test("accept only the camera and screen tracks", async () => {
    const response = await upload("audio", Buffer.from("x"));
    expect(response.status).toBe(404);
  });

  test("accept only WebM video", async () => {
    const response = await upload("cam", Buffer.from("x"), { "content-type": "text/plain" });
    expect(response.status).toBe(415);
  });

  test("refuse a track over the size limit and leave no file behind", async () => {
    const response = await upload("screen", Buffer.alloc(2048));
    expect(response.status).toBe(413);
    expect(existsSync(join(shortFolder, "takes", "screen.webm"))).toBe(false);
    expect(existsSync(join(shortFolder, "takes", "screen.webm.partial"))).toBe(false);
  });

  test("refuse a track whose declared size is over the limit", async () => {
    const response = await upload("screen", Buffer.alloc(2048), { "content-length": "2048" });
    expect(response.status).toBe(413);
    expect(existsSync(join(shortFolder, "takes", "screen.webm"))).toBe(false);
  });
});

describe("finishing a take", () => {
  test("is refused until both tracks are saved", async () => {
    await upload("cam", Buffer.from("camera"));
    const response = await finish({ screenOffsetMs: 42 });
    expect(response.status).toBe(409);
  });

  test("rejects an offset that is not a whole number of milliseconds", async () => {
    await upload("cam", Buffer.from("camera"));
    await upload("screen", Buffer.from("screen"));
    const response = await finish({ screenOffsetMs: "soon" });
    expect(response.status).toBe(400);
  });

  test("writes takes.json and resolves the saved promise", async () => {
    await upload("cam", Buffer.from("camera"));
    await upload("screen", Buffer.from("screen"));

    const response = await finish({ screenOffsetMs: -120 });
    expect(response.status).toBe(201);

    const written = JSON.parse(readFileSync(join(shortFolder, "takes.json"), "utf8"));
    const parsed = parseRecordedTakes(written);
    expect(parsed.success).toBe(true);
    expect(written).toEqual({
      version: 1,
      recordedAt: "2026-10-17T13:45:00.000Z",
      takes: { cam: "takes/cam.webm", screen: "takes/screen.webm", screenOffsetMs: -120 },
    });
    await expect(server.saved).resolves.toEqual(written);
  });
});
