import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import packageJson from "../package.json" with { type: "json" };
import { runCommand, type CommandRunner } from "./commands.ts";
import { computeKeepRanges } from "./edit/cut-list.ts";
import { keptDurationMs } from "./edit/playback.ts";
import { editShort } from "./editor/edit.ts";
import { ShortError } from "./errors.ts";
import { captureNote, listNotes, restoreNote } from "./notes/inbox.ts";
import { openUrl } from "./open-url.ts";
import { recordShort } from "./recorder/record.ts";
import { transcribeShort } from "./transcribe/transcribe.ts";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface CliContext {
  cwd: string;
  now: () => Date;
  environment: Record<string, string | undefined>;
  // The folder with the built browser pages.
  webRoot: string;
  openUrl: (url: string) => Promise<void>;
  runCommand: CommandRunner;
  homeDirectory: string;
}

type CommandHandler = (args: string[], io: CliIo, context: CliContext) => Promise<number>;

interface CommandDescription {
  name: string;
  summary: string;
  // Commands that are not built yet name the milestone that brings them.
  handler: CommandHandler | { milestone: number };
}

async function noteCommand(args: string[], io: CliIo, context: CliContext): Promise<number> {
  const title = args.join(" ").trim();
  if (title === "") {
    io.stderr('Usage: short note "<what you noticed>"\n');
    return 2;
  }

  const note = await captureNote({ cwd: context.cwd, title, now: context.now });
  io.stdout(`Saved note ${note.id}\n`);
  if (note.snapshotRef !== null) {
    io.stdout(`Uncommitted changes are saved in ${note.snapshotRef}.\n`);
  }
  if (note.untracked.length > 0) {
    io.stdout(
      `These untracked files are not in the snapshot:\n${note.untracked.map((path) => `  ${path}\n`).join("")}`,
    );
  }
  return 0;
}

async function notesCommand(_args: string[], io: CliIo, context: CliContext): Promise<number> {
  const notes = await listNotes({ cwd: context.cwd });
  if (notes.length === 0) {
    io.stdout('No notes yet. Save one with short note "<what you noticed>".\n');
    return 0;
  }

  for (const note of notes) {
    const where = note.branch ?? note.commit.slice(0, 7);
    io.stdout(`${note.id}  ${note.title}  (${where})\n`);
  }
  return 0;
}

async function fromCommand(args: string[], io: CliIo, context: CliContext): Promise<number> {
  const [noteId] = args;
  if (noteId === undefined) {
    io.stderr("Usage: short from <note id>\n");
    return 2;
  }

  const restored = await restoreNote({ cwd: context.cwd, noteId });
  io.stdout(`Restored ${restored.note.id} in ${restored.worktreePath}\n`);
  if (restored.missingUntracked.length > 0) {
    io.stdout(
      `These untracked files were not part of the snapshot:\n${restored.missingUntracked.map((path) => `  ${path}\n`).join("")}`,
    );
  }
  io.stdout('Open it in your editor, then run short record "<title>" to record the short.\n');
  return 0;
}

interface WhisperSettings {
  modelPath: string;
  whisperBinary: string;
  language: string;
}

function firstGiven(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value !== "");
}

/** The model, binary and language from flags, then the environment, then the defaults. */
function whisperSettings(
  context: CliContext,
  flags: { model?: string; language?: string } = {},
): WhisperSettings {
  const { environment } = context;
  const defaultModelPath = join(
    context.homeDirectory,
    ".cache",
    "shorty-pants",
    "models",
    "ggml-small.en.bin",
  );
  const configuredModel = firstGiven(flags.model, environment.SHORTY_PANTS_WHISPER_MODEL);
  return {
    modelPath:
      configuredModel === undefined ? defaultModelPath : resolve(context.cwd, configuredModel),
    whisperBinary: firstGiven(environment.SHORTY_PANTS_WHISPER_BIN) ?? "whisper-cli",
    language: firstGiven(flags.language, environment.SHORTY_PANTS_WHISPER_LANGUAGE) ?? "en",
  };
}

