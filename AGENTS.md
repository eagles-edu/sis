# SIS Agents Operating Manual

This file is read at ai boot as SOP (Standard Operating Procedure) and serves as the short, always-loaded contract for agents in `/home/eagles/dockerz/sis`.

**Use `.env.dev` for necessary user credentials.**

---

## Project Identity

- **Project root:** `/home/eagles/dockerz/sis`
- **Stack:** Node.js (ESM), Prisma, PostgreSQL, optional Redis sessions, plain HTML admin UI
- **Primary service:** `server/exercise-mailer.mjs`
- **Workflow reference:** `docs/sop.md`
- **Lean docs policy:** hard constraints in `AGENTS.md`, current status in `sis.md`, history in `docs/history.md`.
- **Primary domains:** exercise submission and email dispatch, student intake ingestion, admin APIs and session auth, report-card PDF generation
- **Dev workspace source of truth:** `/home/eagles/dockerz/sis`
- **Test-host snapshot dump:** `/home/eagles/dockerz/BAK/test-dump-090526/test-host-pre-wipe-20260509-011220`

### Naming & Terminology

- Call `deploy/nginx/test.eagles.edu.vn.conf` the **test-mirror vhost**.
- Call files under `test/` repository contract tests, not test vhosts.
- **Live mirror** and **admin mirror** are synonyms for `https://admin.eagles.edu.vn`.
- **Test mirror** means the test environment.
- **Dev** means the local development runtime.

### Environment-File Ownership (Fixed)

- `.env.dev` is dev only.
- `.env` is live/admin-mirror only.
- `.env.test` is test-mirror only.
- Do not copy, align, read for another environment, or use one as a fallback for another unless the active request explicitly authorizes that exact transfer.

### Environment Execution (Explicit, Fail-Closed)

Every Prisma command must receive `SIS_ENV_FILE` and `DOTENV_CONFIG_PATH` pointing to the same owned file, plus the matching `NODE_ENV`:

| `.env.dev`  | `development` |
|-------------|---------------|
| `.env.test` | `test`        |
| `.env`      | `production`  |

A bare `npm run db:*`, a mismatched `SIS_ENV_FILE`/`DOTENV_CONFIG_PATH`, or a cross-environment fallback is invalid.

### Change Flow (Dev-First)

1. Edit and verify in `/home/eagles/dockerz/sis` against `.env.dev`.
2. Sync the reviewed source and generated payload to the authorized mirror with its environment-owned workflow.
3. Restart and verify that mirror.
4. Only then consider a live/admin sync explicitly authorized.
5. Database migrations follow the same environment gate and are never inferred from a code verification command.

### School Model

- Weekend English classes. Do not import public-school assumptions into date, quarter, holiday, or scheduling logic unless the task explicitly asks for them.
- Authoritative school dates and quarter boundaries come from stored school setup data. If that setup is missing or invalid, fail closed and warn instead of synthesizing a public-school-style default.

---

## Operating Principles

1. Change only what the active request requires.
2. Prefer focused diffs over broad rewrites.
3. Keep code and tests aligned to runtime contracts.
4. Inspect route code before assuming auth behavior.
5. Before changing a route or router contract, diff the last pushed code, the relevant backups, and the route docs to establish the pre-drift baseline.
6. Keep edits ASCII unless the target file already needs Unicode.
7. Before editing, make a backup or verify that a current backup/snapshot already exists for the file.
8. After any file edit, restart the dev runtime before reporting the task complete.

### Configuration Hierarchy

1. `SIS_CONFIG.json` at a deployed runtime root is the **immutable runtime config contract** for that environment.
2. `development` mode is **authoring mode**: local dev config files are the source-of-truth and the DB mirror is repaired from them.
3. `test` and `production` modes are **mirror/repaired mode**: deployed runtime `SIS_CONFIG.json` is reconciled with the DB mirror and the weaker side is repaired when the other side is valid.
4. `config/sis-config.test.json` in the repo is a local test fixture path, not the deployed runtime immutable.

