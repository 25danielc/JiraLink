// scripts/_selftest.js — offline smoke test for the rendering core.
// Needs no Jira, no network, no secrets:
//
//   node scripts/_selftest.js
//
// Exercises the rules that matter: newest-first order, verbatim text, multi-line
// indentation, the inline category tag, the breaking tag, and traceability.

// Dummy creds BEFORE importing config (which requires them). Dynamic import so
// this assignment runs first.
process.env.JIRA_BASE ||= "https://selftest.invalid";
process.env.JIRA_EMAIL ||= "selftest@example.com";
process.env.JIRA_TOKEN ||= "selftest";

const { config } = await import("../config.js");
const { renderFeed } = await import("../lib/render-md.js");
const { adfToText } = await import("../lib/adf.js");

const entries = [
  { key: "PROJ-9", date: "2026-05-28", type: "Story", category: "Feature", breaking: false, text: "Added dark mode.\nToggle it from Settings > Appearance." },
  { key: "PROJ-12", date: "2026-05-27", type: "Bug", category: "Breaking", breaking: true, text: "Removed the legacy /v1 export endpoint. Migrate to /v2." },
  { key: "PROJ-15", date: "2026-05-29", type: "Bug", category: "Fix", breaking: false, text: "Fixed CSV export dropping the last row." },
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
check("verbatim text preserved", md.includes("Removed the legacy /v1 export endpoint. Migrate to /v2."));
check("multi-line continuation is indented", md.includes("\n  Toggle it from Settings > Appearance."));
check("category tag present", md.includes("**Fix**") && md.includes("**Feature**"));
check("breaking tag rendered", md.includes("**⚠️ Breaking**"));
check("completion date shown", md.includes("_(2026-05-29)_"));
check("traceability comment embedded", md.includes("<!-- PROJ-9 -->"));

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
