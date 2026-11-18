# SIS Operating SOP

This file holds the reusable operational procedure. Keep `AGENTS.md` short and use `README.md` for commands and entrypoints.

## Prompt Economy

- Keep `AGENTS.md` & `SOP.MD`as the always-loaded contract: hard constraints only.
- Keep `sis.md` as the current-status snapshot.
- Keep `docs/history.md` as append-only migration history.
- Keep `docs/sop.md` as reusable procedure, not a project diary.
- Put commands and runnable entrypoints in `README.md` unless they are part of a live workflow rule.
- Prefer focused diffs, small context, and file-local changes over broad rewrites.
- Move slow-changing detail out of the hot path; only keep rules here if they change agent behavior.

## Communication

- Use English in chat responses unless the user explicitly asks for another language.
- Interpret the user's words literally and keep the scope narrow; do not widen, reinterpret, or "improve" the request unless the user explicitly asks for that.
- Before changing code, browser-driving a portal surface, or drawing conclusions from a rendered page, read the applicable repo docs first and follow them. Start with `AGENTS.md`, then `docs/sop.md`, then the most relevant wiring or surface doc such as `docs/sis-admin-wiring-map.ascii.txt`.
- When docs and assumptions conflict, stop following the assumption. Use the documented contract unless the user explicitly instructs otherwise.
- Before changing a route or router contract, diff the last pushed code, the relevant backups, and the route docs first so the pre-drift baseline is explicit before edits begin.

## Canonical Workspace

- Canonical source: `/home/eagles/dockerz/sis`
- Mirrors: `/home/admin.eagles.edu.vn/sis` and `/home/test.eagles.edu.vn/sis`
- Environment terminology is fixed: **live mirror** and **admin mirror** are synonyms for `https://admin.eagles.edu.vn`; **test mirror** means the test environment; **dev** means the local development runtime. Status reports and test plans must name the environment using these terms.
- Environment file ownership and execution are explicit: `.env.dev` is dev-only, `.env.test` is test-mirror-only, and `.env` is live/admin-mirror-only. Every Prisma command must set `SIS_ENV_FILE` and `DOTENV_CONFIG_PATH` to the same file and set the matching `NODE_ENV`; `prisma.config.ts` rejects missing, mismatched, unsupported, or cross-environment values instead of loading the default `.env` implicitly.
- Required change flow is: edit canonical dev source -> run dev tests/runtime checks with `.env.dev` -> rebuild generated assets -> run the authorized mirror sync workflow -> verify mirror health/parity/browser behavior. A dev edit is not a mirror edit, and a mirror sync is not production authorization.
- Standard Prisma command forms are:
  - dev: `env SIS_ENV_FILE=.env.dev DOTENV_CONFIG_PATH=.env.dev NODE_ENV=development npm run db:generate` and the same prefix for `npm run db:migrate:deploy`;
  - test mirror: `env SIS_ENV_FILE=.env.test DOTENV_CONFIG_PATH=.env.test NODE_ENV=test ...`;
  - live/admin mirror: `env SIS_ENV_FILE=.env DOTENV_CONFIG_PATH=.env NODE_ENV=production ...`.
  Never run a bare Prisma command when more than one environment file exists.
- Version split is mandatory:
  - live `admin.eagles.edu.vn` is `v1.0`
  - dev/test route contract is `v2.0`
