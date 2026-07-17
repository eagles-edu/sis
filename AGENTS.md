# SIS Agents Operating Manual

This file is the short, always-loaded contract for agents in `/home/eagles/dockerz/sis`.

## Project Identity

- Project root: `/home/eagles/dockerz/sis`
- Stack: Node.js (ESM), Prisma, PostgreSQL, optional Redis sessions, plain HTML admin UI
- Primary service: `server/exercise-mailer.mjs`
- Workflow reference: `docs/sop.md`
- Lean docs policy: hard constraints in `AGENTS.md`, current status in `sis.md`, history in `docs/history.md`.
- Primary domains: exercise submission and email dispatch, student intake ingestion, admin APIs and session auth, report-card PDF generation
- Dev workspace source of truth: `/home/eagles/dockerz/sis`
- Terminology: call `deploy/nginx/test.eagles.edu.vn.conf` the **test-mirror vhost**; call files under `test/` repository contract tests, not test vhosts.
- Test-host snapshot dump: `/home/eagles/dockerz/BAK/test-dump-090526/test-host-pre-wipe-20260509-011220`
- School model: weekend English classes. Do not import public-school assumptions into date, quarter, holiday, or scheduling logic unless the task explicitly asks for them.
- Authoritative school dates and quarter boundaries come from stored school setup data. If that setup is missing or invalid, fail closed and warn instead of synthesizing a public-school-style default.

## Operating Principles

1. Change only what the active request requires.
2. Prefer focused diffs over broad rewrites.
3. Keep code and tests aligned to runtime contracts.
4. Inspect route code before assuming auth behavior.
5. Before changing a route or router contract, diff the last pushed code, the relevant backups, and the route docs to establish the pre-drift baseline.
6. Keep edits ASCII unless the target file already needs Unicode.
7. Before editing, make a backup or verify that a current backup/snapshot already exists for the file.
8. After any file edit, restart the dev runtime before reporting the task complete.
9. `SIS_CONFIG.json` at a deployed runtime root is the immutable runtime config contract for that environment.
10. `development` mode is authoring mode: local dev config files are the source-of-truth and the DB mirror is repaired from them.
11. `test` and `production` modes are mirror/repaired mode: deployed runtime `SIS_CONFIG.json` is reconciled with the DB mirror and the weaker side is repaired when the other side is valid.
12. `config/sis-config.test.json` in the repo is a local test fixture path, not the deployed runtime immutable.
14. Portal origin helper edits must preserve the complete local runtime set: `8786` test mirror, `8787` production/admin-live, and `8788` dev, in every portal helper and both inferred/explicit-origin paths. The portal fallback contract test must pass before reporting a portal change complete.
13. Local portal UI tweaks are authored only in `/home/eagles/dockerz/sis`; every `full` test sync must rebuild generated admin assets, copy the source and generated UI payloads through the strict whitelist, and fail on source-to-test hash drift before restart. Never rely on a mirror-only UI edit surviving a later sync.

## Literal Instruction Terms

The following words are hard constraints, not emphasis: `all`, `every`, `everything`, `everywhere`, `none`, `nothing`, `never`, `always`, `completely`, `thoroughly`, `full`, `full sync`, `move all`, `no fallback`, `no trash fallback`, `only fallback to exact copy of data`, `parity`.

- `all`, `every`, `everything`, `everywhere` mean exhaustive within the stated scope. The scope includes source files, generated assets, minified files, runtime copies, test fixtures, and sync targets when they are part of the request.
- `move all` means search the full declared scope and change every in-scope match. It does not mean a representative sample, a single file, or a line range.
- `none`, `nothing`, `never`, `no fallback`, `no trash fallback` mean fail closed. Do not invent guessed values, synthetic defaults, heuristics, or "close enough" placeholders.
- `only fallback to exact copy of data` means fallback is allowed only when the exact authoritative value exists and can be copied verbatim. If the verbatim value is unavailable, do not substitute another value.
- `always` means every relevant execution path and every affected surface, every time the condition occurs, until a later instruction explicitly changes the rule.
- `completely`, `thoroughly`, `full`, and `full sync` mean the work is not complete until all in-scope matches are changed and verified, including any generated, minified, or deployed copies that must remain in parity with source.
- `parity` means the same behavior, same data contract, and same visible result across equivalent environments and surfaces.
- `on page` means the page HTML, inline styles, embedded scripts, page-local CSS, and any generated or minified assets that affect that page.
- If a task uses any of these terms, interpret them literally and choose the broadest complete scope the request reasonably implies. Do not narrow them into a sample, a window, or a "good enough" subset.
- Do not report completion unless exhaustive search, in-scope edits, generated-asset rebuilds, and verification have all been completed with zero remaining in-scope matches.
- If the scope is genuinely ambiguous after inspection, stop and ask before making changes.
- This contract overrides any weaker paraphrase or casual usage.

## Communication

- Use English in chat responses unless the user explicitly asks for another language.
- Interpret the user's words literally and keep the scope narrow; do not widen, reinterpret, or "improve" the request unless the user explicitly asks for that.
- For portal UI work, browser verification, or rendered-page conclusions, use a full live authenticated browser session that matches the real portal flow. Do not rely on static inspection, unauthenticated page loads, or API-only login as proof of portal behavior.
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