### Sync & Portal Contracts

 1. Local portal UI tweaks are authored only in `/home/eagles/dockerz/sis`; every `full` test sync must rebuild generated admin assets, copy the source and generated UI payloads through the strict whitelist, and fail on source-to-test hash drift before restart. Never rely on a mirror-only UI edit surviving a later sync.
 2. Portal origin helper edits must preserve the complete local runtime set: `8786` test mirror, `8787` production/admin-live, and `8788` dev, in every portal helper and both inferred/explicit-origin paths. The portal fallback contract test must pass before reporting a portal change complete.

### Shared Menu State

 1. Shared admin menu state is `.menu-group.expanded`, not `.menu-group.open`. Every menu handler must initialize the class from `aria-expanded` and toggle `aria-expanded` plus `.expanded` together; do not introduce `.open` as an alternate menu state class.

### Semantic Lock & Code-Editing Discipline

 1. Before acting on a request, create a semantic lock from its exact words: preserve every literal constraint, map each one to an observable acceptance check, and keep that mapping active through implementation and verification. Do not silently replace an objective term with a weaker synonym, visual approximation, inferred preference, or narrower scope. If the requested term and the discovered source appear to conflict, stop and resolve the conflict from the source or ask; do not reinterpret the request.
 2. Before every code edit, read `docs/CODE-EDITING-DOCS-INDEX.md` and follow its review order, including the current status audit, core design parameters, and surface-specific source/tests. If an implementation would intentionally depart from an established web-layout, accessibility, responsive, or source contract, stop and ask before proceeding.
 3. Baseline layout sanity is mandatory across every portal: visible sibling content must have a non-zero parent gap or deliberate margin, visible surfaces and controls must have readable inset padding, and standalone pagination/action groups must be centered or explicitly aligned by the current surface contract. Verify these relationships in the rendered authenticated desktop and mobile browser at the affected portal surfaces.

---

## Literal Instruction Terms

The following words are **hard constraints**, not emphasis:

`all` · `every` · `everything` · `everywhere` · `none` · `nothing` · `never` · `always` · `completely` · `thoroughly` · `full` · `full sync` · `move all` · `no fallback` · `no trash fallback` · `only fallback to exact copy of data` · `parity`

### Definitions

| Term | Meaning |
| ------ | --------- |
| `all`, `every`, `everything`, `everywhere` | Exhaustive within the stated scope. The scope includes source files, generated assets, minified files, runtime copies, test fixtures, and sync targets when they are part of the request. |
| `move all` | Search the full declared scope and change every in-scope match. It does not mean a representative sample, a single file, or a line range. |
| `none`, `nothing`, `never`, `no fallback`, `no trash fallback` | Fail closed. Do not invent guessed values, synthetic defaults, heuristics, or "close enough" placeholders. |
| `only fallback to exact copy of data` | Fallback is allowed only when the exact authoritative value exists and can be copied verbatim. If the verbatim value is unavailable, do not substitute another value. |
| `always` | Every relevant execution path and every affected surface, every time the condition occurs, until a later instruction explicitly changes the rule. |
| `completely`, `thoroughly`, `full`, `full sync` | The work is not complete until all in-scope matches are changed and verified, including any generated, minified, or deployed copies that must remain in parity with source. |
| `parity` | The same behavior, same data contract, and same visible result across equivalent environments and surfaces. |
| `on page` | The page HTML, inline styles, embedded scripts, page-local CSS, and any generated or minified assets that affect that page. |

### Enforcement Rules

- If a task uses any of these terms, interpret them literally and choose the **broadest complete scope** the request reasonably implies. Do not narrow them into a sample, a window, or a "good enough" subset.
- Do not report completion unless exhaustive search, in-scope edits, generated-asset rebuilds, and verification have all been completed with zero remaining in-scope matches.
- If the scope is genuinely ambiguous after inspection, stop and ask before making changes.
- **This contract overrides any weaker paraphrase or casual usage.**

### Semantic-Drift Prevention Gate

