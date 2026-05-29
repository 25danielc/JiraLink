# Archived version — "typed filter"

This is the snapshot of the changelog pipeline **before** it was simplified to
count every Jira issue type. In this version, only tickets whose **issue type**
was one of `Story`, `Task`, or `Bug` were collected; everything else (Epics,
Sub-tasks, custom types) was excluded by the JQL query.

It is kept here for reference and easy rollback. **Do not wire this into the
pipeline** — the live scripts are at the repo root; these are inert copies.

## What changed when it was retired

Only two files differed from the current root version:

- `config.js` — `includeTypes: ["Story", "Task", "Bug"]` (the live version uses
  `includeTypes: []`, meaning "no type filter — count all types").
- `collect.js` — the JQL always included an `AND issuetype in (...)` clause (the
  live version only adds that clause when `includeTypes` is non-empty).

Every other file (`lib/`, `render.js`, `publish.js`, the workflow, etc.) is
identical to the current root version.

## How to restore the typed-filter behavior

You don't need these files to restore — the behavior is reversible by config.
Just set `includeTypes` back to the types you want in `config.js`, e.g.:

```js
includeTypes: ["Story", "Task", "Bug"],
```

A non-empty list re-enables the `issuetype in (...)` JQL clause automatically.

## Complete snapshot

A full, immutable copy of this version is also tagged in git:

```
git show v1-typed-filter        # inspect
git checkout v1-typed-filter    # check out the whole tree at that point
```
