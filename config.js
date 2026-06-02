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

  // Custom fields shown in the collapsible format, given as their Jira field ids
  // (e.g. "customfield_10020"). Find an id in Jira under Settings -> Issues ->
  // Custom fields, or via GET /rest/api/3/field. An empty value simply omits
  // that segment. (Fix Version is Jira's built-in `fixVersions` and needs no id.)
  sprintFieldId: process.env.SPRINT_FIELD_ID || "",
  packageVersionFieldId: process.env.PACKAGE_VERSION_FIELD_ID || "",

  // The exact name of your terminal status — the one that means "shipped".
  // This MUST equal, character for character, the To-status of the Jira
  // Automation rule that fires the workflow (the "Done" you transition into).
  // A mismatch is the one failure that silently collects nothing — see README.
  completedStatus: process.env.COMPLETED_STATUS || "Done",

  // Reconcile window. Each run looks back this many days for Completed tickets
  // and publishes any it hasn't seen yet. With the webhook-only trigger there is
  // no scheduled poll, so a dropped webhook isn't recovered on its own — but the
  // next completion within this window re-scans and picks up the missed ticket.
  // The manual "Run workflow" button is the explicit catch-up for anything older.
  lookbackDays: Number(process.env.LOOKBACK_DAYS || 90),

  // --- The contract expressed as data ---
  // Which issue types to include. EMPTY = count ALL types (no type filter).
  // To restrict the feed again, list types here, e.g. ["Story", "Task", "Bug"];
  // a non-empty list re-adds the `issuetype in (...)` clause to the JQL.
  includeTypes: [],

  excludeLabel: "no-changelog", // excludes a ticket from the changelog entirely

  // --- Output ---
  // GitBook Git Sync points at THIS folder. The feed is a single flat file.
  outDir: "changelog",
  feedFile: "changelog/README.md", // the reverse-chronological feed (newest first)

  // The state ledger: every published ticket, keyed by issue key. Lives at repo
  // root so GitBook never renders it as a page. The feed is rebuilt from this.
  stateFile: "published.json",

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
