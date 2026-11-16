# Mission-Critical SIS Keep-Alive Development Checklist

## Completion rule

- [ ] Leave every item unchecked until it has been performed and verified.
- [ ] For each completed item, record the environment, test or monitor, result, and evidence reference beside the item or in a linked evidence record.
- [ ] Record failures, blocked checks, and limitations without marking them complete.
- [ ] Do not treat a passing build, process health, or an unauthenticated request as proof of an authenticated user workflow.
- [ ] Do not claim continuous availability or automatic repair of every possible failure.

## Preparation and environment boundaries

- [x] Read `AGENTS.md`, `docs/CODE-EDITING-DOCS-INDEX.md`, `docs/sop.md`, `sis.md`, and the applicable surface and route contracts. [KA-006]
- [x] Record the current Git branch, upstream, remote visibility, and unrelated dirty files before making changes. [KA-001, KA-004]
- [ ] Review the existing uncommitted parent draft and approval changes and their regression test; retain or revise them based on end-to-end evidence. [KA-002, KA-005: end-to-end gate incomplete]
- [ ] Preserve unrelated changes and establish a current backup before each file edit.
- [x] Compare the last pushed implementation, relevant backups, and route documentation before changing a route contract. [KA-007]
- [x] Inventory each subsystem's entry points, authorization, storage, dependencies, existing tests, and known failures. [KA-009]
- [x] Pin `.env.dev`, `.env.test`, or `.env` to its owning environment; never use one environment's credentials or configuration as another's fallback. [KA-008]
- [x] Set matching `SIS_ENV_FILE`, `DOTENV_CONFIG_PATH`, and `NODE_ENV` for every Prisma command. [KA-008, KA-011]
- [x] Confirm `SELECT current_database()` before database tests or writes. [KA-008, KA-010]
- [x] Establish isolated synthetic records and deterministic cleanup in dev and test. [KA-010, KA-012]
- [x] Configure test notification recipients or a test transport so synthetic checks cannot message real people. [KA-010, KA-013]
- [x] Verify available alert routing and monitoring services without exposing credentials. [KA-014]
- [ ] Record baseline results and evidence for each subsystem before changing it.

## Parent invitation, draft, submission, approval, and profile update

- [x] Trace manual link creation from admin action through invitation persistence and sharing. [KA-015]
- [x] Trace link activation, password setup, parent session creation, linked child resolution, and profile redirect. [KA-016]
- [ ] Reproduce the reported failure in the affected environment without exposing parent or student data.
- [x] Trace profile field edits through draft request, persistence, reload, and subsequent saves. [KA-017]
- [x] Fix verified draft data loss while preserving earlier fields, signature, agreement, and explicit edits. [KA-017]
- [ ] Verify a saved draft remains visible after reload and can be edited and saved again.
- [x] Trace submission validation, queue persistence, invitation status, and parent feedback. [KA-018]
- [x] Verify submission places the changes in the review queue without updating the official profile. [KA-019; isolated synthetic regression and route contract; authenticated database submission remains open]
- [x] Provide and verify an accessible admin action to inspect submitted changes and approve or reject them. [KA-020; UI contract and authenticated dev browser verified]
- [x] Fix approval so it applies valid fields to the correct official profile and retains signature and agreement data. [KA-021; isolated route-path regression]
- [x] Verify approval respects linked-child authorization, immutable fields, and field locks. [KA-022; isolated parent/admin route regressions]
- [x] Verify rejection retains an auditable decision and does not update the official profile. [KA-023; isolated route-path regression]
- [x] Verify failed approval reports the failure and does not falsely report a completed profile update. [KA-024; isolated route and HTTP error-path regression]
- [ ] Test expired or reused links, unlinked children, missing signatures, and missing agreement.
- [ ] Test repeated draft saves, repeated submission and review actions, concurrent edits, and partial failures.
- [ ] Add an authenticated end-to-end regression from manual invitation through approval and persisted profile reload.
- [ ] Determine and record why existing tests did not catch the observed regression.
- [ ] Add a functional monitor for invitation, draft, submission, review, and approval using isolated synthetic data.
- [ ] Record browser, database, queue, regression, and monitor evidence for this pathway.

