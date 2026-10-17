import { describe, expect, test } from "vite-plus/test";
import {
  maximumTakeMs,
  pickMimeType,
  readSessionToken,
  screenOffsetMs,
} from "../../web/recorder/take.ts";

describe("screenOffsetMs", () => {
  test("is positive when the screen recorder started after the camera recorder", () => {
    expect(screenOffsetMs({ cameraStartedAt: 1000.2, screenStartedAt: 1042.6 })).toBe(42);
  });

  test("is negative when the screen recorder started first", () => {
    expect(screenOffsetMs({ cameraStartedAt: 1120, screenStartedAt: 1000 })).toBe(-120);
  });
});

describe("pickMimeType", () => {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

  test("returns the first type the browser can record", () => {
    const supported = new Set(["video/webm;codecs=vp8,opus", "video/webm"]);
    expect(pickMimeType(candidates, (type) => supported.has(type))).toBe(
      "video/webm;codecs=vp8,opus",
    );
  });

  test("returns null when the browser cannot record WebM", () => {
    expect(pickMimeType(candidates, () => false)).toBeNull();
  });
});

describe("readSessionToken", () => {
  test("reads the token from the URL fragment", () => {
    expect(readSessionToken("#token=abc_123-XYZ")).toBe("abc_123-XYZ");
  });

  test("returns null when the fragment has no token", () => {
    expect(readSessionToken("")).toBeNull();
    expect(readSessionToken("#token=")).toBeNull();
  });
});

test("a take is at most three minutes, the Shorts limit", () => {
  expect(maximumTakeMs).toBe(180_000);
});