- Do not promote `v2.0` route or edge assumptions into live `admin` unless the user explicitly requests a live migration.
- After each completed and verified implementation or operational milestone, commit the complete publishable worktree and push the full current branch history to its configured upstream. Partial pushes are prohibited: before pushing, reconcile every tracked and untracked worktree change, verify the branch, upstream, and remote visibility, and require `git status --short` to be empty after the push. Do not discard or publish protected secrets, student PII, backups, runtime data, or authenticated captures to make the worktree clean; move protected local state to its authorized external location and verify preservation first. If a protected or unrelated change cannot be safely reconciled without losing data or widening publication scope, stop before pushing and report the exact blocker.
- Credential-bearing environment configs and local runtime data must be covered by `.gitignore`. If a sensitive file is already tracked, preserve its local copy, remove it from the Git index, add or verify its ignore rule, and keep its contents out of commits. Never force-add sensitive files to satisfy a clean-worktree requirement.
- Git publication and mirror sync are separate operations. Mirror sync is file-level only and does not require commit matching as a sync gate; when a task requires both, finish and verify both the mirror sync and the full-repository push.
- Local UI sync is source-first and mandatory: author admin/parent/student/shared portal tweaks in `/home/eagles/dockerz/sis`, run the asset build before every full sync, copy both source and generated assets through the strict sync whitelist, and require the source-to-test UI hash parity gate before the test runtime restarts. A mirror-only edit is temporary drift and must not be treated as durable.
- Applied test runtime syncs run `npm run audit:lighthouse:portals` against the configured canonical origin and require 100 desktop Performance and Best Practices scores for `/admin`, `/parent`, and `/student`. This is explicitly a clean-profile, unauthenticated shell gate; it does not prove authenticated boot, dashboard request count, authenticated LCP, or loading-flash absence. The clean-profile Best Practices check confirms optional third-party integrations do not load before consent. Live runtime syncs run the same gate by default once the live origin is reachable to the audit host; set `SIS_LIVE_LIGHTHOUSE_ENABLED=0` only for an explicitly documented exception. Override the origin with `SIS_TEST_PRIMARY_ORIGIN` or `SIS_LIVE_PRIMARY_ORIGIN`. For authenticated portal proof, follow [`docs/authenticated-portal-performance-sop.md`](authenticated-portal-performance-sop.md).
- The test full-sync order is: backup test state, purge mirror files, sync runtime code and whitelisted UI assets, verify local UI source parity, refresh Prisma, restart the test service, sync public assets, then run the portal parity proof and route checks. If any parity gate fails, the sync is incomplete.
- Writes to `/home/*/public_html` are host-owned; use `sudo` for those webroot writes.
- Test route contract lives in `config/test-route-contract.json`; update that file before changing the test sync wrapper checks.
- Dev and test sync use the same strict file whitelist for the portal/runtime payload; only the target roots and route mappings differ.
- Test `full` sync creates a restorable bundle containing the test runtime/public/vhost snapshots plus a PostgreSQL dump of the test database before purging mirror files. The mirror purge never drops, truncates, restores, or otherwise purges the test database; Prisma generation/migrations run against the existing test DB afterward.
- The test sync preserves `.env.test`, `SIS_CONFIG.json`, and `runtime-data/admin-ui-settings.json` across the runtime purge and records the database backup location and preservation contract in the bundle manifest.
- `SIS_CONFIG.json` at a deployed runtime root is the immutable runtime config contract for that environment.
- Every environment selects the newest valid SIS config copy and repairs the older copy. Development compares the local config file's filesystem modification time with the database mirror's `updatedAt`; test and production compare deployed `SIS_CONFIG.json` with the corresponding database mirror using the same rule. No environment has a fixed file or database winner. When recovery must rewrite the file, its actual resulting filesystem modification time becomes the repaired version timestamp and is synchronized to the database row. File payload comparison ignores its embedded timestamp when content and `updatedBy` already match, so protected directory permissions do not cause repeated rewrites or timestamp oscillation.
- A config health check repairs drift before reporting health. Database read/write failures must surface as health failures, and a successful repair must read back and verify the mirror against the selected snapshot.
- Treat database `updatedAt` as the mirror's version timestamp, not as an automatic write clock. Do not copy a stale timestamp from the file payload over it. After a repair, set it to the selected version time; if filesystem permissions require a rewrite that naturally changes file mtime, use that actual mtime for both copies.
- `config/sis-config.test.json` in the repo is a local test fixture path, not the deployed runtime immutable.
- Do not collapse those two roles into one path by convention alone. Keep the role distinction explicit in env files, sync docs, and incident reports unless the test harness is deliberately redesigned to use the deployed-style path safely.
- Live admin HTTPS edge uses Nginx for TLS and proxies to OLSWS on `8088`. Before changing edge docs or cert paths, verify the active listener and certificate on the host; do not infer ownership from templates, backups, or old notes.
- Backup artifacts now live under `/home/eagles/dockerz/backups` instead of the repo-local `backups/` tree. Keep new dev, test, and live backup outputs there, and update scripts or docs that still point at the old root.
- Prisma/Node engine compatibility is a monitored dependency contract. The current `@prisma/streams-local@0.1.2` warning is transitive through the Prisma CLI development chain (`prisma` -> `@prisma/dev` -> `@prisma/streams-local`), not an SIS server import. It declares `bun >=1.3.6` or `node >=22.0.0`, while SIS currently runs Node `20.19.4`; treat the npm `EBADENGINE` message as low priority while `npm ci`, `prisma generate`, `prisma migrate deploy`, service startup, and health probes pass.
- This warning becomes actionable if the package is executed by a runtime or Prisma workflow and fails, strict npm engine enforcement is enabled, a Prisma release makes Node 22 mandatory, or the project adopts Node 22 while any SIS host remains on Node 20. Before a Prisma upgrade, test the locked dependency set on supported Node versions with install, Prisma generate, migration deploy, full tests, service restart, and health probes. Upgrade test/dev runtimes to Node 22 only after that validation; otherwise pin the last Prisma release compatible with the supported Node version.
- Live admin clean sync uses `tools/sync-and-restart-live-runtime.sh` with a restorable bundle under `/home/eagles/dockerz/backups/live-admin/`; keep its whitelist aligned with the test runtime whitelist unless the live host explicitly needs a different file.
- `moodle.eagles.edu.vn` is a separate direct-serve path; do not apply the test-host reverse-proxy contract to it.
- Treat mirror edits as temporary hot-fixes unless the user explicitly asks to propagate them.
- If a mirror edit is unavoidable, record paths, `sha256`, `mtime`, and the reason.
- Do not sync mirror changes back into canonical source without explicit approval.
- After approval, merge to canonical first, run targeted tests and parity checks, then sync mirrors.
- Every status report should state whether drift exists and which copy is newest.
- Portal school setup contracts are resolved from the reconciled SIS config payload mirrored in the DB and current SIS JSON snapshot. Do not reintroduce legacy UI-settings file fallbacks in the portal loader path.
- When student and parent portal sections are intended to match, compare the full paired blocks first, then make one structural edit that brings the student surface into the same wrapper/order contract as the parent surface. Do not burn time on repeated selector-only tweaks when the mismatch is actually in sibling placement or wrapper shape.

