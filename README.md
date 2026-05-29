# Changelog pipeline (Jira → GitHub → GitBook)

Deterministic, no-LLM changelog automation. Engineers write a user-facing
summary into a Jira custom field. When a ticket moves to **Completed**, its
entry is added to a single reverse-chronological changelog that GitBook syncs.

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

1. **Custom field** "Changelog Entry" (Paragraph), on Story/Task/Bug.
   Engineers write **plain Markdown** here. It publishes verbatim.
2. **Classification is derived, shown as an inline tag, not entered:**
   - Story / Task → **Feature**
   - Bug → **Fix**
   - Label `breaking` → **⚠️ Breaking** (overrides the type tag)
   - Label `no-changelog` → excluded entirely
   - Epics / Sub-tasks → never included
3. **The trigger:** a Jira Automation rule — _Work item transitioned → to
   `Completed`_ → **Send web request** to GitHub (see below). No gate; a blank
   field just means `collect.js` skips that ticket.

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

`<GITHUB_TOKEN>` is a **fine-grained PAT** scoped to *only* `Actions: write`
(and `Contents: read`) on this one repo. Treat it as a secret and restrict who
can edit the rule. A dropped request is harmless — the next completion (or a
manual run) reconciles via the lookback window.

## Setup

1. Create the Jira field + the Automation rule (above).
2. Create an Atlassian API token; gather the values in `.env.example`. A
   **read-only** token is enough — if your token offers scopes, `read:jira-work`
   is all the pipeline needs (it only runs a JQL search and reads fields; it
   never writes to Jira). Auth is HTTP Basic (email + token); the client talks
   to the v3 `/search/jql` endpoint.
3. Find the "Changelog Entry" field id (looks like `customfield_10050`):
   Jira → Settings → Issues → Custom fields → find the field → the id is in the
   edit-screen URL (`...customFieldId=10050` → `customfield_10050`). Put it in
   `CHANGELOG_FIELD_ID`. For local runs, `cp .env.example .env` and fill it in.
4. In GitHub repo settings → Secrets and variables → Actions, add:
   `JIRA_BASE`, `JIRA_EMAIL`, `JIRA_TOKEN`, `JIRA_PROJECT_KEY`,
   `CHANGELOG_FIELD_ID`, `COMPLETED_STATUS`.
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
