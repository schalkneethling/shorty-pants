/** A time in WebVTT form, such as 00:01:01.250. */
export function vttTimestamp(ms: number): string {
  const wholeMs = Math.round(ms);
  const hours = Math.floor(wholeMs / 3_600_000);
  const minutes = Math.floor((wholeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((wholeMs % 60_000) / 1000);
  const milliseconds = wholeMs % 1000;
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  return `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)}.${String(milliseconds).padStart(3, "0")}`;
}

/**
 * Cue text on one line. A blank line or an arrow would end the cue or be
 * read as its timing, so they are replaced.
 */
function cueText(text: string): string {
  return text.replaceAll("-->", "→").replace(/\s+/g, " ").trim();
}

/** captions.vtt: one cue per caption chunk, in short time. */
export function toWebVtt(cues: { startMs: number; endMs: number; text: string }[]): string {
  const blocks = cues.map(
    (cue, index) =>
      `${index + 1}\n${vttTimestamp(cue.startMs)} --> ${vttTimestamp(cue.endMs)}\n${cueText(cue.text)}\n`,
  );
  return `WEBVTT\n\n${blocks.join("\n")}`;
}

/** upload.txt: a title and description to paste into YouTube Studio. */
export function uploadText(input: { headline: string; spokenText: string }): string {
  return ["Title", input.headline, "", "Description", input.spokenText, "", "#Shorts", ""].join(
    "\n",
  );
}

/**
 * A list for FFmpeg's concat demuxer that shows each image for its duration.
 * The demuxer ignores the last duration unless the last file is listed again.
 */
export function toFfconcat(entries: { file: string; durationMs: number }[]): string {
  const lines = ["ffconcat version 1.0"];
  for (const entry of entries) {
    lines.push(`file '${entry.file}'`, `duration ${(entry.durationMs / 1000).toFixed(3)}`);
  }
  const lastEntry = entries.at(-1);
  if (lastEntry !== undefined) {
    lines.push(`file '${lastEntry.file}'`);
  }
  lines.push("");
  return lines.join("\n");
}
