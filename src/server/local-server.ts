import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";

const loopbackAddress = "127.0.0.1";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/** An error that becomes an HTTP response with this status and message. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function send(
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

export function sendJson(response: ServerResponse, status: number, value: unknown) {
  send(response, status, JSON.stringify(value), "application/json");
}

export async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  // The chunks are joined before decoding, because a character can be split
  // across two of them.
  const chunks: Buffer[] = [];
  let byteCount = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    byteCount += bytes.byteLength;
    if (byteCount > maxBytes) {
      throw new HttpError(413, "The request body is too large.");
    }
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.");
  }
}

type RouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
) => Promise<void>;

export interface LocalServerOptions {
  // The folder that holds the built browser pages.
  webRoot: string;
  // The page to open, such as "recorder", served from webRoot/recorder/.
  page: string;
  // A random secret. API requests send it as a bearer token, so that other
  // web pages open in the browser cannot use the API.
  token: string;
  // Handles /api/... once the token is checked. The pathname starts after /api.
  handleApi: RouteHandler;
  // Handles /media/<token>/..., for video elements, which cannot send a token
  // header. The pathname starts after the token.
  handleMedia?: RouteHandler;
  port?: number;
}

export interface LocalServer {
  // The page, with the token in the fragment so it never reaches a server log.
  url: string;
  // The address media files are served from, including the token.
  mediaPath: string;
  close: () => Promise<void>;
}

/**
 * Starts a server on 127.0.0.1 that serves the built pages and an API for
 * one page. It refuses requests addressed to any other host name, which
 * blocks DNS rebinding, and refuses API requests without the token.
 */
export async function startLocalServer(options: LocalServerOptions): Promise<LocalServer> {
  const webRoot = resolve(options.webRoot);
  const mediaPrefix = `/media/${options.token}/`;
  let realWebRoot: string | undefined;

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

  async function handle(request: IncomingMessage, response: ServerResponse, port: number) {
    // Only requests addressed to this server by its own address are served, so
    // a page on another domain that resolves to 127.0.0.1 gets nothing.
    const allowedHosts = [`${loopbackAddress}:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(request.headers.host ?? "")) {
      throw new HttpError(403, "Unexpected host.");
    }

    const { pathname } = new URL(request.url ?? "/", `http://${loopbackAddress}`);

    if (pathname.startsWith("/api/")) {
      const hasValidToken = request.headers.authorization === `Bearer ${options.token}`;
      if (!hasValidToken) {
        throw new HttpError(401, "Missing or wrong session token.");
      }
      await options.handleApi(request, response, pathname.slice("/api".length));
      return;
    }

    if (pathname.startsWith("/media/")) {
      if (options.handleMedia === undefined || !pathname.startsWith(mediaPrefix)) {
        throw new HttpError(404, "Not found.");
      }
      await options.handleMedia(request, response, pathname.slice(mediaPrefix.length - 1));
      return;
    }

    if (request.method !== "GET") {
      throw new HttpError(405, "Method not allowed.");
    }
    await serveStatic(pathname, response);
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
    url: `http://${loopbackAddress}:${port}/${options.page}/#token=${options.token}`,
    mediaPath: mediaPrefix,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}
