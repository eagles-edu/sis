# Documentation status and parameter audit

This audit separates executable current requirements from historical plans and abandoned proposals. It is the gate for deciding whether a number, color, function, selector, route, or workflow statement may be copied into a code change.

## Status vocabulary

| Status | Meaning | May define current code? |
| --- | --- | --- |
| `CURRENT` | Verified against current source and contract tests | Yes |
| `CURRENT WITH GAP` | Current authority exists, but documented drift or missing test remains | Yes, with the gap explicitly preserved |
| `TRANSITIONAL` | Active migration target with a documented implementation boundary | Only for the named migration task |
| `HISTORICAL` | Past implementation, incident, abandoned plan, or superseded parameter | No |
| `REFERENCE` | Example or educational material, not a product contract | No |

## Current executable authorities

| Concern | Current authority | Verification anchor |
| --- | --- | --- |
| Shared theme tokens and reusable chrome | `web-asset/shared/portal-theme.css` | `tools/build-admin-assets.mjs`; portal theme contracts |
| Student/Parent χ pilot assets | `web-asset/shared/student-parent-critical.css` plus builder extraction | `portal-theme-colors*.css`, `student-parent-structure*.css`, both portal inline critical blocks | `test/student-parent-chi-contract.spec.mjs`; authenticated desktop/mobile render |
| Generated theme assets | `web-asset/shared/portal-theme.min.css` and `web-asset/admin/admin-portal-theme*.css` | `npm run build:admin-assets:check` |
| Surface roles | `--portal-page-bg`, `--portal-neutral-*`, `--portal-surface-*` in shared CSS | `test/portal-theme-contract.spec.mjs` |
| Shared page stack/content/definition spacing | `--portal-page-stack-gap: 12px`, `--portal-content-gap: 12px`, definition flow `12px`, definition inner spacing = flow / χ (`--portal-definition-chi: 1.61803398875`) | `test/portal-spacing-contract.spec.mjs` |
| Header geometry | `--portal-header-bar-*`, `--portal-brand-header-*` in shared CSS | portal shell tests and authenticated render |
| Footer/prefooter geometry | `--portal-footer-*`, `--portal-prefooter-block-size` | portal spacing/shell tests |
| Button geometry and semantic families | `.portal-button` plus `portal-button-*` classes | `docs/BUTTON-PLAN-1.MD`, `test/portal-button-contract.spec.mjs` |
| Chip geometry and status semantics | `.portal-chip`, `.chip`, and the current resolver contracts | `docs/chips.md`, `test/portal-chip-contract.spec.mjs` |
| Environment badge | `.env-badge` and `web-asset/shared/portal-environment.js` | served CSS, generated parity, runtime browser proof |
| Definition normalization | `normalizeLibraryDefinition`, `LIBRARY_DEFINITION_MAX_LENGTH = 50000` | `src/modules/admin/library-corpus.mjs` and Library tests |
| Definition rendering | `window.SIS_VOCABULARY_ESL.definitionHtml` / `flatEntryHtml` | `web-asset/shared/vocabulary-esl-editor.js`, `test/library-pages.spec.mjs` |
| Admin news review states | `submitted`, `revision-requested`, `approved` plus persisted submission state | `src/modules/admin/student-news-review.mjs`, student-news tests |
| Runtime environment ownership | `.env.dev`, `.env.test`, `.env`, deployed `SIS_CONFIG.json` | `docs/sop.md`, sync contracts, runtime health |

## Current parameter ledger

| Parameter | Current value | Former/conflicting value | Disposition |
| --- | --- | --- | --- |
| Dark data surface | `#525252` | `#5D5D5D` | `#5D5D5D` is historical; do not use |
| Light content role | `#FBFFFF` (`--portal-neutral-content-light`) | `#FFFFFF` in older plans | `#FFFFFF` is historical shorthand; current docs must use `#FBFFFF` |
| Button inline size | `160px` max/min semantic default | full-width/100% base behavior | Current responsive rule is `min(100%, 160px)`; no universal 100% button |
| Button minimum block size | `48px` | page-specific smaller controls | `48px` is shared default; explicit chrome exceptions must remain named |
| Chip inline size | `120px` | button-sized chips | Chips remain compact and separate from buttons |
| Chip minimum block size | `32px` | `30px` legacy compact `.chip` rule | `.portal-chip` contract is current; legacy `.chip` uses must not define a new SSOT |
| Page stack/content/definition gaps | `12px` | ad hoc 8/10px universal cluster rule | 8/10px may be local measured spacing, not a global normalized parameter |
| Body portal block padding | `24px` | critical CSS `0` during rejected async experiment | `0` is historical incident state; current source reserves `24px` |
| Admin theme architecture | one shared source plus generated admin subset | proposed `portal-tokens.css` split | Separate token file is an abandoned proposal unless explicitly re-approved |
| Admin review pending label | `pending-X` where the current surface contract uses it | Source still contains `unapproved-X` / `turquoise` compatibility paths | `CURRENT WITH GAP`: contain the compatibility paths; do not propagate them into new code |
| News report `SUBMITTED` chip | amber in `docs/chips.md` and current resolver | green in the old approved-action note | Old green wording is historical conflict; resolve only through the current chip contract |
| Definition maximum length | `50000` | older lower per-path clamps | All current Library normalization paths use the shared 50,000 limit |
| Definition ordered-list flattening | one compatible ordered list | repeated `1.` entries | Repeated numbering is a historical bug, not a display option |

