import { describe, expect, test } from "vite-plus/test";
import { createDatedId } from "../src/dated-id.ts";

const date = new Date(2026, 9, 17, 13, 45);

describe("createDatedId", () => {
  test("combines the date with a slug of the title", () => {
    expect(createDatedId("Anchor positioning ignores scroll", date, [])).toBe(
      "2026-10-17-anchor-positioning-ignores-scroll",
    );
  });

  test("removes accents and punctuation", () => {
    expect(createDatedId("Café: why does :has() break?!", date, [])).toBe(
      "2026-10-17-cafe-why-does-has-break",
    );
  });

  test("shortens long titles at a word boundary", () => {
    const id = createDatedId(
      "A very long title about container queries and style queries and everything else",
      date,
      [],
    );
    expect(id).toBe("2026-10-17-a-very-long-title-about-container-queries-and");
  });

  test("falls back to note when the title has no letters or digits", () => {
    expect(createDatedId("!!!", date, [])).toBe("2026-10-17-note");
  });

  test("adds a number when the id is already taken", () => {
    const existing = ["2026-10-17-scroll", "2026-10-17-scroll-2"];
    expect(createDatedId("Scroll", date, existing)).toBe("2026-10-17-scroll-3");
  });
});
