# SIS (Student Information System)

![Node.js](https://img.shields.io/badge/Node.js-22.22.1-339933?logo=node.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?logo=javascript&logoColor=111)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-Optional_Sessions-DC382D?logo=redis&logoColor=white)
![HTML](https://img.shields.io/badge/Admin_UI-HTML/CSS/JS-E34F26?logo=html5&logoColor=white)
![License](https://img.shields.io/badge/License-ISC-blue)

Standalone SIS backend, admin workspace, and parent/student portals for The Eagles Club.

## Purpose

This service supports the day-to-day school workflow for:

- Student accounts, roster intake, and profile management
- Enrollment tracking, attendance, assignments, grades, and report cards
- Parent-facing progress communication and profile-update workflows
- Student-facing news reports, homework tracking, and vocabulary work
- Admin/teacher session-based operations with role-aware page access

## Current highlights

Recent improvements now reflected in the system:

- Family-aware student intake with `familyId` support and family lookup helpers
- Parent profile invitation flow with send, resend, open, click, and completion tracking
- Parent first-login password setup via dedicated password-change gate
- New admin engagement views:
  - Profile engagement
  - Assignment engagement
  - RC engagement
- Stronger import validation around `eaglesId`, `studentNumber`, `parentsId`, and `familyId`
- Expanded School Setup and Settings controls for school dates, news-report rules, and session TTLs
- Richer parent/student portal detail views for homework, news reports, attendance, and performance reports
- Async side-effect worker support for invitation and notification background work
- Authoritative vocabulary checking: local CMUdict for pronunciation/primary stress and Merriam-Webster Collegiate/Learner's written-division verification, with canonical accented storage and warning-only temporary service failures
- Protected Library pages: `/student/library.html` (student chat) and `/admin/library` (no admin chat), both using shared portal chrome and theme controls

## Canonical paths

- Project root: `/home/eagles/dockerz/sis`
- Primary service entrypoint: `server/exercise-mailer.mjs`
- Admin shell: `web-asset/admin/student-admin.html`
- Admin Library page source: `web-asset/admin/library-admin.html`, served at `/admin/library` with `/admin/library/manage` and `/admin/library/engagement` child routes
- Parent portal: `web-asset/parent/parent-portal.html`
- Student portal: `web-asset/student/student-portal.html`
- Student Library page: `web-asset/student/library.html`

## Stack

- Runtime: Node.js `v22.22.1`
- Language: JavaScript (ESM)
- Database: PostgreSQL via Prisma
- Optional session backend: Redis
- UI: plain HTML/CSS/JS portal surfaces

## Directory map

- `server/` route handlers, auth/session, runtime wiring
- `src/modules/` domain logic and async/background jobs
- `prisma/` schema and migrations
- `web-asset/admin/` admin UI and standalone admin pages
- `web-asset/parent/` parent portal
- `web-asset/student/` student portal
- `test/` repository contract and portal tests
- `tools/` operational, sync, build, and backup scripts
- `docs/` SOP, audit, operational notes, and user manuals

## Documentation map

- Code-editing review index: [`docs/CODE-EDITING-DOCS-INDEX.md`](docs/CODE-EDITING-DOCS-INDEX.md)
- Normalized shared design parameters: [`docs/CORE-DESIGN-PARAMETERS.md`](docs/CORE-DESIGN-PARAMETERS.md)
- Current-versus-historical parameter audit: [`docs/DOCUMENT-STATUS-AND-PARAMETER-AUDIT.md`](docs/DOCUMENT-STATUS-AND-PARAMETER-AUDIT.md)
- System audit: [`docs/sis-audit.md`](docs/sis-audit.md)
- Staff admin handbook: [`docs/admin-staff-user-manual.md`](docs/admin-staff-user-manual.md)
- Vietnamese parent/student manual: [`docs/parent-student-user-manual.vi.md`](docs/parent-student-user-manual.vi.md)
- Operating SOP: [`docs/sop.md`](docs/sop.md)
- Backup and restore workflows: [`docs/db-backup-failsafe.md`](docs/db-backup-failsafe.md)

## Quick start

```bash
cd /home/eagles/dockerz/sis
npm install
npm test
cp -n .env.dev.example .env.dev
npm run dev
```

Production-mode boot:

```bash
cd /home/eagles/dockerz/sis
npm start
```

Async side-effects worker:

```bash
cd /home/eagles/dockerz/sis
npm run worker:async-side-effects
```

## Canonical dev entry points

Use these when validating the local dev runtime on port `8788`:

- `http://127.0.0.1:8788?apiOrigin=http://127.0.0.1:8788`
- `http://127.0.0.1:8788/admin?apiOrigin=http://127.0.0.1:8788`
- `http://127.0.0.1:8788/parent?apiOrigin=http://127.0.0.1:8788`
- `http://127.0.0.1:8788/student?apiOrigin=http://127.0.0.1:8788`

## Core surfaces

### Admin

- Dashboard / overview
- Queue hub
- Enrollment
- Student admin
- Student profile
- Attendance / attendance data
- Assignments / assignments data / assignment engagement
- Performance reports / performance data / RC engagement
- News reports review
- Grades / grades data / grade table
- Family lookup
- Users, permissions, school setup, settings

### Parent

- Dashboard with child selector
- Homework, attendance, grades, recommendations, and performance report archive
- Parent profile update form
- First-login password setup flow

### Student

- Dashboard
- Daily news report writing and resubmission workflow
- New Words vocabulary workspace
- Library page with student chat
- Homework, attendance, grades, recommendations, and report archive

## Auth model

- Admin login: `POST /api/admin/auth/login`
- Parent login: `POST /api/parent/auth/login`
- Student login: `POST /api/student/auth/login`
- All portals use cookie-based sessions

Role model:

- `admin`: full access
- `teacher`: limited to approved data-entry surfaces and actions
- `parent` and `student`: read-only in admin policy context, dedicated access in their own portals

## Key operational commands

```bash
# Targeted test suite
npm test

# Build generated admin assets
npm run build:admin-assets

# Portal parity / sync proof
npm run sync:proof:portal

# Lighthouse portal audit
npm run audit:lighthouse:portals
```

## Safe workflow notes

- Keep source-of-truth edits in this repo, not mirror-only copies.
- Rebuild generated assets after portal-source changes.
- Treat `SIS_CONFIG.json` in deployed runtimes as the immutable environment contract for that runtime.
- Use the docs above for page-by-page operational guidance before changing workflows.