## Frontend A11y and Box Model

- Add `box-sizing: border-box;` when width or height is combined with padding or border.
- Use `aria-label` only on interactive, labelable, or explicitly role-bearing elements.
- Prefer visible labels on containers and name the actual control instead.

## Frontend Layout Baseline

- SOP #1: when a portal page needs a visible main content shell, start from the admin ladder template and keep the same hierarchy on the page: `page` background, `content` shell, `panel`, `card`, then `data-surface`. Do not add a page-local wrapper that pretends to be `content` if it creates an extra border, padding shell, or other artifact between the real content container and the child surfaces.
- Keep container padding uniform on all sides unless a deliberate asymmetry is required.
- Do not vertically center text blocks inside card/grid cells when the result shifts the perceived margin; top-align the block instead.
- Align sibling edges to the same inset line so the visual left, right, top, and bottom margins read as equidistant from the container boundary.
- If a lower text block needs to span full width, move it to its own row instead of indenting it to match an inner column.
- Before changing a profile or form surface, identify the visible ladder explicitly as `page`, `content`, `panel`, `card`, or `data-surface`.
- Remove or flatten any container that does not represent one of those ladder roles; do not keep decorative shells just to host headings, notes, tabs, or clusters.
- Keep same-tier surfaces visually normalized: same height, font size, line height, padding, and gap unless a different semantic role is required.
- For student/profile form and info surfaces, use `content > panel > card` as the default structure and keep notes or section subtitles as plain text rows inside the owning panel.
- Ladder changes must carry the visible frame with them: when a page surface moves to `content`, `panel`, `card`, or `data-surface`, give that surface its border and radius in the same pass. Do not ship a naked color block with no border/radius and then patch the frame later.
- In light mode, list and table item separators must stay visibly dark enough to read against the light surface; prefer the strong border token for row/item separators instead of the softer default border token when the softer line disappears.
- Normalize divider lines for list and table items in both light mode and dark mode through the shared SSOT. Do not leave a ladder surface visually flat or borderless in either mode.
- `content` can be contiguous or split into separate blocks when the page architecture requires it. For portal pages, the `content` layer includes the full red header bar, the branded header with logo and theme toggle, the main content sections between header and footer, and the prefooter strip when present.
- Central status strips that report bootstrap/auth state, such as `Authenticated as admin. Student admin loaded.`, are `content` when they live in the main page flow beneath the visible header and above or alongside the main sections.
- Do not turn a pure panel/list stack wrapper into its own `content` surface if that creates a visible border, padding shell, or similar artifact between the real content container and the child panels. The wrapper should stay transparent; the owning `content` shell is the visible layer.
- If a portal page is missing the red top bar or the blue footer, add them before considering the page normalized.
- Dropdown menus and select controls resolve to the `card` surface in both light and dark mode unless a separate semantic contract explicitly says otherwise.
- In dark mode, normalize grouped surfaces to the established visual hierarchy: panel background darker, cards lighter.
- If it is unclear whether a surface is acting as a panel or a card, ask the user before changing it.
- For student/profile form and info surfaces, use `content > panel > card (field)` as the default structure.
- Do not stack extra bordered shells between the section content and the field cards just to hold headings, tabs, or clusters.
- Section headings inside a profile panel should be plain headings, not their own boxed containers, unless the user explicitly asks for that treatment.
- Do not hide profile or public-form fields behind collapsed sections or accordions unless the user explicitly requests collapsible behavior.
- Admin level-tile and level-filter surfaces must share the canonical level order. `Eggs & Chicks` is the first level and must remain first on attendance, assignment, parent-tracking, and performance selectors; filtered views may exclude semantic exceptions, but they must preserve the canonical order of the remaining levels.

