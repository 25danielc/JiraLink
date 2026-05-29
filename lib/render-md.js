// lib/render-md.js — the pure rendering core.
// No I/O, no env, no config import: every function takes what it needs and
// returns a string. Trivially testable (see scripts/_selftest.js) and
// same-input -> same-output deterministic.

// The whole feed: every published entry as a bullet, newest completion first.
export function renderFeed(entries, config) {
  const sorted = entries.slice().sort(byDateDesc);
  const lines = ["# Changelog", ""];
  for (const e of sorted) lines.push(renderEntry(e, config));
  lines.push("");
  return lines.join("\n");
}

// One entry -> one Markdown bullet. The engineer's text goes in VERBATIM; we
// only prepend a category tag and indent continuation lines so multi-line text
// stays inside the bullet.
function renderEntry(e, config) {
  let body = e.text.replace(/\r\n/g, "\n").trimEnd();
  body = body.replace(/\n/g, "\n  ");

  const tag = e.breaking ? "⚠️ Breaking" : e.category;
  let line = `- **${tag}** — ${body}`;
  if (config.showDate && e.date) line += ` _(${e.date})_`;
  if (config.showKeys) line += ` (${e.key})`;
  if (config.embedKeyComment) line += ` <!-- ${e.key} -->`;
  return line;
}

// Newest completion date first; ties broken by issue key (descending) so the
// output is fully deterministic regardless of input order.
function byDateDesc(a, b) {
  const da = a.date || "";
  const db = b.date || "";
  if (da !== db) return db.localeCompare(da);
  return String(b.key).localeCompare(String(a.key));
}