async function transcribeFolder(
  shortFolder: string,
  settings: WhisperSettings,
  io: CliIo,
  context: CliContext,
  replaceEditedTranscript = false,
) {
  const transcript = await transcribeShort({
    shortFolder,
    ...settings,
    run: context.runCommand,
    replaceEditedTranscript,
  });
  io.stdout(
    `Transcribed ${transcript.words.length} words with ${transcript.model} into ${join(shortFolder, "transcript.json")}\n`,
  );
}

const transcribeUsage =
  "Usage: short transcribe <short folder> [--model <file>] [--language <code>] [--force]\n";

async function transcribeCommand(args: string[], io: CliIo, context: CliContext): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        model: { type: "string" },
        language: { type: "string" },
        force: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    });
  } catch {
    io.stderr(transcribeUsage);
    return 2;
  }
  if (parsed.values.help) {
    io.stdout(transcribeUsage);
    return 0;
  }

  const [folder] = parsed.positionals;
  if (folder === undefined || parsed.positionals.length > 1) {
    io.stderr(transcribeUsage);
    return 2;
  }

  await transcribeFolder(
    resolve(context.cwd, folder),
    whisperSettings(context, parsed.values),
    io,
    context,
    parsed.values.force,
  );
  return 0;
}

const recordUsage = 'Usage: short record ["<title>"] [--root <folder>] [--no-open]\n';

async function recordCommand(args: string[], io: CliIo, context: CliContext): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        "no-open": { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    });
  } catch {
    io.stderr(recordUsage);
    return 2;
  }
  if (parsed.values.help) {
    io.stdout(recordUsage);
    return 0;
  }

  // An empty value counts as not given, and relative paths are resolved
  // against the folder the command runs in.
  const configuredRoot = firstGiven(
    parsed.values.root,
    context.environment.SHORTY_PANTS_SHORTS_ROOT,
  );
  const shortsRoot = resolve(context.cwd, configuredRoot ?? "shorts");
  const shouldOpen = !parsed.values["no-open"];

  // While waiting for the browser, Ctrl+C shuts the server down. Once the take
  // is saved, the handler is removed, so Ctrl+C during transcription stops
  // the command as usual.
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);

  let result;
  try {
    result = await recordShort({
      shortsRoot,
      title: parsed.positionals.join(" "),
      now: context.now,
      webRoot: context.webRoot,
      signal: controller.signal,
      onReady: async (url) => {
        io.stdout(`The recorder is open at ${url}\n`);
        io.stdout("Record in Chrome or another Chromium browser. Press Ctrl+C to cancel.\n");
        if (shouldOpen) {
          await context.openUrl(url);
        }
      },
    });
  } finally {
    process.removeListener("SIGINT", cancel);
  }

  if (result.outcome === "cancelled") {
    io.stdout(`Recording cancelled. The folder ${result.folder} was left in place.\n`);
    return 1;
  }
  io.stdout(`Saved the take in ${result.folder}\n`);

  // The take is safe on disk, so a transcription problem never fails the recording.
  const settings = whisperSettings(context);
  const transcribeLater = `Run short transcribe "${result.folder}" to transcribe it.`;
  if (!existsSync(settings.modelPath)) {
    io.stdout(
      `No whisper model at ${settings.modelPath}. Once one is set up, ${transcribeLater}\n`,
    );
    return 0;
  }
  try {
    await transcribeFolder(result.folder, settings, io, context);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.stderr(`The take was saved, but transcription failed. ${reason}\n${transcribeLater}\n`);
  }
  return 0;
}

const editUsage = "Usage: short edit <short folder> [--no-open]\n";

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