- Treat the user's nouns, adjectives, adverbs, quantifiers, and scope words as **requirements**. Do not assign them an alternate meaning because a different implementation is easier or more familiar.
- Before editing, identify the authoritative source and write down the exact structural/data/behavioral proof required by each term:
  - `identical` → source parity, DOM hierarchy, sibling order, controls, and rendered result
  - `copy/paste` → direct source comparison
  - `shared` → reuse of the established shared element/style contract
- During editing, reject substitutions that weaken the requirement:
  - `identical` ≠ `similar`
  - `copy/paste` ≠ `recreate`
  - `shared` ≠ `page-local`
  - `always` ≠ `usually`
  - `full` ≠ `partial`
  - `all` ≠ `representative`
- Before reporting completion, check the semantic lock term by term and report any unverified term as incomplete. Never claim completion from a passing build alone when the request contains source, parity, structural, or rendered-result requirements.

---

## Communication

- Use English in chat responses unless the user explicitly asks for another language.
- Interpret the user's words literally and keep the scope narrow; do not widen, reinterpret, or "improve" the request unless the user explicitly asks for that.
- For portal UI work, browser verification, or rendered-page conclusions, use a **full live authenticated browser session** that matches the real portal flow. Do not rely on static inspection, unauthenticated page loads, or API-only login as proof of portal behavior.
- **Use `.env.dev` for necessary user credentials.**
- Keep intermediary updates terse.
- Send one short status update at the start of work, then only ask a question if you are blocked.
- Do not think out loud or narrate internal reasoning in progress updates.
- When the task is complete, close any terminal or background sessions you opened for it.

---

## UI Guardrails

### Spacing

Standard spacing is mandatory for visible portal content: use the shared spacing tokens for vertical gaps, non-zero vertical padding for visible buttons and fields, and wrapping or responsive layout when controls can exceed the available width.

- Do **not** add `margin-bottom: 0`, `padding: 0`, or equivalent zero vertical spacing to visible content, controls, headings, action groups, or pagination.
- Zero-spacing resets are allowed only for structural overlays, native reset normalization, or controls whose spacing is supplied by an explicit parent gap; add a contract test for any such exception.

### Button Labels

- Button labels must be compact: use **one or two words** whenever possible.
- Put longer explanations, consequences, and workflow detail in the control's `title` tooltip and accessible name/description; never pack instructional sentences into a button label.
- Overflow handling is a **worst practice** and is prohibited: never use ellipsis, clipping, horizontal scrolling, shrinking text, or wrapped instructional labels to compensate for a long button copy. Rename the visible action and put its complete explanation in the shared tooltip plus accessible name/description.

### Recoloring Restrictions

Do **not** recolor the following unless the user **explicitly** asks for it:

- Buttons
- Chips or button-like controls
- Icons
- Theme selector styling (in dark mode)

### Dark Mode

- Preserve the established component palette and visual language unless the user explicitly requests a redesign.
- Treat dark-mode coverage and accessibility fixes as **scope-limited work**: fix missing dark styling and illegible text, but do not make unrelated visual changes.
- Normalize element grouping to the established hierarchy: panel background darker, cards lighter.

### Library Queue Surfaces

- `.library-review-list` keeps `var(--portal-surface-panel)`.
- `.library-review-item` owns the Library accordion-header colors (`#CDE0FF` light and `#212121` dark).
- **Never** apply the row color to the containing panel; keep a contract test for both surfaces.
- If the panel/card hierarchy is ambiguous for a given surface, ask the user before choosing a direction.

### General UI Rules

- Preserve the established UI unless the user explicitly asks otherwise.
- Before making any out-of-scope UI or design change, stop and ask the user first.
- Avoid regression-by-cleanup: do not rewrite or replace settled styling rules unless the current task requires it.
- Parent portal ownership rule: `web-asset/parent/parent-portal.html` owns page structure and boot-gate behavior only; shared chrome, buttons, modal surfaces, placeholders, and typography belong in `web-asset/shared/portal-theme.css` unless the user explicitly requests a parent-only exception.

---

## Literal Shared-UI Contract

When a request says `identical`, `copy/paste`, `use the shared header`, `use the shared theme`, or names a shared element, interpret it as a **structural implementation instruction**, not a visual suggestion.

