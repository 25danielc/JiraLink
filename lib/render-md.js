// lib/render-md.js — the pure rendering core.
// No I/O, no env, no config import: every function takes what it needs and
// returns a string. Trivially testable (see scripts/_selftest.js) and
// same-input -> same-output deterministic.

// The whole feed: every published entry as a collapsible block, highest ticket
// id first (KAN-25, KAN-24, …). Blocks are separated by a blank line.
export function renderFeed(entries) {
  const sorted = entries.slice().sort(byKeyDesc);
  const blocks = sorted.map(renderEntry);
  return ["# Changelog", "", ...blocks.flatMap((b) => [b, ""])].join("\n");
}

// One entry -> one GitBook Expandable. The always-visible header is
//   [<sprint>] - [<key>][<package version>]: <summary>
// The sprint and package-version segments drop out cleanly when their field is
// empty. The expandable body leads with the Fix Version, then the description
// flattened to a single-level bullet list.
//
// GitBook Git Sync renders Expandables as HTML <details>/<summary>, but only
// parses the body as Markdown when there's a blank line after </summary> and
// before </details> — hence the explicit "" lines below. (Verified against
// docs.gitbook.com/creating-content/blocks/expandable.)
//
// Every entry gets the same disclosure widget, even when there's nothing to
// reveal (no Fix Version and no description) — an empty body still renders as a
// dropdown, so the feed is uniform.
function renderEntry(e) {
  const sprintSeg = e.sprint ? `[${e.sprint}] - ` : "";
  const pkgSeg = e.packageVersion ? `[${e.packageVersion}]` : "";
  const header = `${sprintSeg}[${e.key}]${pkgSeg}: ${e.summary}`;

  const parts = [];
  if (e.fixVersion) parts.push(`**Fix Version:** ${e.fixVersion}`);
  const bullets = descriptionToBullets(e.description);
  if (bullets.length) parts.push(bullets.join("\n"));

  const lines = ["<details>", `<summary>${header}</summary>`, ""];
  if (parts.length) lines.push(parts.join("\n\n"), "");
  lines.push("</details>");
  return lines.join("\n");
}

// Description text (already ADF -> Markdown via adfToText) -> a flat, single-
// level bullet list: one bullet per non-empty line. Any existing indentation
// and list marker (-, *, +, "1.", "1)") is stripped first, so a source that
// already contains bullets or nested lists never produces a double bullet or a
// nested level — "one bullet maximum".
function descriptionToBullets(text) {
  if (!text) return [];
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/^([-*+]|\d+[.)])\s+/, ""))
    .filter((line) => line !== "")
    .map((line) => `- ${line}`);
}

// Highest ticket id first (KAN-25 above KAN-24). Keys are split into a project
// prefix and a numeric id so the id compares as a NUMBER, not lexically —
// otherwise "KAN-9" would sort above "KAN-25". Across different prefixes we group
// by prefix (ascending) for a stable, deterministic order.
function byKeyDesc(a, b) {
  const pa = parseKey(a.key);
  const pb = parseKey(b.key);
  if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix);
  if (pa.num !== pb.num) return pb.num - pa.num;
  return String(b.key).localeCompare(String(a.key));
}

// "KAN-25" -> { prefix: "KAN", num: 25 }. A key with no trailing number sorts to
// the bottom of its (empty-prefix) group via num = -Infinity.
function parseKey(key) {
  const m = String(key).match(/^(.*?)-?(\d+)$/);
  if (!m) return { prefix: String(key), num: -Infinity };
  return { prefix: m[1], num: Number(m[2]) };
}
