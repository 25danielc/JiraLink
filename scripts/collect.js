// scripts/collect.js — the collector.
//
// Every run, deterministically:
//   1. Ask Jira for tickets in the Completed status within the lookback window.
//   2. Drop any already recorded in published.json (publish-once = no dups).
//   3. Drop excluded / empty ones.
//   4. Add the new ones to published.json as normalized entries.
//
// No inference. The trigger gives real-time publishing; the lookback window
// means a missed trigger self-heals on the next run.

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { config } from "../config.js";
import { searchIssues, getCurrentUser, listVisibleProjects } from "../lib/jira.js";
import { adfToText } from "../lib/adf.js";

// --- load state ---
const state = existsSync(config.stateFile)
  ? JSON.parse(readFileSync(config.stateFile, "utf8"))
  : { entries: {} };
state.entries = state.entries || {};
const known = new Set(Object.keys(state.entries));

// --- 1: query Completed tickets in the window ---
// Only constrain by issue type when includeTypes is non-empty; an empty list
// means "count every type" and the clause is omitted entirely.
const typeClause = config.includeTypes.length
  ? `AND issuetype in (${config.includeTypes.join(",")}) `
  : "";
const jql =
  `project = "${config.projectKey}" ` +
  typeClause +
  `AND status = "${config.completedStatus}" ` +
  `AND updated >= -${config.lookbackDays}d ` +
  `ORDER BY resolutiondate DESC`;

// The field that becomes each entry's text. "summary" mode reads the built-in
// summary (always present); "field" mode reads the custom Changelog Entry field.
const sourceField = config.textSource === "field" ? config.changelogFieldId : "summary";

const fields = ["summary", "issuetype", "labels", "resolutiondate", "updated"];
if (config.textSource === "field") fields.push(config.changelogFieldId);

// Echo the exact query and parameters. When the collector returns 0 while the
// same project clearly has completed tickets, this line is the fastest way to
// see WHY: a status name that doesn't match Jira (default "Done" vs your
// "Completed"), the wrong project key, or the -lookbackDays window excluding
// older tickets your hand-run JQL would still show.
console.log(`Querying Jira: project=${config.projectKey} status="${config.completedStatus}" lookback=${config.lookbackDays}d source=${config.textSource}`);
console.log(`JQL: ${jql}`);

const issues = await searchIssues(jql, fields);
console.log(`Jira returned ${issues.length} issue(s) matching the query.`);

// When the full query returns nothing, peel the clauses back one at a time to
// localize which one zeroes it out — without printing any secret values (we log
// counts only). Whichever probe is the first to return 0 names the culprit:
//   project       0 -> wrong project key, or auth can't see the project
//   + status      0 -> the COMPLETED_STATUS name doesn't match Jira exactly
//   + window      0 -> tickets are completed but not "updated" within lookbackDays
if (issues.length === 0) {
  console.warn("Zero results — probing which clause is responsible:");
  const probes = [
    [`project = "${config.projectKey}"`, "project only"],
    [`project = "${config.projectKey}" AND status = "${config.completedStatus}"`, "project + status"],
    [
      `project = "${config.projectKey}" AND status = "${config.completedStatus}" AND updated >= -${config.lookbackDays}d`,
      "project + status + window",
    ],
  ];
  let projectOnlyCount = null;
  for (const [probeJql, label] of probes) {
    try {
      const n = (await searchIssues(probeJql, ["summary"])).length;
      if (label === "project only") projectOnlyCount = n;
      console.warn(`  ${n === 0 ? "✗" : "✓"} ${label}: ${n} issue(s)`);
    } catch (err) {
      console.warn(`  ! ${label}: query errored — ${err.message.split("\n")[0]}`);
    }
  }

  // If even "project only" is empty, the problem is below JQL: wrong site, wrong
  // credentials, or a project key this token can't see. Confirm identity and
  // list the visible project keys so the mismatch is obvious. (The configured
  // key, if present in the list, is masked by GitHub — its appearing as *** in
  // the printed list IS the confirmation that it matches.)
  if (projectOnlyCount === 0) {
    try {
      const me = await getCurrentUser();
      console.warn(`  Authenticated on ${config.jiraBase} as: ${me.emailAddress || me.displayName || me.accountId}`);
      const keys = await listVisibleProjects();
      console.warn(`  Projects visible to this token (${keys.length}): ${keys.join(", ") || "(none)"}`);
      console.warn(`  Configured project key is ${keys.includes(config.projectKey) ? "PRESENT" : "NOT FOUND"} in that list.`);
    } catch (err) {
      console.warn(`  Identity/project probe errored: ${err.message.split("\n")[0]}`);
    }
  }
}

// --- 2-4: normalize new ones into state ---
let added = 0;
for (const issue of issues) {
  if (known.has(issue.key)) continue; // publish-once: never touch a published ticket

  const labels = issue.fields.labels || [];
  if (labels.includes(config.excludeLabel)) continue; // explicit opt-out

  // summary is a plain string; the custom field comes back as an ADF tree on
  // v3. adfToText handles both — it recovers verbatim Markdown from ADF and
  // passes plain strings straight through.
  const text = adfToText(issue.fields[sourceField]).trim();
  if (!text) {
    // In "field" mode a blank field is the opt-out, so this is expected for
    // internal tickets. In "summary" mode it should never happen (summary is
    // mandatory) but we guard anyway. Either way: never publish a blank bullet.
    console.warn(`  ! ${issue.key} has empty ${sourceField} — skipped.`);
    continue;
  }

  const type = issue.fields.issuetype?.name;
  const breaking = labels.includes(config.breakingLabel);
  const date = (issue.fields.resolutiondate || issue.fields.updated || "").slice(0, 10);

  state.entries[issue.key] = {
    key: issue.key,
    date,
    type,
    category: breaking ? "Breaking" : config.typeToCategory[type] || "Feature",
    breaking,
    text,
  };
  added++;
  console.log(`  + ${issue.key} (${date}) ${breaking ? "Breaking" : type}`);
}

writeFileSync(config.stateFile, JSON.stringify(state, null, 2));
console.log(`Collected ${added} new entr${added === 1 ? "y" : "ies"}. Total: ${Object.keys(state.entries).length}.`);
