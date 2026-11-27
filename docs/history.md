# SIS History

This file keeps the slow-moving migration log that used to live in `sis.md`.

## Major Milestones

- 2026-11-26: Completed the temporary IELTS exercise feed integration to test SIS. All 119 deployed current IELTS forms use the shared sender and common exercise endpoint; a synthetic browser attempt and same-ID replay produced one submission and grade with full identity, timing, title, score, and question metrics. Moodle quiz sync and staging `enrol_sis` lifecycle evidence are recorded in `docs/external-grade-paths.md`; staging safety settings were restored and production remained unchanged.

- 2026-11-22: KA-201 corrected the scheduled Student News monitor to use the SIS midnight grace-window report date and to distinguish a provider check that was not reached from an unavailable LanguageTool result. The report records the Check HTTP status and alerts only on attempted provider failure. Node syntax checks and the 104-rule Prometheus configuration check passed; the dev runtime restarted with `/healthz` status `ok` and config `synced=true`, and the installed 00:45 ICT scheduled monitor passed Check, provider, submission, and cleanup results. No test suite was run. Test/live sync remains pending, and the user-reported logout remains open.

- 2026-11-21: KA-182 enabled the three authenticated Student Library/News lifecycle specs in the exact test-mirror environment and corrected their fixture assumptions. Each targeted E2E passed 1/1 against `sis-test`; the full 165-file nightly suite passed in 1,186.9 seconds with its no-external-message proof verified and message-delivery aggregates unchanged. Prometheus nightly success and isolation metrics were `1`, and the prior nightly-failure alert resolved after rule evaluation. The broad recovery audit, original News logout reproduction, and `DevNewsOldReviewQueue` remain open; that queue was left unchanged. Production/admin was untouched. Backup: `/home/eagles/dockerz/backups/manual-edits/20261121-ka182-test-authenticated-e2e/`.
- 2026-11-21: KA-174–KA-180 established the first full test-mirror nightly pass and recurring monitoring for all ten dev and test logical groups. Added test-owned parent-profile (15m), Library/Dictionary Builder, Student News, and grade-feed/attendance (5m) timers with exact environment ownership, database identity checks, independent group freshness, synthetic cleanup, and no-message behavior. All four probes and scheduled timer runs passed; Prometheus showed all ten test groups fresh and passing. Focused monitor/freshness contracts passed 23/23, and all 100 alert rules plus deterministic rule tests passed, including the new test Library stale transition. The nightly suite passed all 165 registered test files in 1,011.6 seconds. Test-wide external-message isolation, authenticated specs skipped in test, repeat nightly evidence, and broad subsystem recovery verification remain open. Production/admin was untouched. Backups: `/home/eagles/dockerz/backups/manual-edits/20261121-ka176-nightly-smoke/`, `/home/eagles/dockerz/backups/manual-edits/20261121-ka178-test-config-isolation/`, and `/home/eagles/dockerz/backups/manual-edits/20261121-ka180-test-group-monitors/`.

- 2026-11-20: KA-137 recorded partial test-mirror functional and monitor evidence. The complete 161-file suite passed across verified segments after making the report-flow browser test seed and clean up its own unique synthetic report; cold News Check and exact parent desktop/mobile browser gates passed. The full test sync and canonical test-host Lighthouse gate passed. The read-only test engagement monitor still fails on aged notification and parent-report backlog, with two warnings firing; no queue was drained and no email was sent, so the related checklist item remains open. No production change. Backups: `/home/eagles/dockerz/backups/test-runtime/test-sync-20261120-005133/` and `/home/eagles/dockerz/backups/manual-edits/20261120-ka137-test-functional-monitoring/`.

