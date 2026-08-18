# Code-editing documentation index

This is the review directory for code changes that can affect SIS behavior, portal markup, CSS, generated assets, authentication, data contracts, or runtime parity. It is intentionally narrower than a file listing: binary references, screenshots, logs, backups, and one-off scratch notes are not normative code-editing references.

## Review order for every code edit

1. Read [`AGENTS.md`](../AGENTS.md) for non-negotiable repository constraints.
2. Read [`docs/sop.md`](sop.md) for the operational procedure and environment boundaries.
3. Read [`README.md`](../README.md) and [`sis.md`](../sis.md) for current paths, entrypoints, and status.
4. Open [`DOCUMENT-STATUS-AND-PARAMETER-AUDIT.md`](DOCUMENT-STATUS-AND-PARAMETER-AUDIT.md) to reject historical values before reading a plan.
5. Open [`CORE-DESIGN-PARAMETERS.md`](CORE-DESIGN-PARAMETERS.md) for the normalized design contract.
6. Review the surface-specific document below before touching that surface.
7. Search the referenced source and contract tests before editing.
8. Rebuild generated assets, restart the relevant runtime, and run the contract gate named by the document.
9. Update this index or the core parameters document when a new durable contract is created; update [`docs/history.md`](history.md) only for a milestone or incident.

### Baseline layout sanity gate

Every portal UI edit must preserve basic rendered layout hygiene before feature-specific review: visible sibling elements must not touch, visible groups must use a non-zero shared gap or deliberate margin, surfaces and controls must retain readable inset padding, and standalone pagination/action groups must use the established alignment contract (centered by default unless the surface document explicitly requires another alignment). Check the indexed source and tests before coding; if the requested result would intentionally violate an established web-layout, accessibility, or responsive practice, ask before editing. Verify the result in an authenticated browser at desktop and mobile widths for every affected portal.

## Normative source hierarchy

| Priority | Source | Authority | Use |
| --- | --- | --- | --- |
| 1 | `AGENTS.md` | Repository operating contract | Safety, scope, sync, source-first editing, shared UI rules |
| 2 | `docs/sop.md` | Reusable operating procedure | Environment ownership, browser proof, generated assets, parity gates |
| 3 | `docs/CORE-DESIGN-PARAMETERS.md` | Normalized design contract | Shared colors, geometry, typography, component semantics, known gaps |
| 4 | `web-asset/shared/portal-theme.css` | Executable theme SSOT | CSS token and shared component implementation |
| 5 | Surface contracts and tests | Executable behavior contract | Route, markup, API, chip/button, Library, validation, and performance rules |
| 6 | Plans and historical notes | Intent and rationale | Future work, migration context, drift diagnosis; not a license to bypass current code/tests |

The audit is the status gate for priorities 3-6. A document marked `HISTORICAL`
or `REFERENCE` can explain why a value existed, but cannot define a new
requirement. A document marked `CURRENT WITH GAP` is usable only with its
listed gap preserved and checked against executable source.

## Pertinent document directory

### Foundation and operations

| Document | Review when | Detailed contents |
| --- | --- | --- |
| [`README.md`](../README.md) | Any task needing paths, commands, routes, or entrypoints | Purpose; current highlights; canonical paths; stack; directory map; documentation map; quick start; dev entrypoints; admin/parent/student surfaces; auth model; operational commands; safe workflow notes |
| [`sis.md`](../sis.md) | Any non-trivial task or status-sensitive task | Scope; active docs; current baseline; shared-theme SSOT; environment/version split; Library/vocabulary status; performance boundary; test status; prioritized next actions |
| [`docs/sop.md`](sop.md) | Before every code, route, UI, sync, or runtime edit | Prompt/document ownership; communication; canonical workspace; environment ownership; sync order; immutable runtime config; portal theme contract; accessibility/layout; browser and test gates; failure diagnosis |
| [`docs/history.md`](history.md) | When a change follows an incident or creates a durable milestone | Major milestones; theme consolidation; generated-asset incidents; critical-CSS decisions; runtime/config repair; incident evidence; parity and rollback rationale |
| [`docs/security-and-backup-policy.md`](security-and-backup-policy.md) | Any destructive, auth, secret, backup, restore, or mirror operation | Backup-first rules; protected data; restore and rollback boundaries; secret handling; operational evidence |
| [`docs/validation.md`](validation.md) | Student News validation, normalization, save, or response changes | Primary rule; save contract; validation categories; allowed sources; normalization; every field’s length/required/warning/preferred shape; response contract; revision guidance; drift watch |

