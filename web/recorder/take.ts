/** YouTube treats vertical videos of up to three minutes as Shorts. */
export const maximumTakeMs = 180_000;

export const cameraMimeTypes = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
export const screenMimeTypes = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

/**
 * The screen track's start relative to the camera track's, in whole
 * milliseconds. Negative when the screen recorder started first.
 */
export function screenOffsetMs(starts: {
  cameraStartedAt: number;
  screenStartedAt: number;
}): number {
  return Math.round(starts.screenStartedAt - starts.cameraStartedAt);
}

/** The first MIME type the browser can record, or null when there is none. */
export function pickMimeType(
  candidates: string[],
  isTypeSupported: (type: string) => boolean,
): string | null {
  return candidates.find((type) => isTypeSupported(type)) ?? null;
}

/** Reads the session token that the CLI puts in the page's URL fragment. */
export function readSessionToken(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token === null || token === "" ? null : token;
}
