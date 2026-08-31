# Test coverage

## Coverage model

The repository has a substantial automated test suite spanning unit tests, contract tests, and Playwright browser checks. This indicates a strong focus on operational correctness and portal behavior.

## Test categories present

- Unit/logic tests for business rules and data transformations
- Prisma/schema contract tests
- Portal theme/HTML contract tests
- Auth and route contract tests
- Page behavior tests for admin, parent, and student surfaces
- Performance and portal-quality tests
- Migration/restore/sync safeguard tests

## Representative testing areas

Examples from the `test/` directory include:

- `student-admin-import-validation.spec.mjs`
- `student-admin-dashboard-summary.spec.mjs`
- `portal-theme-contract.spec.mjs`
- `portal-button-contract.spec.mjs`
- `portal-hub-fallback.spec.mjs`
- `student-portal-authenticated-performance.playwright.spec.mjs`
- `parent-portal-authenticated-performance.playwright.spec.mjs`
- `student-news-vocabulary.spec.mjs`
- `mission-critical-endpoints.spec.mjs`
- `sync-and-restart-test-runtime.spec.mjs`

## Strengths

- Broad coverage across route behavior and portal flows
- Browser-level validation for authenticated portal surfaces
- Contract tests for theme and page structure rules
- Focus on operational integrity: sync, backup, restore, and health checks

## Gaps / watchouts

- Large tests can be heavy to run and may require environment-specific setup
- The architecture is broad, so regression risk is mostly around cross-feature behavior rather than isolated logic bottlenecks
- Integration-heavy tests rely on runtime environment and config consistency, which raises operational sensitivity

## Overall assessment

Coverage is strong and practical for a complex operational SIS. The project is not lightly tested; it includes explicit contract protections against drift, especially for portal assets, auth, and configuration-sensitive flows. This coverage is a meaningful advantage for modernization work.
