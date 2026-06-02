# Changelog pipeline (Jira → GitHub → GitBook)

Deterministic, no-LLM changelog automation. Each entry's text comes from the
ticket **summary** (plus optional Sprint / Package Version / Fix Version /
description). The **moment** a ticket transitions to **Done** in Jira, its entry
is added to a single reverse-chronological changelog that GitBook syncs — no
manual step.

- **Unit of work:** the **ticket** (not a release/version).
- **Trigger:** a Jira Automation rule fires the instant a ticket transitions to
  Done (real-time webhook → GitHub `repository_dispatch`).
- **Output:** one flat `changelog/README.md`, newest entry at the top.
- **Runner:** GitHub Actions (no servers, no external deps — plain Node 20).
- **State:** this repo (`published.json`, keyed by issue key).
- **Publish:** commit to this repo; GitBook Git Sync does the rest.

```
Jira ticket: In Progress / Review ──▶ Done
   └─ Automation rule "Send web request" ──▶ GitHub repository_dispatch
          └─ collect.js  query Done tickets -> add new ones to published.json
          └─ render.js   rebuild changelog/README.md from published.json
          └─ publish.js  commit + push  ->  GitBook syncs
```

## The Jira contract

1. **Entry text** is the built-in ticket **summary** — always present, nothing
   extra for engineers to fill in. Every Done ticket appears in the feed.
2. **Which tickets count:** by default **every issue type** (Story, Task, Bug,
   Epic, Sub-task, custom types) in the `Done` status is included. To restrict
   the feed to specific types, set `includeTypes` in `config.js` (a non-empty
   list re-adds an `issuetype in (...)` clause to the JQL).
3. **Opt a ticket out:** add the `no-changelog` label in Jira. `collect.js`
   skips any ticket carrying it.
4. **The trigger:** a Jira Automation rule — _Work item transitioned → To:
   `Done`_ → **Send web request** to GitHub (see below).

> Assumption baked in: **Done = shipped to users.** The changelog publishes the
> moment a ticket reaches Done, so that status must mean the work is live.

## The entry format

Each entry renders as a GitBook Expandable. The always-visible header is:

```
[<sprint>] - [<key>][<package version>]: <summary>
```

The sprint and package-version segments drop out cleanly when their field is
empty (a bare `[<key>]: <summary>`). The expandable body leads with the Fix
Version, then the ticket description flattened to a single-level bullet list.
When there's nothing to reveal (no Fix Version, no description), the header is
emitted as a plain line instead of an empty disclosure widget.

Sprint and Package Version are **custom fields**, supplied by id via the
`SPRINT_FIELD_ID` / `PACKAGE_VERSION_FIELD_ID` secrets; leave either unset to
omit that segment. Fix Version is Jira's built-in `fixVersions` (no id needed).

## The trigger: Jira Automation "Send web request"

In Jira → **Project settings → Automation → Create rule**:

1. **Trigger:** _Work item transitioned_. Set **To status: `Done`**. Optionally
   set **From status: `In Progress`, `Review`** to fire only on those exact
   transitions (leave From blank to fire on any → Done, e.g. bulk moves too).
2. **Action:** _Send web request_:
   - **URL:** `https://api.github.com/repos/25danielc/JiraLink/dispatches`
   - **Method:** `POST`
   - **Headers:**
     - `Authorization: Bearer <GITHUB_TOKEN>`
     - `Accept: application/vnd.github+json`
   - **Body type:** Custom data
   - **Body:**
     ```json
     { "event_type": "jira-ticket-completed", "client_payload": { "issue_key": "{{issue.key}}" } }
     ```

`{{issue.key}}` is optional — it just shows up in the GitHub run log ("Triggered
by") so you can see which ticket woke the workflow. The pipeline never depends on
the payload; `collect.js` always re-queries Jira.

`<GITHUB_TOKEN>` is a **fine-grained PAT** scoped to *only* **Contents: Read and
write** on this one repo (the permission the `dispatches` endpoint requires).
Treat it as a secret and restrict who can edit the rule.

> **Reliability note:** this is a webhook-only trigger — there is no scheduled
> poll. If GitHub or the request hiccups and a dispatch is dropped, that one
> ticket is **not** auto-recovered on its own. It *is* picked up the next time
> any ticket completes (each run re-scans the last `LOOKBACK_DAYS` = 90 days and
> publishes anything new), and you can always force a catch-up with the manual
> **Run workflow** button. If you'd rather not rely on that, add an `on:
> schedule:` cron to `.github/workflows/changelog.yml` later.

## Setup

1. **Create the Automation rule** (above).
2. **Create an Atlassian API token** and gather the values in `.env.example`. A
   **read-only** token is enough — if your token offers scopes, `read:jira-work`
   is all the pipeline needs (it only runs a JQL search and reads fields; it
   never writes to Jira). Auth is HTTP Basic (email + token); the client talks to
   the v3 `/search/jql` endpoint.
3. **Create the fine-grained GitHub PAT** (Contents: Read and write, this repo
   only) and paste it into the Automation rule's `Authorization` header.
4. **Add GitHub Actions secrets** (repo Settings → Secrets and variables →
   Actions):
   - `JIRA_BASE`, `JIRA_EMAIL`, `JIRA_TOKEN`, `JIRA_PROJECT_KEY`
   - `COMPLETED_STATUS` — **must exactly match** the rule's To-status (e.g.
     `Done`). A mismatch silently collects nothing.
   - *(optional)* `SPRINT_FIELD_ID`, `PACKAGE_VERSION_FIELD_ID`
   - *(optional)* `LOOKBACK_DAYS` (defaults to 90)
5. **Point GitBook Git Sync** at the `changelog/` folder of this repo.

For local runs, `cp .env.example .env` and fill it in.

## Running it

- **Offline test (no Jira needed):** `npm run selftest`
- **In CI:** it fires automatically on each transition to Done. To force a run
  (reprocess / catch-up), use the Actions tab → "changelog" → **Run workflow**.
- **Locally (dry run):**
  ```bash
  npm run build     # collect + render, writes files but does NOT push
  git diff          # inspect changelog/README.md and published.json
  npm run publish   # commit + push when you're happy
  ```

## How "nothing duplicates, nothing slips" works

- **No duplicates:** a ticket is recorded in `published.json` exactly once;
  already-known keys are skipped. Re-running is a clean no-op. A ticket moved to
  Done, re-opened, and Done again is still logged once (publish-once = the
  changelog is an append-only historical record).
- **Multiple at once:** one run collects every newly-Done ticket in the window,
  and the `changelog` concurrency group serializes overlapping runs so bursts
  can't clobber each other.
- **Recovery:** every run re-queries Done tickets in the lookback window
  (default 90 days) and publishes any it hasn't seen. A failed run or dropped
  webhook is reconciled by the next completion's run (or the manual button).
- **No drift:** the feed is fully re-rendered from `published.json` each run, so
  the file is always a pure function of state.

## Escape hatches

- **Fix a published entry by hand:** edit the text in `published.json` and run
  `npm run build`. Editing `changelog/README.md` directly does **not** stick — a
  re-render rebuilds it from state and overwrites manual edits. State is the
  source of truth; always edit `published.json`.
- **Reprocess a ticket from Jira:** delete its key from `published.json`, then
  run the workflow. It's re-collected from current Jira data.
- **Remove a bad entry:** delete its key from `published.json` and re-render
  (or `git revert` the publish commit). GitBook follows.
- **Exclude a ticket after the fact:** add the `no-changelog` label in Jira and
  delete its key from `published.json`; it won't come back.
