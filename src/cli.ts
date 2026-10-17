import packageJson from "../package.json" with { type: "json" };

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface CommandDescription {
  name: string;
  summary: string;
  milestone: number;
}

// Every command from the project brief. None of them are built yet; each one
// arrives with the milestone listed here.
const plannedCommands: CommandDescription[] = [
  { name: "note", summary: "Save an idea with a snapshot of the current Git state", milestone: 2 },
  { name: "notes", summary: "List saved ideas", milestone: 2 },
  {
    name: "from",
    summary: "Restore a note's Git state in a new worktree and record",
    milestone: 2,
  },
  { name: "record", summary: "Open the recorder for a new short", milestone: 3 },
  { name: "edit", summary: "Open the editor for an existing short", milestone: 5 },
  { name: "render", summary: "Render short.mp4, captions.vtt and upload.txt", milestone: 7 },
];

function usage(): string {
  const nameWidth = Math.max(...plannedCommands.map((command) => command.name.length));
  const commandLines = plannedCommands.map(
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

/**
 * Runs the CLI with the given arguments and returns the exit code: 0 for
 * success, 1 for a command that failed, and 2 for a usage error.
 */
export async function run(args: string[], io: CliIo): Promise<number> {
  const [commandName] = args;

  const wantsHelp = commandName === undefined || commandName === "--help" || commandName === "-h";
  if (wantsHelp) {
    io.stdout(usage());
    return 0;
  }

  if (commandName === "--version") {
    io.stdout(`${packageJson.version}\n`);
    return 0;
  }

  const plannedCommand = plannedCommands.find((command) => command.name === commandName);
  if (plannedCommand === undefined) {
    io.stderr(`Unknown command "${commandName}". Run "short --help" to see the commands.\n`);
    return 2;
  }

  io.stderr(
    `"short ${plannedCommand.name}" is not available yet. It is planned for milestone ${plannedCommand.milestone}.\n`,
  );
  return 1;
}
