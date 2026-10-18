import { createRequire } from "node:module";
import { describe, expect, test } from "vite-plus/test";
import { chromiumInstallCommand } from "../../src/render/overlays.ts";

const { version } = createRequire(import.meta.url)("playwright-core/package.json") as {
  version: string;
};

describe("chromiumInstallCommand", () => {
  test("installs the Chromium build that the installed playwright-core looks for", () => {
    expect(chromiumInstallCommand()).toBe(`npx playwright-core@${version} install chromium`);
  });
});
