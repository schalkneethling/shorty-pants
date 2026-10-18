import type { Layout } from "../schemas/layout.ts";
import type { ShortProject } from "../schemas/short-project.ts";

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
