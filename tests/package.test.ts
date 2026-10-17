import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

test("the package installs the CLI as the short command", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(packageJson.bin).toEqual({ short: "./dist/bin.mjs" });
});
