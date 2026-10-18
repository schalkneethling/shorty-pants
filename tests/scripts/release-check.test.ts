import { describe, expect, test } from "vite-plus/test";
import { hasExactTag, planRelease, publishedVersionsFrom } from "../../scripts/release-check.ts";

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

  test("refuses to publish before fledgling has claimed the name", () => {
    const plan = planRelease({ ...ready, publishedVersions: [] });
    expect(plan).toEqual({
      ok: false,
      problems: [
        "npm has no version of this package yet, so it cannot trust this workflow. Claim the name and set up trusted publishing with fledgling first, as docs/releasing.md describes.",
      ],
    });
  });

  test("releases the first real version over fledgling's 0.0.0 placeholder", () => {
    const plan = planRelease({ ...ready, version: "0.1.0", publishedVersions: ["0.0.0"] });
    expect(plan).toEqual({ ok: true, tag: "v0.1.0", distTag: "latest" });
  });

  test("refuses a stable version below the latest one, which would move latest back", () => {
    const plan = planRelease({ ...ready, version: "0.1.1", publishedVersions: ["0.1.0", "0.2.0"] });
    expect(plan).toEqual({
      ok: false,
      problems: [
        "0.1.1 is lower than 0.2.0, the latest version on npm, so publishing it would move the latest dist-tag back.",
      ],
    });
  });

  test("compares versions by number, not as text", () => {
    const plan = planRelease({ ...ready, version: "0.10.0", publishedVersions: ["0.9.0"] });
    expect(plan.ok).toBe(true);
  });

  test("ignores prereleases when finding the latest version", () => {
    const plan = planRelease({
      ...ready,
      version: "0.2.0",
      publishedVersions: ["0.1.0", "0.3.0-beta.1"],
    });
    expect(plan).toEqual({ ok: true, tag: "v0.2.0", distTag: "latest" });
  });

  test("allows a prerelease below the latest version, since it goes under next", () => {
    const plan = planRelease({ ...ready, version: "0.1.1-beta.1", publishedVersions: ["0.2.0"] });
    expect(plan).toEqual({ ok: true, tag: "v0.1.1-beta.1", distTag: "next" });
  });

  test.each([
    "0.0.0",
    "1.2",
    "v1.2.3",
    "01.2.3",
    "1.2.3+build.5",
    "1.0.0-01",
    "1.0.0-beta.01",
    "1.0.0-",
    "",
  ])("refuses the version %j", (version) => {
    const plan = planRelease({ ...ready, version });
    expect(plan.ok).toBe(false);
  });

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

describe("publishedVersionsFrom", () => {
  test("reads the list npm prints for several versions", () => {
    expect(publishedVersionsFrom('[\n  "0.1.0",\n  "0.2.0"\n]\n')).toEqual(["0.1.0", "0.2.0"]);
  });

  test("reads the single string npm prints when only one version exists", () => {
    expect(publishedVersionsFrom('"0.1.0"\n')).toEqual(["0.1.0"]);
  });
});

describe("hasExactTag", () => {
  test("finds the tag itself", () => {
    expect(hasExactTag([{ ref: "refs/tags/v0.2.0" }], "v0.2.0")).toBe(true);
  });

  test("ignores tags that only start with it", () => {
    expect(hasExactTag([{ ref: "refs/tags/v0.2.0-beta.1" }], "v0.2.0")).toBe(false);
  });
});
