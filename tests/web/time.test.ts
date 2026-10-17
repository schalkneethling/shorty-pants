import { describe, expect, test } from "vite-plus/test";
import { formatElapsed, formatPrecise } from "../../web/shared/time.ts";

describe("formatElapsed", () => {
  test("shows minutes and zero-padded seconds", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(42_900)).toBe("0:42");
    expect(formatElapsed(180_000)).toBe("3:00");
  });
});

describe("formatPrecise", () => {
  test("adds tenths of a second, for trim handles", () => {
    expect(formatPrecise(1450)).toBe("0:01.4");
    expect(formatPrecise(62_050)).toBe("1:02.0");
  });
});
