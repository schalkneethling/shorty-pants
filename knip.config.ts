import calaveraConfig from "./knip.json" with { type: "json" };

// knip.json is generated and owned by Calavera, so project-specific settings
// extend it here instead of editing it. The browser pages are loaded from
// HTML files, which Knip does not read, so their scripts are listed as entries.
export default {
  ...calaveraConfig,
  entry: ["web/*/*.ts"],
  // The font files are copied into dist-web by the pack step in
  // vite.config.ts, which names them by path rather than importing them.
  ignoreDependencies: ["@fontsource/noto-sans"],
  // System tools, installed with Homebrew or apt rather than from npm.
  ignoreBinaries: ["ffmpeg", "ffprobe"],
};
