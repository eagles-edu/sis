# Core design parameters and semantics

This document is the compact normalized review sheet for shared SIS UI work. It does not replace executable CSS, HTML, JavaScript, or tests. It tells an agent where to look, what must remain stable, and which gaps must be resolved before adding another one-off value. Read [`DOCUMENT-STATUS-AND-PARAMETER-AUDIT.md`](DOCUMENT-STATUS-AND-PARAMETER-AUDIT.md) first when an older plan or parameter conflicts with this sheet.

## 1. Review lock

For every code edit affecting a rendered surface, preserve these invariants unless the user explicitly changes the contract:

- Shared means one canonical source and the same DOM/selector contract across equivalent portals.
- Immutable means light/dark theme changes do not recolor the designated chrome control.
- Parity means the source, generated asset, dev runtime, live mirror, and test mirror agree within the authorized scope.
- A generated CSS/JS/minified file is never the editing source.
- A new color, radius, size, spacing value, formatter, or semantic class requires a documented semantic gap and a contract test.
- A passing build is not rendered proof; use authenticated browser proof for protected portal conclusions.

## 2. Source-of-truth map

| Concern | Canonical source | Generated/consuming copies | Required proof |
| --- | --- | --- | --- |
| Shared portal theme | `web-asset/shared/portal-theme.css` | `portal-theme.min.css`, generated admin theme | `npm run build:admin-assets:check`, theme tests |
| Admin theme subset | `tools/build-admin-assets.mjs` extraction boundary | `web-asset/admin/admin-portal-theme.css` and `.min.css` | admin-theme split contract |
| Portal markup/chrome | corresponding HTML source plus shared selectors | runtime/public mirror copies | source structure, DOM order, authenticated render |
| Button semantics | shared CSS plus `docs/BUTTON-PLAN-1.MD` | portal HTML/JS usages | `test/portal-button-contract.spec.mjs` |
| Chip semantics | `docs/chips.md`, shared chip CSS, resolver modules | portal HTML/JS usages | `test/portal-chip-contract.spec.mjs` |
| Definition formatting | shared formatter in `web-asset/shared/vocabulary-esl-editor.js` and server normalizers | Library/New Words/News renderers | `test/library-pages.spec.mjs`, spacing/font tests |
| Runtime environment badge | shared `.env-badge` contract and `web-asset/shared/portal-environment.js` | every portal prefooter | served CSS plus dev/test/live parity proof |
| Runtime config | environment-owned `SIS_CONFIG.json` or development config | DB mirror according to mode | authenticated runtime health and config repair tests |

Parameter status is governed by the audit. Current values must be verified in
the executable source and focused contracts; proposal-only values do not enter
this table until implemented and tested.

## 3. Normalized color roles

Use semantic roles, not raw colors in page-local code. Exact values below are the current shared-theme contract and must be read from `web-asset/shared/portal-theme.css` before changing.

### 3.1 Light neutral ladder

| Role | Current value | Meaning |
| --- | --- | --- |
| Page background | `#E8EEF4` | outer portal canvas |
| Content | `#FBFFFF` | readable content container |
| Panel | `#E3E9F0` | grouped surface |
| Card | `#FCFDFF` | raised/local surface |
| Support/data surface | `#F1F4F8` | secondary table/chart/support surface |
| Primary text | `#212121` | normal light-mode text |
| Soft text | `#2B2B2B` | secondary light-mode text |

### 3.2 Dark neutral ladder

| Role | Current value | Meaning |
| --- | --- | --- |
| Page background | `#000000` | dark outer canvas |
| Content | `#2D2D2D` | dark content container |
| Panel | `#3B3C3E` | dark grouped surface |
| Card | `#4C4C4C` | dark raised/local surface |
| Support/data surface | `#525252` | dark secondary/table/chart surface |
| Primary text | `#FBFFFF` | dark readable text |
| Soft text/link | `#E5F5FF` | dark secondary/link text |
| Link hover | `#FFFFFF` | dark link hover |
| Link active | `#FFF0F2` | dark link active |