async function editCommand(args: string[], io: CliIo, context: CliContext): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        "no-open": { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    });
  } catch {
    io.stderr(editUsage);
    return 2;
  }
  if (parsed.values.help) {
    io.stdout(editUsage);
    return 0;
  }
  const [folder] = parsed.positionals;
  if (folder === undefined || parsed.positionals.length > 1) {
    io.stderr(editUsage);
    return 2;
  }

  // Ctrl+C stops the editor; every change is already saved in short.json.
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);

  let result;
  try {
    result = await editShort({
      shortFolder: resolve(context.cwd, folder),
      webRoot: context.webRoot,
      run: context.runCommand,
      signal: controller.signal,
      onReady: async (url) => {
        io.stdout(`The editor is open at ${url}\n`);
        io.stdout(
          "Every change is saved as you go. Press Done in the editor or Ctrl+C here when finished.\n",
        );
        if (!parsed.values["no-open"]) {
          await context.openUrl(url);
        }
      },
    });
  } finally {
    process.removeListener("SIGINT", cancel);
  }

  if (result.outcome === "cancelled") {
    io.stdout("The editor was closed. Your changes are saved in short.json.\n");
    return 0;
  }
  const { short, transcript } = result;
  const keptMs = keptDurationMs(computeKeepRanges({ words: transcript.words, ...short }));
  const cutCount = short.removedWords.length;
  io.stdout(
    `Saved short.json with ${cutCount} ${cutCount === 1 ? "cut" : "cuts"}. The short is ${formatDuration(keptMs)} long.\n`,
  );
  return 0;
}

const commands: CommandDescription[] = [
  {
    name: "note",
    summary: "Save an idea with a snapshot of the current Git state",
    handler: noteCommand,
  },
  { name: "notes", summary: "List saved ideas", handler: notesCommand },
  { name: "from", summary: "Restore a note's Git state in a new worktree", handler: fromCommand },
  { name: "record", summary: "Open the recorder for a new short", handler: recordCommand },
  {
    name: "transcribe",
    summary: "Transcribe a recorded take with whisper.cpp",
    handler: transcribeCommand,
  },
  { name: "edit", summary: "Open the editor for a recorded short", handler: editCommand },
  {
    name: "render",
    summary: "Render short.mp4, captions.vtt and upload.txt",
    handler: { milestone: 7 },
  },
];

function usage(): string {
  const nameWidth = Math.max(...commands.map((command) => command.name.length));
  const commandLines = commands.map(
    (command) => `  ${command.name.padEnd(nameWidth)}  ${command.summary}`,
  );

  return [
    "Usage: short <command> [options]",
    "",
    "Commands:",
    ...commandLines,
    "",
    "Options:",
    "  --help     Show this help",
    "  --version  Show the version",
    "",
  ].join("\n");
}

const defaultContext: CliContext = {
  cwd: process.cwd(),
  now: () => new Date(),
  environment: process.env,
  // The built CLI lives in dist/, next to dist-web/.
  webRoot: fileURLToPath(new URL("../dist-web/", import.meta.url)),
  openUrl,
  runCommand,
  homeDirectory: homedir(),
};

/**
 * Runs the CLI with the given arguments and returns the exit code: 0 for
 * success, 1 for a command that failed, and 2 for a usage error.
 */
export async function run(
  args: string[],
  io: CliIo,
  contextOverrides: Partial<CliContext> = {},
): Promise<number> {
  const context: CliContext = { ...defaultContext, ...contextOverrides };
  const [commandName, ...commandArgs] = args;

  const wantsHelp = commandName === undefined || commandName === "--help" || commandName === "-h";
  if (wantsHelp) {
    io.stdout(usage());
    return 0;
  }

  if (commandName === "--version") {
    io.stdout(`${packageJson.version}\n`);
    return 0;
  }

  const command = commands.find((candidate) => candidate.name === commandName);
  if (command === undefined) {
    io.stderr(`Unknown command "${commandName}". Run "short --help" to see the commands.\n`);
    return 2;
  }

  if (typeof command.handler !== "function") {
    io.stderr(
      `"short ${command.name}" is not available yet. It is planned for milestone ${command.handler.milestone}.\n`,
    );
    return 1;
  }

  try {
    return await command.handler(commandArgs, io, context);
  } catch (error) {
    if (error instanceof ShortError) {
      io.stderr(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
