// Kept apart from the Zod schema, so the browser pages can use it without Zod.

// Normalizing first makes precomposed and combining forms of the same word
// compare equal. Lowercasing can add combining marks (İ becomes i plus a dot),
// so marks count as part of a word.
function normalizeWord(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase();
}

/** The words of a headline as written, which the accent must be one of. */
export function splitHeadlineWords(text: string): string[] {
  return text
    .normalize("NFC")
    .split(/[^\p{L}\p{M}\p{N}'-]+/u)
    .filter((word) => word !== "");
}

/** Whether two spellings are the same word, ignoring case. */
export function isSameWord(first: string, second: string): boolean {
  return normalizeWord(first) === normalizeWord(second);
}
