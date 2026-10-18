import { describe, expect, test } from "vite-plus/test";
import { accentChoices } from "../../web/editor/preview.ts";

describe("accentChoices", () => {
  test("lists the words of the headline as written", () => {
    expect(accentChoices("Anchor positioning ignores scroll!")).toEqual([
      "Anchor",
      "positioning",
      "ignores",
      "scroll",
    ]);
  });

  test("lists a word that appears twice only once, ignoring case", () => {
    expect(accentChoices("Scroll, then scroll again")).toEqual(["Scroll", "then", "again"]);
  });

  test("lists nothing for a headline without words", () => {
    expect(accentChoices(" !? ")).toEqual([]);
  });
});