## Engagement systems

- [ ] Trace engagement events from parent and student interactions through ingestion, aggregation, retention, and admin display.
- [ ] Identify accounts, event types, and reporting periods used by each engagement surface.
- [ ] Reproduce and fix verified missing, delayed, duplicated, or incorrectly attributed events.
- [ ] Test event ingestion and aggregation for synthetic parent and student activity.
- [ ] Test access control, empty results, delayed processing, and retention boundaries.
- [ ] Test duplicate events and ensure student and family data do not cross account boundaries.
- [ ] Monitor ingestion freshness, processing failures, reporting availability, and worker staleness.
- [ ] Record regression and monitoring evidence for each engagement workflow.

## Student Library

- [ ] Trace student Library access, New Words entry, draft save, submission, review, and result display.
- [ ] Reproduce and fix verified failures in the student Library lifecycle.
- [x] Verify formatted definitions survive save and reload. [KA-012]
- [x] Verify repeat save is idempotent and synthetic cleanup can be repeated. [KA-012]
- [x] Verify New Words forms omit admin-only Dictionary Builder, origin-analysis, and transitivity controls. [KA-012]
- [ ] Verify the protected student-only Merriam-Webster preview path.
- [ ] Test shared client and authoritative server validation, legacy entries, duplicates, and review outcomes.
- [x] Run the authenticated visible save, reload, repeat-save, and cleanup browser checks. [KA-012]
- [ ] Monitor Library access, save failures, review failures, queue age, and required dependencies.
- [ ] Record regression, authenticated browser, cleanup, and monitor evidence.

## News reports, vocabulary, and grammar checks

- [ ] Trace News draft, autosave, reload, grammar and vocabulary checks, submission, review, revision, and resubmission.
- [ ] Reproduce and fix verified failures in each News lifecycle stage.
- [ ] Verify formatted vocabulary definitions remain consistent between News and Library.
- [ ] Verify shared authoritative syllabication, written division, and primary-stress validation.
- [ ] Verify valid uppercase stress remains reversible and canonical accented output is retained.
- [ ] Test authoritative mismatches, unknown words, and invalid syllable divisions and stress.
- [ ] Test LanguageTool and dictionary success, confirmed miss, timeout, rate limit, missing key, and unavailable-service behavior.
- [ ] Verify provider credentials and raw provider responses never reach browser payloads or logs.
- [ ] Test News review, revision feedback, repeat submission, and failure recovery.
- [ ] Monitor check latency, provider availability, submission failures, and review queue age.
- [ ] Record News, grammar, vocabulary, provider, and monitor evidence.

## Admin definitions and Dictionary Builder

- [ ] Trace Dictionary Builder lookup, definition editing, formatted paste, preview, save, reload, and Library propagation.
- [ ] Reproduce and fix verified definition or builder failures.
- [ ] Verify formatted text, lists, examples, and other supported definition structures persist and render correctly.
- [ ] Test authorized and unauthorized access, duplicate entries, large definitions, and malformed input.
- [ ] Test provider misses, temporary failures, retry behavior, and recovery.
- [ ] Monitor definition save failures and provider availability without recording definitions or credentials.
- [ ] Record admin browser, persistence, formatting, regression, and monitor evidence.

## Assignments and notifications

- [ ] Trace assignment creation, targeting, editing, publication, student visibility, completion, and status updates.
- [ ] Reproduce and fix verified assignment lifecycle failures.
- [ ] Trace notification creation, queueing, dispatch, delivery status, retry, and failure reporting.
- [ ] Verify synthetic notifications use an isolated recipient or test transport.
- [ ] Test assignment targeting, authorization, due dates, and student-visible status.
- [ ] Test duplicate dispatch, retry idempotency, provider outages, stale jobs, and recovery.
- [ ] Verify failed delivery remains visible for investigation and does not report false success.
- [ ] Monitor assignment and notification queue age, worker health, delivery failures, and stale checks.
- [ ] Record assignment, notification, idempotency, cleanup, and monitor evidence.

