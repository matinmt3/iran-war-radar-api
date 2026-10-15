# Local verification — 2026-10-15

This record concerns the **Android companion API backend**, not a standalone news-dashboard website or a deployed Android device integration.

| Check | Actual result |
| --- | --- |
| Dependency URL audit | 277 lockfile URLs used `registry.npmjs.org`; no embedded URL credentials |
| `npm ci --ignore-scripts --no-audit --no-fund` | Fresh install succeeded: 206 packages |
| `npm run typecheck` | Passed |
| `npm test` | 11 passed across 3 test files |
| `npm run build` | Passed; `dist/src/index.js` generated |
| Fresh isolated demo initialization | 20 source-catalogue entries and 15 clearly synthetic demo news records |
| Loopback GET `/`, health, config status, sources, news, clusters and stats | All seven returned 200 |
| Unauthenticated `/api/admin/session` | Returned 401 as expected |
| External `fetch` during built-API smoke | Disabled and observed 0 attempts |

Checks used **Node.js 22.23.3**. Its SQLite runtime printed the standard experimental-feature warning. An initial fully offline dependency-install attempt could not complete because one package was absent from the npm cache; the subsequent authorized install used the public registry. No claim is made that a clean dependency installation can complete without a populated cache or network access.

All provider credentials, Telegram sessions, administrator IDs and polling flags were blank/off during validation. Unit tests used synthetic fixtures and an isolated temporary SQLite path. The additional built-server smoke test used a new database outside the publication folder. No production database, scraped article corpus, authentication session or provider response was copied or published.

No RSS/Guardian ingestion, Telegram Bot API request, MTProto login, Gemini translation, Docker build, public deployment or Android device check was performed. Passing tests verify the included contracts and logic, not news truth, connector reachability, production security or device behavior. No hosted GitHub Actions result is claimed.

## Sanitization and source changes

The original server source was preserved. In this portfolio copy only, an owner-specific Telegram handle/source identifier was replaced by `@example_public_channel` and a generic source ID, with the corresponding test expectation updated. Background polling was changed from automatic to opt-in by default. The new `.env.example` has blank integration fields and deliberate development-only placeholders. Existing test/demo passwords are synthetic fixtures, not service credentials.

Dependencies and generated build output were retained outside the source publication folder after checks. No project-wide software license was present or invented; third-party dependencies retain their original licenses.
