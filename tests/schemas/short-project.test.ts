import { describe, expect, test } from "vite-plus/test";
import { parseShortProject } from "../../src/schemas/short-project.ts";

function validProject() {
  return {
    version: 1,
    takes: { cam: "takes/cam.webm", screen: "takes/screen.webm", screenOffsetMs: 42 },
    trim: { startMs: 1800, endMs: 61250 },
    removedWords: [
      [12, 19],
      [88, 90],
    ],
    pauseThresholdMs: 600,
    headline: { text: "Anchor positioning ignores scroll", accent: "scroll" },
    screenCrop: { x: 0, y: 96, width: 1280, height: 1024 },
    segments: [
      { fromWord: 0, layout: "face" },
      { fromWord: 24, layout: "split" },
    ],
  };
}

function issuePaths(input: unknown): string[] {
  const result = parseShortProject(input);
  if (result.success) {
    return [];
  }
  return result.error.issues.map((issue) => issue.path.join("."));
}

describe("parseShortProject", () => {
  test("accepts the example from the project brief", () => {
    const result = parseShortProject(validProject());
    expect(result.success).toBe(true);
  });

  test("accepts a short without a headline or screen crop, which are chosen after editing", () => {
    const { headline: _headline, screenCrop: _screenCrop, ...project } = validProject();
    expect(parseShortProject(project).success).toBe(true);
  });

  test("accepts a negative screen offset, because the screen can start first", () => {
    const project = validProject();
    project.takes.screenOffsetMs = -120;
    expect(parseShortProject(project).success).toBe(true);
  });

  test("rejects an unknown version", () => {
    const project = { ...validProject(), version: 2 };
    expect(issuePaths(project)).toContain("version");
  });

  test("rejects a trim end that comes before its start", () => {
    const project = validProject();
    project.trim = { startMs: 5000, endMs: 4000 };
    expect(issuePaths(project)).toContain("trim.endMs");
  });

  test("rejects a trim end equal to its start, because the short would be empty", () => {
    const project = validProject();
    project.trim = { startMs: 5000, endMs: 5000 };
    expect(issuePaths(project)).toContain("trim.endMs");
  });

  test("rejects a headline accent that is not a word in the headline", () => {
    const project = validProject();
    project.headline = { text: "Anchor positioning ignores scroll", accent: "position" };
    expect(issuePaths(project)).toContain("headline.accent");
  });

  test("matches the headline accent without regard to case", () => {
    const project = validProject();
    project.headline = { text: "Anchor positioning ignores Scroll", accent: "scroll" };
    expect(parseShortProject(project).success).toBe(true);
  });

  test("matches a headline accent whose lowercase form has a combining mark", () => {
    const project = validProject();
    project.headline = { text: "Visiting İstanbul with anchors", accent: "İstanbul" };
    expect(parseShortProject(project).success).toBe(true);
  });

  test("matches a headline accent written in a different Unicode normalization form", () => {
    const project = validProject();
    // "café" with a precomposed é in the text and a combining accent in the accent.
    project.headline = { text: "Anchor caf\u00e9", accent: "cafe\u0301" };
    expect(parseShortProject(project).success).toBe(true);
  });

  test("rejects an empty headline accent", () => {
    const project = validProject();
    project.headline = { text: "Anchor positioning ignores scroll", accent: "" };
    expect(issuePaths(project)).toContain("headline.accent");
  });

  test("rejects a removed word range whose end comes before its start", () => {
    const project = validProject();
    project.removedWords = [[19, 12]];
    expect(issuePaths(project)).toContain("removedWords.0");
  });

  test("rejects segments that do not start at the first word", () => {
    const project = validProject();
    project.segments = [{ fromWord: 3, layout: "split" }];
    expect(issuePaths(project)).toContain("segments.0.fromWord");
  });

  test("rejects overlapping segments that start at the same word", () => {
    const project = validProject();
    project.segments = [
      { fromWord: 0, layout: "face" },
      { fromWord: 10, layout: "split" },
      { fromWord: 10, layout: "circle" },
    ];
    expect(issuePaths(project)).toContain("segments.2.fromWord");
  });

  test("rejects segments that are out of order", () => {
    const project = validProject();
    project.segments = [
      { fromWord: 0, layout: "face" },
      { fromWord: 24, layout: "split" },
      { fromWord: 12, layout: "circle" },
    ];
    expect(issuePaths(project)).toContain("segments.2.fromWord");
  });

  test("rejects an unknown layout", () => {
    const project = validProject();
    project.segments = [{ fromWord: 0, layout: "picture-in-picture" }];
    expect(issuePaths(project)).toContain("segments.0.layout");
  });

  test("rejects a screen crop with no area", () => {
    const project = validProject();
    project.screenCrop = { x: 0, y: 0, width: 0, height: 1024 };
    expect(issuePaths(project)).toContain("screenCrop.width");
  });
});