## Grades, external exercise feeds, and tables

- [ ] Trace grade entry, editing, persistence, calculations, and student and parent visibility.
- [ ] Trace external exercise intake through validation, matching, queue handling, grade creation, and table display.
- [ ] Reproduce and fix verified grade, feed, or table failures.
- [ ] Test authorized grade changes, calculations, persistence, and cross-portal consistency.
- [ ] Test duplicate feed results, unmatched students, malformed input, and retry behavior.
- [ ] Test table sorting, filtering, pagination, access control, and empty states.
- [ ] Monitor feed freshness, ingestion failures, unmatched backlog, grade-write failures, and table availability.
- [ ] Record regression, data consistency, feed, table, and monitor evidence.

## Attendance

- [ ] Trace school setup, roster selection, attendance entry, save, reload, and reporting.
- [ ] Verify stored school setup supplies the authoritative dates and term boundaries.
- [ ] Reproduce and fix verified attendance failures.
- [ ] Test attendance persistence, repeated saves, roster consistency, and authorized access.
- [ ] Test missing or invalid school setup, date boundaries, concurrent edits, and failure reporting.
- [ ] Monitor attendance save failures, configuration validity, and reporting availability.
- [ ] Record browser, persistence, regression, and monitor evidence.

## Parent site, profiles, performance reports, and notifications

- [ ] Trace authenticated parent login, linked-child selection, profile access, report delivery, viewing, and acknowledgment.
- [ ] Trace parent notification creation, delivery status, and visible report state.
- [ ] Reproduce and fix verified parent portal, report, or notification failures.
- [ ] Verify parent-facing profile and report data match authoritative records.
- [ ] Test multiple children, unauthorized access, missing reports, acknowledgment retries, and notification failures.
- [ ] Verify affected portal surfaces in an authenticated desktop and mobile browser.
- [ ] Monitor parent authentication, report availability, acknowledgment errors, notification backlog, and performance.
- [ ] Record browser, report, notification, performance, and monitor evidence.

## Student profiles, enrollment, and notifications

- [ ] Trace student creation, profile edits, family linkage, enrollment periods, roster inclusion, and notifications.
- [ ] Trace archive, reactivation, and student and parent portal visibility.
- [ ] Reproduce and fix verified profile, family, enrollment, or notification failures.
- [ ] Test profile persistence, family changes, access control, and cross-portal consistency.
- [ ] Test enrollment idempotency, overlapping periods, archive and reactivation, and failure recovery.
- [ ] Verify SIS-to-Moodle provisioning remains students-only, signed-outbox, and SIS-owned for enrollments.
- [ ] Verify `username = eaglesId`, `idnumber = studentNumber`, `Eagles Club`, and delete-only-if-clean behavior where applicable.
- [ ] Keep `enrol_sis` Dry run enabled unless imports are explicitly authorized.
- [ ] Monitor profile and enrollment writes, consistency failures, provisioning queue age, and notification delivery.
- [ ] Record profile, enrollment, notification, integration, and monitor evidence.

## Monitoring workers, alerts, retries, and controlled restarts

- [ ] Inventory the active monitoring stack, alert rules, service supervision, existing workers, and available alert receiver.
- [ ] Define a separate logical worker or independently reported check group for each subsystem above.
- [ ] Define each check's environment, frequency, timeout, dependencies, ownership, and safe synthetic-data lifecycle.
- [ ] Implement per-check last success, result, duration, failure reason, and stale-monitor reporting.
- [ ] Route actionable failure and recovery alerts through the verified configured monitoring channel.
- [ ] Exclude student data, passwords, session cookies, request bodies, provider secrets, and notification credentials from monitoring output.
- [ ] Use isolated synthetic write checks in dev and test with deterministic cleanup.
- [ ] Use read-only live checks unless an explicitly isolated synthetic workflow is available.
- [ ] Prevent synthetic probes from sending real messages or duplicating external deliveries.
- [ ] Implement bounded retries only for operations proven idempotent.
- [ ] Implement controlled service restarts with failure thresholds, cooldowns, and restart limits.
- [ ] Alert when retries or restarts fail or reach their limits.
- [ ] Prevent automatic student-data changes, code deployment, and database migrations as recovery actions.
- [ ] Limit AI assistance to diagnosis and proposed repairs within the same recovery boundaries.
- [ ] Test monitor failure, stale results, alert delivery, recovery notification, retries, restart cooldowns, and restart limits.
- [ ] Test cleanup after interrupted probes and verify no synthetic records or queued messages remain.
- [ ] Record worker configuration, alert tests, recovery tests, and operational evidence.

