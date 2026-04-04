# SIS (Student Information System)

![Node.js](https://img.shields.io/badge/Node.js-20.19.4-339933?logo=node.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?logo=javascript&logoColor=111)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-Optional_Sessions-DC382D?logo=redis&logoColor=white)
![HTML](https://img.shields.io/badge/Admin_UI-HTML/CSS/JS-E34F26?logo=html5&logoColor=white)
![License](https://img.shields.io/badge/License-ISC-blue)

Standalone SIS backend and admin UI workspace.

## Purpose

This service is the operational backend for:

- Student account/profile management
- Student roster imports from spreadsheet files
- Attendance, grades, and parent-report tracking
- Exercise result intake and review
- Session-based admin access control
- Export/report generation workflows

Project root:

- `/home/eagles/dockerz/sis`

Production runtime root:

- `/home/admin.eagles.edu.vn/sis`

## Stack

- Runtime: Node.js `v20.19.4`
- Language: JavaScript (ESM)
- API service entrypoint: `server/exercise-mailer.mjs`
- Database: PostgreSQL (via Prisma)
- Optional session backend: Redis
- Admin UI: `web-asset/admin/student-admin.html`

## Directory Map

- `server/` API handlers, store logic, auth/session, report generation
- `prisma/` schema + migrations
- `schemas/` intake schema + import template workbook
- `web-asset/admin/` admin UI
- `test/` node test suite
- `tools/` operational scripts (deploy, backup, restore)

## Architecture Mapping Stack

Runnable mapping assets are in `docs/mapping/`.

- Mermaid diagrams: `docs/mapping/mermaid/*.mmd`
- Structurizr DSL: `docs/mapping/structurizr/workspace.dsl`
- OpenAPI baseline: `docs/mapping/openapi/sis-admin.openapi.yaml`
- Generated outputs: `docs/mapping/out/`

Commands:

```bash
npm run map:deps
npm run map:openapi:lint
npm run map:openapi:build
npm run map:all
```

## Quick Start

```bash
cd /home/eagles/dockerz/sis
npm install
npm test
cp -n .env.dev.example .env.dev
npm run dev
# production-mode boot (uses .env and fixed live port contract)
npm start
```

## Dev/Live Separation

- Dedicated port contract is now strict and fail-fast:
  - dev runtime: `NODE_ENV=development` + expected port `8788`.
  - live runtime: non-dev mode + expected port `8787`.
- `npm run dev` is fixed to `NODE_ENV=development SIS_ENV_FILE=.env.dev`.
- `npm start` is fixed to `NODE_ENV=production SIS_ENV_FILE=.env`.
- Runtime guard in `server/exercise-mailer.mjs` blocks:
  - dev mode inside live root unless `SIS_ALLOW_DEV_ON_LIVE_ROOT=true`.
  - live mode inside dev root unless `SIS_ALLOW_LIVE_ON_DEV_ROOT=true`.
- Sync scripts now lock live checks/wiring to port `8787` without `MAILER_PORT`/`--mailer-port` overrides:
  - `tools/deploy-api-safe.sh`
  - `tools/sis-runtime-resync.sh`

## Feature List

- Cookie-session admin authentication (`/api/admin/auth/login`)
- Role-aware permissions (`admin` full, `teacher` data-entry write with admin-protected mutations restricted)
- Persistent school setup + branding settings (`GET/PUT /api/admin/settings/ui`)
- Admin Queue Hub aggregate (`GET /api/admin/queue-hub`) with persisted panel ordering (`uiSettings.queueHub.panelOrder`)
- Student CRUD + profile persistence
- Strict student import identity validation (`eaglesId + studentNumber`)
- Import template download endpoint
- Attendance tracking workflows
- Grade/performance tracking workflows
- Parent report queueing and review actions
- Parent portal session APIs (`/api/parent/auth/*`, `/api/parent/children`, `/api/parent/dashboard`) and public portal route (`/parent/portal`)
- Exercise incoming queue review/match/create-account flows
- Runtime health + service control endpoints
- XLSX export endpoint
- Backup, restore, deploy, and safe migration scripts

## Teacher Operations (SIS Tracking Entry)

Teacher users should focus on data entry and review workflows that do not mutate protected admin policy/config.

1. Login with teacher credentials in Student Admin.
2. Select student via search/scope controls.
3. Enter tracking data:
4. Attendance entries by class/date/status.
5. Grade/performance entries by assignment/class/quarter.
6. Parent tracking notes/report drafts for admin review queues.
7. Save and verify row-level persistence in student detail panels.

Teacher guardrails:

- Teachers can read most operational datasets.
- Teachers cannot run privileged mutations (user management, service control, protected exports, high-risk queue actions).

## Admin Operations (Tracking Data and Oversight)

Admins own full tracking oversight and correction loops.

1. Review attendance completeness by date/class/level.
2. Review grade records by student/class/quarter.
3. Review parent report queue states (`queued`, `held`, `sent`, `failed`).
4. Hold/requeue/edit/send-all for queued report notifications.
5. Review incoming exercise-result queue and resolve by:
6. Matching to an existing student
7. Requeue/archive/delete
8. Creating a student account from inbound payload when needed

## Admin Handbook (Everything Admins Must Know)

### 1) Authentication and Session Model

- Primary login endpoint: `POST /api/admin/auth/login`
- Legacy alias: `POST /api/admin/login`
- Session is cookie-based and must round-trip as `Cookie`.
- Session validation/refresh occurs per request flow.
- Recommended teacher credential model: configure one account per teacher with `STUDENT_TEACHER_ACCOUNTS_JSON`.
- Legacy shared teacher credentials (`STUDENT_TEACHER_PASS` with `STUDENT_TEACHER_USER` / `STUDENT_TEACHER_USERS`) remain supported for compatibility, but unique passwords per teacher are preferred.

```json
[
  { "username": "carole01", "role": "teacher", "password": "..." },
  { "username": "mei001", "role": "teacher", "password": "..." },
  { "username": "wren01", "role": "teacher", "password": "..." },
  { "username": "thea001", "role": "teacher", "password": "..." },
  { "username": "hannah001", "role": "teacher", "password": "..." },
  { "username": "lily001", "role": "teacher", "password": "..." }
]
```

### 2) Student Identity Contract

- Canonical keys: `eaglesId` + `studentNumber`
- Duplicates are rejected in create/import flows.
- Import strict mode requires explicit identity values.

### 3) Student Import Rules

- Endpoint: `POST /api/admin/students/import`
- Payload supports `rows` or spreadsheet `fileDataBase64`.
- CSV/TSV and JSON import payloads are treated as UTF-8 end-to-end (invalid non-UTF-8 payloads are rejected).
- Preflight identity validation runs before write.
- Re-import supports backfill updates by `eaglesId` (with `studentNumber` mismatch rejection).
- Import processes rows independently (row-level failures are logged; valid rows continue).

### 4) Tracking Data Domains

- Attendance (`StudentAttendance`)
- Assignments (`StudentAssignments`) as an operations domain
- Assignment persistence currently lives in `StudentGradeRecord` fields (`assignmentName`, `dueAt`, `submittedAt`, `homeworkCompleted`, `homeworkOnTime`) until a dedicated `StudentAssignments` model is introduced
- Grade/performance (`StudentGradeRecord`)
- Parent class reports (`ParentClassReport`)
- Profile data (`StudentProfile`)

### 5) Notification and Queue Operations

- Queue email announcements and parent-report batches.
- Review queue status and perform hold/requeue/edit/send-all actions.

### 6) Runtime Controls

- Runtime health endpoint for diagnostics.
- Service control endpoint for controlled restart actions.

### 8) Parent Portal Contract

- Public portal page: `GET /parent/portal`
- Parent auth/session endpoints:
  - `POST /api/parent/auth/login`
  - `POST /api/parent/auth/logout`
  - `GET /api/parent/auth/me`
- Parent data endpoints:
  - `GET /api/parent/children`
  - `GET /api/parent/dashboard`
  - `GET /api/parent/children/{eaglesId}/profile`
  - `PUT /api/parent/children/{eaglesId}/profile-draft`
  - `POST /api/parent/children/{eaglesId}/profile-submit`
- Parent account source:
  - preferred: DB `ParentPortalAccount`
  - fallback env: `STUDENT_PARENT_PORTAL_ACCOUNTS_JSON`

### 9) Student Portal Contract

- Public portal page: `GET /student/portal`
- Student auth/session endpoints:
  - `POST /api/student/auth/login`
  - `POST /api/student/auth/logout`
  - `GET /api/student/auth/me`
- Student data endpoints:
  - `GET /api/student/dashboard`
  - `GET /api/student/news-reports`
  - `GET /api/student/news-reports/calendar`
  - `POST /api/student/news-reports`
- Student account source:
  - preferred: DB `StudentPortalAccount`
  - fallback env: `STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON`

### 7) Data Safety Expectations

- Never run restore commands casually.
- Always backup before any write-heavy operation.
- Keep imports single-file and controlled.
- Require preflight checks for all bulk operations.

## Safe Deploy and Edit Workflow

Use these wrappers for repeatable production-safe updates:

- UI-only deploy: `tools/deploy-ui-safe.sh`
- API/runtime deploy (no DB migration): `tools/deploy-api-safe.sh`
- DB schema change workflow (backup-first): `tools/deploy-db-fields-safe.sh`
- Strict import workflow (preflight -> backup -> import): `tools/import-students-safe.sh`
- Smart DB backup wrapper (host binary or docker fallback): `tools/db-backup-smart.sh`

### UI-only edits (no DB impact)

```bash
cd /home/eagles/dockerz/sis
tools/deploy-ui-safe.sh
```

### API/runtime code edits (no DB migration)

```bash
cd /home/eagles/dockerz/sis
tools/deploy-api-safe.sh
```

Blocking gates (non-optional, enforced by `tools/deploy-api-safe.sh` after sync):

```bash
# Modal chip contract (student + parent)
npm run test:portal-chip-contract

# Source/runtime/public parity proof for student/parent portals
npm run sync:proof:portal
```

Chip semantics SSOT must stay aligned across both:
- `docs/chips.md`
- `docs/chips.xlsx`

Bidirectional portal mirror commands (when edits happen on the wrong side):

```bash
# Check dev/live/public parity for admin + parent + student portals
npm run sync:portal:check

# Push dev edits to live runtime + public mirror
npm run sync:portal:dev-to-live

# Pull live runtime edits back into dev + public mirror
npm run sync:portal:live-to-dev
```

### DB field changes + backfill (safe sequence)

1. Create migration in source workspace.
2. Deploy API/runtime code.
3. Run migration preflight.
4. Backup + apply migration.
5. Run backfill in dry-run mode first, then apply.
6. Validate null/invalid counts.
7. Add stricter constraints only after successful backfill.

Commands:

```bash
cd /home/eagles/dockerz/sis
tools/deploy-db-fields-safe.sh --check-only
tools/deploy-db-fields-safe.sh --yes
```

## Full Safe Edit Workflow (Practical)

Use this workflow for every production change.

### Phase A: Local change and confidence

1. Edit only required files.
2. Run tests.
3. Verify import/migration contracts if touched.

```bash
cd /home/eagles/dockerz/sis
npm test
```

### Phase B: Deploy type decision

1. UI-only change: use UI deploy script.
2. API/runtime change without schema: use API deploy script.
3. Schema change: run DB migration workflow.
4. Bulk data import: run strict import workflow.

### Phase C: Mandatory preflight

```bash
cd /home/eagles/dockerz/sis
tools/deploy-ui-safe.sh --check-only
tools/deploy-api-safe.sh --check-only
tools/deploy-db-fields-safe.sh --check-only
```

### Phase D: Execute only one change lane at a time

1. Deploy UI or API first.
2. Run DB changes only when required and always backup-first.
3. Run imports only after clean preflight.

### Phase E: Post-deploy verification

1. Validate `/healthz`.
2. Validate unauthenticated auth check (`/api/admin/auth/me` -> 401).
3. Run admin smoke checks in UI pages touched.
4. Verify DB row counts and queue states where relevant.

## Practical Admin Runbooks

Detailed backup/restore workflow reference:

- [Backup and Restore Workflows](docs/db-backup-failsafe.md)

### Runbook: Strict student import (backup-first)

Preflight only:

```bash
cd /home/eagles/dockerz/sis
tools/import-students-safe.sh \
  --file /home/eagles/dockerz/sis/docs/students/eaglesclub-students-import-ready.xlsx \
  --check-only
```

Write mode (only after clean preflight):

```bash
cd /home/eagles/dockerz/sis
tools/import-students-safe.sh \
  --file /home/eagles/dockerz/sis/docs/students/eaglesclub-students-import-ready.xlsx \
  --yes
```

### Runbook: Full system backup snapshot

Creates a restorable snapshot of runtime files + DB dump + manifest.

```bash
cd /home/eagles/dockerz/sis
tools/sis-full-backup-snapshot.sh --label before-major-change
```

### Runbook: Full system restore from snapshot

```bash
cd /home/eagles/dockerz/sis
tools/sis-full-restore-snapshot.sh \
  --snapshot-dir /home/eagles/dockerz/sis/backups/full-system/<snapshot-folder> \
  --yes
```

## Backup and Restore Strategy

### Database-only

- Backup: `npm run db:backup` or `tools/db-backup-smart.sh`
- Verify-only restore source: `npm run db:restore:verify`
- Restore: `npm run db:restore -- --yes --clean --single-transaction`

### Full system + DB

- Backup snapshot: `tools/sis-full-backup-snapshot.sh`
- Restore snapshot: `tools/sis-full-restore-snapshot.sh`

Restoration best practice:

1. Create a fresh backup before restore.
2. Restore in maintenance window.
3. Restart service and validate health/auth endpoints.
4. Perform targeted smoke checks in admin UI.

## CI/CD and Maintenance Policy

This repo should follow a strict release gate even when deployed manually.

### Required pipeline stages

1. Static checks (format/lint as configured)
2. Unit/integration tests (`npm test`)
3. Modal chip contract gate (`npm run test:portal-chip-contract`)
4. Migration status check (`npx prisma migrate status`)
5. Deploy dry-run checks (`tools/deploy-ui-safe.sh --check-only`, `tools/deploy-api-safe.sh --check-only`)
6. Production deploy approval gate

### Deployment policy

- UI-only change: deploy UI script only.
- API-only change: deploy API script only.
- Schema change: migration script with backup-first gate.
- Bulk import: preflight-only first, then single controlled import with backup.

### Rollback policy

- Minor UI/API rollback: resync previous runtime backup folder.
- Data rollback: database restore from verified backup.
- Full rollback: restore full snapshot script.

### Operational maintenance cadence

- Daily DB backup verification.
- Weekly full snapshot for disaster recovery readiness.
- Monthly restore drill in non-production environment.
- Daily incoming exercise vacuum (resolve/delete queue artifacts + orphan/malformed report).
- DB health snapshot every 15 minutes (machine-readable JSON).

Dev-first reliability commands:

```bash
# dry-run + report
npm run db:incoming:vacuum

# apply disposition (resolve if matched, delete if not) + purge old resolved/archived queue rows
npm run db:incoming:vacuum -- --apply

# run DB health snapshot and write status file
npm run db:health:check

# render systemd units/timers (check-only)
npm run ops:maintenance:systemd:check

# install and enable timers (requires writable systemd unit dir)
tools/install-maintenance-systemd.sh
```

Installed timer defaults:

- `sis-db-backup.timer` => `02:30` daily
- `sis-incoming-vacuum.timer` => `03:17` daily
- `sis-db-health.timer` => every 15 minutes (`*:0/15`)

Failure-response playbook:

1. Redis/session failure:
   - Check `/healthz` -> `studentAdminRuntime.sessionRedis`.
   - Confirm Redis reachability and credentials.
   - Restart Redis first, then `exercise-mailer.service`.
2. Backup stale:
   - Run `npm run db:backup`.
   - Re-run `npm run db:health:check` and confirm `backup.status = ok`.
3. Vacuum manual-review backlog:
   - Inspect latest `runtime-data/maintenance-reports/incoming-vacuum-*.json`.
   - Resolve ambiguous student matches manually in queue-hub or purge invalid rows.

Promotion checklist (dev -> live):

1. Run `npm test` with all new reliability tests green.
2. Run 72-hour dev soak with no timer failures and stable Redis session behavior after restarts.
3. Deploy runtime sync (`tools/deploy-api-safe.sh --force-sync`) and verify `/healthz`.
4. Install systemd timers on live (`tools/install-maintenance-systemd.sh`) and verify with `systemctl list-timers`.

## Best Practices (Practical and Non-Negotiable)

- Keep production writes explicit (`--yes` gates).
- Never import without preflight.
- Never change schema without backup.
- Keep one source of truth per import file.
- Avoid ad-hoc SQL writes in production.
- Validate post-change health every time.
- Store backup artifacts with clear timestamps and labels.
- Keep runtime and source roots explicit in every script.

## Security Notes

- Do not commit `.env` secrets.
- Do not log credentials or sensitive student data.
- Preserve cookie security flags and role boundaries.

## Key Commands

```bash
npm start
npm test
npm run db:migrate:deploy
npm run db:backup
npm run db:restore:verify
npm run db:rollover:help
```

## School-Year Rollover

Use rollover to archive and purge old operational year data (grades, attendance, year-window volatile queues) while keeping student identity/class data in place.

1. Run a dry-run first to inspect scope and row counts.
2. Run `--apply` only after validating date window and school year.
3. Use inspect mode to view archived rows after purge.

```bash
# dry-run (no writes)
npm run db:rollover -- \
  --school-year 2026-2027 \
  --start-date 2026-08-01 \
  --end-date 2027-07-31

# archive + purge active DB rows for that year window
npm run db:rollover -- \
  --school-year 2026-2027 \
  --start-date 2026-08-01 \
  --end-date 2027-07-31 \
  --apply

# list archived runs
npm run db:rollover:inspect -- --school-year 2026-2027

# preview archived grade rows
npm run db:rollover:inspect -- \
  --school-year 2026-2027 \
  --dataset studentGradeRecord \
  --limit 40
```

Archive output path:

- `backups/school-year-archive/<schoolYear>/<runId>/`
- contains per-dataset `*.ndjson.gz` files plus `manifest.json`.

## School-Year Label Migration

Use this when historical rows were labeled with an incorrect year marker and should be relabeled in-place.

```bash
# dry-run impact report
npm run db:school-year:migrate-label

# apply relabel: 2025-2026 -> 2026-2027
npm run db:school-year:migrate-label -- --apply
```

## Primary Entry Files

- Service: `server/exercise-mailer.mjs`
- Admin routes: `server/student-admin-routes.mjs`
- Store layer: `server/student-admin-store.mjs`
- Admin UI: `web-asset/admin/student-admin.html`