### 3.3 Semantic accents

| Role | Token family | Rule |
| --- | --- | --- |
| Primary action | `portal-action-blue-*` | execute function / forward action |
| Success/affirm | `portal-action-green-*` | approve, save, confirm, success |
| Warning/recoverable reset | `portal-button-warning` / PURPLE tokens | clear/reset/recoverable warning |
| Danger | `portal-action-red-*` | destructive, logout, delete, reject |
| Info | `portal-button-info` / GOLD tokens | CHECK/details/open/non-destructive auxiliary action |
| Utility/refresh | `portal-button-teal-refresh` and utility tokens | refresh/probe/reload |
| Environment badge | `portal-action-green-top`, `portal-action-green-border`, `--portal-action-secondary-text` | immutable green badge in every theme and authorized mirror |

Do not use the environment badge as evidence that every status chip should be green. Environment identity and workflow status are different semantics.

## 4. Theme invariants and immutable controls

- Theme changes may change surfaces and readable text roles, but must not recolor `.portal-button-immutable-chrome` controls.
- Immutable chrome includes theme toggles, menu toggles, modal close controls, header pin/hide controls, and explicitly classified chrome controls.
- Chips EXHIBIT HOMOGENEOUS GEOMETRY AND retain their semantic status colors in both themes; do not convert status/action semantics into a generic dark neutral.
- Buttons EXHIBIT HOMOGENEOUS GEOMETRY AND retain their semantic family across themes; hover/active states may use the established family tokens but may not cross semantic families.
- The environment badge is intentionally stronger than ordinary status chips: its green style is identical across light/dark and development/production labels.
- Do not introduce `.open` as a menu state; the shared state is `.menu-group.expanded` paired with `aria-expanded`.

## 5. Geometry and spacing

| Parameter | Current value | Contract |
| --- | --- | --- |
| Page stack gap | `12px` (`--portal-page-stack-gap`) | fixed vertical gap between shell surfaces |
| Shared content gap | `12px` (`--portal-content-gap`) | standard internal layout gap |
| Definition spacing | `12px` flow (`--portal-definition-flow-gap`); `7.416px` inner (`--portal-definition-item-gap`) | paragraphs/lists/sections use the flow gap; list items, nested lists, and section headings use flow / χ |
| Baseline visible-group gap | non-zero; use `var(--portal-content-gap)` where the group is shared | visible siblings must not touch; use deliberate margin only for a documented structural exception |
| Standalone pagination alignment | centered with wrapping and non-zero inset/block spacing | a different alignment requires an explicit surface contract and responsive proof |
| Shell gap | `var(--portal-page-stack-gap)` | aliases the page stack gap |
| Header bar desktop max/min | `40px` | stable header bar geometry |
| Header bar mobile | `64px` | fixed mobile header block size |
| Brand header block | `58px` desktop; `110px` mobile; `44px` row | shared brand/header geometry |
| Footer block/min size | `52px` | stable footer geometry |
| Prefooter block size | `30px` | AND environment/status prefooter geometry |
| Button inline size | `min(100%, 160px)` | responsive shared button width default; `160px` is the max/min semantic WIDTH size |
| Button inline padding | `14px` | shared button horizontal padding token |
| Chip inline size | `120px` | compact chip width, distinct from buttons |
| Chip min block size | `32px` | normalized chip height |
| Chip inline padding | `10px` | compact chip padding |
| Button radius | `var(--radius-3)` | shared button radius |
| Chip radius | `var(--radius-2)` | shared chip radius |

Visible controls must retain non-zero vertical padding or an explicit parent gap. Responsive controls must wrap or use the established mobile width rules; do not solve overflow by zeroing spacing.

Across all portals, visible sibling content must not touch. Use a shared non-zero parent gap or deliberate margin, preserve readable inset padding on visible surfaces and controls, and center standalone pagination/action groups unless a current surface contract explicitly requires another alignment. This is a rendered acceptance requirement, not a visual preference; verify it in authenticated desktop and mobile browser states.

