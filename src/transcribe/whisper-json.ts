import { z } from "zod";
import type { TranscriptWord } from "../schemas/transcript.ts";

const offsetsSchema = z
  .object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() })
  .refine((offsets) => offsets.to >= offsets.from);

// Only the parts of whisper-cli's -ojf output that the transcript needs.
const whisperOutputSchema = z.object({
  transcription: z.array(
    z.object({
      text: z.string(),
      tokens: z
        .array(
          z.object({
            text: z.string(),
            // Offsets are in milliseconds from the start of the audio. A token
            // without its own times has none.
            offsets: offsetsSchema.optional(),
          }),
        )
        .optional(),
    }),
  ),
});

interface DraftWord {
  text: string;
  // The whisper segment the word came from; sound markers never span segments.
  segment: number;
  startMs?: number;
  endMs?: number;
}

// Tokens such as [_BEG_] and [_TT_150] mark positions, not speech.
const specialToken = /^\[_[^\]]*\]$/;
const hasLetterOrDigit = /[\p{L}\p{N}]/u;
const isOpeningPunctuation = /^[\p{Ps}\p{Pi}¿¡"']+$/u;
const isPunctuation = /^\p{P}+$/u;
const closingBracket: Record<string, string> = { "[": "]", "(": ")" };

/** Groups tokens into words: a token that starts with a space begins a new word. */
function groupTokens(segments: z.infer<typeof whisperOutputSchema>["transcription"]): DraftWord[] {
  const words: DraftWord[] = [];
  for (const [segmentIndex, segment] of segments.entries()) {
    let current: DraftWord | undefined;
    for (const token of segment.tokens ?? []) {
      if (specialToken.test(token.text)) {
        continue;
      }
      if (current === undefined || /^\s/.test(token.text)) {
        current = { text: "", segment: segmentIndex };
        words.push(current);
      }
      current.text += token.text;
      if (token.offsets !== undefined) {
        current.startMs ??= token.offsets.from;
        current.endMs = token.offsets.to;
      }
    }
  }
  return words
    .map((word) => ({ ...word, text: word.text.trim() }))
    .filter((word) => word.text !== "");
}

/**
 * Drops sound descriptions such as [BLANK_AUDIO] or (upbeat music). whisper
 * splits a description of several words into several words, so everything
 * from the opening bracket to the matching closing one is dropped.
 */
function dropSoundMarkers(words: DraftWord[]): DraftWord[] {
  const kept: DraftWord[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const closing = closingBracket[words[index]!.text[0] ?? ""];
    if (closing === undefined) {
      kept.push(words[index]!);
      continue;
    }
    const opening = words[index]!;
    const closingIndex = words.findIndex(
      (word, candidate) =>
        candidate >= index && word.segment === opening.segment && word.text.includes(closing),
    );
    if (closingIndex === -1) {
      kept.push(words[index]!);
      continue;
    }
    index = closingIndex;
  }
  return kept;
}

/**
 * Reads the words from whisper-cli JSON written with -ojf. Each word starts
 * at its first token and ends at its last, using the token times whisper
 * refines from the audio, so silences between words are kept as gaps.
 */
export function parseWhisperWords(input: unknown): TranscriptWord[] {
  const result = whisperOutputSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `The whisper-cli output is not in the expected format. ${result.error.message}`,
    );
  }
  const segments = result.data.transcription;
  const hasSegmentWithoutTokens = segments.some(
    (segment) => segment.tokens === undefined && segment.text.trim() !== "",
  );
  if (hasSegmentWithoutTokens) {
    throw new Error(
      "The whisper-cli output has no token times. Run whisper-cli with -ojf (full JSON output).",
    );
  }

  const draftWords = dropSoundMarkers(groupTokens(segments));
  const words: TranscriptWord[] = [];
  let openingPunctuation = "";

  for (const draft of draftWords) {
    const hasTimes = draft.startMs !== undefined && draft.endMs !== undefined;
    if (hasLetterOrDigit.test(draft.text) && hasTimes) {
      words.push({
        text: `${openingPunctuation}${draft.text}`,
        startMs: draft.startMs!,
        endMs: draft.endMs!,
      });
      openingPunctuation = "";
      continue;
    }
    if (!isPunctuation.test(draft.text) && !hasLetterOrDigit.test(draft.text)) {
      // Symbols such as ♪ describe music, not speech.
      continue;
    }

    // Punctuation, or a word without times, joins a neighbouring word
    // without changing that word's times.
    const previous = words.at(-1);
    if (isOpeningPunctuation.test(draft.text)) {
      openingPunctuation += draft.text;
    } else if (previous !== undefined) {
      previous.text += hasLetterOrDigit.test(draft.text) ? ` ${draft.text}` : draft.text;
    }
  }
  return words;
}
