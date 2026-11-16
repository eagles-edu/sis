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
- [x] Set matching `SIS_ENV_FILE`, `DOTENV_CONFIG_PATH`, and `NODE_ENV` for every Prisma command. [KA-008]
- [x] Confirm `SELECT current_database()` before database tests or writes. [KA-008]
- [ ] Establish isolated synthetic records and deterministic cleanup in dev and test.
- [ ] Configure test notification recipients or a test transport so synthetic checks cannot message real people.
- [ ] Verify available alert routing and monitoring services without exposing credentials.
- [ ] Record baseline results and evidence for each subsystem before changing it.

## Parent invitation, draft, submission, approval, and profile update

- [ ] Trace manual link creation from admin action through invitation persistence and sharing.
- [ ] Trace link activation, password setup, parent session creation, linked child resolution, and profile redirect.
- [ ] Reproduce the reported failure in the affected environment without exposing parent or student data.
- [ ] Trace profile field edits through draft request, persistence, reload, and subsequent saves.
- [ ] Fix verified draft data loss while preserving earlier fields, signature, agreement, and explicit edits.
- [ ] Verify a saved draft remains visible after reload and can be edited and saved again.
- [ ] Trace submission validation, queue persistence, invitation status, and parent feedback.
- [ ] Verify submission places the changes in the review queue without updating the official profile.
- [ ] Provide and verify an accessible admin action to inspect submitted changes and approve or reject them.
- [ ] Fix approval so it applies valid fields to the correct official profile and retains signature and agreement data.
- [ ] Verify approval respects linked-child authorization, immutable fields, and field locks.
- [ ] Verify rejection retains an auditable decision and does not update the official profile.
- [ ] Verify failed approval reports the failure and does not falsely report a completed profile update.
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
- [ ] Verify formatted definitions survive save and reload.
- [ ] Verify repeat save is idempotent and synthetic cleanup can be repeated.
- [ ] Verify New Words forms omit admin-only Dictionary Builder, origin-analysis, and transitivity controls.
- [ ] Verify the protected student-only Merriam-Webster preview path.
- [ ] Test shared client and authoritative server validation, legacy entries, duplicates, and review outcomes.
- [ ] Run the authenticated visible save, reload, repeat-save, and cleanup browser checks.
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

- **KA-002** — Dev baseline: `sis_dev` confirmed with environment-pinned Prisma access; `/healthz` returned 200; focused parent draft and invitation contract specs passed (10/10). The exact parent account `cmmark001` is present in `.env.dev` only as a password hash; no matching plaintext password is configured, so the authenticated write workflow was not run. No DB writes or notifications were made. The code and spec remain under end-to-end review; this item is not complete.

- **KA-003** — Branch setup: created local `keep-alive,` from the synchronized starting HEAD, set upstream to `origin/keep-alive,`, and pushed the complete current branch history after each documentation milestone. Before this record, local HEAD and the remote branch both resolved to `f406825a`; worktree source/runtime changes remained uncommitted and untouched. Evidence: `git status --short --branch`, `git rev-parse HEAD`, and `git ls-remote origin refs/heads/keep-alive,`.

- **KA-004** — Source-control correction: at the user's direction, removed five ignored runtime artifacts (PID files, dev log, maintenance log, and test metrics) from Git tracking with `git rm --cached`; all five local runtime files remain on disk. `.gitignore` already contains exact ignore rules for those paths. This keeps operational state out of the public code repository.

- **KA-005** — Parent draft source checkpoint: committed the existing repeated-save merge and approval agreement handling with the new focused regression spec. `node --test test/parent-profile-draft-regression.spec.mjs test/parent-profile-invitation-contract.spec.mjs` passed 10/10 on dev. The authenticated browser write and approval path remains unverified because `.env.dev` has no usable password for the required `cmmark001` account; no DB writes or notification sends were performed. This reference does not mark the parent review item complete.

- **KA-006** — Preparation review completed in `/home/eagles/dockerz/sis` on `keep-alive,`: read `AGENTS.md`, `docs/CODE-EDITING-DOCS-INDEX.md`, `docs/sop.md`, `README.md`, `sis.md`, `docs/DOCUMENT-STATUS-AND-PARAMETER-AUDIT.md`, `docs/CORE-DESIGN-PARAMETERS.md`, `docs/mapping/admin-route-trace.md`, and `docs/security-and-backup-policy.md`, plus the parent/student surface manual. Confirmed cookie-session auth, linked-child scope, draft and submission route contracts, admin review routes, strict environment ownership, backup-first edits, and the dev-first workflow. Evidence: current document contents and `git status --short --branch` at `5338737624d1f884cd60c8470408ea2063125112`; no code, database, or environment configuration was changed by this review.

- **KA-007** — Parent profile route baseline comparison completed before the KA-005 source checkpoint. Compared `server/student-admin-routes.mjs` at last-pushed base `2c82cdaeaca7167b0f895137ebc83bc018cf7f15` with the exact matching copies in the 2026-11-16 live-admin and test-runtime backups (SHA-256 `f1dcc54e5a7c3c2b39642c364237cc461463169995c239fb9cf50bd80ed5dbf0` for all three). Reviewed the parent routes in `docs/mapping/admin-route-trace.md` and the source diff adding merged draft fields, cumulative diffs, preserved comments/agreement, and returning the persisted diff. Evidence: `git diff 2c82cdae..53387376 -- server/student-admin-routes.mjs test/parent-profile-draft-regression.spec.mjs`, backup hashes, and the route table. This closes the baseline-comparison preparation item only; the authenticated draft-to-approval workflow remains incomplete.

- **KA-008** — Dev environment boundary verified read-only in `/home/eagles/dockerz/sis`: executed `SELECT current_database()` through `getSharedPrismaClient` with `SIS_ENV_FILE=.env.dev`, `DOTENV_CONFIG_PATH=.env.dev`, and `NODE_ENV=development`; result was `sis_dev`. No `.env.test` or production `.env` fallback was used and no DB writes were made. Evidence: the command output for the environment-pinned query on 2026-11-17. This records the dev-only environment and query gate; it does not claim test/live verification.

- **KA-009** — Completed a source inventory of all checklist subsystems, mapping routes/pages, authorization boundaries, Prisma storage, external or worker dependencies, existing contract/regression tests, and known failures or unverified checks. Evidence: [keep-alive-inventory.md](keep-alive-inventory.md), `docs/mapping/admin-route-trace.md`, `prisma/schema.prisma`, module/test path inventory, and the current monitoring references. Confirmed gaps are recorded as gaps rather than treated as passing checks.
