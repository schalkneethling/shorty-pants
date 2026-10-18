import type { Preset } from "../schemas/preset.ts";
import type { TranscriptWord } from "../schemas/transcript.ts";
import type { KeepRange } from "./cut-list.ts";
import { shortTimeMs, wordIndexAt } from "./playback.ts";

export interface CaptionChunk {
  words: TranscriptWord[];
  startMs: number;
  endMs: number;
  // When the chunk leaves the screen; later than endMs when the next chunk
  // follows closely, so the captions do not flicker between chunks.
  displayEndMs: number;
}

type CaptionStyle = Pick<Preset["captions"], "wordsPerChunk" | "maxChunkCharacters">;

// A gap between two chunks that is this short keeps the first one on screen.
const captionHoldMs = 300;

/** Whether a word ends a sentence, such as "scroll." or "really?". */
function endsSentence(word: TranscriptWord): boolean {
  return /[.!?…]["')\]]*$/u.test(word.text);
}

function chunkText(words: TranscriptWord[]): string {
  return words.map((word) => word.text).join(" ");
}

/** Splits one sentence into chunks of at most wordsPerChunk words. */
function chunkSentence(sentence: TranscriptWord[], style: CaptionStyle): TranscriptWord[][] {
  const chunks: TranscriptWord[][] = [];
  for (const word of sentence) {
    const current = chunks.at(-1);
    const hasRoom =
      current !== undefined &&
      current.length < style.wordsPerChunk &&
      chunkText([...current, word]).length <= style.maxChunkCharacters;
    if (hasRoom) {
      current.push(word);
    } else {
      chunks.push([word]);
    }
  }

  // A last chunk of one word reads as an afterthought, so it takes the last
  // word of the chunk before it, when that still fits.
  const last = chunks.at(-1);
  const beforeLast = chunks.at(-2);
  const isLoneLastWord = last?.length === 1 && beforeLast !== undefined && beforeLast.length > 1;
  if (isLoneLastWord) {
    const movedWord = beforeLast.at(-1)!;
    const fitsWithMovedWord = chunkText([movedWord, ...last]).length <= style.maxChunkCharacters;
    if (fitsWithMovedWord) {
      beforeLast.pop();
      last.unshift(movedWord);
    }
  }
  return chunks;
}

/**
 * Groups the kept words into the chunks of text the captions show one at a
 * time. With the keep ranges, the gap between two chunks is measured in the
 * short, where cut pauses take no time.
 */
export function chunkCaptions(
  words: TranscriptWord[],
  style: CaptionStyle,
  keepRanges?: KeepRange[],
): CaptionChunk[] {
  const toShortMs = (ms: number) => (keepRanges === undefined ? ms : shortTimeMs(keepRanges, ms));
  const sentences: TranscriptWord[][] = [[]];
  for (const word of words) {
    sentences.at(-1)!.push(word);
    if (endsSentence(word)) {
      sentences.push([]);
    }
  }

  const groups = sentences.flatMap((sentence) => chunkSentence(sentence, style));
  return groups.map((group, index) => {
    const startMs = group[0]!.startMs;
    const endMs = group.at(-1)!.endMs;
    const nextStartMs = groups[index + 1]?.[0]?.startMs;
    const isNextClose =
      nextStartMs !== undefined && toShortMs(nextStartMs) - toShortMs(endMs) <= captionHoldMs;
    return {
      words: group,
      startMs,
      endMs,
      displayEndMs: isNextClose ? nextStartMs : endMs,
    };
  });
}

/** The words that stay in the short: those whose middle is inside a kept range. */
export function keptWords(words: TranscriptWord[], keepRanges: KeepRange[]): TranscriptWord[] {
  return words.filter((word) => {
    const middleMs = (word.startMs + word.endMs) / 2;
    return keepRanges.some((range) => middleMs >= range.startMs && middleMs <= range.endMs);
  });
}

/** The chunk on screen at a moment, and which of its words is being said. */
export function captionAt(
  chunks: CaptionChunk[],
  ms: number,
): { chunk: CaptionChunk; wordIndex: number } | null {
  const chunk = chunks.find((candidate) => ms >= candidate.startMs && ms < candidate.displayEndMs);
  if (chunk === undefined) {
    return null;
  }
  return { chunk, wordIndex: wordIndexAt(chunk.words, ms) };
}
