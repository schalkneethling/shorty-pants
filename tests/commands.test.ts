import { describe, expect, test } from "vite-plus/test";
import { CommandNotFoundError, runCommand } from "../src/commands.ts";

// A small Node script stands in for a tool that fails the way whisper-cli does:
// the error first, then its usage text.
function failingTool(stderrLines: string[]) {
  const script = `process.stderr.write(${JSON.stringify(`${stderrLines.join("\n")}\n`)}); process.exit(1);`;
  return runCommand(process.execPath, ["-e", script]);
}

describe("runCommand", () => {
  test("returns what the program prints", async () => {
    const { stdout } = await runCommand(process.execPath, ["-e", "console.log('ok')"]);
    expect(stdout).toBe("ok\n");
  });

  test("reports a program that is not installed", async () => {
    await expect(runCommand("shorty-pants-missing-tool", [])).rejects.toBeInstanceOf(
      CommandNotFoundError,
    );
  });

  test("reports the error line rather than the usage text after it", async () => {
    const result = failingTool([
      "error: model file not found 'missing.bin'",
      "",
      "usage: whisper-cli [options] file0 file1 ...",
      "  -h,        --help      [default] show this help message and exit",
      "  -t N,      --threads N [4      ] number of threads to use during computation",
      "  -p N,      --processors N [1   ] number of processors to use during computation",
      "  -ot N,     --offset-t N [0     ] time offset in milliseconds",
      "  -on N,     --offset-n N [0     ] segment index offset",
    ]);
    await expect(result).rejects.toThrow("error: model file not found 'missing.bin'");
  });

  test("falls back to the last lines when there is no error line", async () => {
    await expect(failingTool(["first", "second", "something broke"])).rejects.toThrow(
      /something broke/,
    );
  });

  test("names the exit code when the program prints nothing", async () => {
    await expect(failingTool([])).rejects.toThrow(/exit code 1/);
  });
});