- 2026-11-20: KA-136 completed the full test-mirror sync only after a verified backup of test runtime, public assets, vhost configuration, and `sis-test` PostgreSQL. No migrations were pending; test health, public admin route, strict source/runtime/public portal parity, favicon/mobile-width checks, compression negotiation, and admin/parent/student Lighthouse gates all passed. Each route scored 100 Performance and 100 Best Practices. Production was untouched. Backup: `/home/eagles/dockerz/backups/test-runtime/test-sync-20261120-001257/`; documentation backup: `/home/eagles/dockerz/backups/manual-edits/20261120-ka136-test-sync/`.

- 2026-11-19: KA-130 recorded dev/test worker ownership, polling intervals, job limits, heartbeat status, the installed test restart guard, current Prometheus rule-test results, and stale-recovery contract results. The alert and restart-limit end-to-end recovery evidence remains indexed under KA-127. The current dev engagement run still fails its aggregate result: queued announcement, notification, and parent-report work plus enrollment-integrity and News-review alerts remain visible; both worker heartbeats pass, but that does not mean delivery queues are healthy. Current test freshness/queue and three certificate-expiry warnings were also recorded without operational data changes. Production was untouched. Backup: `/home/eagles/dockerz/backups/manual-edits/20261119-ka130-worker-alert-evidence/`.

- 2026-11-19: KA-127 exercised monitoring freshness, alert routing, retry policy, and bounded test-service recovery. The `.env.test` engagement monitor ran read-only and emitted a failing aggregate result while its authenticated report API and exact parent dashboard checks were up; `TestEngagementMonitorStale` resolved after a fresh run and fired again after the on-demand result aged past three minutes. Prometheus recorded `TestServiceRestartFailed` pending then firing after an injected failure of only `sis-web-test.service`; systemd executed four starts across 30-second cooldowns, rejected the next attempt with `Start request repeated too quickly`, and left `Result=exit-code` from the last process failure. The test static server recovered to HTTP 200 locally and publicly. Alertmanager delivered firing and resolved service notifications and stale-monitor transitions to Slack `#sis-alert`, with zero failed notifications. Corrected stale alert-routing and restart-result documentation, and added deterministic Prometheus freshness firing/recovery coverage. The explicit test retry/stale-recovery suite passed 9/9. Production SIS services and data were untouched. Backup: `/home/eagles/dockerz/backups/manual-edits/20261119-ka127-alert-recovery-exercise/`.

- 2026-11-18: KA-093 parent report acknowledgment recovery closed a UI failure found during the authenticated review. The parent stylesheet had hidden the report archive that owns the acknowledgment link, and the click handler marked reports reviewed locally before the API succeeded. The archive is reachable again; failed acknowledgment now remains pending and retryable, and local state changes only after server success. Authenticated desktop/mobile browser proof forced a failed request followed by a successful retry using a synthetic browser-response report; no report data or email was changed. Focused tests, lint, and generated-asset checks passed. Evidence is recorded in `docs/keep-alive-plan.md` under KA-093.

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
- `development` mode was previously treated as authoring mode; this rule was superseded on 2026-11-18 by the all-environment newest-valid-copy reconciliation policy below.
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

### 2026-11-18: SIS config mirror recency recovery

- Root cause: `/healthz` reported mirror state without running reconciliation, the development path hard-coded the JSON file as winner, database read/write errors were swallowed, and repair forced the database row's `updatedAt` to the file payload timestamp. The row therefore could not retain independent recency information.
- Current rule: all environments compare the config file's filesystem modification time with the database-managed `SisConfigMirror.updatedAt`, choose the newer valid copy, repair the older copy, and read back to verify a database repair. An exact timestamp tie selects the database copy deterministically. Recovery copies the winning version timestamp to both copies, including the repaired file's mtime, preventing timestamp oscillation.
- Health endpoints now reconcile before reporting. A database failure is surfaced instead of being reported as an apparently successful load.
- Dev runtime was backed up before repair; the local file was newer than the database row's recorded timestamp and the dev mirror was repaired from that file. No production runtime or production database was changed.

### 2026-11-19: KA-129 domain-layer health history visualization