## Combined regression testing and rollout

- [ ] Run focused regression tests for every subsystem and record results.
- [ ] Run the critical workflows together to detect shared dependency and cross-system regressions.
- [ ] Verify authenticated desktop and mobile portal workflows for each affected surface.
- [ ] Rebuild required generated assets and verify source-to-generated parity.
- [ ] Restart the dev runtime after edits and verify dev health and the affected workflows.
- [ ] Verify test-mirror backup, whitelist sync, generated-asset parity, restart, health, routes, and required performance gates.
- [ ] Run the functional checks and monitor failure simulations against the test mirror.
- [ ] Complete the live/admin backup and guarded deployment only after dev and test proof.
- [ ] Verify live/admin health, source and asset parity, authorized read-only checks, monitor status, and alert delivery.
- [ ] Verify the branch, upstream, remote visibility, and publication scope before any push.
- [ ] Review staged changes for secrets, student data, backups, runtime data, and authenticated captures.
- [ ] Commit and publish only authorized, reviewed changes while preserving unrelated dirty work.
- [ ] Record per-subsystem results, environment, evidence, remaining gaps, and monitoring coverage.


## Evidence references

- **KA-001** — 2026-11-17 dev workspace: starting branch `migrate/full-sync-parity-audit-skill` tracked `origin/migrate/full-sync-parity-audit-skill`; local HEAD and upstream both resolved to `2c82cdaeaca7167b0f895137ebc83bc018cf7f15`; `eagles-edu/sis` is public with default branch `syllables`. Recorded pre-existing dirty paths: `.gitignore`, `runtime-data/dev-async-worker.pid`, `runtime-data/dev-runtime.log`, `runtime-data/dev-runtime.pid`, `runtime-data/maintenance-reports/sis-config-repair-cron.log`, `runtime-data/prometheus/sis-test-request-metrics.prom`, `server/student-admin-routes.mjs`, and `test/parent-profile-draft-regression.spec.mjs`. Runtime paths remain outside commits. Evidence: `git status --short --branch`, `git rev-list --left-right --count @{u}...HEAD`, `gh repo view eagles-edu/sis --json visibility,defaultBranchRef,url`, and `git ls-remote origin`.

- **KA-002** — Dev baseline: `sis_dev` confirmed with environment-pinned Prisma access; `/healthz` returned 200; focused parent draft and invitation contract specs passed (10/10). `.env.dev` contains the exact `cmmark001` account in `STUDENT_PARENT_PORTAL_ACCOUNTS_JSON` using `parentsId` and a password. The earlier credential check searched only for `username` and missed this account shape. The authenticated write workflow was not run at that time. No DB writes or notifications were made. The code and spec remain under end-to-end review; this item is not complete.

- **KA-003** — Branch setup: created local `keep-alive,` from the synchronized starting HEAD, set upstream to `origin/keep-alive,`, and pushed the complete current branch history after each documentation milestone. Before this record, local HEAD and the remote branch both resolved to `f406825a`; worktree source/runtime changes remained uncommitted and untouched. Evidence: `git status --short --branch`, `git rev-parse HEAD`, and `git ls-remote origin refs/heads/keep-alive,`.

- **KA-004** — Source-control correction: at the user's direction, removed five ignored runtime artifacts (PID files, dev log, maintenance log, and test metrics) from Git tracking with `git rm --cached`; all five local runtime files remain on disk. `.gitignore` already contains exact ignore rules for those paths. This keeps operational state out of the public code repository.

