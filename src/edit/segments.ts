import type { Layout } from "../schemas/layout-names.ts";
import type { ShortProject } from "../schemas/short-project.ts";
import type { TranscriptWord } from "../schemas/transcript.ts";
import { defaultWordPaddingMs } from "./cut-list.ts";

type Segments = ShortProject["segments"];

/** The layout of the segment that a word falls in. */
export function layoutAtWord(segments: Segments, wordIndex: number): Layout {
  let layout = segments[0]!.layout;
  for (const segment of segments) {
    if (segment.fromWord > wordIndex) {
      break;
    }
    layout = segment.layout;
  }
  return layout;
}

/**
 * Gives an inclusive range of words a layout. The words after the range keep
 * the layout they had, and neighboring segments with the same layout are
 * joined, so the result never has two segments in a row with one layout.
 */
export function applyLayout(
  segments: Segments,
  range: { fromWord: number; toWord: number },
  layout: Layout,
  wordCount: number,
): Segments {
  if (wordCount === 0) {
    return [{ fromWord: 0, layout }];
  }

  // Working word by word keeps the rules simple: set the range, then group
  // the words back into segments.
  const layouts = Array.from({ length: wordCount }, (_, index) => layoutAtWord(segments, index));
  for (let index = range.fromWord; index <= Math.min(range.toWord, wordCount - 1); index += 1) {
    layouts[index] = layout;
  }

  const result: Segments = [];
  layouts.forEach((wordLayout, index) => {
    const isNewLayout = result.at(-1)?.layout !== wordLayout;
    if (isNewLayout) {
      result.push({ fromWord: index, layout: wordLayout });
    }
  });
  return result;
}

/**
 * When each layout segment starts, in camera time. A segment starts with the
 * padding kept before its first word, but never before the previous word ends.
 */
export function layoutChanges(
  words: TranscriptWord[],
  segments: Segments,
): { fromMs: number; layout: Layout }[] {
  return segments.flatMap((segment) => {
    if (segment.fromWord === 0) {
      return [{ fromMs: 0, layout: segment.layout }];
    }
    const word = words[segment.fromWord];
    const previousWord = words[segment.fromWord - 1];
    if (word === undefined || previousWord === undefined) {
      return [];
    }
    const fromMs = Math.max(previousWord.endMs, word.startMs - defaultWordPaddingMs);
    return [{ fromMs, layout: segment.layout }];
  });
}

/** The layout at a moment in camera time, the same moment the render switches. */
export function layoutAtTime(words: TranscriptWord[], segments: Segments, ms: number): Layout {
  const changes = layoutChanges(words, segments);
  return changes.filter((change) => change.fromMs <= ms).at(-1)?.layout ?? segments[0]!.layout;
}