- **`identical`** means the same DOM hierarchy, sibling order, element types, classes, control set, and shared selectors as the authoritative existing page. A different wrapper, merged surface, replacement control, or approximate recreation is not identical.
- **`copy/paste`** means first read the authoritative source block and reproduce that block verbatim. Do not recreate it from memory, simplify it, substitute a `Back` link, omit controls, or redesign it. Only explicit runtime substitutions are permitted: portal-specific home path, locale-visible labels, authenticated identity values, and collision-safe IDs when the source contract requires them.
- **`use the shared header`** means preserve the complete portal chrome sequence: contact header, floating navigation control, separate `.content.topbar` surface, `.topbar-head`, brand block, theme toggle, and text-zoom controls. The topbar remains a sibling of the page content; it must never be moved inside, merged with, or represented by the Settings/content container.
- **`use the shared theme`** means use the established selectors and CSS variables from `web-asset/shared/portal-theme.css`/`.min.css`. Do not create page-local copies of shared header, button, surface, dark-mode, or spacing rules unless the request explicitly authorizes a page-only exception.
- The **canonical parent/student header source** is the corresponding block in `web-asset/parent/parent-portal.html` and `web-asset/student/student-portal.html`. Any new portal page must be checked against those blocks before editing and must retain the same structural contract after editing.
- Before reporting completion, verify both source structure and rendered structure. Add or update a contract test when a shared element is added to a new page so a future change fails loudly instead of drifting silently.

---

## OpenAI Docs

- When working with OpenAI API, Codex, ChatGPT Apps SDK, or related OpenAI developer docs, use the `openaiDeveloperDocs` MCP server first and pair it with the `openai-docs` skill when available.
- If the docs MCP server is unavailable, fall back only to official OpenAI domains.
- For OpenAI product/API questions, ask for citations and keep answers tied to official docs sources.

---

## Authentication Contract

Admin API auth is **cookie-session based**, not bearer-token based.

- **Login endpoints:**
  - `POST /api/admin/auth/login`
  - `POST /api/admin/login` (legacy alias)
- **Session cookie** is issued by the server and must round-trip as `Cookie`.
- **Session validation and refresh** happen in request flow via `touchSession`.
- **Role gate:**
  - `admin` → full access
  - `teacher` → read-only; `GET` is allowed, mutating methods are forbidden

---

## Implemented Vocabulary and Library Contracts

- Vocabulary syllabication and stress verification is shared server behavior for New Words and student-news vocabulary draft/check/submit/save flows. The client guard remains structural feedback only; the server is authoritative.
- **Local CMUdict** is the offline authority for pronunciation syllable count and primary-stress position.
- **Merriam-Webster Collegiate** is the written-division authority queried first; **Learner's** is queried only after a confirmed Collegiate miss.
- Merriam-Webster credentials are server-only and independently configured as `MERRIAM_WEBSTER_COLLEGIATE_API_KEY` and `MERRIAM_WEBSTER_LEARNERS_API_KEY` in the environment-specific `.env.dev`, `.env.test`, and `.env` files. Keys and provider responses must not reach browser payloads or logs.
- Successful and not-found Merriam-Webster results use a bounded normalized-word/source cache. Temporary timeout, rate-limit, unavailable-service, or missing-key conditions produce an unverified warning and may allow the action; authoritative mismatches, unknown CMUdict words, incorrect syllable division, or incorrect primary stress block without exposing a correction.
- **Stress editing must remain reversible:** accept complete uppercase stressed syllables such as `com-MEND-ed`, preserve already accented input such as `com-ménd-ed`, and store canonical accented output. Do not normalize an invalid submission in a way that prevents the student from correcting uppercase stress in the edit form.
- The protected physical student Library page is `/student/library.html`, linked below New Words, and includes student chat. The protected admin Library routes are `/admin/library`, `/admin/library/manage`, and `/admin/library/engagement`, linked under Administration, and must not include student chat. All use the canonical shared header/footer and SVG theme-toggle component.