- Extended the five provisioned domain dashboards with history timelines for each configured host service and authenticated dependency, plus an ERPNext component-running timeline.
- Dashboard tables now distinguish Docker `HEALTHY`, `UNHEALTHY`, and `NO HEALTHCHECK`; domains without configured service/dependency probes show explicit instrumentation gaps.
- Dev Grafana provisions the generated dashboards and Prometheus evaluates the newly added layer queries. Production was untouched. Backup: `/home/eagles/dockerz/backups/manual-edits/20261119-domain-layer-visualization/`.

### 2026-11-19: KA-128 interrupted synthetic-probe cleanup

- Exercised post-write interruption paths for the parent invitation, submitted Student News report, and approved Library contribution in dev. The flows cleaned their synthetic records and verified queue/contribution/canonical-entry absence; the parent cleanup also removes any async invitation job keyed to its synthetic invitation IDs.
- Read-only aggregate checks in `sis_dev` and `sis-test` found no synthetic records or matching queued invitation jobs. The dev API remained healthy and production was untouched. Backup: `/home/eagles/dockerz/backups/manual-edits/20261119-ka128-interrupted-probe-cleanup/`.

### 2026-11-19: KA-131 complete core regression pass

- Corrected contract tests whose expectations had drifted from current dictionary-source URL resolution, cache-busted portal assets, route matching, and normalized parent-review fields. Isolated student-admin SIS config writes from the development database and isolated the repair-script fixture from the owned dev database.
- The SIS config recovery test now validates that the selected database snapshot remains the winner while allowing filesystem mtime precision/ownership behavior; the service account can write the protected config inode but cannot arbitrarily set its mtime.
- The complete 143-file core suite passed under the explicit `.env.dev` / `development` environment against `sis_dev`. The dev restart completed with no pending migrations, `/healthz` reported `ok`, and the config mirror reported in sync. Production was untouched. Backups: `/home/eagles/dockerz/backups/manual-edits/20261119-ka131-core-regression/`.

### 2026-11-19: KA-132 parent activation throttle and integrated workflow run

- Parent activation throttling now counts invalid, expired, and reused links per source IP; successful one-time activations clear that source's failure counter. This prevents valid families behind a shared school network from exhausting the eight-attempt lockout. The lockout remains active after eight failed attempts in the 15-minute window and rejects the next request before a database lookup.
- Parent invitation/profile draft/review E2E passed twice consecutively after the change; the parent workflow monitor passed on rerun. News, Library, and grade-feed/attendance dev monitors passed. The engagement monitor still fails on the existing dev notification backlog and overlapping enrollment periods; no email was sent and no operational records were edited. One earlier parent review read returned HTTP 500 and was not reproduced in the final two E2E runs or monitor pass.
- The parent-focused contract, draft-regression, and monitor tests passed 26/26; ESLint, Node syntax checks, and `git diff --check` passed. Dev restart completed with no pending migrations; `/healthz` returned `ok` and the config mirror was in sync. Synthetic E2E student, parent, invitation, submission, and job counts returned zero after cleanup. Production was untouched. Backup: `/home/eagles/dockerz/backups/manual-edits/20261119-ka132-parent-activation-rate-limit/`.

### 2026-11-20: KA-133 authenticated parent/admin desktop and mobile gate

- The full synthetic parent invitation, password setup, draft save/reload, submission, admin review/approval, and profile reload E2E passed twice on desktop after KA-132. In the connected dev Chrome profile, the exact `cmmark001` parent session showed linked `mark001`; its profile form opened with zero unsaved changes. The authenticated admin Family Lookup review control loaded 18 submitted rows. At mobile widths 390px and 320px, both affected surfaces rendered within the viewport; `documentElement` and body widths matched the viewport, the parent profile form had no child overflow, and the review action remained within the viewport. The connected browser desktop check was 1024px; the synthetic full E2E context is 1280×900. The mobile and exact-account checks were read-only; no real profile or queue item was changed. Synthetic E2E cleanup passed. Backup: `/home/eagles/dockerz/backups/manual-edits/20261120-ka133-authenticated-mobile-workflows/`.

