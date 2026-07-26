# GitHub Engine Expansion

**Issue:** pgmac-net/metasearch#23
**PR:** pgmac-net/metasearch#26
**Date:** 2026-07-26

## Work

Extended the GitHub search engine to cover four new data sources beyond the existing repo metadata and issue/PR search.

### New Sources

| Source | API | Approach |
|---|---|---|
| **Actions** | `GET /search/code` with `path:.github/workflows` | Searches workflow file names and contents across the org |
| **Security advisories** | `GET /orgs/{org}/security-advisories` | Fetches all advisories, filters client-side |
| **Dependabot alerts** | `GET /orgs/{org}/dependabot/alerts` | Fetches open alerts, filters by advisory summary/package name |
| **Code scanning alerts** | `GET /orgs/{org}/code-scanning/alerts` | Fetches alerts, filters by rule name/description |
| **Secret scanning alerts** | `GET /orgs/{org}/secret-scanning/alerts` | Fetches open alerts, filters by secret type name |
| **Discussions** | GraphQL `search(type: DISCUSSION)` | Searches org discussions via GraphQL search API |
| **Wiki** | `GET /repos/{org}/{repo}/contents?ref=wiki/master` | Iterates repos in parallel, filters wiki page names |

### Architecture

The existing monolithic `search` function was refactored into named helper functions — one per source — called in parallel via `Promise.all` within the org loop. Each helper is wrapped in try/catch returning `[]` on failure, so one unavailable endpoint doesn't break the full search.

### Decisions

- **Per-repo vs org-level APIs:** Where org-level endpoints exist (security alerts, advisories), those are preferred. Wiki requires per-repo iteration since no cross-repo wiki search API exists.
- **Client-side filtering:** Alert endpoints don't support text search parameters, so all items are fetched (up to 50 per source) and filtered with `fuzzyIncludes`.
- **No new config options:** All new sources reuse the existing `organizations`, `token`, and `origin` config. No additional GitHub permissions are required beyond what the existing token already grants — endpoints silently return empty if the token lacks access.
- **Wiki search scope:** Only top-level wiki `.md` files are searched (the Contents API on the wiki branch returns flat listings). Nested wiki subdirectories are not traversed.

### Deviation from Plan

- Implemented on DeepSeek instead of the planned Sonnet (user preference — no model switch available).
