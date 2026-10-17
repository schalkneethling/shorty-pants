import { createReadStream } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { parseRecordedTakes } from "../schemas/recorded-takes.ts";
import { parseShortProject, type ShortProject } from "../schemas/short-project.ts";
import { parseTranscript } from "../schemas/transcript.ts";
import {
  HttpError,
  readJsonBody,
  send,
  sendJson,
  startLocalServer,
} from "../server/local-server.ts";

// The parts of short.json the editor changes. Anything else in a request is refused.
const editorChangesSchema = z
  .object({
    trim: z.object({ startMs: z.number().int(), endMs: z.number().int() }).optional(),
    removedWords: z.array(z.tuple([z.number().int(), z.number().int()])).optional(),
    pauseThresholdMs: z.number().int().optional(),
  })
  .strict();

// The seekable copies that short edit makes of the recordings.
const previewFiles: Record<string, string> = {
  "/cam.webm": "cam.preview.webm",
  "/screen.webm": "screen.preview.webm",
};

export interface EditorServerOptions {
  shortFolder: string;
  webRoot: string;
  token: string;
  port?: number;
}

export interface EditorServer {
  url: string;
  // Resolves when the editor page says the editing is done.
  done: Promise<void>;
  close: () => Promise<void>;
}

async function readValidated<T>(
  path: string,
  parse: (input: unknown) => { success: true; data: T } | { success: false; error: Error },
): Promise<T> {
  const result = parse(JSON.parse(await readFile(path, "utf8")));
  if (!result.success) {
    throw new HttpError(500, `${path} is not valid. ${result.error.message}`);
  }
  return result.data;
}

/** Parses a single Range header such as bytes=0-499, bytes=500- or bytes=-500. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) {
    return null;
  }
  const [, startText, endText] = match;
  if (startText === "") {
    const suffixLength = Number(endText);
    return suffixLength > 0 ? { start: Math.max(0, size - suffixLength), end: size - 1 } : null;
  }
  const start = Number(startText);
  const end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  return start <= end && start < size ? { start, end } : null;
}

/**
 * Starts the local server for the editor page. It serves the take, the
 * transcript and short.json, saves the editor's changes into short.json,
 * and streams the preview recordings with support for seeking.
 */
export async function startEditorServer(options: EditorServerOptions): Promise<EditorServer> {
  const { shortFolder } = options;
  const shortPath = join(shortFolder, "short.json");
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolvePromise) => {
    resolveDone = resolvePromise;
  });
  let mediaPath = "";

  async function loadProject() {
    const [recordedTakes, transcript, short] = await Promise.all([
      readValidated(join(shortFolder, "takes.json"), parseRecordedTakes),
      readValidated(join(shortFolder, "transcript.json"), parseTranscript),
      readValidated(shortPath, parseShortProject),
    ]);
    return { recordedTakes, transcript, short };
  }

  async function saveChanges(request: IncomingMessage, response: ServerResponse) {
    const changes = editorChangesSchema.safeParse(await readJsonBody(request, 1024 * 1024));
    if (!changes.success) {
      throw new HttpError(400, `The changes are not valid. ${changes.error.message}`);
    }

    const { transcript, short } = await loadProject();
    const merged = parseShortProject({ ...short, ...changes.data });
    if (!merged.success) {
      throw new HttpError(400, `The changes are not valid. ${merged.error.message}`);
    }
    const updated: ShortProject = merged.data;
    if (updated.trim.endMs > transcript.durationMs) {
      throw new HttpError(400, "The trim ends after the recording ends.");
    }
    const lastWordIndex = transcript.words.length - 1;
    if (updated.removedWords.some(([, toWord]) => toWord > lastWordIndex)) {
      throw new HttpError(400, "The cuts refer to words that are not in the transcript.");
    }

    // Writing a temporary file and renaming it means a failed save never
    // leaves a half-written short.json.
    const temporaryPath = `${shortPath}.saving`;
    await writeFile(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`);
    await rename(temporaryPath, shortPath);
    sendJson(response, 200, updated);
  }

  async function handleApi(request: IncomingMessage, response: ServerResponse, pathname: string) {
    if (request.method === "GET" && pathname === "/project") {
      const project = await loadProject();
      sendJson(response, 200, {
        ...project,
        media: { cam: `${mediaPath}cam.webm`, screen: `${mediaPath}screen.webm` },
      });
      return;
    }
    if (request.method === "PUT" && pathname === "/short") {
      await saveChanges(request, response);
      return;
    }
    if (request.method === "POST" && pathname === "/done") {
      send(response, 204);
      resolveDone();
      return;
    }
    throw new HttpError(404, "Not found.");
  }

  async function handleMedia(request: IncomingMessage, response: ServerResponse, pathname: string) {
    const fileName = previewFiles[pathname];
    if (fileName === undefined || request.method !== "GET") {
      throw new HttpError(404, "Not found.");
    }
    const filePath = join(shortFolder, "takes", fileName);
    const { size } = await stat(filePath);
    const headers = {
      "content-type": "video/webm",
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    };

    const rangeHeader = request.headers.range;
    if (rangeHeader === undefined) {
      response.writeHead(200, { ...headers, "content-length": size });
      await pipeline(createReadStream(filePath), response);
      return;
    }

    const range = parseRange(rangeHeader, size);
    if (range === null) {
      response.writeHead(416, { ...headers, "content-range": `bytes */${size}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      ...headers,
      "content-range": `bytes ${range.start}-${range.end}/${size}`,
      "content-length": range.end - range.start + 1,
    });
    await pipeline(createReadStream(filePath, range), response);
  }

  const server = await startLocalServer({
    webRoot: options.webRoot,
    page: "editor",
    token: options.token,
    handleApi,
    handleMedia,
    port: options.port,
  });
  mediaPath = server.mediaPath;

  return { url: server.url, done, close: server.close };
}
