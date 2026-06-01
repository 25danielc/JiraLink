// scripts/_selftest.js — offline smoke test for the rendering core.
// Needs no Jira, no network, no secrets:
//
//   node scripts/_selftest.js
//
// Exercises the rules that matter: newest-first order, the collapsible header
// format ([key][reporter] summary), the breaking marker, description ->
// single-level bullets (no double-bulleting), and the empty-description case.

// Dummy creds BEFORE importing config (which requires them). Dynamic import so
// this assignment runs first.
process.env.JIRA_BASE ||= "https://selftest.invalid";
process.env.JIRA_EMAIL ||= "selftest@example.com";
process.env.JIRA_TOKEN ||= "selftest";

const { config } = await import("../config.js");
const { renderFeed } = await import("../lib/render-md.js");
const { adfToText } = await import("../lib/adf.js");

const entries = [
  // Multi-line description, including a line the author already bulleted — it
  // must NOT come out double-bulleted.
  { key: "PROJ-9", date: "2026-05-28", reporter: "Jane Doe", breaking: false, summary: "Add dark mode", description: "Toggle it from Settings > Appearance.\n- Respects the OS preference" },
  // Breaking change -> ⚠️ prepended to the summary.
  { key: "PROJ-12", date: "2026-05-27", reporter: "Sam Lee", breaking: true, summary: "Remove legacy /v1 export endpoint", description: "Migrate to /v2." },
  // Empty description -> plain header line, no <details>.
  { key: "PROJ-15", date: "2026-05-29", reporter: "", breaking: false, summary: "Fix CSV export dropping the last row", description: "" },
];

const md = renderFeed(entries, config);

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "ok  " : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

console.log("----- rendered changelog/README.md -----\n" + md);
console.log("----- checks -----");
check("newest entry (PROJ-15, 05-29) is first", md.indexOf("PROJ-15") < md.indexOf("PROJ-9"));
check("middle entry (PROJ-9, 05-28) before oldest (PROJ-12, 05-27)", md.indexOf("PROJ-9") < md.indexOf("PROJ-12"));
check("header format [key][reporter] summary", md.includes("<summary>[PROJ-9][Jane Doe] Add dark mode</summary>"));
check("breaking marker prepended to summary", md.includes("<summary>[PROJ-12][Sam Lee] ⚠️ Remove legacy /v1 export endpoint</summary>"));
check("collapsible block emitted", md.includes("<details>") && md.includes("</details>"));
check("blank line after </summary> (GitBook list parsing)", md.includes("</summary>\n\n- "));
check("description rendered as a bullet", md.includes("- Toggle it from Settings > Appearance."));
check("pre-bulleted line is NOT double-bulleted", md.includes("- Respects the OS preference") && !md.includes("- - Respects"));
check("missing reporter -> segment dropped", md.includes("[PROJ-15] Fix CSV export dropping the last row"));
check("empty description -> plain header, no <details> for that entry", !md.includes("<summary>[PROJ-15]"));

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