- **KA-005** — Parent draft source checkpoint: committed the existing repeated-save merge and approval agreement handling with the new focused regression spec. `node --test test/parent-profile-draft-regression.spec.mjs test/parent-profile-invitation-contract.spec.mjs` passed 10/10 on dev. The original note that `.env.dev` had no usable password for `cmmark001` was incorrect: the account is configured in `STUDENT_PARENT_PORTAL_ACCOUNTS_JSON` with the `parentsId` property, not `username`, and its password is configured. The authenticated database write and approval path was not run at that checkpoint; no DB writes or notification sends were performed. This reference does not mark the parent review item complete.

- **KA-006** — Preparation review completed in `/home/eagles/dockerz/sis` on `keep-alive,`: read `AGENTS.md`, `docs/CODE-EDITING-DOCS-INDEX.md`, `docs/sop.md`, `README.md`, `sis.md`, `docs/DOCUMENT-STATUS-AND-PARAMETER-AUDIT.md`, `docs/CORE-DESIGN-PARAMETERS.md`, `docs/mapping/admin-route-trace.md`, and `docs/security-and-backup-policy.md`, plus the parent/student surface manual. Confirmed cookie-session auth, linked-child scope, draft and submission route contracts, admin review routes, strict environment ownership, backup-first edits, and the dev-first workflow. Evidence: current document contents and `git status --short --branch` at `5338737624d1f884cd60c8470408ea2063125112`; no code, database, or environment configuration was changed by this review.

- **KA-007** — Parent profile route baseline comparison completed before the KA-005 source checkpoint. Compared `server/student-admin-routes.mjs` at last-pushed base `2c82cdaeaca7167b0f895137ebc83bc018cf7f15` with the exact matching copies in the 2026-11-16 live-admin and test-runtime backups (SHA-256 `f1dcc54e5a7c3c2b39642c364237cc461463169995c239fb9cf50bd80ed5dbf0` for all three). Reviewed the parent routes in `docs/mapping/admin-route-trace.md` and the source diff adding merged draft fields, cumulative diffs, preserved comments/agreement, and returning the persisted diff. Evidence: `git diff 2c82cdae..53387376 -- server/student-admin-routes.mjs test/parent-profile-draft-regression.spec.mjs`, backup hashes, and the route table. This closes the baseline-comparison preparation item only; the authenticated draft-to-approval workflow remains incomplete.

- **KA-008** — Dev environment boundary verified read-only in `/home/eagles/dockerz/sis`: executed `SELECT current_database()` through `getSharedPrismaClient` with `SIS_ENV_FILE=.env.dev`, `DOTENV_CONFIG_PATH=.env.dev`, and `NODE_ENV=development`; result was `sis_dev`. No `.env.test` or production `.env` fallback was used and no DB writes were made. Evidence: the command output for the environment-pinned query on 2026-11-17. This records the dev-only environment and query gate; it does not claim test/live verification.

- **KA-009** — Completed a source inventory of all checklist subsystems, mapping routes/pages, authorization boundaries, Prisma storage, external or worker dependencies, existing contract/regression tests, and known failures or unverified checks. Evidence: [keep-alive-inventory.md](keep-alive-inventory.md), `docs/mapping/admin-route-trace.md`, `prisma/schema.prisma`, module/test path inventory, and the current monitoring references. Confirmed gaps are recorded as gaps rather than treated as passing checks.

- **KA-010** — Test-mirror fixture isolation: updated the assignment-reminder idempotency, Library assignment email, and Brevo webhook integration specs to pin `.env.test` with matching `SIS_ENV_FILE`, `DOTENV_CONFIG_PATH`, and `NODE_ENV`; use UUID-scoped synthetic records and reserved `example.invalid` recipients; and attempt full cleanup even after setup or assertion failures. The assignment-reminder spec keeps async side-effect jobs in test-only memory storage so the active test worker cannot send its synthetic queue item. Confirmed `sis-test` before the run; all three specs passed. Post-run aggregate queries found zero matching synthetic students, templates, reminder dispatches, webhook deliveries/events, or invalid-recipient notifications; the database async-job aggregate remained the three pre-existing succeeded jobs. Evidence: `node --check` on all three specs, `git diff --check`, the focused `node --test` run on 2026-11-17, and environment-pinned post-run cleanup counts. This verifies the three test-mirror fixtures only; dev synthetic cleanup and repository-wide notification isolation remain open.

