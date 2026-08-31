# Migration risks

## 1. Highly coupled route surface

The single largest risk is the breadth of responsibilities in `server/student-admin-routes.mjs`. It imports and orchestrates many feature modules directly, which makes modernization and refactoring riskier than a cleanly separated service boundary.

Risks:

- broad blast radius for configuration or auth changes,
- harder test isolation,
- increased chance of unintended side effects during route refactors,
- difficult dependency tracing when adding new features.

## 2. Runtime configuration drift

The repo explicitly manages environment-specific config and runtime mirrors (`SIS_CONFIG.json`, `sis-config-store`, `.env.dev`, `.env.test`, `.env`). This is necessary, but it creates migration risk if dev/test/live config values drift.

Risks:

- wrong DB routing during local dev or mirror sync,
- stale config mirrored across environments,
- incompatible runtime assumptions between local and deployed modes.

## 3. Schema and workflow breadth

The Prisma schema covers many school processes: students, attendance, grades, enrollment, intake, notifications, library, parent profile flows, and report generation. This broadness increases migration risk because unrelated modules share data and workflow assumptions.

Risks:

- schema changes can have cross-feature side effects,
- data integrity validation is more complex,
- report-generation and portal flows depend on multiple related tables.

## 4. Portal and server asset coupling

The app serves static portal HTML and CSS assets, while also relying on server-side logic for API routes and auth. There is a strong runtime coupling between page assets and server route behavior.

Risks:

- drift between built assets and source pages,
- auth/session issues when origin or routing changes,
- parity problems between dev/test/live mirrors.

## 5. Background jobs and notification flows

`AsyncSideEffectJob`, notification queue, and email delivery code create additional operational complexity. These workflows rely on persisted state and retriable processing.

Risks:

- duplicate or stale job execution,
- email notification inconsistencies,
- operational dependence on queue-state correctness during upgrades.

## 6. Mixed data-origin and import concerns

The schema stores imported data, external system payloads, and matched student identity data side by side. Large volumes of intake and result data are processed with dedupe, matching, and review logic.

Risks:

- incorrect identity matching after migration,
- duplicate source submissions,
- review delays and import backfill errors.

## 7. Contract-heavy browser tests

The repo includes a substantive contract and Playwright test suite, which is a strong positive sign, but it also means changes are heavily coupled to expected browser and route behavior.

Risks:

- migration may require broad test updates,
- UI parity changes can fail contract tests even when logic remains sound,
- route or origin assumptions are enforced in tests.

## Overall risk profile

This project is a mid-sized operational monolith with broad domain coverage and environment-sensitive deployment patterns. It is not high-risk because of a single complex dependency, but because of the combination of:

- shared route orchestration,
- DB-backed business workflows,
- runtime config drift sensitivity,
- portal asset parity rules,
- operational background jobs.

Migration work should proceed incrementally and verify environment config and portal parity before broad refactoring.