### 2026-11-20: KA-134 generated admin asset parity

- KA-132 changed only server-side invitation throttling, tests, and evidence documents; no generated admin assets were required. `npm run dev:restart` ran the admin asset build and reported outputs already current. `npm run build:admin-assets:check` exited 0 with all admin asset outputs up to date. No generated payload drift was found. Backup: `/home/eagles/dockerz/backups/manual-edits/20261120-ka134-generated-assets-parity/`.

### 2026-11-20: KA-135 dev restart and post-restart workflow health

- Dev restart completed from the workspace with all 72 migrations current; `/healthz` reported `status=ok` and the SIS file/database mirror was in sync. The connected authenticated parent profile form and admin parent-review queue both loaded after restart; the review queue returned 18 rows. At 320px and 390px, both pages had no document-level horizontal overflow. No real profile or review row was changed. Backup: `/home/eagles/dockerz/backups/manual-edits/20261120-ka135-post-restart-workflows/`.

### 2026-11-21: KA-181 nightly test-wide no-send proof

- The full `.env.test` nightly runner passed all 165 registered test files against `sis-test` in 1,106.3 seconds. It removed configured SMTP/Brevo credentials from suite children, pinned both outbound mail providers to an unbound loopback port, retained ordinary browser/web access, and verified the email-job, notification-queue, and provider-delivery database aggregates were unchanged before and after the suite. Prometheus reports successful smoke and no-send proof gauges; nightly failure and isolation alerts are inactive. The system-level timer is the only enabled nightly scheduler. Dev `/healthz` was `ok` with the SIS config copies in sync; it also reports runtime self-heal disabled and a stale maintenance check, which remain in the broader recovery audit. The existing `DevNewsOldReviewQueue` alert and review records were not changed. No production/admin runtime or data was changed. Backup: `/home/eagles/dockerz/backups/manual-edits/20261121-ka181-nightly-no-send-proof/`.

- 2026-11-22: KA-202 added identical 26-panel SIS live/admin and test Grafana operations dashboards, repaired unsupported student-write latency queries and the legacy PostgreSQL/Redis panel, and resolved node-exporter textfile scrape rejection from dev/test HELP-text drift plus a stale duplicate profile file. The collector reports `node_textfile_scrape_error=0`; dev/test scheduled monitors passed and the test dashboard rendered ten passing groups. Authenticated PostgreSQL and Redis status cards rendered UP on both pages after changing status cards to instant queries; live workflow count is explicitly 0 and the schedule panel records that no live workflow smoke is scheduled. Smoke-history panels carry each last result for ten minutes. Live workflow smoke, provider-specific API health, production save-stage telemetry, and MEGS monitoring remain gaps; no live synthetic workflow ran and no test suite was run.

- 2026-11-22: KA-203 corrected a stale critical Prometheus dependency-coverage threshold. The rule now validates the expected 8 live/admin SIS, 8 test-mirror SIS, and 6 LTD Redis-role series separately. The nightly test-mirror smoke timer is active at 04:00 ICT; the prior service run was intentionally stopped and is not counted as passing. `promtool` accepted all 104 rules; Prometheus reload cleared the false alert, and direct counts confirmed 8 admin / 8 test / 6 LTD series. After the required dev restart, `/healthz` is `ok` with config synced and all 20 dev/test logical monitor groups are successful and fresh. The system nightly timer remains enabled for 04:00 ICT; the previous invocation was user-stopped, and its last published no-send result remains successful but is aging. The real `DevNewsOldReviewQueue` remains open.

### 2026-11-22: KA-204 live/test operations dashboards and scheduled probes

