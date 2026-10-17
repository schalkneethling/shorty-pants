import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Commits need an identity, and CI runners do not have one configured.
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Test Author",
  GIT_COMMITTER_EMAIL: "author@example.com",
};

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, env: gitEnvironment, encoding: "utf8" }).trim();
}

export interface TestRepository {
  root: string;
  write: (relativePath: string, contents: string) => void;
  git: (args: string[]) => string;
  remove: () => void;
}

/** Creates a Git repository in a temporary folder with one commit on main. */
export function createTestRepository(): TestRepository {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "shorty-pants-")));
  const write = (relativePath: string, contents: string) => {
    writeFileSync(join(root, relativePath), contents);
  };

  git(root, ["init", "--quiet", "--initial-branch=main"]);
  write("demo.css", ".anchor { position: absolute; }\n");
  git(root, ["add", "demo.css"]);
  git(root, ["commit", "--quiet", "--message", "Initial commit"]);

  return {
    root,
    write,
    git: (args) => git(root, args),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

export { gitEnvironment };
