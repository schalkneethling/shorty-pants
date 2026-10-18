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

// major.minor.patch with an optional prerelease such as -beta.1. Build
// metadata (+build.5) is refused, because npm ignores it when comparing
// versions, so 1.0.0+a and 1.0.0+b would be the same release.
const releasableVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

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

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  // npm 11 refuses to publish a prerelease without a dist-tag, so that it
  // never becomes the version people get from a plain install.
  const isPrerelease = version.includes("-");
  return { ok: true, tag, distTag: isPrerelease ? "next" : "latest" };
}

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
    const versions: unknown = JSON.parse(run("npm", ["view", packageName, "versions", "--json"]));
    // npm prints a single string when only one version exists.
    return Array.isArray(versions) ? versions.map(String) : [String(versions)];
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
  // matching-refs answers with an empty list instead of a 404, and matches by
  // prefix, so v0.2.0 also finds v0.2.0-beta.1 and needs the exact check.
  const refs: { ref: string }[] = JSON.parse(
    run("gh", ["api", `repos/${repository}/git/matching-refs/tags/${tag}`]),
  );
  return refs.some((ref) => ref.ref === `refs/tags/${tag}`);
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. This script runs in GitHub Actions.`);
  }
  return value;
}

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