- Expanded the paired SIS live/admin and test operations dashboards with ten-row smoke result tables, corrected the live subsystem count to sum all ten probes, and corrected the test smoke label selectors. The 26 panels remain structurally matched; smoke result tables have enough height to show all ten rows. Added checked/available series for the twelve fixed Dictionary Builder source IDs and read-only vendor checks for Brevo, Merriam-Webster, Google Forms discovery, CMUdict, Moodle/MEGS endpoint configuration, and both shared LanguageTool instances. The site dependency exporter now uses the existing canonical Brevo-webhook HELP text.
- Installed and enabled `site-dependency-monitor.timer` (60 seconds) and `sis-vendor-health-monitor.timer` (15 minutes); the immediate one-shot runs completed successfully. Prometheus accepted all 148 dashboard expressions. Both authenticated Grafana pages rendered 10/10 rows: test workflow checks and live read-only probes. `node_textfile_scrape_error=0`. Contract tests passed 14/14; Python monitor tests passed 10/10. Dev was restarted from `.env.dev` / `NODE_ENV=development`; `/healthz` is `ok` and the SIS config mirror is synced. Admin/live SIS was not restarted, deployed, or written.
- Current measured vendor results: live/test Merriam-Webster Collegiate and Learner's HTTP 200; both shared LanguageTool endpoints HTTP 200; test Brevo HTTP 200; live Brevo is unconfigured; Google Forms discovery has no live HTTP response and test returns 403. Moodle health and MEGS endpoints are unconfigured; the Moodle provisioning secret is configured only in live. Test Dictionary Builder checked seven of twelve sources, with Cambridge unavailable and five unchecked; live per-source Dictionary Builder previews are not scheduled. Student-save request and phase metrics have no samples, so latency remains an explicit instrumentation gap; PostgreSQL probe latency includes Docker/psql client startup, and no Redis exporter memory/client diagnostics are available. No live workflow write, email, grade submission, suite run, or app deployment occurred. Backup: `/home/eagles/dockerz/backups/manual-edits/20261122-ka204-monitoring-panels/`.

### 2026-11-22: KA-205 live/test monitoring feeds and Loki recovery

- The live/admin and test SIS dashboards now share an identical 31-panel structure and each display 20 current outcome rows. Live shows ten read-only checks plus ten vendor/configuration outcomes; test shows ten authenticated workflows plus the same ten vendor/configuration outcomes. Unconfigured services remain labeled `NOT CONFIGURED`; test Google Forms discovery and its vendor aggregate correctly show the observed HTTP 403. Live workflow writes and external sends remain held, and the live News/student-save instrumentation gaps remain explicit.
- Enabled cAdvisor, Loki, and Grafana Alloy in the monitoring Compose project; Prometheus scrapes all three and Grafana provisions the Loki datasource. cAdvisor returned 13 container memory series. Authenticated Redis role pings/latency and container CPU/memory are visible in the paired dashboards. The dedicated Redis exporter stays off because persistent read-only ACL support would require changing and restarting the shared Redis service; no application credential was reused.
- Loki initially rejected writes because its WAL shared a root filesystem already at 91.7%, above Loki's default 90% guard. The monitoring-only configuration preserves the WAL guard and raises it to 95%, exposes the measured pressure and guard counters on both dashboards, and retains the configured seven-day log retention. Alloy now parses Docker timestamp envelopes before the 30-minute stale-entry filter and stores reader offsets in a persistent volume. After restarting only Loki/Grafana Alloy monitoring components, a fresh allowlisted Prometheus log event was queried successfully from Loki; accepted writes returned HTTP 204 and there were no new write errors after the WAL guard change.
- Validation: Prometheus reported 20/20 active targets up and `node_textfile_scrape_error=0`; dashboard contracts passed 8/8; all 178 PromQL targets without Grafana macros evaluated without query errors, and both `$__range` student-save expressions validated using the dashboard's 24-hour range. Both authenticated Grafana pages provisioned 31 panels, displayed all 20 result rows, and showed the Loki panels without data-source errors. The live SIS application, live SIS data, and shared Redis service were not restarted or changed; the dev restart required by repository procedure completed with no pending migrations and `/healthz` returned `ok` with config copies synced. Backup: `/home/eagles/dockerz/backups/manual-edits/20261122-ka205-monitoring-feeds/`.


