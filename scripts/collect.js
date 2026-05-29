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
const jql =
  `project = "${config.projectKey}" ` +
  `AND issuetype in (${config.includeTypes.join(",")}) ` +
  `AND status = "${config.completedStatus}" ` +
  `AND updated >= -${config.lookbackDays}d ` +
  `ORDER BY resolutiondate DESC`;

const fields = ["summary", "issuetype", "labels", "resolutiondate", "updated", config.changelogFieldId];
const issues = await searchIssues(jql, fields);

// --- 2-4: normalize new ones into state ---
let added = 0;
for (const issue of issues) {
  if (known.has(issue.key)) continue; // publish-once: never touch a published ticket

  const labels = issue.fields.labels || [];
  if (labels.includes(config.excludeLabel)) continue; // explicit opt-out

  // v3 returns this rich-text field as an ADF tree; adfToText recovers the
  // verbatim Markdown the engineer typed (and passes plain strings through).
  const text = adfToText(issue.fields[config.changelogFieldId]).trim();
  if (!text) {
    // Nothing enforces the field anymore (gate removed), so this is expected
    // for internal tickets. Warn and skip; never publish a blank bullet.
    console.warn(`  ! ${issue.key} has empty Changelog Entry — skipped.`);
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
