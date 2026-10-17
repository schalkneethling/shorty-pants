import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
    },
    dts: {
      generator: "tsgo",
    },
    exports: true,
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
    ],
  },
});
