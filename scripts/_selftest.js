// scripts/_selftest.js — offline smoke test for the rendering core.
// Needs no Jira, no network, no secrets:
//
//   node scripts/_selftest.js
//
// Exercises the rules that matter: highest-ticket-id-first order, the collapsible
// header format ([sprint] - [key][package]: summary), Fix Version on top of the
// body, description -> single-level bullets (no double-bulleting), empty/optional
// segments dropping out, and the empty-description-still-gets-a-dropdown case.

// Dummy creds BEFORE importing config (which requires them). Dynamic import so
// this assignment runs first.
process.env.JIRA_BASE ||= "https://selftest.invalid";
process.env.JIRA_EMAIL ||= "selftest@example.com";
process.env.JIRA_TOKEN ||= "selftest";

const { config } = await import("../config.js");
const { renderFeed } = await import("../lib/render-md.js");
const { adfToText } = await import("../lib/adf.js");

const entries = [
  // Full header (sprint + package version) + Fix Version + multi-line desc whose
  // second line the author already bulleted — it must NOT come out double-bulleted.
  { key: "KAN-9", date: "2026-05-28", sprint: "Sprint 12", packageVersion: "v2.3.1", fixVersion: "2026.6.0", summary: "Add dark mode", description: "Toggle it from Settings > Appearance.\n- Respects the OS preference" },
  // No sprint, no package version -> bare "[key]: summary". Fix Version present.
  { key: "KAN-12", date: "2026-05-27", sprint: "", packageVersion: "", fixVersion: "2026.5.2", summary: "Remove legacy /v1 export endpoint", description: "Migrate to /v2." },
  // Sprint set but no Fix Version and empty description -> nothing to reveal, so
  // a plain header line (no <details>).
  { key: "KAN-15", date: "2026-05-29", sprint: "Sprint 12", packageVersion: "", fixVersion: "", summary: "Fix CSV export dropping the last row", description: "" },
];

const md = renderFeed(entries, config);

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "ok  " : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

console.log("----- rendered changelog/README.md -----\n" + md);
console.log("----- checks -----");
check("highest id (KAN-15) is first, then KAN-12, then KAN-9", md.indexOf("KAN-15") < md.indexOf("KAN-12") && md.indexOf("KAN-12") < md.indexOf("KAN-9"));
check("ids sort numerically, not lexically (KAN-12 above KAN-9)", md.indexOf("KAN-12") < md.indexOf("KAN-9"));
check("full header [sprint] - [key][package]: summary", md.includes("<summary>[Sprint 12] - [KAN-9][v2.3.1]: Add dark mode</summary>"));
check("Fix Version sits at the top of the body, before the first bullet", md.includes("**Fix Version:** 2026.6.0") && md.indexOf("**Fix Version:** 2026.6.0") < md.indexOf("- Toggle it from Settings"));
check("blank line after </summary> (GitBook parsing)", md.includes("</summary>\n\n"));
check("description rendered as a bullet", md.includes("- Toggle it from Settings > Appearance."));
check("pre-bulleted line is NOT double-bulleted", md.includes("- Respects the OS preference") && !md.includes("- - Respects"));
check("missing sprint+package -> bare [key]: summary", md.includes("<summary>[KAN-12]: Remove legacy /v1 export endpoint</summary>"));
check("empty description still gets a dropdown (same <details>/<summary> format)", md.includes("<summary>[Sprint 12] - [KAN-15]: Fix CSV export dropping the last row</summary>"));

// --- ADF conversion: API v3 returns the changelog field as an ADF tree, so
// collect.js runs it through adfToText. These checks pin that behavior. -----
console.log("----- ADF conversion checks -----");

const adfDoc = {
  type: "doc",
  version: 1,
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Added " },
        { type: "text", text: "dark mode", marks: [{ type: "strong" }] },
        { type: "text", text: "." },
        { type: "hardBreak" },
        { type: "text", text: "See " },
        { type: "text", text: "the docs", marks: [{ type: "link", attrs: { href: "https://x.io" } }] },
        { type: "text", text: "." },
      ],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
      ],
    },
  ],
};
const adf = adfToText(adfDoc);
console.log("----- adfToText(adfDoc) -----\n" + adf);

check("ADF: plain text extracted", adf.includes("Added") && adf.includes("See"));
check("ADF: strong mark -> bold", adf.includes("**dark mode**"));
check("ADF: hardBreak -> newline", adf.includes("**dark mode**.\nSee"));
check("ADF: link mark -> markdown link", adf.includes("[the docs](https://x.io)"));
check("ADF: bullet list rendered", adf.includes("- one") && adf.includes("- two"));
check("ADF: plain string passes through verbatim", adfToText("literal *markdown* text") === "literal *markdown* text");
check("ADF: null/undefined -> empty string", adfToText(null) === "" && adfToText(undefined) === "");

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
