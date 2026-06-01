// config.js — single source of truth for the pipeline's wiring.
// Secrets come from environment variables (GitHub Actions secrets).
// Structural choices (mappings, labels) live here in plain sight so behavior
// is predictable and reviewable in a diff.

export const config = {
  // --- Jira connection (from env / GitHub secrets) ---
  jiraBase: requireEnv("JIRA_BASE"), // e.g. https://yourco.atlassian.net  (no trailing slash)
  jiraEmail: requireEnv("JIRA_EMAIL"), // the Atlassian account email that owns the API token
  jiraToken: requireEnv("JIRA_TOKEN"), // Atlassian API token

  // --- What to read ---
  projectKey: process.env.JIRA_PROJECT_KEY || "PROJ", // e.g. "ENG"

  // Where each entry's text comes from:
  //   "summary" — the built-in ticket summary. Good for an INTERNAL feed (e.g.
  //               the engineering support team): every Completed ticket appears,
  //               no extra field for engineers to fill in. This is the default.
  //   "field"   — the custom "Changelog Entry" field below. Good for a CURATED,
  //               user-facing feed: only tickets with text written into it
  //               appear (a blank field opts the ticket out).
  // The `no-changelog` label excludes a ticket in either mode.
  textSource: process.env.TEXT_SOURCE === "field" ? "field" : "summary",

  // Only used when textSource === "field". The custom field holding the
  // verbatim changelog text. Find the id (e.g. "customfield_10050") in Jira:
  // Settings -> Issues -> Custom fields.
  changelogFieldId: process.env.CHANGELOG_FIELD_ID || "customfield_XXXXX",

  // Custom fields shown in the collapsible format, given as their Jira field ids
  // (e.g. "customfield_10020"). Find an id in Jira under Settings -> Issues ->
  // Custom fields, or via GET /rest/api/3/field. An empty value simply omits
  // that segment. (Fix Version is Jira's built-in `fixVersions` and needs no id.)
  sprintFieldId: process.env.SPRINT_FIELD_ID || "",
  packageVersionFieldId: process.env.PACKAGE_VERSION_FIELD_ID || "",

  // The exact name of your terminal status — the one that means "shipped".
  // You called it "Completed"; set COMPLETED_STATUS to match Jira exactly.
  completedStatus: process.env.COMPLETED_STATUS || "Done",

  // Safety-net reconcile window. Each run looks back this many days for Completed
  // tickets and publishes any it hasn't seen yet. The Jira trigger gives you
  // real-time publishing; this window just means a missed trigger self-heals.
  lookbackDays: Number(process.env.LOOKBACK_DAYS || 90),

  // --- The contract expressed as data ---
  // Which issue types to include. EMPTY = count ALL types (no type filter).
  // To restrict the feed again, list types here, e.g. ["Story", "Task", "Bug"];
  // a non-empty list re-adds the `issuetype in (...)` clause to the JQL.
  includeTypes: [],

  // Issue type -> inline category tag. Types not listed fall back to "Feature"
  // (see collect.js). `breakingLabel` overrides any tag to "Breaking".
  typeToCategory: {
    Story: "Feature",
    Task: "Feature",
    Bug: "Fix",
  },

  breakingLabel: "breaking", // tags an entry as a breaking change
  excludeLabel: "no-changelog", // excludes a ticket from the changelog entirely

  // --- Output ---
  // GitBook Git Sync points at THIS folder. The feed is a single flat file.
  outDir: "changelog",
  feedFile: "changelog/README.md", // the reverse-chronological feed (newest first)

  // The state ledger: every published ticket, keyed by issue key. Lives at repo
  // root so GitBook never renders it as a page. The feed is rebuilt from this.
  stateFile: "published.json",

  // Show the completion date on each entry, e.g. "_(2026-05-28)_".
  showDate: true,
  // Show the Jira key visibly, e.g. "... (PROJ-12)". Off by default (clean feed).
  showKeys: false,
  // Append an invisible "<!-- PROJ-12 -->" for traceability (readers don't see it).
  embedKeyComment: true,

  // Identity for the automated commit.
  gitUserName: process.env.GIT_USER_NAME || "changelog-bot",
  gitUserEmail: process.env.GIT_USER_EMAIL || "changelog-bot@users.noreply.github.com",
};

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable: ${name}`);
    console.error("See .env.example for the full list. In CI these are GitHub Actions secrets.");
    process.exit(1);
  }
  return v.replace(/\/+$/, ""); // strip trailing slash (matters for jiraBase)
}
