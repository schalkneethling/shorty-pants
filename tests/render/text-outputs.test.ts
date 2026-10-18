import { describe, expect, test } from "vite-plus/test";
import { toFfconcat, toWebVtt, uploadText, vttTimestamp } from "../../src/render/text-outputs.ts";

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

describe("toFfconcat", () => {
  test("lists each image with its duration in seconds, and repeats the last one", () => {
    expect(
      toFfconcat([
        { file: "blank.png", durationMs: 100 },
        { file: "caption-1-1.png", durationMs: 1250 },
      ]),
    ).toBe(
      [
        "ffconcat version 1.0",
        "file 'blank.png'",
        "duration 0.100",
        "file 'caption-1-1.png'",
        "duration 1.250",
        // The concat demuxer ignores the last duration without this.
        "file 'caption-1-1.png'",
        "",
      ].join("\n"),
    );
  });
});
