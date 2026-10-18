// Checks that the version in package.json can be released, before the publish
// workflow builds or publishes anything. Run by .github/workflows/publish.yml.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

export interface ReleaseCandidate {
  // The Git ref the workflow runs on, such as refs/heads/main.
  ref: string;
  version: string;
  publishedVersions: string[];
  tagExists: boolean;
}

export type ReleasePlan =
  | { ok: true; tag: string; distTag: "latest" | "next" }
  | { ok: false; problems: string[] };

const releaseRef = "refs/heads/main";

// One part of a prerelease, such as beta or 1 in -beta.1. Semver forbids
// leading zeros in a numeric part, so 01 is refused while 0a is allowed.
const prereleasePart = String.raw`(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;

// major.minor.patch with an optional prerelease such as -beta.1. Build
// metadata (+build.5) is refused, because npm ignores it when comparing
// versions, so 1.0.0+a and 1.0.0+b would be the same release.
const releasableVersion = new RegExp(
  String.raw`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-${prereleasePart}(\.${prereleasePart})*)?$`,
);

/** Whether a version has a prerelease part, such as -beta.1. */
function isPrerelease(version: string): boolean {
  return version.includes("-");
}

/** Orders two stable major.minor.patch versions by their numbers. */
function compareStableVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (const [index, leftPart] of leftParts.entries()) {
    const difference = leftPart - rightParts[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/** The highest stable version, which npm's latest dist-tag points to. */
function latestStableVersion(versions: string[]): string | undefined {
  return versions
    .filter((version) => !isPrerelease(version))
    .toSorted(compareStableVersions)
    .at(-1);
}

/** Decides whether a version can be released, and under which npm dist-tag. */
export function planRelease(candidate: ReleaseCandidate): ReleasePlan {
  const { ref, version, publishedVersions, tagExists } = candidate;
  const tag = `v${version}`;
  const problems: string[] = [];

  const isOnReleaseRef = ref === releaseRef;
  if (!isOnReleaseRef) {
    problems.push(`Releases run from main, and this run is on ${ref}.`);
  }

  const isWellFormed = releasableVersion.test(version);
  const isPlaceholder = version === "0.0.0";
  if (!isWellFormed || isPlaceholder) {
    problems.push(
      `${JSON.stringify(version)} is not a version to release. Use major.minor.patch, such as 0.2.0, or a prerelease such as 0.2.0-beta.1.`,
    );
  }

  const isAlreadyPublished = publishedVersions.includes(version);
  if (isAlreadyPublished) {
    problems.push(
      `npm already has version ${version}. Raise the version in package.json in a pull request first.`,
    );
  }

  if (tagExists) {
    problems.push(`The tag ${tag} already exists. Raise the version in package.json first.`);
  }

  // npm can only trust this workflow once the package exists, so the first
  // version would fail at the publish step, after the approval.
  const isUnpublished = publishedVersions.length === 0;
  if (isUnpublished) {
    problems.push(
      "npm has no version of this package yet. Publish the first release by hand, as docs/releasing.md describes, then turn on trusted publishing.",
    );
  }

  // npm only guards against moving latest backwards when the dist-tag is
  // implicit, and this workflow always passes one.
  const latest = latestStableVersion(publishedVersions);
  const wouldMoveLatestBack =
    isWellFormed &&
    !isPrerelease(version) &&
    latest !== undefined &&
    !isAlreadyPublished &&
    compareStableVersions(version, latest) < 0;
  if (wouldMoveLatestBack) {
    problems.push(
      `${version} is lower than ${latest}, the latest version on npm, so publishing it would move the latest dist-tag back.`,
    );
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  // npm 11 refuses to publish a prerelease without a dist-tag, so that it
  // never becomes the version people get from a plain install.
  return { ok: true, tag, distTag: isPrerelease(version) ? "next" : "latest" };
}

/** Reads the output of npm view <package> versions --json. */
export function publishedVersionsFrom(output: string): string[] {
  const versions: unknown = JSON.parse(output);
  // npm prints a single string when only one version exists.
  return Array.isArray(versions) ? versions.map(String) : [String(versions)];
}

/** Whether a list of matching refs from the GitHub API holds this exact tag. */
export function hasExactTag(refs: { ref: string }[], tag: string): boolean {
  // matching-refs matches by prefix, so v0.2.0 also finds v0.2.0-beta.1.
  return refs.some((ref) => ref.ref === `refs/tags/${tag}`);
}

/** Runs a command and returns what it printed. */
function run(command: string, args: string[]): string {
  // npm refuses to run inside this project, whose devEngines names pnpm, so
  // every command runs from the temporary folder instead.
  return execFileSync(command, args, {
    cwd: tmpdir(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Every version of the package on npm, or none before its first release. */
function readPublishedVersions(packageName: string): string[] {
  try {
    return publishedVersionsFrom(run("npm", ["view", packageName, "versions", "--json"]));
  } catch (error) {
    // With encoding set, execFileSync attaches the output as a string.
    const output = (error as { stdout?: string }).stdout ?? "";
    const isUnpublished = output.includes("E404");
    if (isUnpublished) {
      return [];
    }
    throw error;
  }
}

/** Whether the repository already has this exact tag. */
function readTagExists(repository: string, tag: string): boolean {
  // matching-refs answers with an empty list instead of a 404.
  const refs: { ref: string }[] = JSON.parse(
    run("gh", ["api", `repos/${repository}/git/matching-refs/tags/${tag}`]),
  );
  return hasExactTag(refs, tag);
}

/** Reads a variable GitHub Actions sets, and fails clearly without it. */
function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. This script runs in GitHub Actions.`);
  }
  return value;
}

/** Checks the version in package.json and hands the plan to the workflow. */
function main() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const version = String(packageJson.version);
  const plan = planRelease({
    ref: requireEnvironment("GITHUB_REF"),
    version,
    publishedVersions: readPublishedVersions(packageJson.name),
    tagExists: readTagExists(requireEnvironment("GITHUB_REPOSITORY"), `v${version}`),
  });

  if (!plan.ok) {
    for (const problem of plan.problems) {
      console.error(`::error::${problem}`);
    }
    process.exit(1);
  }
  console.log(`Releasing ${packageJson.name}@${version} as ${plan.tag} under ${plan.distTag}.`);
  appendFileSync(
    requireEnvironment("GITHUB_OUTPUT"),
    `version=${version}\ntag=${plan.tag}\ndist-tag=${plan.distTag}\n`,
  );
}

if (import.meta.main) {
  main();
}
