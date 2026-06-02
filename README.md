# Changelog pipeline (Jira → GitHub → GitBook)

When a Jira ticket moves to **Done**, its summary is added to a single Markdown
changelog that GitBook publishes — automatically, no LLM, no servers, no manual
step. Plain Node 20 running on GitHub Actions.

```
Jira ticket → Done
   └─ Automation rule "Send web request" → GitHub repository_dispatch
        └─ collect → render → publish (commit + push) → GitBook syncs
```

The pipeline is a pure function of Jira state plus one JSON ledger
(`published.json`), so it's **idempotent** (re-running changes nothing) and
**self-healing** (each run re-scans the last 90 days, recovering any missed
trigger).

## Entry format

Every entry is a GitBook expandable. Header (segments drop out when empty):

```
[<sprint>] - [<key>][<package version>]: <summary>
```

The body shows the Fix Version, then the description as bullets. Entries are
sorted by ticket id, highest first (KAN-25 above KAN-24).

- **Opt a ticket out:** add the `no-changelog` label in Jira.
- **Restrict issue types:** set `includeTypes` in `config.js` (empty = all types).

## Setup

**1. Jira Automation rule** — *Project settings → Automation → Create rule*:

- **Trigger:** *Work item transitioned* → **To status: `Done`** (leave *From*
  blank so any → Done fires it).
- **Action:** *Send web request*:
  - **URL:** `https://api.github.com/repos/25danielc/JiraLink/dispatches`
  - **Method:** `POST`
  - **Headers:** `Authorization: Bearer <GITHUB_PAT>` and
    `Accept: application/vnd.github+json`
  - **Body** (Custom data):
    `{ "event_type": "jira-ticket-completed", "client_payload": { "issue_key": "{{issue.key}}" } }`

`<GITHUB_PAT>` is a fine-grained PAT scoped to **Contents: Read and write** on
this repo only. Turn the rule on.

**2. GitHub Actions secrets** — *Settings → Secrets and variables → Actions*:

| Secret | Meaning |
|---|---|
| `JIRA_BASE` | `https://<site>.atlassian.net` (no trailing slash) |
| `JIRA_EMAIL` | account that owns the API token |
| `JIRA_TOKEN` | Atlassian API token (read-only is enough) |
| `JIRA_PROJECT_KEY` | project key, e.g. `KAN` |
| `COMPLETED_STATUS` | must match the rule's To-status exactly (e.g. `Done`) |
| `SPRINT_FIELD_ID`, `PACKAGE_VERSION_FIELD_ID` | *(optional)* custom field ids |
| `LOOKBACK_DAYS` | *(optional)* self-heal window, default 90 |

**3. GitBook:** point Git Sync at the `changelog/` folder.

## Running locally

```bash
cp .env.example .env   # fill in real values (git-ignored)

npm run selftest       # offline: render core + ADF, no Jira/secrets
npm run build          # collect + render — writes files, no push
npm run all            # collect + render + publish (pushes!)
```

`published.json` is the source of truth; `changelog/README.md` is rebuilt from it
every run — never hand-edit the feed. To reprocess a ticket, delete its key from
`published.json` and run again.
