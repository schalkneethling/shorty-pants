import { describe, expect, test } from "vite-plus/test";
import { planRelease } from "../../scripts/release-check.ts";

const ready = {
  ref: "refs/heads/main",
  version: "0.2.0",
  publishedVersions: ["0.1.0"],
  tagExists: false,
};

describe("planRelease", () => {
  test("releases a new version from main under the latest dist-tag", () => {
    expect(planRelease(ready)).toEqual({ ok: true, tag: "v0.2.0", distTag: "latest" });
  });

  test("releases a prerelease under the next dist-tag, so it never becomes latest", () => {
    expect(planRelease({ ...ready, version: "0.2.0-beta.1" })).toEqual({
      ok: true,
      tag: "v0.2.0-beta.1",
      distTag: "next",
    });
  });

  test("refuses to release from any ref but main", () => {
    const plan = planRelease({ ...ready, ref: "refs/heads/feat/publish" });
    expect(plan).toEqual({
      ok: false,
      problems: ["Releases run from main, and this run is on refs/heads/feat/publish."],
    });
  });

  test("refuses a version npm has already published", () => {
    const plan = planRelease({ ...ready, version: "0.1.0" });
    expect(plan).toEqual({
      ok: false,
      problems: [
        "npm already has version 0.1.0. Raise the version in package.json in a pull request first.",
      ],
    });
  });

  test("refuses a version whose tag already exists", () => {
    const plan = planRelease({ ...ready, tagExists: true });
    expect(plan).toEqual({
      ok: false,
      problems: ["The tag v0.2.0 already exists. Raise the version in package.json first."],
    });
  });

  test.each(["0.0.0", "1.2", "v1.2.3", "01.2.3", "1.2.3+build.5", ""])(
    "refuses the version %j",
    (version) => {
      const plan = planRelease({ ...ready, version });
      expect(plan.ok).toBe(false);
    },
  );

  test("lists every problem at once", () => {
    const plan = planRelease({
      ref: "refs/tags/v0.1.0",
      version: "0.1.0",
      publishedVersions: ["0.1.0"],
      tagExists: true,
    });
    expect(plan.ok === false && plan.problems).toHaveLength(3);
  });
});