### 2026-11-22: KA-206 Student News grammar false-positive correction

- LanguageTool's `ARTICLE_MISSING` result is now ignored when a preceding possessive determiner already governs the matched noun phrase. The focused contract verifies both the false positive on “Pakistan's diplomatic role” and a genuinely missing determiner that must still block. The LanguageTool suite passed 14/14. The original reported involuntary logout remains an independent open reproduction item.

### 2026-11-22: KA-207 live feeds for paired SIS dashboards

- Added a live-only authenticated, fixed-word Dictionary Builder preview probe and fixed-provider metrics. It records only provider IDs, checked state, availability, success, duration, and freshness; it does not persist preview results or expose provider payloads. Six of twelve provider IDs were checked and available in the observed live run.
- Wired the live SIS process to export its existing authenticated request-stage metrics into node-exporter's textfile collector. The scrape is healthy (`node_textfile_scrape_error=0`); there are no live write samples yet, so request counters and stage latency remain correctly empty until real user writes occur. Loki is ready and its dashboard returns allowlisted monitoring-container logs. Redis role latency probes and cAdvisor CPU/memory feeds are active; a direct Redis exporter remains off until the shared server has a persistent read-only ACL.
- Both authenticated Grafana dashboards display 20 current outcomes and the Loki panel. Vendor and dashboard contracts passed 12/12 and 9/9. A failed live preview now marks the aggregate vendor monitor failed; malformed source rows are safely ignored. No live student writes, grade submissions, external messages, or Redis service changes occurred. The authorized live service restart only activated metrics export. Backup: `/home/eagles/dockerz/backups/manual-edits/20261122-dashboard-live-feeds/`.

### 2026-11-22: KA-227 local-only Moodle staging clone

- Prepared a private Moodle clone on loopback only. The application copy differs from live only in the staging `config.php`, and `moodledata/filedir` checksums match. The separate 690-table `moodle_stage` database has a dedicated database user; staging email is disabled, copied Redis session configuration was removed, `enrol_sis` points nowhere and has no secret, and Dry run remains enabled.
- Nginx binds the staging clone only to `127.0.0.1:18452`; its Moodle page returned HTTP 200. The test SIS secret files were not changed and no signed poll or provisioning command ran. The user is adding the staging hostname; authenticated external access and signed test-mirror provisioning remain open, so KA-158 is not complete. Disk cleanup removed 228 MB of regenerable root npm cache and left 9.3 GB free. Documentation backup: `/home/eagles/dockerz/backups/manual-edits/20261122-ka227-moodle-stage-prep/`.

### 2026-11-23: KA-228 dev/test engagement monitor refresh

- The environment-pinned `npm run monitor:engagement:dev` and `npm run monitor:engagement:test` runs both exited 0. Each authenticated its report API and exact `cmmark001` parent dashboard; all four engagement, parent-report, assignment-notification, and student-profile/enrollment groups passed, and the async worker heartbeat was fresh. Both metric files recorded zero due notifications, parent-report notifications, queued announcement jobs, enrollment conflicts/overlaps, and Moodle provisioning due/processing/rejected commands. No business data, email, Moodle request, or production/admin data changed. Only dev/test monitor metric artifacts were refreshed. This is partial evidence for the open profile/enrollment/notification/integration/monitor item: a zero SIS command queue and a local-only staging clone do not prove an external signed Moodle poll. The staging hostname is not present yet, so the integration gate remains open. Backup: `/home/eagles/dockerz/backups/manual-edits/20261123-ka228-engagement-monitor-refresh/`.

### 2026-11-23: KA-229 scrub copied live SIS settings from Moodle staging

