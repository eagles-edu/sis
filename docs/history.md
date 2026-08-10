# SIS History

This file keeps the slow-moving migration log that used to live in `sis.md`.

## Major Milestones

- 2026-08-10: Authoritative student vocabulary verification was added to the New Words and student-news vocabulary save/check flows. Local CMUdict remains the offline pronunciation and primary-stress authority; Merriam-Webster Collegiate is queried first for written division, with Learner's Dictionary fallback, bounded success/not-found caching, and warning-only behavior for temporary service/key/rate-limit failures. Canonical accented stress storage and editable stress input were preserved. Added protected physical Library pages at `/student/library.html` and `/admin/library-admin.html`; the student page includes student chat, while the admin page intentionally has no chat. Both pages use the shared header/footer and SVG theme toggle. Contract tests, lint, syntax checks, asset rebuild, dev restart, and authenticated Playwright checks passed.

- 2026-07-12: Selector-safe admin critical CSS extraction and load-path promotion were completed across dev and the test mirror. `tools/extract-critical-css.mjs` parses CSS with PostCSS and copies complete rules whose selectors contain IDs present in the admin HTML; it does not split shared/admin CSS by raw byte ranges. `web-asset/admin/student-admin.critical.css` is generated as a separate artifact, while the full shared and admin stylesheets are loaded asynchronously after the critical path. The test mirror was used first, then the same HTML path was promoted to dev; `student-admin.critical.css` was added to the runtime/public parity maps and stale admin HTML assertions were aligned. Test-mirror Lighthouse reference: performance 90, TBT 250 ms, FCP 0.4 s, LCP 0.6 s; the remaining render-blocking entries are the small theme-state script and critical stylesheet, with no estimated FCP/LCP savings from removing them. Authenticated admin theme toggle and reload persistence passed on both test and dev without browser errors. Future asset-reduction work should use Playwright Chromium CSS/JS coverage over representative authenticated flows plus Lighthouse validation; do not automatically purge shared selectors from a single coverage run. PurgeCSS is review-only with a dynamic-selector safelist, and the preferred JS reduction is page/island splitting of `student-admin.js`.
- 2026-07-12: The selector-only critical CSS async experiment was rejected after throttled test-mirror screenshots showed a first-paint FOUC/geometry transition that Lighthouse did not classify as CLS. Dev and test were restored to blocking full shared/admin stylesheets; `student-admin.critical.css` remains generated for analysis but is not active in the page load path. The async path must not be re-enabled until a real above-the-fold render-based extraction proves identical visual first paint and stable screenshots. The earlier Lighthouse reference (performance 90, TBT 250 ms, FCP 0.4 s, LCP 0.6 s) is retained as a performance-only result, not an acceptance result.
- 2026-06-29: A test-mirror admin dashboard incident was traced to an undeclared student-news review status constant in the admin source bundle, followed by an incorrect direct minified hot-patch; recovery now requires source-only edits, asset rebuild, parity verification across dev/test runtime and public copies, and a stricter no-hand-edit rule for minified CSS/JS.
- 2026-05-19: A portal date-format regression was introduced while attempting to normalize visible date output, then rolled back; the recovery now requires a dev-runtime restart plus browser validation after any date-display change.
- 2026-05-17: Portal theming tightened again around `web-asset/shared/portal-theme.css` as the only editable source, with quarter-board/assignment/profile chrome moved out of the student and parent page style blocks, student-points/admin login chrome aligned to shared selectors, and a fail-closed local-theme allowlist test added for the cleaned pages.
- 2026-05-13: Dev restart and sync wrappers were hardened to rebuild admin assets and apply Prisma generate/deploy before relaunching the dev runtime, so schema drift now fails fast instead of silently falling back and breaking dashboard loads.
- 2026-05-06: Portal theming was consolidated around `web-asset/shared/portal-theme.css` semantic tokens for page background, panels, cards, tables, support text, and chart axis labels, with local page CSS kept structural.
- 2026-04-17: Moodle quiz sync was added with a repo-owned Moodle local plugin, signed outbound quiz results, and SIS-side ingestion on the existing exercise submission endpoint.
- 2026-04-15: Phase 6 UI decomposition expanded again with a dedicated parent-tracking island, moving the page and queue wiring out of the main admin bundle.
- 2026-04-15: Phase 6 UI decomposition expanded again with a dedicated attendance-grade controls island, moving the attendance, performance, grades, and chart wiring out of the main admin bundle.
- 2026-04-15: Phase 6 UI decomposition expanded again with a dedicated assignment controls island, moving the assignment and level-reminder wiring out of the main admin bundle.
- 2026-04-15: Phase 6 UI decomposition expanded again with a dedicated school setup branding island, moving the school setup and profile-field layout wiring out of the main admin bundle.
- 2026-04-15: Phase 6 UI decomposition expanded again with a dedicated report settings island, moving the import, settings, and report wiring out of the main admin bundle.
- 2026-04-15: Phase 6 UI decomposition expanded again with a dedicated profile island, moving the profile and student-form wiring out of the main admin bundle.
- 2026-04-15: Phase 6 UI decomposition expanded again with a dedicated news review island, moving the page controls and viewer wiring out of the main admin bundle.
- 2026-04-15: Phase 6 UI decomposition was completed after the queue-hub and overview news queue islands were split out of the main admin bundle.
- 2026-04-15: Phase 6 UI decomposition gained a second island for the overview news queue controls, separating it from the queue-hub wiring.
- 2026-04-14: Phase 5 async side effects were finished with an outbox/job table, a reusable worker processor, and a worker CLI for announcement email and report-card PDF jobs.
- 2026-04-14: Phase 5 async side effects became the active boundary after the prior module extraction work completed for the tracked admin slices.
- 2026-04-14: Admin domain slices were split into dedicated `src/modules/admin/*` modules for session, roster, points, student records, parent reports, student news review/submissions/compliance, dashboard summary, student write/import, and notification queue handling.
- 2026-04-13: Assignment templates became backend-owned, the dashboard summary contract was updated, and the docs/mapping artifacts were refreshed.
- 2026-04-13: CI workflow branch targeting was retargeted to `server-side-refactor`.
- Earlier entries were retained in prior `sis.md.BAK-*` snapshots during the compression pass.

