import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createDatedId } from "../dated-id.ts";
import { ShortError } from "../errors.ts";
import { readPreset } from "../preset-file.ts";
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
  if (!(await stat(shortsRoot)).isDirectory()) {
    throw new ShortError(`The shorts root ${shortsRoot} is not a folder.`);
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

  // An invalid preset.json fails here, before a folder exists for the short.
  const preset = await readPreset(options.shortsRoot);

  const existingIds = await existingShortIds(options.shortsRoot);
  const id = createDatedId(options.title, options.now(), existingIds, "short");
  const folder = join(options.shortsRoot, id);

  // The folder is created once the server is listening, so a server that
  // cannot start leaves nothing behind.
  const server = await startRecorderServer({
    shortFolder: folder,
    webRoot: options.webRoot,
    token: randomBytes(24).toString("base64url"),
    now: options.now,
    preset,
  });
  try {
    await mkdir(folder, { recursive: true });
  } catch (error) {
    await server.close();
    throw error;
  }

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