### Shared visual system and interaction semantics

| Document | Review when | Detailed contents |
| --- | --- | --- |
| [`CORE-DESIGN-PARAMETERS.md`](CORE-DESIGN-PARAMETERS.md) | Every rendered UI or shared formatter edit | Review lock; source hierarchy; normalized color roles; theme invariants; geometry/spacing; typography; header/footer; button semantics; chip semantics; definition formatting; form/control geometry; functions and ownership; generated assets; parity proof; gap register |
| [`DOCUMENT-STATUS-AND-PARAMETER-AUDIT.md`](DOCUMENT-STATUS-AND-PARAMETER-AUDIT.md) | Every code edit when a plan, screenshot, log, or older parameter is cited | Status vocabulary; executable authorities; current parameter ledger; conflicting legacy values; document disposition; quarantine rule; unresolved reconciliations |
| [`docs/# Hub-First Palette SSOT Migration.md`](%23%20Hub-First%20Palette%20SSOT%20Migration.md) | Shared colors, surfaces, dark mode, page-local CSS, or theme migration | Summary; neutral surface model; content-layer contract; light roles; dark roles; ownership; dev entrypoints; single-pass alignment; page-local exceptions; hard bans; immutable button/chip exclusions; drift inventory; migration roadmap; tests; assumptions; status; notes |
| [`docs/Normalize Shared Theme Then Rebase.md`](Normalize%20Shared%20Theme%20Then%20Rebase.md) | Historical grades/tab rebasing context only | `HISTORICAL`: earlier shared-token changes, page-local ownership, grades-tabulator rebase, tab changes, and test rationale |
| [`docs/BUTTON-PLAN-1.MD`](BUTTON-PLAN-1.MD) | Any button, action link, menu control, modal close, radius, hover, or sizing edit | Shared semantic classes; radius tokens; button variants; chip variants; base button/chip contracts; immutable exclusions; review-first rollout; proof page; test plan; assumptions; hard rules; semantic groups; box model; portal inventory; missing buttons; retired rows; open drift; out-of-semantics controls; recommendations |
| [`docs/chips.md`](chips.md) | Any status/action chip, queue/calendar chip, chip geometry, or chip color edit | SSOT scope; report chip states and precedence; week-set Status; week-set Action; surface matrix; modal blocking matrix; normalized dimensions; accessibility contrast; contract test |
| [`docs/APPROVED ACTION chips.md`](APPROVED%20ACTION%20chips.md) | Historical workflow terminology only | `HISTORICAL`: older report status colors, action labels, modal/API ideas; do not use as current chip authority |
| [`docs/01-gray-palette-darkmode.md`](01-gray-palette-darkmode.md) | Dark neutral ladder, content/panel/card/data-surface, or text/link colors | `CURRENT`: dark page/content/panel/card/data-surface values; chart/table background; black/white/link/link-hover/link-down values |
| [`docs/HEADER-PROPER.HTML`](HEADER-PROPER.HTML) | Header, topbar, menu, theme toggle, zoom controls, or shell sibling order | Canonical header markup; runtime warning; search/filter controls; admin shell structure; shared chrome control placement; footer/prefooter context |
| [`docs/defspace-1.md`](defspace-1.md) | Definition display, flattening, ordered-list numbering, etymology, or vocabulary formatting | Preferred formatted definition example; original source example; headings; ordered/unordered lists; examples; etymology; verb forms; stems; works cited; exact spacing reference used by Library tests |

### Surface and workflow contracts

