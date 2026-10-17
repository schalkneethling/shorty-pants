import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";
import { z } from "zod";
import type { RecordedTakes } from "../schemas/recorded-takes.ts";

const loopbackAddress = "127.0.0.1";
const tracks = ["cam", "screen"] as const;
type Track = (typeof tracks)[number];

// Three minutes of 1080p video is well under 1 GB; the limit guards against a
// runaway upload filling the disk.
const defaultMaxUploadBytes = 2 * 1024 ** 3;

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const finishRequestSchema = z.object({
  screenOffsetMs: z.number().int(),
});

export interface RecorderServerOptions {
  // The folder for this short; takes/ and takes.json are written inside it.
  shortFolder: string;
  // The folder that holds the built browser pages, such as recorder/index.html.
  webRoot: string;
  // A random secret that every API request must send, so that other web pages
  // open in the browser cannot upload to or finish the take.
  token: string;
  now: () => Date;
  maxUploadBytes?: number;
  port?: number;
}

export interface RecorderServer {
  // The recorder page, with the token in the fragment so it never reaches a server log.
  url: string;
  // Resolves with takes.json once the browser has finished the take.
  saved: Promise<RecordedTakes>;
  close: () => Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(
  response: ServerResponse,
  status: number,
  body: string | Buffer = "",
  contentType = "text/plain; charset=utf-8",
) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function trackPath(shortFolder: string, track: Track): string {
  return join(shortFolder, "takes", `${track}.webm`);
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > maxBytes) {
      throw new HttpError(413, "The request body is too large.");
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.");
  }
}

/**
 * Starts the local server that serves the recorder page and receives the two
 * recordings. It listens on 127.0.0.1 only.
 */
