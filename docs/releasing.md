# Releasing

`@schalkneethling/shorty-pants` is published to npm by `.github/workflows/publish.yml` with trusted publishing. GitHub Actions signs in to npm through OpenID Connect (OIDC), so no npm token is stored in the repository, and npm attaches a provenance statement that links each version to the workflow run that built it.

npm can only set up trusted publishing for a package that already exists. The first version is therefore published by hand, and every version after it comes from the workflow.

## Before the first release

These settings live outside the repository, and each one is made once.

1. Turn on two-factor authentication for both the npm and the GitHub account, preferably with a security key.
2. Make the repository public. npm only generates provenance for packages published from a public repository.
3. Create the `publish` environment from the repository controls (see [repository-controls.md](repository-controls.md)). It allows only `main` to deploy, waits for a reviewer to approve each run, and sets the `RELEASE_GUARD` variable that the publish job checks. In **Settings → Environments → publish**, turn off administrator bypass, which the API cannot change.

## The first release, by hand

From an up-to-date `main` with a clean working tree:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm quality
pnpm build
pnpm package:check
pnpm publish
```

Use `pnpm publish` rather than `npm publish`: npm refuses to run in this project because `devEngines` names pnpm as its package manager. pnpm checks that the branch is `main` and the working tree is clean, packs the same files the workflow would, and asks for the npm one-time password. Then tag the release and push the tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

## Turning on trusted publishing

On npmjs.com, open the package's **Settings** tab and add a trusted publisher with these values:

| Field             | Value             |
| ----------------- | ----------------- |
| Provider          | GitHub Actions    |
| Organization/user | `schalkneethling` |
| Repository        | `shorty-pants`    |
| Workflow filename | `publish.yml`     |
| Environment       | `publish`         |
| Allowed action    | `npm publish`     |

On the same page, choose **Require two-factor authentication and disallow tokens**, so that a hand-published version also needs two-factor authentication.

## Every release after the first

1. Raise `version` in `package.json` in a pull request, and merge it once CI is green. A version with a prerelease part, such as `0.2.0-beta.1`, is published under the `next` dist-tag, so `npm install` keeps giving people the latest stable version.
2. In the **Actions** tab, choose **Publish**, then **Run workflow** on `main`.
3. The workflow runs the same checks as every pull request. It then checks that the version is new to npm and has no tag yet, builds and packs the package, installs the packed file, and runs `short --help` from it.
4. The publish job waits for approval in the `publish` environment. Approve it to publish the packed file to npm.
5. After npm accepts the version, the workflow creates the `v<version>` tag and a GitHub release with generated notes.

If the release job fails after npm has accepted the version, re-run only that job. Running the whole workflow again stops at the version check, because npm already has that version.

## A note on sole maintainers

GitHub environments cannot yet ask for two-factor authentication when a run is approved ([community discussion](https://github.com/orgs/community/discussions/174507)). Someone holding a stolen GitHub session could therefore approve a publish without a second factor. The required approval, the `main`-only rule and the disallowed tokens narrow that risk, but publishing by hand with `pnpm publish` stays available for anyone who prefers a two-factor prompt on every release.