## UI Scope Guardrails

- Treat existing UI decisions as binding unless the user explicitly asks to change them.
- Do not recolor buttons unless the user explicitly asks for button recoloring.
- Do not recolor chips or button-like controls in dark mode unless the user explicitly asks for recoloring.
- Do not recolor buttons in dark mode.
- Do not recolor chips or button-like controls in dark mode.
- Do not recolor icons in dark mode.
- Do not change theme selector styling in dark mode unless the user explicitly asks for it.
- Preserve the established UI unless the user explicitly asks otherwise.
- For dark-mode work, fix missing dark styling and illegible text only; do not redesign settled component styling as part of that work.
- When a page has both dark panels and intentionally light-style controls, preserve that split unless the user says otherwise.
- Before making any out-of-scope visual change, stop and ask the user first.
- Prefer browser-verified fixes over assumption-driven cleanup; patch only the specific rendered regressions you can point to.
- Before editing, create or verify a backup/snapshot for the target file.

## Portal Theme Contract

- Treat `web-asset/shared/portal-theme.css` as the source of truth for portal theme tokens and shared semantic colors.
- Treat minified CSS/JS as generated artifacts, not authoring surfaces.
- Never hand-edit minified CSS/JS files such as `*.min.css` or `*.min.js`.
- Edit the canonical source file first, then run the project build/minification step so source, generated asset, and deployed copies stay in parity.
- Edit `web-asset/shared/portal-theme.css` first; rebuild `web-asset/shared/portal-theme.min.css` from the script. Do not hand-edit the minified file.
- The canonical loopback dev entrypoints are `http://127.0.0.1:8788`, `http://127.0.0.1:8788/admin`, `http://127.0.0.1:8788/parent`, and `http://127.0.0.1:8788/student`, each with `?apiOrigin=http://127.0.0.1:8788` when the page needs an explicit origin.
- The explicit dev navigation contract is always these four URLs: `http://127.0.0.1:8788?apiOrigin=http://127.0.0.1:8788`, `http://127.0.0.1:8788/admin?apiOrigin=http://127.0.0.1:8788`, `http://127.0.0.1:8788/parent?apiOrigin=http://127.0.0.1:8788`, and `http://127.0.0.1:8788/student?apiOrigin=http://127.0.0.1:8788`. Shared `portal-navigation.js` appends that query to internal `/admin`, `/parent`, and `/student` anchors on dev and static-preview surfaces; it must not mix the `5500` static-preview host into runtime navigation.
- Portal API-origin helpers are duplicated inline in the hub, parent, and student pages. Their allowlists must always contain all three local runtime ports: `8786` (test mirror), `8787` (production/admin-live), and `8788` (dev), in both the inferred-origin and explicit-origin normalization helpers. A missing test-mirror port strands the page in booting or silently sends login to the wrong runtime; `test/portal-hub-fallback.spec.mjs` is the blocking guard for this parity rule.
- Shared admin menu state is `.menu-group.expanded`, not `.menu-group.open`. Initialize the class from `aria-expanded` before binding clicks, then update both the attribute and `.expanded` class in the same handler. A state-class mismatch can leave a correctly marked-up child menu invisible.
- Theme alignment is a single-pass workflow: identify the visible ladder once, label the page element with the ladder name in class/id/data attribute/accessible label, and wire both light mode and dark mode to that same element instead of creating separate per-mode duplicates.
- For any surface that is clearly `page`, `content`, `panel`, `card`, or `data-surface`, name it with the ladder term on the page and let shared CSS resolve the mode-specific token; do not create parallel light-only and dark-only page-local wrappers for the same role.
- If a ladder element is missing in one mode, create the shared ladder element first and then theme it in both modes in the same pass.
- Standalone admin surfaces such as Enrollment must inherit the existing admin portal frame instead of shipping ad hoc chrome: red contact header, branded page header with current school logo/name, shared theme toggle, shared text-size controls, centered content column, themed panels/cards/tables, and the shared blue footer in both light and dark mode.
- Use shared tokens and shared selectors for page background, panel, card, data-set/table surfaces, muted/support text, chart axis labels, modal/dialog surfaces, immutable header/footer chrome, and immutable button/chip/pill chrome.
- Keep local CSS for layout, spacing, responsive structure, boot-state/prepaint rules, and any page-critical post-vendor overrides that must remain on-page to preserve portal text/layout behavior and prevent drift or CLS.
- All color definitions, aliases, and neutral mappings belong in the shared SSOT. Page-local CSS may not define new color values or duplicate role colors unless the rule is structural and required to prevent CLS.
- Do not add page-local login forms or parallel auth flows on standalone admin pages. They must use the current admin cookie session and, when unauthenticated, fail closed back to the main admin login surface.
- Do not feed gradient tokens into `color-mix()` or other color-only functions. When blend math is required, mix against solid color tokens only.
- Do not introduce ad hoc page-local theme colors when an equivalent shared portal token already exists.
- Treat page-local ownership of `background`, `color`, `border-color`, `box-shadow`, `fill`, and `stroke` as a regression unless it is in the explicit structural allowlist enforced by tests.
- Do not create page-local color aliases for shared portal roles. If a rule needs color, it should consume the shared SSOT token instead of defining a local parallel name.
- Keep button and chip chrome intentionally light unless the user explicitly asks for recoloring.
- When a button is meant to stay white or neutral, use the shared portal button/chip contract and shared radius tokens; do not introduce page-local pill radii or custom button chrome for that surface.
- Semantic table/status fills must stay opaque enough to read against the current surface. If dark-mode tokens need contrast, adjust the shared status tokens instead of layering a translucent wash on top of them.
- In dark mode, preserve the established surface hierarchy:
  - panel backgrounds darker
  - cards lighter
  - support text muted