- A fresh read-only audit contradicted KA-227's claim that the staging SIS URL and provisioning secret were empty. The isolated `moodle_stage` database still contained the live SIS origin (`https://admin.eagles.edu.vn`) and a copied provisioning secret; the secret value was never exposed. Unset both plugin settings using Moodle CLI, retained `dryrun=1`, purged only staging Moodle caches, and verified both settings absent and the loopback staging page HTTP 200. No SIS poll, provisioning command, live Moodle setting, live database, or production/admin SIS state changed. The staging host still needs test-only SIS URL/secret configuration after its domain is available. Backup: `/home/eagles/dockerz/backups/manual-edits/20261123-ka229-stage-config-scrub/`.

### 2026-11-23: KA-230 self-refreshing private dev database backup

- Dev `/healthz` exposed `database_health=warn`; the underlying `sis_dev` database check passed but `backup_stale=1`. The single system-level nightly backup unit reads the live/admin `.env`, and no dev backup schedule existed. Created a current custom-format dump using exact `.env.dev` environment pins, verified the archive with `pg_restore --list` and recorded its SHA-256. The direct one-off created `0664` files; corrected the dev-only backup directory to `0700` and all artifacts to `0600`. Added `tools/dev-db-backup-if-stale.mjs` as a preflight to the existing 15-minute `sis-db-health-dev.timer`: it requires the exact development env tuple, queries `current_database() = sis_dev`, checks the isolated latest metadata/archive, and refreshes only when missing, invalid, or older than 24 hours. It enforces private permissions and delegates retention to the existing failsafe tool (30 days, at least 14 dumps). Preflight failure does not prevent the read-only health check from publishing its stale-backup warning. Focused tests cover environment isolation, freshness, permissions, trigger behavior, wrong-database rejection, and the unit contract. The dev service returned overall health `ok`, `sis_dev` database status `ok`, and backup age zero. No production/admin backup job, database, service, or environment was changed. Backup: `/home/eagles/dockerz/backups/manual-edits/20261123-ka230-dev-db-backup-auto/`.

### 2026-11-23: KA-231 Moodle PHP 8.3 parity and staged recovery workflow

- Installed PHP 8.3.37 FPM and Moodle's required extensions while retaining PHP 8.2 FPM. Matched PHP-FPM pool and Moodle ini settings, switched only the live Moodle and staging Moodle Nginx vhosts to PHP 8.3, and validated Nginx. PHP 8.3 booted both Moodle apps; external live Moodle returned HTTP 200 and protected staging returned HTTP 401. Added an isolated staging status/refresh/restore script with private pre-refresh snapshots and stage safety settings, plus an operator runbook. The status and refresh dry-run gates passed. A live-to-stage refresh completed and created a restorable stage snapshot. Its first run then exposed an EXIT-trap scope error; the script was corrected and subsequent status and restore dry-run checks passed. Corrected the scheduler parser after it missed the active stage SIS task; a private compressed stage DB backup was verified, then that stage-only task was disabled and confirmed disabled. Temporary source SQL/config files were securely removed. No SIS admin mirror configuration or data changed; no SIS provisioning poll ran. Authenticated staging walkthrough remains open. Backup: `/home/eagles/dockerz/backups/manual-edits/20261123-ka231-moodle-stage-workflow/`.

### 2026-11-23: KA-232 paired live/test subsystem report feeds

- Rebuilt both authenticated Grafana reports with matching 61-panel layouts, 100 targets apiece, 20 outcome rows, 28-day historical cadence, and a one-minute refresh. Every panel target evaluated successfully and returned a result in Prometheus. Live vendor metrics test the configured SMTP relay without authenticating or sending, while test checks its Brevo API. Corrected the Google Forms check to represent the actual response-sheet Apps Script → signed SIS endpoint flow: the dashboard shows per-environment source grade counts/latest update, SIS endpoint-key presence, and authorized request outcomes without submitting a grade. Current data has zero live and three test Google Forms grade records; signed request counter series were absent, so the external trigger remains unverified. Public Google API discovery is no longer treated as grade health. Live Moodle is HTTP 200 and staging's Basic Auth 401 is treated as reachable. MEGS remains explicitly not configured because neither owned environment has a health endpoint. Vendor tests passed 15/15, dashboard contracts passed, Python compilation and generated JSON/JS checks passed, and the authenticated browser loaded both report pages. No message, form response, grade, customer workflow write, or live SIS change occurred. Backup: `/home/eagles/dockerz/backups/manual-edits/20261123-ka232-vendor-monitor-feeds/`.

