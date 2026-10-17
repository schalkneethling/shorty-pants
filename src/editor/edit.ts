import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CommandNotFoundError, type CommandRunner } from "../commands.ts";
import { createShortProject } from "../edit/short-project-defaults.ts";
import { ShortError } from "../errors.ts";
import { defaultPreset } from "../schemas/preset.ts";
import { parseRecordedTakes } from "../schemas/recorded-takes.ts";
import { parseShortProject, type ShortProject } from "../schemas/short-project.ts";
import { parseTranscript, type Transcript } from "../schemas/transcript.ts";
import { startEditorServer } from "./server.ts";

export interface EditShortOptions {
  shortFolder: string;
  webRoot: string;
  run: CommandRunner;
  // Called with the editor address once the server is listening.
  onReady: (url: string) => Promise<void> | void;
  signal?: AbortSignal;
}

export type EditShortResult =
  | { outcome: "done"; short: ShortProject; transcript: Transcript }
  | { outcome: "cancelled" };

async function readValidated<T>(
  path: string,
  missingMessage: string,
  parse: (input: unknown) => { success: true; data: T } | { success: false; error: Error },
): Promise<T> {
  if (!existsSync(path)) {
    throw new ShortError(missingMessage);
  }
  let input: unknown;
  try {
    input = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new ShortError(
      `${path} is not valid JSON. ${error instanceof Error ? error.message : ""}`,
    );
  }
  const result = parse(input);
  if (!result.success) {
    throw new ShortError(`${path} is not valid. ${result.error.message}`);
  }
  return result.data;
}

async function isUpToDate(preview: string, source: string): Promise<boolean> {
  if (!existsSync(preview)) {
    return false;
  }
  const [previewStats, sourceStats] = await Promise.all([stat(preview), stat(source)]);
  return previewStats.mtimeMs >= sourceStats.mtimeMs;
}

/**
 * Browser recordings have no duration and no seek index, so video elements
 * cannot jump around in them. Copying the streams into a new file with
 * ffmpeg adds both without re-encoding anything.
 */
async function makeSeekablePreviews(
  shortFolder: string,
  sources: Record<string, string>,
  run: CommandRunner,
) {
  for (const [track, source] of Object.entries(sources)) {
    const preview = join(shortFolder, "takes", `${track}.preview.webm`);
    if (await isUpToDate(preview, source)) {
      continue;
    }
    // ffmpeg writes to a separate file that is renamed once it is complete,
    // so an interrupted copy is never mistaken for an up-to-date preview.
    const partialPreview = join(shortFolder, "takes", `${track}.preview.partial.webm`);
    try {
      await run("ffmpeg", [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        source,
        "-c",
        "copy",
        partialPreview,
      ]);
      await rename(partialPreview, preview);
    } catch (error) {
      await rm(partialPreview, { force: true });
      if (error instanceof CommandNotFoundError) {
        throw new ShortError("ffmpeg was not found. Install it with brew install ffmpeg.");
      }
      throw error;
    }
  }
}

/**
 * Prepares a recorded and transcribed short for editing, serves the editor
 * on 127.0.0.1, and waits until the page says it is done or the signal aborts.
 */
export async function editShort(options: EditShortOptions): Promise<EditShortResult> {
  const { shortFolder } = options;
  if (!existsSync(join(options.webRoot, "editor", "index.html"))) {
    throw new ShortError(
      `The editor page is missing from ${options.webRoot}. Run "pnpm build" first.`,
    );
  }

  const recordedTakes = await readValidated(
    join(shortFolder, "takes.json"),
    `No recorded take in ${shortFolder}. Record one with short record.`,
    parseRecordedTakes,
  );
  const transcript = await readValidated(
    join(shortFolder, "transcript.json"),
    `${shortFolder} has no transcript yet. Run short transcribe "${shortFolder}" first.`,
    parseTranscript,
  );

  await makeSeekablePreviews(
    shortFolder,
    {
      cam: join(shortFolder, recordedTakes.takes.cam),
      screen: join(shortFolder, recordedTakes.takes.screen),
    },
    options.run,
  );

  const shortPath = join(shortFolder, "short.json");
  if (!existsSync(shortPath)) {
    const short = createShortProject({ recordedTakes, transcript, preset: defaultPreset });
    await writeFile(shortPath, `${JSON.stringify(short, null, 2)}\n`);
  }

  const server = await startEditorServer({
    shortFolder,
    webRoot: options.webRoot,
    token: randomBytes(24).toString("base64url"),
  });
  const cancelled = new Promise<"cancelled">((resolveCancelled) => {
    if (options.signal?.aborted) {
      resolveCancelled("cancelled");
    }
    options.signal?.addEventListener("abort", () => resolveCancelled("cancelled"), { once: true });
  });

  try {
    await options.onReady(server.url);
    const outcome = await Promise.race([server.done.then(() => "done" as const), cancelled]);
    if (outcome === "cancelled") {
      return { outcome };
    }
    const short = await readValidated(shortPath, `${shortPath} is missing.`, parseShortProject);
    return { outcome, short, transcript };
  } finally {
    await server.close();
  }
}