## Document disposition matrix

### Current normative documents

| Document | Status | Current responsibility |
| --- | --- | --- |
| `AGENTS.md` | `CURRENT` | Hard operating and semantic constraints |
| `docs/sop.md` | `CURRENT` | Reusable workflow and environment procedure |
| `README.md` | `CURRENT` | Paths, commands, entrypoints, surface map |
| `sis.md` | `CURRENT` | Current project snapshot |
| `docs/CODE-EDITING-DOCS-INDEX.md` | `CURRENT` | Review directory and document routing |
| `docs/CORE-DESIGN-PARAMETERS.md` | `CURRENT WITH GAP` | Normalized theme/function/geometry/semantics sheet |
| `docs/# Hub-First Palette SSOT Migration.md` | `CURRENT WITH GAP` | Active cross-portal surface architecture; must use current values |
| `docs/01-gray-palette-darkmode.md` | `CURRENT` | Dark neutral ladder values |
| `docs/chips.md` | `CURRENT WITH GAP` | Chip semantics and dimensions; one status conflict remains with an older note |
| `docs/BUTTON-PLAN-1.MD` | `CURRENT WITH GAP` | Button semantic/geometry contract and inventory; old universal gap language must be removed |
| `docs/admin-performance-contract.md` | `CURRENT` | Protected performance and generated-asset gates |
| `docs/validation.md` | `CURRENT` | Student News field validation contract |
| `docs/Shared Vocabulary Library Corpus.md` | `CURRENT WITH GAP` | Library workflow and geometry; verify each UX number against current CSS |
| `docs/PROMULGATE-LIBRARY-PLAN.md` | `TRANSITIONAL` | Library canonicalization/cutover implementation boundary |
| `docs/# Layered Student-News Validator Superch.MD` | `TRANSITIONAL` | Consolidated future validator workflow |

### Historical or abandoned documents

| Document | Status | Why it must not define current requirements |
| --- | --- | --- |
| `docs/PLAN.md` | `HISTORICAL` | Proposes a separate `portal-tokens.css` architecture that is not the current implementation |
| `docs/UPDATED-PLAN.md` | `HISTORICAL` | Rewrite plan contains the stale `#5D5D5D` value and proposal language |
| `docs/cleaner architecture.md` | `HISTORICAL` | Earlier token/component split proposal; not implemented |
| `docs/01-gray-palette-darkmode.TXT` | `HISTORICAL` | Older palette copy uses `#5D5D5D`; current `.md` file is authoritative |
| `docs/APPROVED ACTION chips.md` | `HISTORICAL` | Earlier chip proposal conflicts with current `docs/chips.md` status colors and labels |
| `docs/Student News Draft + MMR Check Flow.md` | `HISTORICAL` | It already identifies itself as consolidated historical context |
| `docs/Normalize Shared Theme Then Rebase.md` | `HISTORICAL` | Migration plan/rationale; current implementation is the shared CSS and tests |
| `docs/chat.md` | `HISTORICAL` | Transcript/evidence archive; command output and intermediate proposals are not requirements |
| `docs/logs/**`, screenshots, exports, and scratch files | `HISTORICAL` or `REFERENCE` | Evidence or source material, not implementation authority |

## Required document cleanup rule

Every document that contains a superseded parameter must have a visible status banner near the title. The banner must name the current authority and state that the old value is not a current requirement. Do not silently edit historical evidence to make it look current; quarantine it and preserve its historical meaning.

## Open reconciliations

1. `docs/chips.md` and `docs/APPROVED ACTION chips.md` disagree about `SUBMITTED`; `docs/chips.md` is current and the older note is historical.
2. `docs/BUTTON-PLAN-1.MD` still contains a large inventory of observed control drift; convert each remaining outlier into an explicit semantic family or structural exception before changing it.
3. The repository does not yet have a dedicated executable `.env-badge` parity contract across both theme states and runtime mirrors; served CSS and generated parity checks remain the current evidence.
4. The Library plan documents need a final pass against current rendered Library geometry; a requested number is not current merely because it appears in a plan.
