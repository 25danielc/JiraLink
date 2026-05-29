# Changelog pipeline (Jira → GitHub → GitBook)

Deterministic, no-LLM changelog automation. Each entry's text comes from the
ticket **summary** by default (an internal/support-facing feed), or optionally
from a curated custom field. When a ticket moves to **Completed**, its entry is
added to a single reverse-chronological changelog that GitBook syncs.

- **Unit of work:** the **ticket** (not a release/version).
- **Trigger:** Jira Automation fires when a ticket transitions to Completed.
- **Output:** one flat `changelog/README.md`, newest entry at the top.
- **Runner:** GitHub Actions (no servers, no external deps — plain Node 20).
- **State:** this repo (`published.json`, keyed by issue key).
- **Publish:** commit to this repo; GitBook Git Sync does the rest.

```
Jira ticket -> Completed
   └─ Automation "Send web request" ──▶ GitHub repository_dispatch
          └─ collect.js  query Completed tickets -> add new ones to published.json
          └─ render.js   rebuild changelog/README.md from published.json
          └─ publish.js  commit + push  ->  GitBook syncs
```

## The Jira contract

1. **Entry text** comes from one of two sources, set by `TEXT_SOURCE`:
   - **`summary`** (default): the built-in ticket **summary**. Good for an
     **internal** feed (e.g. the engineering support team) — every Completed
     ticket appears, nothing extra for engineers to fill in.
   - **`field`**: a custom **"Changelog Entry"** field (Paragraph) on
     Story/Task/Bug, where engineers write **plain Markdown** that publishes
     verbatim. Good for a **curated, user-facing** feed — a blank field opts the
     ticket out.
2. **Which tickets count:** by default **every issue type** (Story, Task, Bug,
   Epic, Sub-task, custom types) in the `Completed` status is included. To
   restrict the feed to specific types, set `includeTypes` in `config.js`.
3. **Classification is derived, shown as an inline tag, not entered:**
   - Story / Task → **Feature**
   - Bug → **Fix**
   - Any other type → **Feature** (the fallback tag)
   - Label `breaking` → **⚠️ Breaking** (overrides the type tag)
   - Label `no-changelog` → excluded entirely
4. **The trigger:** a Jira Automation rule — _Work item transitioned → to
   `Completed`_ → **Send web request** to GitHub (see below). In `field` mode a
   blank field just means `collect.js` skips that ticket; in `summary` mode
   use the `no-changelog` label to exclude a ticket.

> Assumption baked in: **Completed = shipped to users.** The changelog publishes
> the moment a ticket completes, so that status must mean the work is live.

## The Jira "Send web request" action

In the Automation rule, after the trigger, add **Send web request**:

- **URL:** `https://api.github.com/repos/<owner>/<repo>/dispatches`
- **Method:** `POST`
- **Headers:**
  - `Authorization: Bearer <GITHUB_TOKEN>`
  - `Accept: application/vnd.github+json`
- **Body (custom data):**
  ```json
  { "event_type": "jira-ticket-completed" }
  ```

`<GITHUB_TOKEN>` is a **fine-grained PAT** scoped to *only* **Contents: Read and
write** on this one repo (the permission the `dispatches` endpoint requires).
Treat it as a secret and restrict who can edit the rule. A dropped request is
harmless — the next completion (or a manual run) reconciles via the lookback
window.

## Setup

1. Create the Automation rule (above). Default `summary` mode needs no custom
   field; only create one if you want `field` mode (see step 3).
2. Create an Atlassian API token; gather the values in `.env.example`. A
   **read-only** token is enough — if your token offers scopes, `read:jira-work`
   is all the pipeline needs (it only runs a JQL search and reads fields; it
   never writes to Jira). Auth is HTTP Basic (email + token); the client talks
   to the v3 `/search/jql` endpoint.
3. **(Only for `field` mode)** Create a "Changelog Entry" Paragraph field on
   Story/Task/Bug, then find its id (looks like `customfield_10050`): Jira →
   Settings → Issues → Custom fields → find the field → the id is in the
   edit-screen URL (`...customFieldId=10050` → `customfield_10050`). Put it in
   `CHANGELOG_FIELD_ID` and set the repo variable `TEXT_SOURCE=field`. For local
   runs, `cp .env.example .env` and fill it in.
4. In GitHub repo settings → Secrets and variables → Actions, add secrets:
   `JIRA_BASE`, `JIRA_EMAIL`, `JIRA_TOKEN`, `JIRA_PROJECT_KEY`,
   `COMPLETED_STATUS` (plus `CHANGELOG_FIELD_ID` for `field` mode). To use the
   custom field, also add the **variable** `TEXT_SOURCE=field` (leave it unset
   for the default summary feed).
5. Point **GitBook Git Sync** at the `changelog/` folder of this repo.

## Running it

- **Offline test (no Jira needed):** `npm run selftest`
- **In CI:** Actions tab → "changelog" → **Run workflow**, or let Jira fire it.
- **Locally (dry run):**
  ```bash
  npm run build     # collect + render, writes files but does NOT push
  git diff          # inspect changelog/README.md and published.json
  npm run publish   # commit + push when you're happy
  ```

## How "nothing duplicates, nothing slips" works

- **No duplicates:** a ticket is recorded in `published.json` exactly once;
  already-known keys are skipped. Re-running is a clean no-op.
- **No slips:** every run re-queries Completed tickets in the lookback window
  (default 90 days) and publishes any it hasn't seen. A missed trigger or a CI
  outage self-heals on the next run.
- **No drift:** the feed is fully re-rendered from `published.json` each run, so
  the file is always a pure function of state.

## Escape hatches

- **Fix a published entry by hand:** edit the text in `published.json` and run
  `npm run build` (or just edit `changelog/README.md` — but a re-render will
  overwrite it from state, so prefer editing `published.json`).
- **Reprocess a ticket from Jira:** delete its key from `published.json`, then
  run the workflow. It's re-collected from current Jira data.
- **Remove a bad entry:** delete its key from `published.json` and re-render
  (or `git revert` the publish commit). GitBook follows.
- **Exclude a ticket after the fact:** add the `no-changelog` label in Jira and
  delete its key from `published.json`; it won't come back.
