import { describe, expect, test } from "vite-plus/test";
import {
  imageConcatList,
  videoConcatList,
  toWebVtt,
  uploadText,
  vttTimestamp,
} from "../../src/render/text-outputs.ts";

describe("vttTimestamp", () => {
  test("writes hours, minutes, seconds and milliseconds", () => {
    expect(vttTimestamp(0)).toBe("00:00:00.000");
    expect(vttTimestamp(61_250)).toBe("00:01:01.250");
    expect(vttTimestamp(3_723_004)).toBe("01:02:03.004");
  });
});

describe("toWebVtt", () => {
  test("writes one numbered cue per caption chunk", () => {
    expect(
      toWebVtt([
        { startMs: 100, endMs: 1200, text: "Anchor positioning" },
        { startMs: 1200, endMs: 2700, text: "ignores the scroll" },
      ]),
    ).toBe(
      [
        "WEBVTT",
        "",
        "1",
        "00:00:00.100 --> 00:00:01.200",
        "Anchor positioning",
        "",
        "2",
        "00:00:01.200 --> 00:00:02.700",
        "ignores the scroll",
        "",
      ].join("\n"),
    );
  });

  test("keeps a cue from ending its block early when its text has an arrow or a blank line", () => {
    const vtt = toWebVtt([{ startMs: 0, endMs: 500, text: "a --> b\n\nc" }]);
    expect(vtt).toContain("a → b c");
  });
});

describe("uploadText", () => {
  test("suggests the headline as the title and the kept words as the description", () => {
    expect(
      uploadText({
        headline: "Anchor positioning ignores scroll",
        spokenText: "It ignores the scroll.",
      }),
    ).toBe(
      [
        "Title",
        "Anchor positioning ignores scroll",
        "",
        "Description",
        "It ignores the scroll.",
        "",
        "#Shorts",
        "",
      ].join("\n"),
    );
  });
});

describe("imageConcatList", () => {
  test("lists each image with its duration in seconds, and repeats the last one", () => {
    expect(
      imageConcatList([
        { file: "blank.png", durationMs: 100 },
        { file: "caption-1-1.png", durationMs: 1250 },
      ]),
    ).toBe(
      [
        "ffconcat version 1.0",
        "file 'blank.png'",
        "duration 0.100000",
        "file 'caption-1-1.png'",
        "duration 1.250000",
        // The concat demuxer ignores the last duration without this.
        "file 'caption-1-1.png'",
        "",
      ].join("\n"),
    );
  });

  test("quotes a file name with an apostrophe so the demuxer reads it whole", () => {
    expect(imageConcatList([{ file: "it's.png", durationMs: 100 }])).toContain(
      "file 'it'\\''s.png'",
    );
  });
});

describe("videoConcatList", () => {
  test("gives each video its exact length, to the microsecond, and plays the last one once", () => {
    // 28 frames at 30 per second.
    expect(
      videoConcatList([
        { file: "piece-0.nut", durationMs: (28 * 1000) / 30 },
        { file: "piece-1.nut", durationMs: 1000 },
      ]),
    ).toBe(
      [
        "ffconcat version 1.0",
        "file 'piece-0.nut'",
        "duration 0.933333",
        "file 'piece-1.nut'",
        "duration 1.000000",
        "",
      ].join("\n"),
    );
  });
});
