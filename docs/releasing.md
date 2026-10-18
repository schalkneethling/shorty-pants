# Releasing

`@schalkneethling/shorty-pants` is published to npm by `.github/workflows/publish.yml` with trusted publishing. GitHub Actions signs in to npm through OpenID Connect (OIDC), so no npm token is stored in the repository, and npm attaches a provenance statement that links each version to the workflow run that built it.

npm can only set up trusted publishing for a package that already exists. [fledgling](https://github.com/dmno-dev/fledgling) solves that once: it publishes a `0.0.0` placeholder to claim the name, then sets up the trusted publisher with npm's own `npm trust`. Every real version, 0.1.0 included, then comes from the workflow.

## Before the first release

These settings live outside the repository, and each one is made once.

1. Turn on two-factor authentication for both the npm and the GitHub account, preferably with a security key.
2. Make the repository public. npm only generates provenance for packages published from a public repository.
3. Create the `publish` environment from the repository controls (see [repository-controls.md](repository-controls.md)). It allows only `main` to deploy, waits for a reviewer to approve each run, and sets the `RELEASE_GUARD` variable that the publish job checks. In **Settings → Environments → publish**, turn off administrator bypass, which the API cannot change.

## Claiming the name and turning on trusted publishing

fledgling needs npm 11.15.0 or newer, so check `npm --version` first and run `npm install --global npm@latest` if it is older. Then sign in to npm and run fledgling from an empty temporary folder:

```sh
npm login
cd "$(mktemp -d)"
npx fledgling@1.3.1 add @schalkneethling/shorty-pants --new \
  --repo schalkneethling/shorty-pants --workflow publish.yml --env publish --dry-run
```

The dry run prints the plan: it would claim `@schalkneethling/shorty-pants@0.0.0` and trust `publish.yml` in the `publish` environment of `schalkneethling/shorty-pants`. When the plan is right, run the same command with `--yes` in place of `--dry-run`, and approve npm's two-factor prompts.

fledgling runs from a temporary folder, with every setting passed as a flag, because npm refuses to run inside this project: its `devEngines` names pnpm as the package manager, and npm stops every command there with `EBADDEVENGINES`. For the same reason, fledgling's own configuration block in `package.json` and `fledgling sync` cannot be used from the project folder.

Afterward, open the package's **Settings** tab on npmjs.com. Check that the trusted publisher lists `schalkneethling/shorty-pants`, `publish.yml` and the `publish` environment, then choose **Require two-factor authentication and disallow tokens**, so that a version published by hand also needs two-factor authentication.

## Releasing a version

1. Raise `version` in `package.json` in a pull request, and merge it once CI is green. A stable version has to be higher than the latest one on npm, because publishing a lower one would move the `latest` dist-tag back. A version with a prerelease part, such as `0.2.0-beta.1`, is published under the `next` dist-tag, so `npm install` keeps giving people the latest stable version.
2. In the **Actions** tab, choose **Publish**, then **Run workflow** on `main`.
3. The workflow runs the same checks as every pull request. It then checks that the version is new to npm and has no tag yet, builds and packs the package, installs the packed file, and runs `short --help` from it.
4. The publish job waits for approval in the `publish` environment. Approve it within 30 days, while the packed file is kept, to publish it to npm.
5. After npm accepts the version, the workflow creates the `v<version>` tag and a GitHub release with generated notes.

If the release job fails after npm has accepted the version, re-run only that job. Running the whole workflow again stops at the version check, because npm already has that version.

## A note on sole maintainers

GitHub environments cannot yet ask for two-factor authentication when a run is approved ([community discussion](https://github.com/orgs/community/discussions/174507)). Someone holding a stolen GitHub session could therefore approve a publish without a second factor. The required approval, the `main`-only rule and the disallowed tokens narrow that risk, but publishing by hand stays available for anyone who prefers a two-factor prompt on every release. Use `pnpm publish` from a clean `main` for that, not `npm publish`, which the `devEngines` setting blocks in this project, and push the `v<version>` tag afterward.
