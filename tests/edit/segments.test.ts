import { describe, expect, test } from "vite-plus/test";
import { applyLayout, layoutAtTime, layoutAtWord } from "../../src/edit/segments.ts";

describe("layoutAtWord", () => {
  const segments = [
    { fromWord: 0, layout: "face" as const },
    { fromWord: 4, layout: "split" as const },
  ];

  test("uses the segment that the word falls in", () => {
    expect(layoutAtWord(segments, 0)).toBe("face");
    expect(layoutAtWord(segments, 3)).toBe("face");
    expect(layoutAtWord(segments, 4)).toBe("split");
    expect(layoutAtWord(segments, 99)).toBe("split");
  });
});

describe("applyLayout", () => {
  const allSplit = [{ fromWord: 0, layout: "split" as const }];

  test("gives a range of words in the middle its own segment", () => {
    expect(applyLayout(allSplit, { fromWord: 3, toWord: 5 }, "face", 10)).toEqual([
      { fromWord: 0, layout: "split" },
      { fromWord: 3, layout: "face" },
      { fromWord: 6, layout: "split" },
    ]);
  });

  test("changes the layout of the first words without a second segment at 0", () => {
    expect(applyLayout(allSplit, { fromWord: 0, toWord: 2 }, "circle", 10)).toEqual([
      { fromWord: 0, layout: "circle" },
      { fromWord: 3, layout: "split" },
    ]);
  });

  test("runs to the end when the range ends on the last word", () => {
    expect(applyLayout(allSplit, { fromWord: 7, toWord: 9 }, "face", 10)).toEqual([
      { fromWord: 0, layout: "split" },
      { fromWord: 7, layout: "face" },
    ]);
  });

  test("joins neighboring segments that end up with the same layout", () => {
    const segments = [
      { fromWord: 0, layout: "split" as const },
      { fromWord: 3, layout: "face" as const },
      { fromWord: 6, layout: "split" as const },
    ];
    expect(applyLayout(segments, { fromWord: 3, toWord: 5 }, "split", 10)).toEqual(allSplit);
  });

  test("keeps the segments as they are when the layout does not change", () => {
    expect(applyLayout(allSplit, { fromWord: 2, toWord: 4 }, "split", 10)).toEqual(allSplit);
  });

  test("keeps one segment when the transcript has no words", () => {
    expect(applyLayout(allSplit, { fromWord: 0, toWord: 0 }, "face", 0)).toEqual([
      { fromWord: 0, layout: "face" },
    ]);
  });
});

describe("layoutAtTime", () => {
  const words = [
    { text: "Anchor", startMs: 300, endMs: 700 },
    { text: "positioning", startMs: 800, endMs: 1300 },
    { text: "ignores", startMs: 1400, endMs: 1800 },
  ];
  const segments = [
    { fromWord: 0, layout: "split" as const },
    { fromWord: 2, layout: "face" as const },
  ];

  test("switches layout where the padding before the segment's first word starts", () => {
    expect(layoutAtTime(words, segments, 1299)).toBe("split");
    expect(layoutAtTime(words, segments, 1300)).toBe("face");
    expect(layoutAtTime(words, segments, 0)).toBe("split");
  });
});