### 2026-11-23: KA-233 installed-browser nightly and News/Library isolation

- Audited Playwright launches and made the nightly runner resolve an explicit installed browser path from `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, `CHROME_PATH`, or known system Chrome/Chromium locations. Updated specs that could otherwise fall back to Playwright's missing bundled browser. Admin performance, parent acknowledgment, portal audit, and News/Library lifecycle authenticated browser specs passed on `/usr/bin/google-chrome-stable`.
- Diagnosed the News/Library lifecycle false positive: the test read the first weekly aggregate, which included other existing student reports, and later selected a same-vocabulary report instead of its own. Gave the synthetic report a unique title and made the modal assertion locate that exact report. During rerun, concurrent search requests from input and form submission detached the Library result control; `loadLibrary` now ignores stale responses so an older query cannot overwrite newer results. The lifecycle test passed 1/1 with deterministic cleanup, and authenticated search passed at 1440px and 390px with results and no horizontal overflow.
- Full test sync to `/home/test.eagles.edu.vn` completed with no pending migrations. Portal source/runtime/public hashes matched, favicon and 320px checks passed, gzip/Brotli negotiation passed, and Lighthouse returned 100 Performance and Best Practices for admin, parent, and student. The full 171-file suite passed in 1,376.5 seconds using `.env.test`, `NODE_ENV=test`, and installed Chrome. The runner verified `current_database() = sis-test`; outbound message credentials were removed and SMTP/Brevo endpoints pinned to loopback; before/after delivery state matched and `no_external_message_proof=1`. Dev restart and health passed. No admin/live mirror was changed. This synthetic run does not reproduce or close the previously reported involuntary News logout. Backups: `/home/eagles/dockerz/backups/manual-edits/20261123-ka233-playwright-news-library/`, `/home/eagles/dockerz/backups/manual-edits/20261123-ka233-playwright-binary/`, `/home/eagles/dockerz/backups/manual-edits/20261123-ka233-news-week-aggregate/`, and `/home/eagles/dockerz/backups/manual-edits/20261123-ka233-library-load-race/`.

### 2026-11-27: Test Moodle provisioning queue repair

- The test provisioning queue had eight overdue synthetic commands. Staging had no SIS URL or secret, Dry run was on, and the scheduled task was disabled. A new test-owned `.env.test` key was installed in the repository and test runtime; staging was configured to the test SIS URL with Dry run off. The test API was restarted. An enabled `moodle-staging-cron.timer` now runs only `\enrol_sis\task\sync` once per minute as `stage8567`; general Moodle cron is not enabled by this timer. Staging mail remains disabled.
- The original synthetic batch could not be decrypted with any available test-owned backup key. Its exact SIS and staging database states were backed up, a redacted command audit was preserved, and only that `example.invalid` synthetic batch was removed. A fresh authenticated test create/update produced repeat command batches. Moodle applied user creation, encrypted password, cohort membership, and course enrollment; the missing `A1 Movers` course `idnumber` was mapped to the existing staging course. A replacement promotion receipt applied after the mapping repair.
- SIS reported zero due, processing, or rejected commands, and the `student_profile_enrollment` monitor passed. Same-command Moodle replay kept one idempotency record; duplicate SIS receipt returned `duplicate=true` with one receipt; invalid HMAC returned HTTP 401. No email jobs or Brevo deliveries were created in the smoke window, and staging retained `noemailever=1`. Production Moodle and admin/live SIS were not changed. The separate test `parent_profile` workflow remains failed; `hoc@eagles.edu.vn` is not configured in the test environment/database. Backup root: `/home/eagles/dockerz/backups/manual-edits/20261127-test-moodle-provisioning-fix/`.
