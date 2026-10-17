import type { TranscriptWord } from "../schemas/transcript.ts";

/** How much sound to keep around each word, so cuts never clip a syllable. */
export const defaultWordPaddingMs = 100;

export interface KeepRange {
  startMs: number;
  endMs: number;
}

export interface CutListInput {
  words: TranscriptWord[];
  trim: { startMs: number; endMs: number };
  // Inclusive ranges of word indexes, such as [12, 19].
  removedWords: [number, number][];
  // Silences between two kept words that are longer than this are cut.
  pauseThresholdMs: number;
  paddingMs?: number;
}

function removedIndexes(removedWords: [number, number][], wordCount: number): Set<number> {
  const removed = new Set<number>();
  for (const [fromWord, toWord] of removedWords) {
    for (let index = fromWord; index <= Math.min(toWord, wordCount - 1); index += 1) {
      removed.add(index);
    }
  }
  return removed;
}

function mergeOverlapping(ranges: KeepRange[]): KeepRange[] {
  const merged: KeepRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous !== undefined && range.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, range.endMs);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

/**
 * Turns the transcript and the edit decisions into the parts of the
 * recording to keep, in camera-track time. Words outside the trim or in a
 * removed range are dropped, and so are pauses longer than the threshold
 * and the silence before the first and after the last kept word.
 */
export function computeKeepRanges(input: CutListInput): KeepRange[] {
  const { words, trim, pauseThresholdMs } = input;
  const paddingMs = input.paddingMs ?? defaultWordPaddingMs;
  const removed = removedIndexes(input.removedWords, words.length);

  const isInsideTrim = (word: TranscriptWord) =>
    word.endMs > trim.startMs && word.startMs < trim.endMs;
  const isKept = (index: number) => !removed.has(index) && isInsideTrim(words[index]!);

  const ranges: KeepRange[] = [];
  let previousKeptIndex = -1;

  words.forEach((word, index) => {
    if (!isKept(index)) {
      return;
    }

    // Padding stops where a removed word begins or ends, so none of it is heard.
    const previousWord = words[index - 1];
    const nextWord = words[index + 1];
    let startMs = word.startMs - paddingMs;
    if (previousWord !== undefined && removed.has(index - 1)) {
      startMs = Math.min(Math.max(startMs, previousWord.endMs), word.startMs);
    }
    let endMs = word.endMs + paddingMs;
    if (nextWord !== undefined && removed.has(index + 1)) {
      endMs = Math.max(Math.min(endMs, nextWord.startMs), word.endMs);
    }
    startMs = Math.max(startMs, trim.startMs, 0);
    endMs = Math.min(endMs, trim.endMs);

    const followsPreviousWord = previousKeptIndex === index - 1 && previousWord !== undefined;
    const isShortPause =
      followsPreviousWord && word.startMs - previousWord.endMs <= pauseThresholdMs;
    const current = ranges.at(-1);
    if (isShortPause && current !== undefined) {
      current.endMs = Math.max(current.endMs, endMs);
    } else {
      ranges.push({ startMs, endMs });
    }
    previousKeptIndex = index;
  });

  return mergeOverlapping(ranges).filter((range) => range.endMs > range.startMs);
}
