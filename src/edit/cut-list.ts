import type { TranscriptWord } from "../schemas/transcript.ts";

/** How much sound to keep around each word, so cuts never clip a syllable. */
export const defaultWordPaddingMs = 100;

export interface KeepRange {
  startMs: number;
  endMs: number;
}

export interface CutListInput {
  words: TranscriptWord[];
  trim: KeepRange;
  // Inclusive ranges of word indexes, such as [12, 19].
  removedWords: [number, number][];
  // Silences between two kept words that are longer than this are cut.
  // Padding on both sides is kept, so a pause shorter than twice the padding
  // is never cut, whatever the threshold.
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

/** Cuts the time of every removed word out of the ranges, wherever padding put it back. */
function subtractRemovedWords(ranges: KeepRange[], removedWords: TranscriptWord[]): KeepRange[] {
  let remaining = ranges;
  for (const word of removedWords) {
    remaining = remaining.flatMap((range) => {
      const isOverlapping = range.startMs < word.endMs && range.endMs > word.startMs;
      if (!isOverlapping) {
        return [range];
      }
      return [
        { startMs: range.startMs, endMs: word.startMs },
        { startMs: word.endMs, endMs: range.endMs },
      ].filter((piece) => piece.endMs > piece.startMs);
    });
  }
  return remaining;
}

/**
 * Turns the transcript and the edit decisions into the parts of the
 * recording to keep, in camera-track time. Removed words and pauses longer
 * than the threshold are cut. The trim handles decide the start and end: the
 * silence between a handle and the nearest word inside the trim is kept,
 * unless a removed word sits between them.
 */
export function computeKeepRanges(input: CutListInput): KeepRange[] {
  const { words, trim, pauseThresholdMs } = input;
  const paddingMs = input.paddingMs ?? defaultWordPaddingMs;
  const removed = removedIndexes(input.removedWords, words.length);

  const isInsideTrim = (word: TranscriptWord) =>
    word.endMs > trim.startMs && word.startMs < trim.endMs;
  const indexesInsideTrim = words.flatMap((word, index) => (isInsideTrim(word) ? [index] : []));

  // A trim without words, such as a silent demo, is kept as it is.
  if (indexesInsideTrim.length === 0) {
    return trim.endMs > trim.startMs ? [{ ...trim }] : [];
  }

  const keptIndexes = indexesInsideTrim.filter((index) => !removed.has(index));
  if (keptIndexes.length === 0) {
    return [];
  }

  const ranges: KeepRange[] = [];
  let previousKeptIndex = -1;
  for (const index of keptIndexes) {
    const word = words[index]!;
    const previousWord = words[index - 1];
    const followsPreviousWord = previousKeptIndex === index - 1 && previousWord !== undefined;
    const isShortPause =
      followsPreviousWord && word.startMs - previousWord.endMs <= pauseThresholdMs;

    const current = ranges.at(-1);
    if (isShortPause && current !== undefined) {
      current.endMs = Math.max(current.endMs, word.endMs + paddingMs);
    } else {
      ranges.push({ startMs: word.startMs - paddingMs, endMs: word.endMs + paddingMs });
    }
    previousKeptIndex = index;
  }

  // The edges reach the trim handles when nothing removed lies in between.
  if (keptIndexes[0] === indexesInsideTrim[0]) {
    ranges[0]!.startMs = trim.startMs;
  }
  if (keptIndexes.at(-1) === indexesInsideTrim.at(-1)) {
    ranges.at(-1)!.endMs = trim.endMs;
  }

  const removedWords = [...removed].map((index) => words[index]!);
  const clipped = mergeOverlapping(ranges).map((range) => ({
    startMs: Math.max(range.startMs, trim.startMs, 0),
    endMs: Math.min(range.endMs, trim.endMs),
  }));
  return subtractRemovedWords(clipped, removedWords).filter((range) => range.endMs > range.startMs);
}

/**
 * The trim an editor starts with: from just before the first word to just
 * after the last, or the whole recording when nobody speaks.
 */
export function defaultTrim(
  transcript: { words: TranscriptWord[]; durationMs: number },
  paddingMs = defaultWordPaddingMs,
): KeepRange {
  const firstWord = transcript.words[0];
  const lastWord = transcript.words.at(-1);
  if (firstWord === undefined || lastWord === undefined) {
    return { startMs: 0, endMs: transcript.durationMs };
  }
  return {
    startMs: Math.max(0, firstWord.startMs - paddingMs),
    endMs: Math.min(transcript.durationMs, lastWord.endMs + paddingMs),
  };
}