### 2026-05-23: cron to check for SIS_CONFIG.json periodically, replace json if corrupt (make .BAK FIRST)then SPAWN MIRROR SIS_CONFIG.json, IF MISSING SPAWN MIRROR TO NEW SIS_CONFIG.json, AND VICE-VERSA

- SIS_CONFIG.json and runtime-data/admin-ui-settings.json now get backed up to adjacent .BAK-<timestamp>-<pid> files before a repair overwrite when the existing file is corrupt or empty. That logic lives in src/modules/admin/sis-config-store.mjs (line 95) and is applied in both the save path and the load/repair path.
- Added a cron-safe repair entrypoint in tools/sis-config-repair.mjs (line 1). It just runs the same ensureSisConfigLoaded({ refresh: true }) repair flow.
- Added a cron installer in tools/install-sis-config-cron.sh (line 1). Default schedule is */15* ** *, and it logs to runtime-data/maintenance-reports/is-config-repair-cron.log.
- Added self-healing for the full school setup payload in `schoolProfile`, plus the school logo and the six dedicated class-level SVG tiles. Missing profile fields are normalized to the canonical setup shape, and missing logo/image fields fall back to relative `web-asset/images/*.svg` paths before the same repair flow rewrites the snapshot and DB mirror.
- Added tests for both repair directions in test/sis-config-store.spec.mjs (line148): corrupt SIS_CONFIG.json repaired from legacy, and corrupt legacy repaired from SIS_CONFIG.json.

Verified:
`node --test test/sis-config-store.spec.mjs`
`bash -n tools/install-sis-config-cron.sh`
`bash tools/install-sis-config-cron.sh --check-only`

To install the cron entry:
`bash tools/install-sis-config-cron.sh`

#### Artifacts related to this work is in these files

- sis-config-store.mjs
- sis-config-store.spec.mjs
- sis-config-repair.mjs
- install-sis-config-cron.sh

### 2026-06-29: dev/test admin dashboard mixed-bundle incident, root cause, recovery, and hardening

Scope:

- Dev admin dashboard.
- Test mirror admin dashboard after full purge/sync.

Primary regression:

- The authenticated admin dashboard shell rendered broken or partially unstyled because the admin bundle threw before the overview/dashboard islands finished booting.

Root cause:

- `web-asset/admin/student-admin.js` referenced `STUDENT_NEWS_REVIEW_STATUS_SUBMITTED` in the admin news-review path, but that constant was not declared in the bundle.
- The visible symptom looked like missing panels and missing style/application on the dashboard, but the actual failure was JavaScript boot abort, not data drift.

Observed browser failures during diagnosis:

