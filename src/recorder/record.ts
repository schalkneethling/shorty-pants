import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createDatedId } from "../dated-id.ts";
import { ShortError } from "../errors.ts";
import type { RecordedTakes } from "../schemas/recorded-takes.ts";
import { startRecorderServer } from "./server.ts";

export interface RecordShortOptions {
  shortsRoot: string;
  title: string;
  now: () => Date;
  webRoot: string;
  // Called with the recorder address once the server is listening.
  onReady: (url: string) => Promise<void> | void;
  signal?: AbortSignal;
}

export type RecordShortResult =
  | { outcome: "saved"; folder: string; takes: RecordedTakes }
  | { outcome: "cancelled"; folder: string };

async function existingShortIds(shortsRoot: string): Promise<string[]> {
  if (!existsSync(shortsRoot)) {
    return [];
  }
  const entries = await readdir(shortsRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/**
 * Creates a folder for a new short, serves the recorder page on 127.0.0.1,
 * and waits until the browser has saved the take or the signal aborts.
 */
export async function recordShort(options: RecordShortOptions): Promise<RecordShortResult> {
  const recorderPage = join(options.webRoot, "recorder", "index.html");
  if (!existsSync(recorderPage)) {
    throw new ShortError(
      `The recorder page is missing from ${options.webRoot}. Run "pnpm build" first.`,
    );
  }

  const title = options.title.trim() === "" ? "short" : options.title;
  const id = createDatedId(title, options.now(), await existingShortIds(options.shortsRoot));
  const folder = join(options.shortsRoot, id);
  await mkdir(folder, { recursive: true });

  const server = await startRecorderServer({
    shortFolder: folder,
    webRoot: options.webRoot,
    token: randomBytes(24).toString("base64url"),
    now: options.now,
  });

  const cancelled = new Promise<"cancelled">((resolveCancelled) => {
    if (options.signal?.aborted) {
      resolveCancelled("cancelled");
    }
    options.signal?.addEventListener("abort", () => resolveCancelled("cancelled"), { once: true });
  });

  try {
    await options.onReady(server.url);
    const result = await Promise.race([server.saved, cancelled]);
    return result === "cancelled"
      ? { outcome: "cancelled", folder }
      : { outcome: "saved", folder, takes: result };
  } finally {
    await server.close();
  }
}
