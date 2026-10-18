import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { ShortError } from "./errors.ts";

type Parse<T> = (input: unknown) => { success: true; data: T } | { success: false; error: Error };

/** Reads a JSON file and checks it with a schema, explaining any problem as a ShortError. */
export async function readValidatedJson<T>(
  path: string,
  missingMessage: string,
  parse: Parse<T>,
): Promise<T> {
  if (!existsSync(path)) {
    throw new ShortError(missingMessage);
  }
  let input: unknown;
  try {
    input = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new ShortError(
      `${path} is not valid JSON. ${error instanceof Error ? error.message : ""}`,
    );
  }
  const result = parse(input);
  if (!result.success) {
    throw new ShortError(`${path} is not valid. ${result.error.message}`);
  }
  return result.data;
}
