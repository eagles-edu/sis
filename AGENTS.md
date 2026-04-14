# SIS Agents Operating Manual

This file is the short, always-loaded contract for agents in `/home/eagles/dockerz/sis`.

## Project Identity

- Project root: `/home/eagles/dockerz/sis`
- Stack: Node.js (ESM), Prisma, PostgreSQL, optional Redis sessions, plain HTML admin UI
- Primary service: `server/exercise-mailer.mjs`
- Workflow reference: `docs/sop.md`
- Lean docs policy: hard constraints in `AGENTS.md`, current status in `sis.md`, history in `docs/history.md`.
- Primary domains: exercise submission and email dispatch, student intake ingestion, admin APIs and session auth, report-card PDF generation

## Operating Principles

1. Change only what the active request requires.
2. Prefer focused diffs over broad rewrites.
3. Keep code and tests aligned to runtime contracts.
4. Inspect route code before assuming auth behavior.
5. Keep edits ASCII unless the target file already needs Unicode.

## Authentication Contract

Admin API auth is cookie-session based, not bearer-token based.

- Login endpoints:
  - `POST /api/admin/auth/login`
  - `POST /api/admin/login` (legacy alias)
- Session cookie is issued by the server and must round-trip as `Cookie`.
- Session validation and refresh happen in request flow via `touchSession`.
- Role gate:
  - `admin`: full access
  - `teacher`: read-only; `GET` is allowed, mutating methods are forbidden