## 6. Typography and font ownership

- Shared portal body typography belongs in `web-asset/shared/portal-theme.css`.
- B612 Mono is the designated admin-only font boundary for definition displays/editors and documented admin surfaces; follow `docs/font-hosting.md`.
- Formatted definitions use `line-height: 1.45`; `--portal-definition-flow-gap` is `12px`, while `--portal-definition-item-gap` is exactly flow / `--portal-definition-chi` (`1.61803398875`) for list items, nested lists, and section headings.
- Definition display and editor text must preserve readable list indentation, paragraph separation, and safe inline emphasis.
- Do not add a page-local font or letter-spacing override to compensate for a shared geometry problem.
- Dictionary Builder candidates are content-sized editing controls: structured values use textareas, auto-expand to their rendered content, and retain manual resize. The modal has one centered header information area for its active-tab/status/feedback messages; candidate panels do not repeat those headings.

## 7. Header, footer, and prefooter structure

The canonical portal chrome sequence is:

1. Contact/header bar.
2. Floating navigation control where the surface owns one.
3. Separate `.content.topbar` surface.
4. `.topbar-head` with brand block, theme toggle, and text-zoom controls.
5. Page content as a sibling, not merged into the topbar.
6. Separate `.portal-prefooter` or hub prefooter with `.env-badge`.
7. Separate `.hub-footer`.

Header/footer structure is shared even when visible labels or home paths differ. Check `docs/HEADER-PROPER.HTML`, the corresponding portal HTML, and the header contract tests before adding a new page.

## 8. Button semantics

| Semantic family | Use | Never use for |
| --- | --- | --- |
| `primary` | OPEN/EXECUTE/ACTIVATE/forward/submit/login/main action | destructive actions or passive detail |
| `affirm` | approve/save/confirm/positive completion | navigation-only actions |
| `info` | open details/non-destructive auxiliary action | approve/reject or state labels |
| `alt` | secondary navigation, previous/next, back | primary submit or danger |
| `warning` | clear/reset/recoverable caution | delete/logout/reject |
| `danger` | delete/logout/reject/destructive action | ordinary close/back |
| `btn-refresh` / teal refresh | reload/probe/refresh | submit or status display |
| `immutable-chrome` | theme/menu/modal/header chrome | workflow actions |

Button labels should be one or two words where possible. Put consequences and longer instructions in TOOL-TIPS `ARIA-`, AND `title`, accessible names, or nearby text. Do not create a new button skin when the semantic family exists.

## 9. Chip semantics

Chips are compact status/action indicators, not small buttons. Keep one normalized dimension contract and use the resolver precedence in `docs/chips.md`.

| Report state | Meaning | Current semantic color |
| --- | --- | --- |
| `OPEN` | window open, no submission | light blue |
| `NONE` | missed/no submission | red |
| `SUBMITTED` | initial submission awaiting review | amber |
| `REVISE` | revision requested | purple |
| `WAITING` | resubmission awaiting re-review | purple |
| `APPROVED` | approved | green |
| `PENDING` | documented admin pending/teal state where the surface contract calls for it | teal |

Do not mix Admin Action and Status semantics, rename persisted review keys, or add a chip class for a single page. Any
disagreement between `docs/chips.md` and older chip notes must be SUPERSEDED BY CURRENT THEME/DOCS AND/OR resolved before changing colors.

## 10. Definition formatting and functions

The definition pipeline is shared across Library, New Words, and student News vocabulary:

1. Server normalizes/clamps authoritative data with `normalizeLibraryDefinition` and the `LIBRARY_DEFINITION_MAX_LENGTH` limit (`50000`).
2. Shared client formatter converts safe definition text to HTML.
3. Compatible blank-separated numbered items remain one ordered list; do not flatten each item into repeated `1.` text.
4. Paragraphs, ordered lists, unordered lists, sections, examples, etymology, verb forms, stems, and works cited retain their semantic grouping.
5. Rendered output uses shared definition classes and the `12px` flow gap.

