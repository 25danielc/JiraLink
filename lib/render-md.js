// lib/render-md.js — the pure rendering core.
// No I/O, no env, no config import: every function takes what it needs and
// returns a string. Trivially testable (see scripts/_selftest.js) and
// same-input -> same-output deterministic.

// The whole feed: every published entry as a collapsible block, newest
// completion first. Blocks are separated by a blank line.
export function renderFeed(entries, config) {
  const sorted = entries.slice().sort(byDateDesc);
  const blocks = sorted.map((e) => renderEntry(e, config));
  return ["# Changelog", "", ...blocks.flatMap((b) => [b, ""])].join("\n");
}

// One entry -> one GitBook Expandable. The always-visible header is
//   [<key>][<reporter>] <summary>
// with a ⚠️ prepended to the summary for breaking changes. The description is
// the expandable body, flattened to a single-level bullet list.
//
// GitBook Git Sync renders Expandables as HTML <details>/<summary>, but only
// parses the body as Markdown when there's a blank line after </summary> and
// before </details> — hence the explicit "" lines below. (Verified against
// docs.gitbook.com/creating-content/blocks/expandable.)
//
// When the description is empty there's nothing to expand, so we emit the
// header as a plain line instead of an empty disclosure widget.
function renderEntry(e, config) {
  const summary = e.breaking ? `⚠️ ${e.summary}` : e.summary;
  const reporterSeg = e.reporter ? `[${e.reporter}]` : "";
  const header = `[${e.key}]${reporterSeg} ${summary}`.trim();

  const bullets = descriptionToBullets(e.description);
  if (!bullets.length) return header;

  return ["<details>", `<summary>${header}</summary>`, "", ...bullets, "", "</details>"].join("\n");
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

// Newest completion date first; ties broken by issue key (descending) so the
// output is fully deterministic regardless of input order.
function byDateDesc(a, b) {
  const da = a.date || "";
  const db = b.date || "";
  if (da !== db) return db.localeCompare(da);
  return String(b.key).localeCompare(String(a.key));
}
