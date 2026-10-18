import type { CaptionChunk } from "../edit/captions.ts";
import type { KeepRange } from "../edit/cut-list.ts";
import { shortTimeMs } from "../edit/playback.ts";
import { layoutAtTime, layoutChanges } from "../edit/segments.ts";
import { frame } from "../schemas/frame.ts";
import type { Layout } from "../schemas/layout-names.ts";
import type { ShortProject } from "../schemas/short-project.ts";
import type { TranscriptWord } from "../schemas/transcript.ts";

const frameDurationMs = 1000 / frame.fps;

/** A stretch of the recordings, in camera time, that goes into the short with one layout. */
export interface RenderPiece {
  startMs: number;
  endMs: number;
  layout: Layout;
}

/** Splits the kept ranges where the layout changes. Pieces shorter than a frame are left out. */
export function renderPieces(input: {
  words: TranscriptWord[];
  keepRanges: KeepRange[];
  segments: ShortProject["segments"];
}): RenderPiece[] {
  const changes = layoutChanges(input.words, input.segments);

  const pieces: RenderPiece[] = [];
  for (const range of input.keepRanges) {
    const cutPoints = changes
      .map((change) => change.fromMs)
      .filter((ms) => ms > range.startMs && ms < range.endMs);
    const edges = [range.startMs, ...cutPoints, range.endMs];
    for (let index = 0; index < edges.length - 1; index += 1) {
      const startMs = edges[index]!;
      const endMs = edges[index + 1]!;
      const isLongEnoughForAFrame = endMs - startMs >= frameDurationMs;
      if (isLongEnoughForAFrame) {
        pieces.push({ startMs, endMs, layout: layoutAtTime(input.words, input.segments, startMs) });
      }
    }
  }
  return pieces;
}

/** One state of the captions: a chunk with one of its words lit, in short time. */
export interface CaptionCue {
  chunkIndex: number;
  wordIndex: number;
  startMs: number;
  endMs: number;
}

/**
 * The moments each word of each chunk is lit, in short time. A word stays
 * lit until the next word starts, and the last until the chunk leaves.
 */
export function captionCues(chunks: CaptionChunk[], keepRanges: KeepRange[]): CaptionCue[] {
  const cues: CaptionCue[] = [];
  chunks.forEach((chunk, chunkIndex) => {
    chunk.words.forEach((word, wordIndex) => {
      const isFirstWord = wordIndex === 0;
      const nextWord = chunk.words[wordIndex + 1];
      const startMs = shortTimeMs(keepRanges, isFirstWord ? chunk.startMs : word.startMs);
      const endMs = shortTimeMs(
        keepRanges,
        nextWord === undefined ? chunk.displayEndMs : nextWord.startMs,
      );
      if (endMs > startMs) {
        cues.push({ chunkIndex, wordIndex, startMs, endMs });
      }
    });
  });
  return cues;
}

/** An image in the caption sequence, or null for no caption, and how long it shows. */
export interface CaptionFrame {
  image: { chunkIndex: number; wordIndex: number } | null;
  durationMs: number;
}

/** The caption images from the start of the short to its end, with blanks between cues. */
export function captionFrames(cues: CaptionCue[], durationMs: number): CaptionFrame[] {
  const frames: CaptionFrame[] = [];
  let cursorMs = 0;
  for (const cue of cues) {
    const startMs = Math.max(cue.startMs, cursorMs);
    if (startMs > cursorMs) {
      frames.push({ image: null, durationMs: startMs - cursorMs });
    }
    if (cue.endMs > startMs) {
      frames.push({
        image: { chunkIndex: cue.chunkIndex, wordIndex: cue.wordIndex },
        durationMs: cue.endMs - startMs,
      });
      cursorMs = cue.endMs;
    }
  }
  if (durationMs > cursorMs) {
    frames.push({ image: null, durationMs: durationMs - cursorMs });
  }
  return frames;
}
