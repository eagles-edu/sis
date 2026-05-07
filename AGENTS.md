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
6. Before editing, make a backup or verify that a current backup/snapshot already exists for the file.

## Communication

- Keep intermediary updates terse.
- Send one short status update at the start of work, then only ask a question if you are blocked.
- Do not think out loud or narrate internal reasoning in progress updates.
- When the task is complete, close any terminal or background sessions you opened for it.

## UI Guardrails

- Do not recolor buttons unless the user explicitly asks for button recoloring.
- Do not recolor chips or button-like controls in dark mode unless the user explicitly asks for recoloring.
- Do not recolor buttons in dark mode.
- Do not recolor chips or button-like controls in dark mode.
- Do not recolor icons in dark mode.
- Do not change theme selector styling in dark mode unless the user explicitly asks for it.
- Preserve the established UI unless the user explicitly asks otherwise.
- For dark-mode work, preserve the established component palette and visual language unless the user explicitly requests a redesign.
- Treat dark-mode coverage and accessibility fixes as scope-limited work: fix missing dark styling and illegible text, but do not make unrelated visual changes.
- In dark mode, normalize element grouping to the established hierarchy: panel background darker, cards lighter.
- If that panel/card hierarchy is ambiguous for a given surface, ask the user before choosing a direction.
- Before making any out-of-scope UI or design change, stop and ask the user first.
- Avoid regression-by-cleanup: do not rewrite or replace settled styling rules unless the current task requires it.
- Parent portal ownership rule: `web-asset/parent/parent-portal.html` owns page structure and boot-gate behavior only; shared chrome, buttons, modal surfaces, placeholders, and typography belong in `web-asset/shared/portal-theme.css` unless the user explicitly requests a parent-only exception.

## OpenAI Docs

- When working with OpenAI API, Codex, ChatGPT Apps SDK, or related OpenAI developer docs, use the `openaiDeveloperDocs` MCP server first and pair it with the `openai-docs` skill when available.
- If the docs MCP server is unavailable, fall back only to official OpenAI domains.
- For OpenAI product/API questions, ask for citations and keep answers tied to official docs sources.

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
