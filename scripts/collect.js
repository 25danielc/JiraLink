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
import { searchIssues } from "../lib/jira.js";
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

// Custom field ids (from .env) for the collapsible header/body: Sprint and
// Package Version. An unset id simply omits that segment. Fix Version is Jira's
// built-in `fixVersions`, added to the field list directly below.
const sprintFieldId = config.sprintFieldId;
const packageFieldId = config.packageVersionFieldId;
console.log(`Custom fields: sprint=${sprintFieldId || "(unset)"} package=${packageFieldId || "(unset)"}`);

const fields = ["summary", "issuetype", "labels", "resolutiondate", "updated", "description", "fixVersions"];
if (sprintFieldId) fields.push(sprintFieldId);
if (packageFieldId) fields.push(packageFieldId);

// Echo the exact query and parameters. When the collector returns 0 while the
// same project clearly has completed tickets, this line is the fastest way to
// see WHY: a status name that doesn't match Jira (default "Done" vs your
// "Completed"), the wrong project key, or the -lookbackDays window excluding
// older tickets your hand-run JQL would still show.
console.log(`Querying Jira: project=${config.projectKey} status="${config.completedStatus}" lookback=${config.lookbackDays}d`);
console.log(`JQL: ${jql}`);

const issues = await searchIssues(jql, fields);
console.log(`Jira returned ${issues.length} issue(s) matching the query.`);

// A zero-result run is the usual "ran but published nothing" case. The three
// likely causes, in order: COMPLETED_STATUS doesn't match your Jira status name
// exactly (e.g. "Done" vs "Completed"); JIRA_PROJECT_KEY is wrong or unseen by
// the token; or tickets completed but weren't "updated" within the window.
// Re-run the JQL printed above by hand in Jira to see which it is.
if (issues.length === 0) {
  console.warn(
    `Zero results. Verify COMPLETED_STATUS ("${config.completedStatus}") and ` +
      `JIRA_PROJECT_KEY (${config.projectKey}) match Jira exactly.`
  );
}

// --- 2-4: normalize new ones into state ---
let added = 0;
for (const issue of issues) {
  if (known.has(issue.key)) continue; // publish-once: never touch a published ticket

  const labels = issue.fields.labels || [];
  if (labels.includes(config.excludeLabel)) continue; // explicit opt-out

  // The summary is the entry's headline and is always present; guard anyway so
  // a blank header is never published.
  const summary = (issue.fields.summary || "").trim();
  if (!summary) {
    console.warn(`  ! ${issue.key} has an empty summary — skipped.`);
    continue;
  }

  const type = issue.fields.issuetype?.name || "";
  const date = (issue.fields.resolutiondate || issue.fields.updated || "").slice(0, 10);

  // Fields the collapsible format renders:
  //   summary        -> header title (after the colon)
  //   sprint         -> "[sprint] -" header prefix (most recent sprint)
  //   packageVersion -> "[package version]" header segment
  //   fixVersion     -> first line of the expandable body
  //   description    -> the expandable body bullets (ADF on v3 -> adfToText)
  state.entries[issue.key] = {
    key: issue.key,
    date,
    summary,
    sprint: sprintFieldId ? sprintName(issue.fields[sprintFieldId]) : "",
    packageVersion: packageFieldId ? fieldText(issue.fields[packageFieldId]) : "",
    fixVersion: fieldText(issue.fields.fixVersions),
    description: adfToText(issue.fields.description).trim(),
  };
  added++;
  console.log(`  + ${issue.key} (${date})${type ? ` ${type}` : ""}`);
}

writeFileSync(config.stateFile, JSON.stringify(state, null, 2));
console.log(`Collected ${added} new entr${added === 1 ? "y" : "ies"}. Total: ${Object.keys(state.entries).length}.`);

// --- field value helpers -------------------------------------------------
// Jira custom fields come back in several shapes. Reduce any of them to one
// display string: scalars pass through, option/version objects expose
// .name/.value, and arrays (e.g. fixVersions) join their parts.
function fieldText(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(fieldText).filter(Boolean).join(", ");
  if (typeof v === "object") return v.name || v.value || "";
  return "";
}

// The Sprint field is an array of sprint objects (newest last); we show the most
// recent one's name. Tolerates the legacy "...[name=Sprint 5,...]" string form.
function sprintName(v) {
  if (!v) return "";
  const arr = Array.isArray(v) ? v : [v];
  const last = arr[arr.length - 1];
  if (!last) return "";
  if (typeof last === "string") return (last.match(/name=([^,]+)/)?.[1] || last).trim();
  return last.name || "";
}
