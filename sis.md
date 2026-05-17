# SIS Project Notes

## Scope

- Dev workspace: `/home/eagles/dockerz/sis`
- Test-host snapshot dump: `/home/eagles/dockerz/BAK/test-dump-090526/test-host-pre-wipe-20260509-011220`
- Runtime: Node `v20.19.4`
- Service entrypoint: `server/exercise-mailer.mjs`
- Admin routing module: `server/student-admin-routes.mjs`

## Active Docs

- `AGENTS.md`: short always-loaded contract, including the dev/test location split
- `docs/sop.md`: operational procedure and workflow
- `docs/history.md`: historical migration log
- `docs/plan-upgrade-0426.md`: current upgrade plan

## Current Baseline

- Single-service Node.js + Prisma workspace.
- Cookie-session auth remains the admin contract.
- Version split is explicit:
  - dev/test route and UI line: `v2.0`
  - live `admin.eagles.edu.vn` route: `v1.0`
- Edge contract: Nginx terminates TLS and proxies to OLSWS on `8088`; verify the active listener and cert on the host before updating docs.
- `moodle.eagles.edu.vn` is a separate direct-serve alternative; do not derive its edge behavior from the test host.
- Assignment templates are backend-owned.
- Admin, parent, and student portals are all active.
- Moodle quiz sync now lives in `integrations/moodle/local/sisquizsync` and posts signed quiz results into the existing exercise submission pipeline.
- The current extraction focus is the UI decomposition boundary in Phase 6 after the async side-effects outbox/worker cutover.
- Phase 6 now includes the queue-hub page wiring in `web-asset/admin/queue-hub-island.mjs`, the overview news queue wiring in `web-asset/admin/overview-news-queue-island.mjs`, the news review wiring in `web-asset/admin/news-review-island.mjs`, the profile wiring in `web-asset/admin/profile-island.mjs`, the parent-tracking wiring in `web-asset/admin/parent-tracking-island.mjs`, the attendance/grade controls in `web-asset/admin/attendance-grade-controls-island.mjs`, the assignment/level-reminder controls in `web-asset/admin/assignment-controls-island.mjs`, the school setup/profile-field layout controls in `web-asset/admin/school-setup-branding-island.mjs`, and the import/settings/report controls in `web-asset/admin/report-settings-island.mjs`.
- Portal theming now uses `web-asset/shared/portal-theme.css` as the SSOT for portal page background, panel/card surfaces, table/chart/dialog chrome, quarter/grade surfaces, shared control chrome, and immutable header/footer treatment; `portal-theme.min.css` is generated only from that source.
- Student portal and parent portal keep their critical grade/quarter overrides on-page after vendor CSS so dark-mode row tinting and quarter-board/button layout stay stable; the shared theme still owns the central tokens behind those overrides.
- Student points and the shared admin login shell keep local CSS effectively structural-only, with a fail-closed theme allowlist test guarding against page-local color reintroduction outside the explicit critical override fences.
- `grades-tabulator.html` and `portal-hub.html` still retain page-specific visual ownership beyond pure structure, so they remain the main outstanding centralization gap.

## Test Status

- Latest targeted theme verification in this session: pass, including `node --test test/admin-theme-tokens.spec.mjs`, `node --test test/portal-dark-surface-leaks.playwright.spec.mjs`, `node --test test/portal-shell-background.playwright.spec.mjs`, `npm run build:admin-assets:check`, and `npx html-validate web-asset/admin/student-admin.html web-asset/admin/student-points.html web-asset/admin/grades-tabulator.html`.
- The outbox/worker cutover is now covered by the passing suite; no extra rerun was needed after the last doc-only update.

## Prioritized Next Actions

1. Split the next page slice out of `web-asset/admin/student-admin.js`.
2. Keep the async side-effects worker boundary as the reference path for new side effects.
3. Update `docs/history.md` only when the milestone log changes.
