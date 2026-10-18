import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import { startEditorServer, type EditorServer } from "../../src/editor/server.ts";
import { createShortProject } from "../../src/edit/short-project-defaults.ts";
import { defaultPreset } from "../../src/schemas/preset.ts";

// The built pages; the test:e2e script builds them before Playwright runs.
export const webRoot = resolve(import.meta.dirname, "..", "..", "dist-web");
const mediaFixtures = resolve(import.meta.dirname, "..", "fixtures", "media");

export const recordedTakes = {
  version: 1 as const,
  recordedAt: "2026-10-17T13:45:00.000Z",
  takes: { cam: "takes/cam.webm", screen: "takes/screen.webm", screenOffsetMs: 40 },
};

// The 800 ms gap after "ignores" is a pause that the default threshold cuts.
export const transcript = {
  version: 1 as const,
  model: "ggml-small.en.bin",
  language: "en",
  durationMs: 4000,
  words: [
    { text: "Anchor", startMs: 300, endMs: 700 },
    { text: "positioning", startMs: 800, endMs: 1300 },
    { text: "ignores", startMs: 1400, endMs: 1800 },
    { text: "the", startMs: 2600, endMs: 2800 },
    { text: "scroll", startMs: 2900, endMs: 3400 },
  ],
};

export interface EditorWorkspace {
  shortFolder: string;
  server: EditorServer;
  savedShort: () => Record<string, unknown> & {
    removedWords: unknown;
    trim: { startMs: number; endMs: number };
  };
  remove: () => Promise<void>;
}

/**
 * A short folder with the fixture recordings, their seekable copies, a
 * transcript and a fresh short.json, in a temporary workspace.
 */
export function createShortFolder(
  options: { transcript?: typeof transcript; short?: Record<string, unknown> } = {},
): { workspace: string; shortFolder: string } {
  const workspaceTranscript = options.transcript ?? transcript;
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "shorty-pants-e2e-")));
  const shortFolder = join(workspace, "2026-10-17-anchor-scroll");
  mkdirSync(join(shortFolder, "takes"), { recursive: true });
  for (const track of ["cam", "screen"]) {
    copyFileSync(join(mediaFixtures, `${track}.webm`), join(shortFolder, "takes", `${track}.webm`));
    copyFileSync(
      join(mediaFixtures, `${track}.webm`),
      join(shortFolder, "takes", `${track}.preview.webm`),
    );
  }
  writeFileSync(join(shortFolder, "takes.json"), JSON.stringify(recordedTakes));
  writeFileSync(join(shortFolder, "transcript.json"), JSON.stringify(workspaceTranscript));
  writeFileSync(
    join(shortFolder, "short.json"),
    JSON.stringify({
      ...createShortProject({
        recordedTakes,
        transcript: workspaceTranscript,
        preset: defaultPreset,
      }),
      ...options.short,
    }),
  );
  return { workspace, shortFolder };
}

/** A short folder served by the editor. */
export async function createEditorWorkspace(
  options: { transcript?: typeof transcript; short?: Record<string, unknown> } = {},
): Promise<EditorWorkspace> {
  const { workspace, shortFolder } = createShortFolder(options);
  const server = await startEditorServer({
    shortFolder,
    webRoot,
    token: "editor-e2e-token-0123",
    preset: defaultPreset,
  });
  return {
    shortFolder,
    server,
    savedShort: () => JSON.parse(readFileSync(join(shortFolder, "short.json"), "utf8")),
    remove: async () => {
      await server.close();
      rmSync(workspace, { recursive: true, force: true });
    },
  };
}

export function words(page: Page) {
  return page.getByRole("listbox", { name: "Transcript" }).getByRole("option");
}

export async function openEditor(
  page: Page,
  workspace: EditorWorkspace,
  wordCount = transcript.words.length,
) {
  await page.goto(workspace.server.url);
  await expect(words(page)).toHaveCount(wordCount);
  // The layout choice is enabled once the short has loaded.
  await expect(page.getByRole("group", { name: "Layout for the selected words" })).toBeEnabled();
}