| Document | Review when | Detailed contents |
| --- | --- | --- |
| [`docs/admin-performance-contract.md`](admin-performance-contract.md) | Admin shell, first paint, asset loading, island split, critical CSS, or generated admin assets | Regressions and mitigations; protected performance markers; required verification; authenticated desktop/mobile regression gate; CLS/LCP/TBT/request constraints |
| [`docs/PROMULGATE-LIBRARY-PLAN.md`](PROMULGATE-LIBRARY-PLAN.md) | Library corpus, duplicate lifecycle, canonicalization, review state, ET lookup, or cutover | Canonical uniqueness; migration order; implementation changes; tests; defaults; legacy cutover; assumptions |
| [`docs/Shared Vocabulary Library Corpus.md`](Shared%20Vocabulary%20Library%20Corpus.md) | Shared Library editor, student/admin parity, fields, origin attribution, or legacy entries | Corpus summary; data/API; origin attribution; UX/classification; verification; assumptions; legacy cutover; full ESL entry flow; MW workflow; preflight/cutover; flowchart; tests |
| [`docs/Student News Draft + MMR Check Flow.md`](Student%20News%20Draft%20%2B%20MMR%20Check%20Flow.md) | Historical Student News context only | `HISTORICAL`: explicit pre-submit state, MMR/advisory split, UI flow, and test rationale; the consolidated validator plan and current code win |
| [`docs/mapping/admin-route-trace.md`](mapping/admin-route-trace.md) | Admin/parent route, auth, role gate, handler, or API contract | Auth/role summary; public routes; auth routes; core admin routes; parent routes; incoming queue actions; batch queue actions |
| [`docs/mapping/README.md`](mapping/README.md) | Route map, OpenAPI, dependency map, or mapping artifact regeneration | Toolchain; layout; commands; local workflow; portal capabilities; graphical views; outputs; coverage note |

## Supporting documents to consult by task

These are pertinent but usually follow the core review set:

- [`docs/sis-admin-wiring-map.ascii.txt`](sis-admin-wiring-map.ascii.txt) for admin DOM-to-handler wiring.
- [`docs/admin-staff-user-manual.md`](admin-staff-user-manual.md) for visible admin workflow meaning.
- [`docs/parent-student-user-manual.vi.md`](parent-student-user-manual.vi.md) for visible parent/student workflow meaning.
- [`docs/font-hosting.md`](font-hosting.md) for B612 Mono and font-loading boundaries.
- [`docs/monitoring.md`](monitoring.md) and [`docs/test-mirror-monitoring.md`](test-mirror-monitoring.md) for health and parity evidence.
- [`docs/db-backup-failsafe.md`](db-backup-failsafe.md) for backup commands and restore evidence.
- [`docs/test-redis-note.md`](test-redis-note.md) for Redis/runtime health interpretation.
- [`docs/plan-upgrade-0426.md`](plan-upgrade-0426.md) for upgrade planning, and [`docs/PLAN.md`](PLAN.md) / [`docs/UPDATED-PLAN.md`](UPDATED-PLAN.md) for `HISTORICAL` theme proposals only; verify every plan claim against current code.

## Gap-finding register

| Gap | Current authority | Required follow-up |
| --- | --- | --- |
| Core parameters were distributed across plans and CSS | `CORE-DESIGN-PARAMETERS.md` plus shared CSS | Keep the parameter table synchronized when a token or component contract changes |
| Chip documents disagree on `SUBMITTED` color terminology | `docs/chips.md` is the current detailed contract; the approved-action note is historical intent | Resolve the canonical label/color matrix in one reviewed change and update both docs |
| Header markup reference is HTML, not a structured contract | `docs/HEADER-PROPER.HTML` plus portal contract tests | Add explicit sibling/order/selector assertions when header structure changes |
| Button inventory has documented open drift | `docs/BUTTON-PLAN-1.MD` | Classify remaining out-of-semantics controls before restyling them |
| Definition formatting has examples but limited token ownership documentation | `docs/defspace-1.md`, shared formatter, spacing tests | Keep formatter, safe HTML, ordered-list flattening, and spacing parameters linked here |
| Portal hub still has centralization drift | `sis.md` and theme SSOT plan | Do not add new hub-local theme tokens; migrate only with rendered parity proof |
| Environment parity is documented operationally but not summarized per design component | SOP, sync scripts, generated-asset checks | Use the parity checklist in `CORE-DESIGN-PARAMETERS.md` for every shared UI change |

## Change-record rule

When editing code, do not update this index for a transient implementation detail. Update it only when one of these changes: a new normative document is added; a source of truth moves; a parameter becomes canonical; a gap is closed; or a contract/test gate changes.
