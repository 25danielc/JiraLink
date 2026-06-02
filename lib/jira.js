// lib/jira.js — a minimal, resilient Jira Cloud client.
//
// Auth: HTTP Basic (account email + API token). Scoped API tokens work here
// too — they use the same Basic scheme and only gate WHAT the token may read.
// The read-only scope `read:jira-work` is sufficient for the search below.
//
// Endpoint: REST API v3 `/search/jql`, which is token-paginated. The legacy
// `/rest/api/2/search` (offset paginated, returned a `total`) is being removed
// from Jira Cloud and rejects scoped tokens — so we use v3 deliberately.
//
// One consequence of v3: rich-text fields come back as ADF (a JSON tree), not
// plain text. The ticket description is converted back to Markdown by lib/adf.js
// at the point of use (collect.js). Everything else we read (summary, labels,
// dates, issuetype) is already scalar.

import { config } from "../config.js";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 4; // attempts beyond the first, on transient failures
const MAX_PAGES = 1000; // safety valve against a pathological pagination loop
const PAGE_SIZE = 100;

function authHeader() {
  const creds = Buffer.from(`${config.jiraEmail}:${config.jiraToken}`).toString("base64");
  return `Basic ${creds}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Exponential backoff with a hard cap; honors a server's explicit hint when given.
function backoffMs(attempt, hintMs) {
  if (hintMs != null) return Math.min(hintMs, 30_000);
  return Math.min(1000 * 2 ** (attempt - 1), 15_000);
}

// One GET with a per-request timeout and bounded retry on transient failures
// (network errors, request timeouts, HTTP 429, and 5xx). Anything else — e.g.
// 401 (bad token), 403 (missing scope), 400 (bad JQL) — throws immediately,
// since retrying won't help and a fast, loud failure is the right signal in CI.
async function get(path, params) {
  const url = new URL(config.jiraBase + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: authHeader(), Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (err) {
      // Network failure or timeout (AbortError). Retry if budget remains.
      if (attempt++ < MAX_RETRIES) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      throw new Error(`Jira request to ${path} failed after ${MAX_RETRIES + 1} attempts: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) return res.json();

    if ((res.status === 429 || res.status >= 500) && attempt++ < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const hintMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : null;
      await sleep(backoffMs(attempt, hintMs));
      continue;
    }

    const body = await res.text().catch(() => "");
    throw new Error(`Jira ${res.status} ${res.statusText} on ${path}\n${body}`);
  }
}

// All issues matching a JQL query, following token pagination to completion.
// v3 `/search/jql` does not return a `total`; instead each page carries a
// `nextPageToken` when more results remain. We stop when it's absent.
export async function searchIssues(jql, fields) {
  const out = [];
  let nextPageToken;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await get("/rest/api/3/search/jql", {
      jql,
      fields: fields.join(","),
      maxResults: PAGE_SIZE,
      nextPageToken, // omitted on the first call (get() drops undefined params)
    });

    out.push(...(data.issues || []));

    if (!data.nextPageToken) return out; // no token => that was the last page
    nextPageToken = data.nextPageToken;
  }

  throw new Error(`Jira pagination exceeded ${MAX_PAGES} pages — aborting to avoid a loop.`);
}
