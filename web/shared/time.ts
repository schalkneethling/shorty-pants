/** Formats a duration as minutes and seconds, such as 0:42. */
export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** Formats a time with tenths of a second, such as 0:01.4. */
export function formatPrecise(milliseconds: number): string {
  const tenths = Math.floor((milliseconds % 1000) / 100);
  return `${formatElapsed(milliseconds)}.${tenths}`;
}
