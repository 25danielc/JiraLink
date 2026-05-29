// scripts/publish.js — the publisher.
//
// Commits the rendered Markdown + updated state, then pushes. GitBook Git Sync
// picks up the push and updates the changelog. If nothing changed, it's a clean
// no-op (safe to run repeatedly — that's the whole idempotency story).
//
// In GitHub Actions, actions/checkout already configured an authenticated
// remote (push needs `permissions: contents: write`). The remote can still move
// under us between checkout and push — GitBook Git Sync pushes back to `main`,
// and repository_dispatch checks out a possibly-stale SHA — so the push below
// rebases-and-retries on a non-fast-forward rejection rather than failing.

import { execSync } from "node:child_process";
import { config } from "../config.js";

function git(args, opts = {}) {
  return execSync(`git ${args}`, { stdio: "pipe", encoding: "utf8", ...opts }).trim();
}

// The branch we're publishing to (the checked-out branch in CI).
const branch = git("rev-parse --abbrev-ref HEAD");

// Identity for the bot commit.
git(`config user.name "${config.gitUserName}"`);
git(`config user.email "${config.gitUserEmail}"`);
// Auto-stash any incidental working-tree noise during the rebase below.
git(`config rebase.autoStash true`);

// Stage only what the pipeline owns.
git(`add ${config.outDir} ${config.stateFile}`);

// Anything staged? If not, stop cleanly.
let hasChanges = true;
try {
  execSync("git diff --cached --quiet", { stdio: "ignore" });
  hasChanges = false; // exit 0 => no staged diff
} catch {
  hasChanges = true; // non-zero => there are staged changes
}

if (!hasChanges) {
  console.log("No changelog changes to publish. Done.");
  process.exit(0);
}

// Summarize what's being published (for the commit message + the run log).
const staged = git("diff --cached --name-only").split("\n").filter(Boolean);
console.log("Publishing:\n" + staged.map((f) => `  ${f}`).join("\n"));

git(`commit -m "chore(changelog): publish ${staged.length} file change(s) [skip ci]"`);

// Push, absorbing a remote that moved out from under us. The remote `main`
// advances independently of this runner: GitBook Git Sync pushes back to it
// (bidirectional sync), and a repository_dispatch checkout starts from a
// possibly-stale SHA. A bare `git push` then fails non-fast-forward. So on
// rejection we fetch + rebase our single commit onto the latest remote tip and
// retry. The render is a pure function of published.json, so a rebased commit
// reproduces the same deterministic output.
const MAX_PUSH_ATTEMPTS = 5;
for (let attempt = 1; ; attempt++) {
  try {
    git(`push origin HEAD:${branch}`);
    console.log("Pushed. GitBook will sync shortly.");
    break;
  } catch (err) {
    if (attempt >= MAX_PUSH_ATTEMPTS) {
      console.error(`Push still rejected after ${MAX_PUSH_ATTEMPTS} attempts.`);
      throw err;
    }
    console.warn(`Push rejected (attempt ${attempt}/${MAX_PUSH_ATTEMPTS}); rebasing onto origin/${branch} and retrying...`);
    git(`fetch origin ${branch}`);
    git(`rebase origin/${branch}`);
  }
}
