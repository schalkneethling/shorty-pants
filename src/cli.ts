import packageJson from "../package.json" with { type: "json" };
import { ShortError } from "./errors.ts";
import { captureNote, listNotes, restoreNote } from "./notes/inbox.ts";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface CliContext {
  cwd: string;
  now: () => Date;
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
  // Recording from the restored worktree arrives with short record in milestone 3.
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
  { name: "record", summary: "Open the recorder for a new short", handler: { milestone: 3 } },
  { name: "edit", summary: "Open the editor for an existing short", handler: { milestone: 5 } },
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
};

/**
 * Runs the CLI with the given arguments and returns the exit code: 0 for
 * success, 1 for a command that failed, and 2 for a usage error.
 */
export async function run(
  args: string[],
  io: CliIo,
  context: CliContext = defaultContext,
): Promise<number> {
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
