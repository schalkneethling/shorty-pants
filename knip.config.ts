import calaveraConfig from "./knip.json" with { type: "json" };

// knip.json is generated and owned by Calavera, so project-specific settings
// extend it here instead of editing it. The browser pages are loaded from
// HTML files, which Knip does not read, so their scripts are listed as entries.
export default {
  ...calaveraConfig,
  entry: ["web/*/*.ts"],
};
