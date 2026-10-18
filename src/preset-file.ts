import { existsSync } from "node:fs";
import { join } from "node:path";
import { readValidatedJson } from "./json-file.ts";
import { defaultPreset, parsePreset, type Preset } from "./schemas/preset.ts";

/** The preset in the shorts root, or the default preset when there is none. */
export async function readPreset(shortsRoot: string): Promise<Preset> {
  const presetPath = join(shortsRoot, "preset.json");
  if (!existsSync(presetPath)) {
    return defaultPreset;
  }
  return readValidatedJson(presetPath, `${presetPath} is missing.`, parsePreset);
}