export async function startRecorderServer(options: RecorderServerOptions): Promise<RecorderServer> {
  const maxUploadBytes = options.maxUploadBytes ?? defaultMaxUploadBytes;
  const webRoot = resolve(options.webRoot);
  let isSaved = false;
  const uploadsInProgress = new Set<Track>();
  let realWebRoot: string | undefined;
  let resolveSaved: (takes: RecordedTakes) => void = () => {};
  const saved = new Promise<RecordedTakes>((resolvePromise) => {
    resolveSaved = resolvePromise;
  });

  async function serveStatic(pathname: string, response: ServerResponse) {
    const relativePath = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(relativePath);
    } catch {
      throw new HttpError(400, "The path is not valid percent-encoding.");
    }

    const notFound = new HttpError(404, "Not found.");
    const filePath = normalize(join(webRoot, decodedPath));
    const isInsideWebRoot = filePath.startsWith(`${webRoot}${sep}`);
    if (!isInsideWebRoot || !existsSync(filePath)) {
      throw notFound;
    }

    // The check above is about the path as written; resolving symbolic links
    // makes sure the file itself is inside the web root too.
    realWebRoot ??= await realpath(webRoot);
    const realFilePath = await realpath(filePath);
    const isReallyInsideWebRoot = realFilePath.startsWith(`${realWebRoot}${sep}`);
    if (!isReallyInsideWebRoot || !(await stat(realFilePath)).isFile()) {
      throw notFound;
    }

    const contentType = contentTypes[extname(filePath)] ?? "application/octet-stream";
    send(response, 200, await readFile(realFilePath), contentType);
  }

  async function writeUpload(request: IncomingMessage, partialPath: string): Promise<number> {
    const tooLarge = new HttpError(413, "The track is larger than the upload limit.");
    const declaredBytes = Number(request.headers["content-length"] ?? 0);
    if (declaredBytes > maxUploadBytes) {
      throw tooLarge;
    }

    const file = createWriteStream(partialPath);
    let receivedBytes = 0;
    await new Promise<void>((resolveWrite, rejectWrite) => {
      let failed = false;
      // The request is not destroyed on failure, so the error response can
      // still reach the browser. The rest of the body is read and discarded.
      const fail = (error: Error) => {
        if (failed) {
          return;
        }
        failed = true;
        request.unpipe(file);
        file.destroy();
        rejectWrite(error);
      };

      // Uploads without a Content-Length are counted as they arrive.
      request.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxUploadBytes) {
          fail(tooLarge);
        }
      });
      request.once("close", () => {
        if (!request.complete) {
          fail(new HttpError(400, "The upload was interrupted."));
        }
      });
      file.once("error", fail);
      file.once("finish", () => resolveWrite());
      request.pipe(file);
    });
    return receivedBytes;
  }

  async function receiveTrack(track: Track, request: IncomingMessage, response: ServerResponse) {
    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.startsWith("video/webm")) {
      throw new HttpError(415, "Tracks must be sent as video/webm.");
    }
    if (isSaved) {
      throw new HttpError(409, "The take is already saved.");
    }
    // Two uploads of the same track would write into the same partial file.
    if (uploadsInProgress.has(track)) {
      throw new HttpError(409, "This track is already being uploaded.");
    }

    uploadsInProgress.add(track);
    const finalPath = trackPath(options.shortFolder, track);
    const partialPath = `${finalPath}.partial`;
    try {
      await mkdir(join(options.shortFolder, "takes"), { recursive: true });
      // Writing to a partial file and renaming it means a cut-off upload never
      // looks like a finished track.
      const receivedBytes = await writeUpload(request, partialPath);
      if (receivedBytes === 0) {
        throw new HttpError(400, "The track is empty.");
      }
      await rename(partialPath, finalPath);
    } catch (error) {
      await rm(partialPath, { force: true });
      throw error;
    } finally {
      uploadsInProgress.delete(track);
    }
    send(response, 204);
  }

  async function finishTake(request: IncomingMessage, response: ServerResponse) {
    if (isSaved) {
      throw new HttpError(409, "The take is already saved.");
    }
    const result = finishRequestSchema.safeParse(await readJsonBody(request, 4096));
    if (!result.success) {
      throw new HttpError(400, "screenOffsetMs must be a whole number of milliseconds.");
    }

    const missingTracks = tracks.filter(
      (track) => !existsSync(trackPath(options.shortFolder, track)),
    );
    if (missingTracks.length > 0) {
      throw new HttpError(
        409,
        `These tracks have not been uploaded yet: ${missingTracks.join(", ")}.`,
      );
    }

    const recordedTakes: RecordedTakes = {
      version: 1,
      recordedAt: options.now().toISOString(),
      takes: {
        cam: "takes/cam.webm",
        screen: "takes/screen.webm",
        screenOffsetMs: result.data.screenOffsetMs,
      },
    };
    await writeFile(
      join(options.shortFolder, "takes.json"),
      `${JSON.stringify(recordedTakes, null, 2)}\n`,
    );
    isSaved = true;
    send(response, 201, JSON.stringify({ folder: options.shortFolder }), "application/json");
    resolveSaved(recordedTakes);
  }

  async function handle(request: IncomingMessage, response: ServerResponse, port: number) {
    // Only requests addressed to this server by its own address are served, so
    // a page on another domain that resolves to 127.0.0.1 gets nothing.
    const allowedHosts = [`${loopbackAddress}:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(request.headers.host ?? "")) {
      throw new HttpError(403, "Unexpected host.");
    }

    const { pathname } = new URL(request.url ?? "/", `http://${loopbackAddress}`);
    const isApiRequest = pathname.startsWith("/api/");
    if (!isApiRequest) {
      if (request.method !== "GET") {
        throw new HttpError(405, "Method not allowed.");
      }
      await serveStatic(pathname, response);
      return;
    }

    const hasValidToken = request.headers.authorization === `Bearer ${options.token}`;
    if (!hasValidToken) {
      throw new HttpError(401, "Missing or wrong session token.");
    }

    const trackMatch = /^\/api\/takes\/([a-z]+)$/.exec(pathname);
    const requestedTrack = trackMatch?.[1];
    if (request.method === "PUT" && requestedTrack !== undefined && requestedTrack !== "done") {
      const track = tracks.find((candidate) => candidate === requestedTrack);
      if (track === undefined) {
        throw new HttpError(404, "Unknown track.");
      }
      await receiveTrack(track, request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/takes/done") {
      await finishTake(request, response);
      return;
    }

    throw new HttpError(404, "Not found.");
  }

  const server = createServer((request, response) => {
    const { port } = server.address() as AddressInfo;
    handle(request, response, port).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Internal error.";
      if (!response.headersSent) {
        // The connection closes after this response. Reading and discarding
        // the rest of a refused upload lets the browser see the response
        // instead of a dropped connection.
        response.setHeader("connection", "close");
        send(response, status, message);
        request.resume();
      }
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port ?? 0, loopbackAddress, () => resolveListen());
  });

  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${loopbackAddress}:${port}/recorder/#token=${options.token}`,
    saved,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}