- **KA-011** — Completed the Prisma environment audit. Added a fail-closed environment checker for the database-backed test runner, diagnostics, watch command, and authenticated Playwright specs; updated environment-specific npm scripts and `start`/`dev` to pass all three matching variables; and pinned the previously bare live Prisma wrappers in `deploy-db-fields-safe.sh`, `deploy-api-safe.sh`, `sis-runtime-resync.sh`, and the live branch of `sync-and-restart-runtimes.sh`. The dev-only SIS config database specs now run only with the exact `.env.dev`/`development` pair, so test/live suites cannot redirect them to dev. Bare `db:*` package scripts still require an explicit caller environment and Prisma config rejects missing or mismatched values. Evidence: repository-wide CLI and test-fallback searches; `node --check`, `bash -n`, and package JSON validation; valid dev/test/live checker invocations plus rejection of missing and mismatched variables; `test/sis-config-store.spec.mjs` under `.env.test` passed 11 tests and skipped its three dev-only DB tests; and 22 existing runtime/deploy contract tests passed. No Prisma CLI, migration, or live database operation was run.

- **KA-012** — Dev Student Library/New Words verification: upgraded the authenticated Library edit-submit and News/New Words lifecycle specs to UUID-scoped fixtures with deterministic identifiers, partial-setup cleanup, repeated idempotent cleanup, and cleanup errors that fail the spec. With `.env.dev`, `NODE_ENV=development`, and `SELECT current_database()` confirmed as `sis_dev`, Chromium ran the visible `mark001` login and both browser specs passed. Verified formatted News definition persistence, Library contribution edits, New Words repeat-save idempotency, reload persistence, and absence of admin-only New Words controls. After both cleanup passes, environment-pinned aggregate queries returned zero matching synthetic reports, New Words rows, Library entries/contributions, or invalid-recipient notifications; the temporary authenticated screenshot was removed. Dev `/healthz` returned 200. Evidence: `node --check`, `git diff --check`, the focused Playwright specs on 2026-11-17, and post-run aggregate counts. This does not verify parent workflows or live/test UI behavior.
- **KA-013** — Test notification isolation completed. The synthetic assignment-reminder and Library-assignment specs use UUID-scoped `@example.invalid` recipients; the reminder spec disables database-backed async jobs in the test process, and the Library spec removes its queued notification/job during cleanup. The Brevo webhook lifecycle spec uses an injected mock transporter and `@example.invalid` records. The report-flow browser fixture also injects a mock transporter. With the test environment triplet pinned, `SELECT current_database()` returned `sis-test`; all three focused notification integration specs passed. Post-run read-only aggregates found zero `@example.invalid` notification queue rows, active async jobs, Library/assignment reminder engagement rows, Brevo deliveries, or webhook events. Evidence: focused `node --test` run on 2026-11-17 and environment-pinned aggregate query. This isolates the reviewed synthetic notification checks; it does not verify live delivery or every provider outage path.
- **KA-014** — Monitoring and alert-routing availability verified without reading or printing credential values. The active monitoring Compose profile contains Prometheus, Grafana, node-exporter, and blackbox-exporter; a process-exporter container is also currently running as an on-demand diagnostic. Prometheus `/api/v1/targets` returned HTTP 200 with four of four targets `up`; `/api/v1/rules` returned three inactive rules and `/api/v1/alerts` returned no active alerts. Alertmanager is absent from the active profile and container list, `127.0.0.1:9093/-/healthy` is unavailable, Prometheus has no alerting configuration, and the checked-in Alertmanager config has no webhook receiver. The ignored Slack webhook file exists with mode `0600`, but it is not wired to an active receiver. Evidence: `docker compose config --services`, running-container inventory, Prometheus API summaries, Alertmanager config shape, and loopback health probe on 2026-11-17. External alert delivery is not available or verified; routing tests remain open.
- **KA-015** — Manual parent-link creation traced from the admin profile action through persistence and handoff. `copyParentProfileLink()` posts the selected student ID; the admin route requires `canManageUsers`, calls `createParentProfileInvitation` with email sending disabled and URL return enabled, and returns the one-time URL for clipboard sharing. The invitation service validates the configured public origin before writes, ensures and links the parent account, supersedes prior open invitations, stores only a token hash, and returns the plaintext token only in the URL response. The focused contract suite passed 9/9, including the copy-link/no-email path and origin-before-transaction check. Evidence: `web-asset/admin/student-admin.js`, `server/student-admin-routes.mjs`, `src/modules/admin/parent-profile-invitations.mjs`, and `node --test test/parent-profile-invitation-contract.spec.mjs` on 2026-11-17. This traces manual link creation only; email invitations and parent activation remain open.
- **KA-016** — Traced invitation activation through parent-session and child resolution. The one-time link GET validates/marks the token and redirects to `/parent?activate=...`; the portal exchanges it at `/api/parent/auth/activation/exchange`, where the server atomically redeems it and issues the parent session cookie. New accounts enter required-password setup; the authenticated set-password route hashes the replacement password and rotates the session. Parent child reads require that session and resolve linked children by `parentAccountId`, with the documented `Parents ID`/account-email profile matches included in the result. The parent client then hydrates the dashboard and handles the child-page route state. The focused parent UI and invitation contract suites passed 30/30; the activation UI test verifies query-token exchange, URL cleanup, and password-setup display. Evidence: `server/student-admin-routes.mjs`, `src/modules/admin/parent-profile-invitations.mjs`, `web-asset/parent/parent-portal.js`, and focused `node --test` run on 2026-11-17. Database invitation redemption and password setup remain unverified. A connected dev browser session for `cmmark001` was confirmed later; that session does not prove the invitation-activation flow.
- **KA-017** — Reproduced the parent draft reload gap in the last-pushed source path: the linked-child profile GET returned the official profile and lock metadata but never loaded the parent/student-scoped saved draft; `loadChildProfile()` reset the local patch and rendered only the official profile, hiding draft-only values after reload. The route now loads the newest `draft` row for the authenticated parent account and linked student (with matching volatile-storage behavior), returns it separately, and the parent UI overlays it on the official profile for editing. The existing save path continues merging later field edits into the stored draft. Updated `docs/mapping/admin-route-trace.md`. Source comparison confirmed the prior GET block matched the live-admin and test-runtime backups (SHA-256 `dc23faf5c61a594f127c6927ad58bd6d3484ec22716fcf064471c40286112e52`). Regression coverage passed 25/25 across the parent UI and draft suites; the parent minified JS and source map were rebuilt and `node tools/build-admin-assets.mjs --check` passed. Dev restarted; `/healthz` returned 200 and the served parent bundle hash matched the local generated bundle. No database writes were made. The connected dev browser is authenticated as `cmmark001`, but the linked child has no saved draft, so visible saved-draft reload and repeat-save remain unverified. Evidence: focused `node --test test/parent-profile-draft-regression.spec.mjs test/parent-portal-ui.spec.mjs` run and source/backup comparison on 2026-11-17.
- **KA-018** — Traced parent submission validation and feedback. The client saves pending field edits first, requires signature name, signature email, and explicit agreement, then posts the submission; missing signature data keeps the request from being sent and shows a visible correction message. The server re-resolves the linked child, submits only the latest draft scoped to the parent account and student after the same signature checks, sets its queue status and timestamp, marks the invitation completed, and returns the submission ID/status. This route does not write the official `StudentProfile`; the parent UI reports submission to review. The response also contains `notifications.email: "received"`, although this route does not invoke an email provider and the parent UI does not display that field; its intended semantics remain to verify. Evidence: `web-asset/parent/parent-portal.js`, `server/student-admin-routes.mjs`, `test/parent-portal-ui.spec.mjs` missing-signature gate, and `test/parent-profile-invitation-contract.spec.mjs` signature contract; the focused parent suite passed 25/25 on 2026-11-17. No authenticated database submission or email delivery was run; those gates remain open.
- **KA-019** — Added an isolated synthetic regression for parent submission queueing. A synthetic saved draft with complete signature data changes from `draft` to `submitted`, remains visible from the submitted review-queue query, and retains the exact proposed payload. The test tracks the mocked official profile and asserts it remains unchanged with zero profile create/update calls; it also checks the parent submit route delegates to the queue helper and contains no official-profile write. Focused `node --check test/parent-profile-draft-regression.spec.mjs` and `node --test test/parent-profile-draft-regression.spec.mjs` passed (4/4) on 2026-11-17. This is isolated helper/route-contract evidence, not a database-backed endpoint submission. The connected dev browser session is authenticated as `cmmark001`, but the linked real child has no saved draft; no real profile or queue row was changed. Authenticated database submission and notification delivery remain open.
- **KA-020** — Added a manager-only Parent Profile Reviews panel to Family Lookup with a refreshable submitted-change queue, accessible per-submission detail disclosure, field-by-field before/after values, approval confirmation, and required rejection reason. UI tests verify the approve/reject request payloads, rejection reason gate, queue refresh, and hidden/no-fetch behavior for a non-manager; focused review tests passed 2/2. `npm run build:admin-assets`, `npm run build:admin-assets:check`, syntax checks, and `git diff --check` passed. Restarted dev with the owned `.env.dev` triplet; the restart reported dev health OK and no pending migrations. The connected authenticated admin browser loaded the real queue without changing submissions; desktop and 390x844 mobile render checks confirmed the list uses a 12px shared-token gap, cards have 12px inset padding, and neither page nor review panel overflows horizontally. Existing queue records were inspected only; approve/reject API mutations against a real submission remain for the following end-to-end checklist items.
- **KA-021** — Added a route-path regression using an isolated synthetic submitted record and mocked Prisma calls. It verifies approval looks up and updates the official profile using the submission's linked `studentRefId`, writes permitted profile fields, excludes immutable and unsupported fields, preserves prior raw/normalized payload values, retains signature name/email and agreement in the JSON evidence while keeping the agreement out of nonexistent scalar storage, records approved status/reviewer/diff, and returns success only after the profile update. `node --check test/parent-profile-draft-regression.spec.mjs` and the focused suite passed 5/5. The existing route already met these assertions, so no runtime behavior change was needed. This is isolated route-path evidence; a real database-backed approval and persisted reload remain open for the later authenticated end-to-end item.
- **KA-022** — Added isolated route-path regressions for parent-child authorization and profile field locks. A parent submission is scoped to the authenticated parent account and the linked child's `studentRefId`; an unlinked child receives 403 without queue submission or invitation completion. Approval checks field locks against the submitted student, returns 409 with `lock-conflict`, and makes no official-profile persistence call. KA-021 separately verifies immutable identity fields are excluded from writes. The focused parent draft suite passed 7/7; these checks use synthetic route fixtures and mock storage, with no database writes or changes to existing submissions. No runtime behavior change was needed because the current route already enforced these contracts.
- **KA-023** — Hardened the admin rejection route to require a non-empty rejection reason server-side before changing queue state. The synthetic route regression verifies a missing reason returns 400 and performs no queue update; a supplied reason records `rejected`, the reason, reviewer, and review time, returns the rejected item, and does not access official-profile storage. The combined parent draft and invitation contract suites passed 17/17, syntax checks and `git diff --check` passed. No real submission or profile was changed.
- **KA-024** — Added an isolated synthetic failure-path regression for admin approval. A mocked official-profile update failure returns the same 503 through the route's shared HTTP error handler, records `failurePoint=merge-write` and the failure reason, leaves the submission `submitted`, and sends no approved action/item response. The combined parent draft and invitation contract suites passed 18/18; `node --check` and `git diff --check` passed. No production code or real profile/queue record changed.
