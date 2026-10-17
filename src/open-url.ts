import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function tryRun(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens a URL in a browser. On macOS, Chrome is preferred, because the
 * recorder needs Chromium's WebM recording. Failures are ignored, since the
 * address is also printed.
 */
export async function openUrl(url: string): Promise<void> {
  if (process.platform === "darwin") {
    const openedInChrome = await tryRun("open", ["-a", "Google Chrome", url]);
    if (!openedInChrome) {
      await tryRun("open", [url]);
    }
    return;
  }
  if (process.platform === "win32") {
    await tryRun("cmd", ["/c", "start", "", url]);
    return;
  }
  await tryRun("xdg-open", [url]);
}
