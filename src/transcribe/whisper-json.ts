import { z } from "zod";
import type { TranscriptWord } from "../schemas/transcript.ts";

// Only the parts of whisper-cli's JSON output that the transcript needs.
const whisperOutputSchema = z.object({
  transcription: z.array(
    z.object({
      // Offsets are in milliseconds from the start of the audio.
      offsets: z
        .object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() })
        .refine((offsets) => offsets.to >= offsets.from),
      text: z.string(),
    }),
  ),
});

// Markers such as [BLANK_AUDIO] or (music) describe sound, not speech.
const nonSpeechMarker = /^(\[.*\]|\(.*\))$/;
const hasLetterOrDigit = /[\p{L}\p{N}]/u;

/**
 * Reads the words from whisper-cli JSON produced with -oj -ml 1 -sow, where
 * every segment is one word. Punctuation that whisper puts in a segment of
 * its own is attached to the word before it.
 */
export function parseWhisperWords(input: unknown): TranscriptWord[] {
  const result = whisperOutputSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `The whisper-cli output is not in the expected format. ${result.error.message}`,
    );
  }

  const words: TranscriptWord[] = [];
  for (const segment of result.data.transcription) {
    const text = segment.text.trim();
    if (text === "" || nonSpeechMarker.test(text)) {
      continue;
    }

    const previous = words.at(-1);
    const isPunctuationOnly = !hasLetterOrDigit.test(text);
    if (isPunctuationOnly && previous !== undefined) {
      previous.text += text;
      previous.endMs = Math.max(previous.endMs, segment.offsets.to);
      continue;
    }

    words.push({ text, startMs: segment.offsets.from, endMs: segment.offsets.to });
  }
  return words;
}
