# SIS Agents Operating Manual

This file defines how coding agents should operate in the standalone SIS workspace.

## Project Identity

- Project root: `/home/eagles/dockerz/sis`
- Stack: Node.js (ESM), Prisma, PostgreSQL, Redis (optional for sessions), plain HTML admin UI.
- Primary service: `server/exercise-mailer.mjs`
- Primary domains:
  - Exercise submission + email dispatch
  - Student intake ingestion
  - Admin APIs and session auth
  - Report-card PDF generation

## Session Startup Checklist

Run this checklist at the start of every session:

1. Confirm location:
   - `pwd` must be `/home/eagles/dockerz/sis` (or a direct child path).
2. Confirm Node version:
   - `node -v` must be `v20.19.4`.
3. Confirm workspace state:
   - This workspace may be non-git. If `.git` is absent, skip git-specific workflow and record that explicitly.
4. Validate baseline:
   - Run `npm test` and record pass/fail summary before changes.
5. Read core docs:
   - `README.md`
   - `sis.md`
   - this `AGENTS.md`

## Operating Principles

1. Change only what is required for the active request.
2. Prefer focused diffs over broad rewrites.
3. Keep code and tests aligned to runtime contracts.
4. Never assume auth model details: inspect route code first.
5. Keep all edits ASCII unless target files already require Unicode.

## Frontend A11y and Box Model SOP

1. When a CSS rule uses `width`/`height` (or min/max variants) together with `padding` and/or `border`, include `box-sizing: border-box;` in that same rule block.
2. Use `aria-label` only on valid elements:
   - interactive elements (for example `button`, `a[href]`, form controls),
   - landmarks/labelable elements,
   - or elements with explicit ARIA widget roles (for example `role="toolbar"`).
3. For non-interactive containers, prefer visible text labels and apply ARIA naming to the actual clickable controls, or add an appropriate role before using `aria-label`.

## Authentication Contract (Critical)

Admin API auth is cookie-session based, not bearer-token based.

- Login endpoints:
  - `POST /api/admin/auth/login`
  - `POST /api/admin/login` (legacy alias)
- Session cookie is set by server and must be sent back as `Cookie`.
- Session validation and refresh happen in request flow (`touchSession`).
- Role gate:
  - `admin`: full access
  - `teacher`: read-only (`GET` allowed, mutating methods forbidden)

Any auth-related test or client update must follow this contract.

## Directory Map

- `server/`
  - `exercise-mailer.mjs`
  - `exercise-store.mjs`
  - `student-intake-store.mjs`
  - `student-admin-routes.mjs`
  - `student-admin-store.mjs`
  - `student-admin-session-store.mjs`
  - `student-report-card-pdf.mjs`
- `test/`
  - `exercise-mailer.spec.mjs`
  - `student-admin.spec.mjs`
- `prisma/`
  - `schema.prisma`
  - `migrations/`
- `schemas/`
  - intake schema JSON
  - student import template (`.xlsx`)
- `web-asset/admin/`
  - `student-admin.html`
- `tools/`
  - DB backup/restore scripts

## Commands

- Install: `npm install`
- Start: `npm start`
- Dev start: `npm run dev`
- Test: `npm test`
- Prisma generate: `npm run db:generate`
- Prisma migrate deploy: `npm run db:migrate:deploy`
- Prisma studio: `npm run db:studio`
- Backup DB: `npm run db:backup`
- Restore DB: `npm run db:restore`

## Testing Standards

When changing behavior, update/add tests in the same task.

### Minimum expectations per subsystem

1. Exercise submission:
   - success path
   - input validation failures
   - CORS preflight
   - recipient decode behavior
2. Intake submission:
   - valid and invalid payload handling
   - required-field semantics
3. Admin auth/session:
   - login success/failure
   - cookie issuance
   - `/auth/me` and `/auth/logout`
   - unauthorized and forbidden paths
4. Admin data APIs:
   - at least one happy path + one failure path per endpoint group
5. Report-card PDF:
   - valid PDF bytes
   - filename behavior
   - selected-filter behavior

### Test Quality Rules

1. Use deterministic fixtures; avoid random assertions.
2. Verify response codes and key headers, not just body.
3. Avoid false coverage: ensure requests actually pass auth when required.
4. Keep disabled-store tests distinct from DB-enabled integration tests.

## Security and Data Handling

1. Never commit secrets from `.env`.
2. Do not log raw credentials or sensitive student PII.
3. Keep CORS and cookie security behavior explicit in changes.
4. Preserve `HttpOnly`, `SameSite`, and `Secure` handling unless requirements change.

## Editing and Backup Workflow

Before editing existing files:

1. Create timestamped backup file with `.BAK-<YYYYmmdd-HHMMSS>`.
2. Capture undo diff to `/tmp/codex-undo-<timestamp>.patch`.
3. Apply focused patch.
4. Re-run affected tests or smoke commands.

For new files:

1. Place in correct root-level domain (`server`, `test`, `docs`, etc.).
2. Add concise but complete documentation context.

## Documentation Rules

When behavior, contracts, or coverage changes:

1. Update `sis.md`:
   - current test status
   - coverage gaps
   - prioritized next actions
2. Keep this `AGENTS.md` current when workflows change.
3. Keep `README.md` runnable (commands and entrypoints accurate).

## Completion Checklist

Before final handoff:

1. Confirm requested files are created/updated.
2. Provide explicit list of touched paths.
3. Report test command outcomes and failures.
4. Call out residual risks and open gaps.
