/**
 * An error with a message written for the person running the CLI. The CLI
 * prints its message without a stack trace.
 */
export class ShortError extends Error {
  override name = "ShortError";
}
