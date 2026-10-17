import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    // The CLI and the library entry, for Node.
    {
      entry: ["src/index.ts", "src/bin.ts"],
      deps: {
        // tsdown <0.23 compatibility: resolve external dependency subpaths.
        // Remove to preserve subpath imports as written (the new default).
        // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
        resolveDepSubpath: true,
      },
      dts: {
        generator: "tsgo",
      },
      // The bin entry is the CLI, not a module for other packages to import.
      exports: {
        exclude: ["bin"],
        // Without this, the command name comes from the package name.
        bin: { short: "./src/bin.ts" },
      },
    },
    // The browser pages that the local server serves, such as the recorder.
    {
      entry: { "recorder/recorder": "web/recorder/recorder.ts" },
      platform: "browser",
      outDir: "dist-web",
      dts: false,
      copy: [
        { from: "web/recorder/index.html", to: "dist-web/recorder" },
        { from: "web/recorder/recorder.css", to: "dist-web/recorder" },
      ],
    },
  ],
  test: {
    // Playwright owns tests/e2e/*.spec.ts.
    include: ["tests/**/*.test.ts"],
  },
  lint: {
    // Generated and owned by Calavera; findings belong upstream.
    ignorePatterns: ["scripts/repository-controls.mjs"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    // Calavera owns these files and tracks their hashes, so reformatting them
    // would register as local edits on the next apply.
    ignorePatterns: [
      ".agents/**",
      ".calavera/**",
      ".mcp.json",
      "AGENTS.md",
      ".editorconfig",
      ".stylelintrc.json",
      ".htmlvalidate.json",
      ".htmlvalidateignore",
      "knip.json",
      ".github/repository-controls.json",
      ".github/dependabot.yml",
      "scripts/repository-controls.mjs",
      "docs/repository-controls.md",
      // html-validate owns the HTML style, and the two disagree on void elements.
      "web/**/*.html",
    ],
  },
});