Authoritative implementation anchors:

- `src/modules/admin/library-corpus.mjs`
- `src/modules/admin/library-origin.mjs`
- `web-asset/shared/vocabulary-esl-editor.js`
- `docs/defspace-1.md`
- `test/library-pages.spec.mjs`

## 11. Functions and ownership rules

- Shared formatter/normalizer functions own behavior used by more than one portal or editor.
- Page-local code may own only route-specific data binding, structural layout, and explicitly documented exceptions.
- Auth is cookie-session based; do not introduce bearer-token assumptions into admin routes.
- Runtime environment resolution belongs in `web-asset/shared/portal-environment.js`; do not hard-code DEV/LIVE labels in individual pages.
- Generated assets are outputs of `tools/build-admin-assets.mjs`; source edits must precede rebuilds.
- Runtime self-healing must be idempotent and must preserve environment-owned config boundaries.

## 12. Generated assets and parity

After shared UI source changes:

```text
npm run build:admin-assets
npm run build:admin-assets:check
npm run dev:restart
```

For test/live mirror work, use the environment-owned sync workflow and its backup/parity gates. Do not edit mirror-only CSS or minified output as a durable fix. Verify source, generated output, runtime-served output, and the authorized mirror target.

## 13. Contract-test map

| Change | Minimum focused contracts |
| --- | --- |
| Theme tokens/surfaces | `test/portal-theme-contract.spec.mjs`, `test/admin-theme-tokens.spec.mjs` |
| Buttons | `test/portal-button-contract.spec.mjs` |
| Chips | `test/portal-chip-contract.spec.mjs` |
| Spacing/definitions | `test/portal-spacing-contract.spec.mjs`, `test/library-pages.spec.mjs`, `test/admin-font-hosting.contract.spec.mjs` |
| Header/menu/theme toggle | `test/portal-theme-contract.spec.mjs`, `test/portal-menu-auth-contract.spec.mjs` |
| Admin performance/assets | `test/admin-font-hosting.contract.spec.mjs`, `test/portal-asset-contract.spec.mjs`, `test/portal-theme-contract.spec.mjs`, authenticated performance gate |
| Routes/auth | `test/student-admin.spec.mjs`, route trace, route-specific contracts |
| Email engagement visibility | `src/modules/admin/engagement-retention.mjs` plus engagement route contracts | Sent recipients only; completed rows older than 15 days are GUI-hidden, not deleted |

## 14. Open gaps to fill deliberately

1. Reconcile the old chip note’s `SUBMITTED=green` wording with the current `docs/chips.md` `SUBMITTED=amber` contract.
2. Add a dedicated executable contract for `.env-badge` immutability across theme and environment states.
3. Convert the detailed button inventory’s remaining out-of-semantics controls into explicit shared semantic variants or documented structural exceptions.
4. Keep the header HTML reference and shared header contract tests synchronized when sibling order or controls change.
5. Add a single machine-readable token manifest only after deciding whether CSS custom properties or a generated JSON representation is authoritative; do not create a second ungoverned SSOT.

## 15. Required review checklist

- [ ] Exact user wording and scope captured.
- [ ] This document and the surface-specific docs read.
- [ ] Canonical source identified; generated copies not edited as source.
- [ ] Existing semantic token/class reused or a gap recorded.
- [ ] Light and dark behavior checked.
- [ ] light mode (LM) / dark mode (DM) themes in dev/test mirrorscope and authorization checked.
- [ ] Geometry, DOM order, responsive behavior, and accessibility checked.
- [ ] Focused contracts pass.
- [ ] Generated assets rebuilt and parity checked.
- [ ] Dev runtime restarted and health verified.
- [ ] Authenticated browser proof performed when the surface is protected.
- [ ] Remaining gaps recorded here or in the relevant normative document.
