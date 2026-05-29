// scripts/publish.js — the publisher.
//
// Commits the rendered Markdown + updated state, then pushes. GitBook Git Sync
// picks up the push and updates the changelog. If nothing changed, it's a clean
// no-op (safe to run repeatedly — that's the whole idempotency story).
//
// In GitHub Actions, actions/checkout already configured an authenticated
// remote, so `git push` just works with `permissions: contents: write`.

import { execSync } from "node:child_process";
import { config } from "../config.js";

function git(args, opts = {}) {
  return execSync(`git ${args}`, { stdio: "pipe", encoding: "utf8", ...opts }).trim();
}

// Identity for the bot commit.
git(`config user.name "${config.gitUserName}"`);
git(`config user.email "${config.gitUserEmail}"`);

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
git("push");
console.log("Pushed. GitBook will sync shortly.");