- Dev initially threw `STUDENT_NEWS_REVIEW_STATUS_SUBMITTED is not defined`.
- After an incorrect hot-fix pass, test threw `Cannot access 'STUDENT_NEWS_REVIEW_STATUS_SUBMITTED' before initialization`.

Code files touched in the incident:

- `web-asset/admin/student-admin.js`
- `web-asset/admin/student-admin.min.js`

Incorrect intervention that was backed out:

- A direct hot-patch was applied to the already-built admin bundle in dev.
- A direct hot-patch was also applied to `web-asset/admin/student-admin.min.js`.
- That was the wrong repair path because it created generated/source drift risk and helped produce a mixed-bundle failure mode across environments.

Correct repair:

- Declare the missing constants in the canonical source file `web-asset/admin/student-admin.js`.
- Rebuild the generated admin asset so `web-asset/admin/student-admin.min.js` is regenerated from source instead of hand-edited.
- Restart dev.
- Re-run the test runtime sync so the test runtime copy and test public copy both receive the same rebuilt bundle.

Final source fix that remained:

- Added `const STUDENT_NEWS_REVIEW_STATUS_SUBMITTED = "submitted";`
- Added `const STUDENT_NEWS_REVIEW_STATUS_APPROVED = "approved";`
- Added `const STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED = "revision-requested";`

Verification after the correct repair:

- Dev source/admin minified bundle hashes matched the synced test runtime and test public copies.
- Authenticated browser verification showed both dev and test loading the admin overview shell normally again.
- The dashboard panels reappeared because the admin boot path no longer aborted.

Current parity status after recovery:

- Code parity for the repaired admin bundle is clean across dev source, test runtime mirror, and test public mirror.
- Remaining dev/test differences are runtime-state differences, not code-bundle drift.

Runtime-state differences confirmed at incident close:

- Dev uses PostgreSQL database `sis`; test uses PostgreSQL database `sis-test`.
- Dev latest applied Prisma migration: `20260615175000_parent_report_workflow_and_events`.
- Test latest applied Prisma migration: `20260628093000_add_student_news_submission_state`.
- `runtime-data/admin-ui-settings.json` matched between dev and test at incident close.
- Dev retained `runtime-data/student-news-reports.json`; test runtime root did not carry that fallback file.
- Dev `.env.test` points `SIS_CONFIG_FILE` at `config/sis-config.test.json`; test mirror `.env.test` points `SIS_CONFIG_FILE` at `SIS_CONFIG.json`.
- `config/sis-config.test.json` remains the repo-local test fixture path for local test-mode execution.
- `development` mode is authoring mode: local dev config files are the source-of-truth and the DB mirror is repaired from them.
- `test` and `production` are mirror/repaired modes: deployed runtime `SIS_CONFIG.json` is reconciled with the DB mirror and the weaker side is repaired when the other side is valid.
- `SIS_CONFIG.json` content hashes can differ between dev root and test mirror root because test runtime state is an explicit immutable runtime artifact.
- Database content counts differed materially, including `StudentNewsReport`, `StudentAttendance`, `StudentGradeRecord`, `AdminUser`, and `IncomingExerciseResult`.

Chosen follow-up course of action:

- Keep the split path contract.
- `config/sis-config.test.json` remains the repo-local test fixture path for local test-mode execution.
- Root-level `SIS_CONFIG.json` remains the deployed runtime immutable for synced environments.
- The fix for confusion is explicit documentation of role, not forcing identical names for unlike operational surfaces.

Why this incident mattered:

- The visible test failure was not caused by PostgreSQL content drift.
- The incident was caused by a broken admin JavaScript bundle plus an unsafe hot-patch path that bypassed the source-to-generated contract.
- Full-sync safety depends on guaranteeing that source, generated assets, runtime mirror, and public mirror are always promoted as one coherent build set.

Hardening decisions captured from this incident:

- Never directly edit minified CSS/JS. Edit source, run the build/minification step, then sync the rebuilt artifact.
- Treat source asset, generated asset, runtime mirror copy, and public mirror copy as a single parity unit during sync verification.
- Fail the sync if any paired source/generated asset hashes disagree before promotion.
- Fail the sync if the runtime mirror and public mirror copies of a promoted asset do not match the rebuilt dev artifact after promotion.
- Keep runtime-state drift reporting separate from code-parity reporting so database/content differences are not mistaken for bundle regressions.

## Notes

- Use `sis.md` for the current status snapshot.
- Use `docs/sop.md` for the active procedure.
- Use this file for historical context only; do not load it into active task instructions unless the task needs the migration timeline.
