# msal-node 3.7.4 to 7.1.0

Tracking issue: pgmac-net/metasearch#35. Follows #33 (aws-sdk v3 migration).

## Why

Dependabot alert #155 (GHSA-w5hq-g745-h8pq, medium): `uuid` < 11.1.1 has a missing buffer bounds check in v3/v5/v6 when `buf` is provided.

`@azure/msal-node@3.7.4` pinned `uuid ^8.3.0` and was the only `uuid` consumer in the lockfile. After the aws-sdk v3 migration it was the last thing holding `uuid` at 8.3.2.

## What changed

- `@azure/msal-node` 3.7.4 to **7.1.0** (exact pin). `@azure/msal-common` follows to 16.14.2.
- `uuid` is gone from the dependency tree (`npm ls uuid` is empty).
- No source changes. `tsc` accepted `src/oauth.microsoft.ts` and `src/engines/outlookCalendar.ts` unchanged.

## Decisions

- **Target 7.1.0, not 5.6.0.** 5.6.0 is the smallest jump past the release that dropped `uuid`, but exposes the same API surface as 7.1.0. Going to latest avoids another major-bump PR when Dependabot proposes 6.x/7.x.
- **Node floor.** msal-node 5.x+ requires Node >= 20. The Docker base is `node:22.19.0-trixie`, so the Dockerfile is unchanged.
- **Verification is split.** `make build` and a load/construct smoke test run in CI and locally. The real Microsoft path needs a tenant, so it is a manual check before merge.

## Verification

Done:
- `make build` (npm ci, tsc, uglify, sass) passes.
- `require("@azure/msal-node")` loads; `ConfidentialClientApplication` constructs; `acquireTokenByCode`, `acquireTokenByRefreshToken` and `getAuthCodeUrl` exist.
- `getTokenCache().serialize()` still exposes a `RefreshToken` map, which `oauth.microsoft.ts` reads to extract the refresh token.
- `src/engines/outlookCalendar` imports.

Manual, before merge (needs a tenant):
- `make oauth_microsoft` completes consent and prints a refresh token, or
- one Outlook Calendar search succeeds on a deployment using that token.

## Rollback

Revert the commit. 3.7.4 returns `uuid@8.3.2` and re-opens alert #155.