- When you find low-contrast or dead-looking text/elements during theme work, surface the issue explicitly instead of silently restyling unrelated chrome.
- If a surface is structurally important but the panel/card role is unclear, ask before changing its treatment.

## Testing and Security

- When behavior changes, update or add tests in the same task.
- Verify response codes and key headers, not only response bodies.
- After any file edit, restart the dev runtime before reporting the change complete.
- Browser QA is doc-first, not guess-first: read the relevant auth/session and page wiring notes before starting browser validation, then validate against that documented flow.
- For any portal browser operation on admin, parent, or student surfaces, always use Playwright in full live authenticated mode: establish the real admin/parent/student session through the visible login form in the browser context, then validate or inspect the rendered page with that session. Do not use static inspection, an unauthenticated load, an API-only login, injected cookies, or copied storage state as the primary proof.
- For any portal date-display change, restart the dev runtime and verify the parent, student, and admin browser views before calling it done.
- Keep disabled-store tests separate from DB-backed integration tests.
- Never commit secrets from `.env`.
- Do not log raw credentials or sensitive student PII.
- Preserve `HttpOnly`, `SameSite`, and `Secure` handling unless the requirement changes.

## Test-file failure diagnosis

When a repository contract test reports a failure, run the complete file through
the diagnostic wrapper instead of rerunning only the displayed assertion:

```bash
npm run test:file:diagnose -- test/portal-theme-contract.spec.mjs
```

The command prints the normal Node test output and then enumerates every failing
subtest with its `location`. For each item, inspect the cited test and the
referenced source before deciding whether the implementation or the contract is
stale. After all items are fixed, rerun the same complete-file command; success
requires zero listed failures and exit status 0.
