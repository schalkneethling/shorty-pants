import { existsSync } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { CommandNotFoundError, type CommandRunner } from "../commands.ts";
import { ShortError } from "../errors.ts";

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
export async function makeSeekableCopies<Track extends string>(
  shortFolder: string,
  sources: Record<Track, string>,
  run: CommandRunner,
): Promise<Record<Track, string>> {
  const copies = {} as Record<Track, string>;
  for (const [track, source] of Object.entries(sources) as [Track, string][]) {
    const preview = join(shortFolder, "takes", `${track}.preview.webm`);
    copies[track] = preview;
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
  return copies;
}
