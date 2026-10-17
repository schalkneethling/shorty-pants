import { describe, expect, test } from "vite-plus/test";
import { run } from "../src/cli.ts";

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
