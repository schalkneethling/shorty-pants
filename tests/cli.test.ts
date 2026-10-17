import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { run } from "../src/cli.ts";
import {
  createTestRepository,
  gitEnvironment,
  type TestRepository,
} from "./helpers/git-repository.ts";

function createIo() {
  const output = { stdout: "", stderr: "" };
  return {
    output,
    io: {
      stdout: (text: string) => {
        output.stdout += text;
      },
      stderr: (text: string) => {
        output.stderr += text;
      },
    },
  };
}

describe("short CLI", () => {
  test("prints usage and exits with 0 for --help", async () => {
    const { io, output } = createIo();
    const exitCode = await run(["--help"], io);
    expect(exitCode).toBe(0);
    expect(output.stdout).toContain("Usage: short <command>");
  });

  test("lists every planned command in the usage text", async () => {
    const { io, output } = createIo();
    await run(["--help"], io);
    for (const command of ["note", "notes", "from", "record", "edit", "render"]) {
      expect(output.stdout).toMatch(new RegExp(`^\\s+${command}\\b`, "m"));
    }
  });

  test("prints usage and exits with 0 when no command is given", async () => {
    const { io, output } = createIo();
    expect(await run([], io)).toBe(0);
    expect(output.stdout).toContain("Usage: short <command>");
  });

  test("prints the package version for --version", async () => {
    const { io, output } = createIo();
    expect(await run(["--version"], io)).toBe(0);
    expect(output.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("reports an unknown command on stderr and exits with 2", async () => {
    const { io, output } = createIo();
    expect(await run(["publish"], io)).toBe(2);
    expect(output.stderr).toContain('Unknown command "publish"');
  });

  test("reports a command that is planned but not built yet and exits with 1", async () => {
    const { io, output } = createIo();
    expect(await run(["record"], io)).toBe(1);
    expect(output.stderr).toContain('"short record" is not available yet');
  });
});

describe("short note, notes and from", () => {
  let repository: TestRepository;
  const now = () => new Date(2026, 9, 17, 13, 45);

  beforeEach(() => {
    Object.assign(process.env, gitEnvironment);
    repository = createTestRepository();
  });

  afterEach(() => {
    repository.remove();
  });

  test("short note saves a note and prints its id", async () => {
    const { io, output } = createIo();
    const exitCode = await run(["note", "Anchor", "positioning", "ignores", "scroll"], io, {
      cwd: repository.root,
      now,
    });
    expect(exitCode).toBe(0);
    expect(output.stdout).toContain("Saved note 2026-10-17-anchor-positioning-ignores-scroll");
  });

  test("short note mentions untracked files that the snapshot leaves out", async () => {
    repository.write("new-demo.html", "<p>New</p>\n");
    const { io, output } = createIo();
    await run(["note", "Untracked"], io, { cwd: repository.root, now });
    expect(output.stdout).toContain("new-demo.html");
  });

  test("short note without a title is a usage error", async () => {
    const { io, output } = createIo();
    expect(await run(["note"], io, { cwd: repository.root, now })).toBe(2);
    expect(output.stderr).toContain('Usage: short note "<what you noticed>"');
  });

  test("short note outside a repository reports the problem and exits with 1", async () => {
    const { io, output } = createIo();
    const outside = join(repository.root, "..");
    expect(await run(["note", "Nowhere"], io, { cwd: outside, now })).toBe(1);
    expect(output.stderr).toContain("is not inside a Git repository");
  });

  test("short notes lists the saved notes", async () => {
    const silent = createIo();
    await run(["note", "First idea"], silent.io, { cwd: repository.root, now });

    const { io, output } = createIo();
    expect(await run(["notes"], io, { cwd: repository.root, now })).toBe(0);
    expect(output.stdout).toContain("2026-10-17-first-idea");
    expect(output.stdout).toContain("First idea");
  });

  test("short notes says so when there are no notes", async () => {
    const { io, output } = createIo();
    await run(["notes"], io, { cwd: repository.root, now });
    expect(output.stdout).toContain("No notes yet");
  });

  test("short from restores a note and prints the worktree path", async () => {
    const silent = createIo();
    await run(["note", "Restore me"], silent.io, { cwd: repository.root, now });

    const { io, output } = createIo();
    expect(await run(["from", "2026-10-17-restore-me"], io, { cwd: repository.root, now })).toBe(0);
    expect(output.stdout).toContain(
      join(repository.root, ".git", "shorts", "worktrees", "2026-10-17-restore-me"),
    );
  });

  test("short from reports a git failure as a message, not a stack trace", async () => {
    const silent = createIo();
    repository.write("demo.css", ".anchor { inset: 0; }\n");
    await run(["note", "Lost snapshot"], silent.io, { cwd: repository.root, now });
    repository.git(["update-ref", "-d", "refs/shorts/2026-10-17-lost-snapshot"]);

    const { io, output } = createIo();
    expect(await run(["from", "2026-10-17-lost-snapshot"], io, { cwd: repository.root, now })).toBe(
      1,
    );
    expect(output.stderr).toContain("Could not apply the snapshot");
    expect(output.stderr).not.toMatch(/\n\s+at /);
  });

  test("short from without a note id is a usage error", async () => {
    const { io, output } = createIo();
    expect(await run(["from"], io, { cwd: repository.root, now })).toBe(2);
    expect(output.stderr).toContain("Usage: short from <note id>");
  });
});
