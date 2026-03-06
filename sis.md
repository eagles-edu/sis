# SIS Project Notes

## Scope

- Workspace: `/home/eagles/dockerz/sis`
- Runtime: Node `v20.19.4`
- Service entrypoint: [server/exercise-mailer.mjs](server/exercise-mailer.mjs)
- Admin routing module: [server/student-admin-routes.mjs](server/student-admin-routes.mjs)

## Update (2026-03-06 - progress report layout + collapsible left menu)

- Replaced the `parent-tracking` input panel in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html) with a workbook-shaped progress report form:
  - widened the form to span both large-viewport columns.
  - added a two-column report body that stacks on small viewports.
  - preserved all existing `pt_*` contract ids used by save/queue/report flows.
  - added `pt_homeworkAnnouncement` as an auto-filled read-only assignment summary line.
- Added desktop + mobile left-menu collapsing in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - menu toggle moved to the persistent page header.
  - desktop mode toggles `menu-collapsed` and persists state in `localStorage`.
  - mobile mode keeps existing `menu-open` overlay behavior.
- Added regression coverage in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - `desktop menu toggle collapses and restores left navigation`.
- Current test status:
  - `node --test test/student-admin-ui.spec.mjs` => `34` pass, `0` fail.
  - `npm test` => `137` pass, `0` fail.
- Coverage gaps and prioritized next actions:
  - progress-rubric table rows are currently UI-only and not persisted.
  - TODO: auto-render parent-facing Vietnamese summary from rubric rows + score bands (currently manual VI entry in `pt_comments`).
  - next priority: introduce dedicated `StudentAssignments` persistence + migration and wire rubric/homework rows into API/UI payload contracts.

## Update (2026-03-06 - operations hardening)

- Added backup-first import runbook script [tools/import-students-safe.sh](tools/import-students-safe.sh):
  - enforces strict preflight validation before write.
  - write path requires explicit `--yes`.
  - backup is executed before import write.
- Added smart DB backup wrapper [tools/db-backup-smart.sh](tools/db-backup-smart.sh):
  - prefers native `pg_dump`/`pg_restore` workflow via existing Node backup utility.
  - falls back to dockerized `pg_dump`/`pg_restore` using running `sis-postgres` when host binaries are unavailable.
- Added full-system snapshot backup script [tools/sis-full-backup-snapshot.sh](tools/sis-full-backup-snapshot.sh):
  - snapshots runtime files and DB dump into a timestamped folder.
  - writes snapshot manifest + restore notes.
- Added full-system restore script [tools/sis-full-restore-snapshot.sh](tools/sis-full-restore-snapshot.sh):
  - restores snapshot app files and DB dump with explicit `--yes` confirmation.
  - supports docker fallback restore when host `pg_restore` is unavailable.
- Added deploy wrappers earlier in this session:
  - [tools/deploy-ui-safe.sh](tools/deploy-ui-safe.sh)
  - [tools/deploy-api-safe.sh](tools/deploy-api-safe.sh)
  - [tools/deploy-db-fields-safe.sh](tools/deploy-db-fields-safe.sh)
- Rewrote [README.md](README.md) into full GitHub-style operations documentation with:
  - role runbooks (teacher/admin tracking operations),
  - feature matrix and admin handbook,
  - CI/CD and maintenance policy,
  - safe edit/deploy workflows,
  - backup and disaster-recovery runbooks.
- Verification executed:
  - syntax checks for new/updated shell scripts (`bash -n`) passed.
  - `tools/deploy-db-fields-safe.sh --check-only` passed.
  - `tools/db-backup-smart.sh` succeeded via docker fallback.
  - `tools/sis-full-backup-snapshot.sh --no-archive` succeeded.
  - `tools/import-students-safe.sh --check-only` correctly halted on duplicate `eaglesId` preflight errors with no write.

## Update (2026-03-06)

- Refined admin navigation and top branding in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - added a compact page brand strip with school name at top of app pages, clamped for small screens.
  - added sidebar logo placement between `Navigation` title and the expandable-menu helper text.
  - normalized top-level menu visual hierarchy so `DASHBOARD`, `STUDENTS`, `TRACKING`, `SUPPORT`, and `ADMINISTRATION` share uppercase sizing.
- Improved top live student result UX in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - added sortable headers for `Eagles ID`, `Name`, and `Level`.
  - retained compact default panel height and added `Show All` / `Show Less` toggle for full result expansion.
  - removed dot-prefix decoration from level chip labels.
- Standardized UI corner rounding in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - introduced proportional radius tokens anchored at `3.667px` (`--radius-base`, `--radius-1`, `--radius-2`, `--radius-3`, `--radius-pill`).
  - remapped hardcoded `border-radius` values (`3/6/7/8/10/999`) to the shared token scale for visual consistency.
- Improved student identity labels for missing-name cases in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - added shared display helpers so student labels fall back to `englishName` when `fullName` is blank.
  - top search/selector labels now include `studentNumber` with format like `(Anna 2) anna002 <222>` instead of `(no name)`.
- Added regression coverage in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - `top search option uses englishName and studentNumber when fullName is missing`.
- Added regression coverage in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - `top search results support show-all expansion and sortable headers`.
- Current test status:
  - `npm test` => `135` pass, `0` fail.
  - `node --test test/student-admin-ui.spec.mjs` => `33` pass, `0` fail.

## Update (2026-03-05)

- Import integrity hardening (anti-corruption guardrails):
  - [server/student-admin-store.mjs](server/student-admin-store.mjs) now validates import identity rows before write using `validateImportRowsForIdentity(...)`.
  - strict import identity mode is now enabled by default via `STUDENT_IMPORT_REQUIRE_EXPLICIT_IDENTITY` (default `true`), requiring explicit `eaglesId` and `studentNumber` values per row.
  - import preflight now rejects duplicate identity keys in the upload and identity collisions with existing database rows before any write occurs.
  - import persistence now runs inside a single transaction (all-or-nothing) and returns `committed: false` when an import fails.
  - compatibility mode remains available by setting `STUDENT_IMPORT_REQUIRE_EXPLICIT_IDENTITY=false`, preserving prior autofill behavior.
- Added import-validation unit coverage in [test/student-admin-import-validation.spec.mjs](test/student-admin-import-validation.spec.mjs) for strict rejection paths and compatibility-mode autofill behavior.
- Current test status:
  - `npm test` => `133` pass, `0` fail.
- Dependency security remediation (audit-focused):
  - removed unused vulnerable dev tooling from [package.json](package.json): `critical`, `lighthouse`.
  - upgraded direct runtime/security-sensitive deps:
    - `nodemailer` -> `^7.0.13`
    - `prisma`, `@prisma/client`, `@prisma/adapter-pg` -> `^7.4.2`
  - added targeted dependency overrides in [package.json](package.json):
    - `hono: 4.12.5`
    - `lodash: 4.17.23`
  - baseline `npm audit --json` before edits: `18` vulnerabilities (`1` critical, `6` high, `11` moderate).
  - current `npm audit --json` after remediation: `1` vulnerability (`1` high, `0` critical, `0` moderate), limited to direct dependency `xlsx@0.18.5` (no fix published on npm).
  - validation after dependency changes:
    - `npm run db:generate` succeeded (`Prisma Client v7.4.2` generated).
    - `npm test` => `129` pass, `0` fail.
  - added production-focused audit command in [package.json](package.json):
    - `npm run audit:prod` -> `npm audit --omit=dev --audit-level=high`.
  - follow-up host audit after `npm audit fix` on `2026-03-05`:
    - remaining highs are `@hono/node-server@1.19.9` (via `prisma` CLI dev dependency `@prisma/dev`) and direct runtime dependency `xlsx@0.18.5` (no upstream fix published).
    - production mitigation remains: install/runtime deploy with `npm ci --omit=dev` to exclude the Prisma CLI dev chain from shipped artifacts.
- Added final DB hardening for student identity:
  - [prisma/schema.prisma](prisma/schema.prisma) now defines `Student.eaglesId` as non-null (`String @unique`).
  - added migration [prisma/migrations/20260305024500_eaglesid_not_null/migration.sql](prisma/migrations/20260305024500_eaglesid_not_null/migration.sql) to:
    - normalize blank `eaglesId` values to `NULL`,
    - backfill missing `eaglesId` values from `studentNumber` as `SIS-######` (with deterministic `-<id>` suffix when base id is already taken),
    - enforce `ALTER COLUMN "eaglesId" SET NOT NULL`.
  - local apply result: `npm run db:migrate:deploy` successfully applied `20260305024500_eaglesid_not_null`.
- Validation:
  - `npm run db:generate` succeeded.
  - `npm test` => `129` pass, `0` fail.
- Completed strict internal identity rename from `Student.studentId` to `Student.eaglesId`:
  - [prisma/schema.prisma](prisma/schema.prisma) now defines `Student.eaglesId` (no `studentId` field).
  - added migration `20260305005500_rename_studentid_to_eaglesid` and deployed it with `npm run db:migrate:deploy`.
  - completed admin/runtime/UI sweep in [server/student-admin-store.mjs](server/student-admin-store.mjs), [server/student-admin-routes.mjs](server/student-admin-routes.mjs), [server/student-report-card-pdf.mjs](server/student-report-card-pdf.mjs), [server/exercise-store.mjs](server/exercise-store.mjs), and [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html).
- Enforced stricter student-number DB integrity:
  - [prisma/schema.prisma](prisma/schema.prisma) now sets `Student.studentNumber` to non-null (`Int @unique`).
  - added migration `20260305012000_student_number_not_null`:
    - backfills any null `studentNumber` values with deterministic sequential numbers starting at `max(100, current max + 1)`.
    - then applies `ALTER COLUMN "studentNumber" SET NOT NULL`.
  - deployed with `npm run db:migrate:deploy` (success).
- Removed remaining admin UI `studentId` naming drift:
  - parent-tracking selector/id and code paths now use `studentRefId` (`pt_studentRefId`), avoiding confusion with `eaglesId`/`studentNumber`.
  - fixed parent-tracking report-save endpoint path to use internal student ref id (`/api/admin/students/:studentRefId/reports`).
- Updated coverage for strict naming:
  - [test/profile-form-contract.spec.mjs](test/profile-form-contract.spec.mjs) now validates `topLevelKey: eaglesId` directly against Prisma schema.
  - [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs), [test/student-admin.spec.mjs](test/student-admin.spec.mjs), and [test/student-admin-import-autofill.spec.mjs](test/student-admin-import-autofill.spec.mjs) now use `eaglesId`-first fixtures/contracts and no `autoFilledStudentIds` alias assumptions.
- Enforced strict duplicate rejection for student identity keys:
  - [server/student-admin-store.mjs](server/student-admin-store.mjs) `saveStudent` now rejects duplicate `eaglesId` on create (`409`) instead of updating an existing record.
  - import flow now pre-validates duplicate `eaglesId` and duplicate `studentNumber` within the upload batch and marks those rows as failures before save attempts.
- Removed remaining public/admin `studentId` fallback handling from student-admin save/import flows:
  - [server/student-admin-store.mjs](server/student-admin-store.mjs) now requires `payload.eaglesId` in `saveStudent`, import row mapping resolves only canonical camelCase `eaglesId`, and identity auto-fill now natively writes `eaglesId`.
  - [server/student-admin-routes.mjs](server/student-admin-routes.mjs) incoming queue `create-account` action now resolves requested id from `payload.eaglesId` (plus submitted fallback), not `payload.studentId`.
- Updated profile form top-level identifier mapping in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - canonical field key `eaglesId` maps to `topLevelKey: eaglesId` and control id `f_eaglesId`.
  - profile payload collection now emits `{ eaglesId, studentNumber, email, profile }`.
  - profile save validation now enforces `eaglesId is required`.
  - incoming queue create-account prompt/action now uses `eaglesId`.
- Tightened workbook tooling:
  - [tools/prepare-student-import-workbooks.mjs](tools/prepare-student-import-workbooks.mjs) removed legacy `studentId` import alias and now emits canonical camelCase `eaglesId`.
  - regenerated template + import files and verified strict header parity against canonical `docs/students/eaglesclub-students-import-ready.xlsx`.
  - latest validation: `current_matches_amalgamated.import-ready.xlsx` header order matches schema (`63/63`) with `0` missing `eaglesId` and `0` missing `studentNumber`.
- Updated regression tests:
  - [test/student-admin-import-autofill.spec.mjs](test/student-admin-import-autofill.spec.mjs) now validates `eaglesId` autofill behavior.
  - [test/profile-form-contract.spec.mjs](test/profile-form-contract.spec.mjs) now enforces allowed top-level key `eaglesId`.
  - [test/profile-form-contract.spec.mjs](test/profile-form-contract.spec.mjs) now includes a guard asserting `Student.eaglesId` is non-null at schema contract level.
  - [test/profile-form-contract.spec.mjs](test/profile-form-contract.spec.mjs) now includes a strict workbook guard for canonical `docs/students/eaglesclub-students-import-ready.xlsx`, requiring exact header parity with `PROFILE_FORM_FIELD_ROWS` and direct DB-contract validation through Prisma mappings.
  - [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs) updated for `f_eaglesId` and `payload.eaglesId`.
- Current test status:
  - `npm test` => `130` pass, `0` fail.
- Final camelCase hardening (2026-03-05):
  - [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html) now canonicalizes profile field keys with `toProfileFieldIdSuffix(...)` in both field-definition normalization and settings custom-field creation, eliminating kebab-case key generation.
  - [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs) now asserts custom key creation/storage uses camelCase (`customHealthNote`, `customAlias`) and explicitly rejects kebab-case key slots.
  - `npm test` revalidated after these assertions: `130` pass, `0` fail.

## Update (2026-03-04)

- Introduced a dedicated **Dashboard** landing button and reworked the Students navigation so it now jumps straight to profile, removed the floating Students submenu, and hid the global top-search controls whenever viewing dashboard, attendance, assignments, grades, or performance data pages so their local filters take precedence.
- Stripped “Unassigned” level tiles from the overview charts/tiles by filtering out blank or `unassigned` completions, and clarified the level detail panel binding with the existing assigned level data.
- Added inline summaries for Attendance data, Assignments data, Grades data, Performance data, and All Reports, then taught each admin-data table to show the active filters (level, student, search term) as soon as the dropdowns change so selecting a student immediately surfaces their info in the page’s purpose interface.
- Fixed admin data-page loading behavior in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - `Attendance data`, `Performance data`, `Grades data`, and `All Reports` now auto-hydrate records from scoped student detail fetches when those pages are opened (instead of relying on the currently selected profile only).
  - hydrated rows are cached by student id (`studentDetailCacheById`) and reused across page switches to avoid redundant API calls.
  - each of the four data tables now includes a sortable `Student` result column and search text now includes student name/id/level so free-text filtering behaves as expected for all/level/individual lookups.
- Added dedicated UI coverage for School Setup profile/logo flows in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - validates that school profile fields + school-year dates persist to `sis.admin.uiSettings` and reset back from saved values.
  - validates logo upload constraints (`svg/jpg/png/webp`, max `650px`) plus preview/clear behavior.
- Improved small-screen dashboard behavior in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - wrapped `Homework progress`, `Anonymous Exercise Submissions`, and `Queued Performance Reports` tables in horizontal scroll containers so Overview no longer overflows viewport width on phones.
  - wrapped `Enrolled vs Attendance (Today)` in the same scroll container model, and tightened queue/details table min-width behavior for narrow screens.
  - stacked queue/detail action buttons to one column at narrow widths and allowed queue summary headers/status text to wrap.
- Resolved browser console password-field warning in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - wrapped dynamic `Profile` editor controls in a real `<form id="profileEditorForm">` so dynamically-rendered `f_password` input is form-contained.
  - set `autocomplete="new-password"` on rendered profile password controls.
- Addressed editor diagnostics in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - added default `src="data:,"` to the school-logo preview `<img>` element.
  - removed explicit `width` on profile-tab buttons and enforced `box-sizing: border-box` for safer box-model behavior.
- Stabilized flaky async JSDOM cleanup in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - added `settleDomAsync` and used it before closing DOM in high-activity tests to prevent post-close `document.getElementById` unhandled rejections.
  - extended mobile-wrapper assertions to include `#overviewClassTableWrap`.
- Refactored student numbering + profile field persistence from the 2026 workbook contract:
  - added DB-backed `Student.studentNumber` (unique) plus profile fields `memberSince`, `exercisePoints`, `parentsId`, `newAddress`, `currentSchoolGrade`, and `postCode` in [prisma/schema.prisma](prisma/schema.prisma) and migration `20260304214000_add_student_number_and_profile_fields`.
  - standardized import header mapping in [server/student-admin-store.mjs](server/student-admin-store.mjs) to canonical keys only (camelCase + workbook keys), removing fuzzy legacy aliases.
  - added store + API support for next student number resolution (`GET /api/admin/students/next-student-number`) with a floor of `100`, so once the highest number is `225`, the next auto-suggested number is `226`.
  - updated profile editor wiring in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html) so `student-number` is a first-class top-level field and new forms hydrate only `studentNumber` (not `studentId`) from the next-number endpoint.
  - removed legacy `studentId -> studentNumber` fallback paths in both UI and store logic; next-number resolution now uses `studentNumber` only.
  - aligned `PROFILE_FORM_FIELD_ROWS` with canonical workbook keys exactly (63/63, same order), including `studentPhoto`, `parentsId`, `classLevel`, `languagesHome`, and `postCode`.
  - corrected form-to-schema mapping gaps so workbook rows now persist `memberSince`, `exercisePoints`, and `newAddress` into `StudentProfile`.
  - normalized profile metadata symmetry by requiring bilingual labels + section labels for all configured fields in the default layout.
- Added regression coverage:
  - [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs): `new profile form hydrates next student number and keeps floor at 100+`.
  - [test/student-admin.spec.mjs](test/student-admin.spec.mjs): auth and store-disabled checks for `GET /api/admin/students/next-student-number`.
  - [test/profile-form-contract.spec.mjs](test/profile-form-contract.spec.mjs): workbook key/order parity, list-option integrity, camelCase naming rules, form/schema mapping completeness, strict removal of legacy student-number fallbacks, and no-fuzzy import alias enforcement.
- Production-prep DB/import operations:
  - applied pending migration `20260304214000_add_student_number_and_profile_fields` locally via `npm run db:migrate:deploy`; follow-up deploy shows `No pending migrations to apply`.
  - added one-time backfill utility [tools/backfill-student-number-once.mjs](tools/backfill-student-number-once.mjs) and executed it against local DB (current result: `assignedCount=0` because local `Student` table is empty).
  - verified runtime resolver still honors floor behavior: `getNextStudentNumber()` returns `{ startAt: 100, nextStudentNumber: 100 }` on empty DB.
  - added workbook prep utility [tools/prepare-student-import-workbooks.mjs](tools/prepare-student-import-workbooks.mjs):
    - regenerated served template [schemas/student-import-template.xlsx](schemas/student-import-template.xlsx) with canonical camelCase headers.
    - generated filled example template [docs/students/student-import-template.filled-example.xlsx](docs/students/student-import-template.filled-example.xlsx).
    - audited and canonicalized `docs/students/current_matches_amalgamated.xlsx` to [docs/students/current_matches_amalgamated.canonical-ready.xlsx](docs/students/current_matches_amalgamated.canonical-ready.xlsx) with audit report [docs/students/current_matches_amalgamated.canonical-audit.json](docs/students/current_matches_amalgamated.canonical-audit.json).
    - built import-ready workbook [docs/students/current_matches_amalgamated.import-ready.xlsx](docs/students/current_matches_amalgamated.import-ready.xlsx) with deterministic identity/number autofill (`studentNumber` floor `100`, `eaglesId = SIS-<6 digits>`).
    - latest audit result: canonicalized source still lacks optional headers `parentsId`, `photoUrl`, `postCode`, but import-ready workbook has `0` missing required ids (`eaglesId`/`studentNumber`).
- Follow-up validation and UI hardening (2026-03-04):
  - re-ran `node tools/backfill-student-number-once.mjs --dry-run`, apply mode, and `npm run db:migrate:deploy`; result remains `assignedCount=0` and no pending migrations.
  - verified student-domain cleanup status via DB counts (`students`, `profiles`, `attendance`, `grades`, `parentReports`, `submissions`, `intakeSubmissions`, `incomingExerciseResults`, `adminNotificationQueue`) all at `0`.
  - regenerated import artifacts via [tools/prepare-student-import-workbooks.mjs](tools/prepare-student-import-workbooks.mjs); latest audit timestamp `2026-03-04T17:12:05.937Z`.
  - refined Profile/Medical/COVID/Submission tabs in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html) into compact true horizontal tablists with desktop equal-width segments, mobile swipe support, and keyboard navigation (`ArrowLeft/ArrowRight/Home/End`).
  - hardened runtime spreadsheet import identity handling in [server/student-admin-store.mjs](server/student-admin-store.mjs):
    - added `applyImportIdentityDefaults` to auto-fill blank `eaglesId` and missing `studentNumber` for new import rows before save.
    - generated ids follow `SIS-<6 digits>` from assigned number with collision suffixing (`-2`, `-3`, ...).
    - existing students with explicit `eaglesId` continue update-safe behavior (missing number keeps existing DB number).
  - normalized import-facing naming to `eaglesId`:
    - [tools/prepare-student-import-workbooks.mjs](tools/prepare-student-import-workbooks.mjs) now emits `eaglesId` canonical header in blank/filled/import-ready workbooks.
    - import mapping in [server/student-admin-store.mjs](server/student-admin-store.mjs) now resolves `eaglesId` first (with legacy `studentId` aliases accepted for compatibility).
    - import UI status now reports `autoFilledEaglesIds` (with fallback support for prior `autoFilledStudentIds`) in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html).
  - added regression coverage in [test/student-admin-import-autofill.spec.mjs](test/student-admin-import-autofill.spec.mjs).
- SVG sizing still depends on browser intrinsic image dimensions (`naturalWidth`/`naturalHeight`), so malformed or dimensionless SVG edge-cases remain a follow-up hardening item.
- Targeted run: `node --test --test-name-pattern="school setup" test/student-admin-ui.spec.mjs` ⇒ pass.
- Current full run: `npm test` ⇒ `127` pass, `0` fail.

## Update (2026-03-03)

- Replaced the single-page student profile form in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html) with a tabbed profile renderer:
  - tabs now follow workbook-driven grouping (`Student profile`, `Medical tab`, `COVID tab`, `Submission tab`)
  - field layout now renders left-to-right by sequence, wrapping to new rows automatically
  - profile field definitions now cover the expanded `formfields.xlsx` model, including medical/covid and submission-signature fields
- Improved profile-form readability and structure in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - stronger contrast across tab shell, tab buttons, and section cards
  - larger profile label/input typography and clearer section-heading hierarchy
  - improved focus ring and option-card readability for checkbox/radio groups
- Added button interaction feedback in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - themed hover elevation/shadow transitions across button variants (primary/edit/delete/refresh)
  - explicit click feedback animation (ring + ripple) and active press state so button presses are visible
  - keyboard-triggered click feedback is also applied for `Enter`/`Space` button activation
- Refined profile UX structure in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - split profile into separate compact `Info` view and `New / Edit Form` view
  - added `Edit Info` action from info view and `Back to Info` action from form view
  - reduced spacing in profile blocks to minimize wasted screen space
- Updated profile field behavior in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - `Các ngôn ngữ được nói ở nhà` now renders as a dropdown (`select`) instead of checkbox group
  - profile info view now presents fields in a neat read-only card grid instead of input controls
- Improved mobile checkbox/radio usability in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - profile choice controls now use larger touch targets on small screens (24px control size, 48px minimum row height)
- Fixed search usability regressions in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - top student list live filter now includes `studentId` and email fields (not only name fields)
  - top student search now uses accent-insensitive matching and falls back to a local `take=1000` fetch when strict API search returns no rows
  - table-panel search/filter text matching now uses accent-insensitive normalization for student name + free-text filters
  - data-table Student ID filter now accepts both legacy IDs (`steve001`) and numeric-only IDs
  - Student ID validation copy now reflects both accepted formats
- Wired top search scope into page-specific student workflows in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - top `Search student` now supports datalist dropdown selection (`#searchStudentOptions`) while still allowing free-text search
  - top scope (`query`, `level`, `school`) is now persisted per search run and reused by student-centric pages
  - assignment/attendance/performance and tracking-data student sources now use scoped top results when a top filter is active, enabling quick one-student, level-only, or all-student drill-down
  - added top-panel scope status hint (`#topSearchScopeHint`) to show active scope and current-page scoped student count
  - added top-panel live search result rows (`#topSearchRows`) outside `Student Admin`; each row can be clicked to load the linked student directly into `Profile`
- Extended backend student search behavior in [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - `listStudents` now keeps fast DB `contains` search first, then runs accent-insensitive server-side matching when strict query returns zero rows
  - fallback scan respects level/school filters, normalizes Vietnamese diacritics, and returns ordered student rows from the API directly
  - this reduces dependence on client-side `take=1000` fallback for accent variants
- Added profile field layout management controls to `Settings` in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - create custom fields
  - delete fields (with lock protection on required key fields)
  - reconfigure input type/tab/section/sequence/width/options/placeholder/enabled state
  - apply/reset/reload layout editor actions
- Added client-side profile layout persistence (`localStorage`) and drop-in payload compatibility:
  - profile save/load now maps configured fields into existing profile keys where supported
  - non-core/custom fields are preserved in `normalizedFormPayload` / `rawFormPayload` for future complementary form build-out
  - existing student save/update/delete flow remains unchanged at API contract level (`studentId` + `profile`)
- Added profile-layout follow-up hardening in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - creating a new profile field in `Settings` now repopulates currently selected student data into the rerendered tabbed profile form
  - restored missing `normalizeTextArray` helper used by checkbox-array profile fields during payload collection
- Added UI regression coverage in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - `profile settings layout editor supports tab/type/sequence updates and custom field create-delete`
  - `profile payload mapping preserves mapped fields and custom form payload keys`
  - `student search fallback keeps accent-insensitive matches discoverable`
  - `student search keeps direct query result and avoids fallback refetch`
- Added top-scope coverage in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - `top search level scope narrows assignment student dropdown and supports datalist selection`
  - `student admin child page owns students panel while search stays visible` now also verifies top-panel quick results stay available outside `Student Admin` and row click opens `Profile`
- Current test run: `npm test` => `113` pass, `0` fail.
- Coverage gap / next action:
  - add one browser-level hosted smoke check to verify top search scope + assignment drill-down behavior on production-sized student rosters.

## Update (2026-03-02)

- Fixed class-level tile style key compatibility in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - assignment/attendance/parent-tracking tiles now resolve style config through canonical + alias keys (`Pre-A1 Starters` / `Starters`, etc.)
  - style apply/clear/reset now normalize to canonical level key and remove duplicate alias keys
  - style refresh now rerenders all class-level tile modules through one helper (`renderAllClassLevelTiles`)
- Added UI regression coverage in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - `legacy alias level-tile config still applies to assignments input tiles`
- Current test run: `npm test` => `108` pass, `0` fail.
- Coverage gap / next action:
  - add one browser-level smoke check on hosted `admin.eagles.edu.vn` to confirm old localStorage style payloads render consistently after deploy.

## Update (2026-03-01)

- Restored the Overview dashboard panel for anonymous exercise submissions in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - new `Anonymous Exercise Submissions` section with queue table and summary
  - `Show All Statuses` / `Show Active Only` toggle
  - `Reload Queue` action
- Wired the panel to runtime-configured incoming queue API path:
  - `window.__SIS_ADMIN_INCOMING_EXERCISE_RESULTS_PATH`
  - fallback: `/api/admin/exercise-results/incoming`
- Added UI state + bootstrap/refresh loading for incoming queue data and role-based visibility (admin-only review panel).
- Added incoming queue disposition controls in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - per-row `Temp`, `Archive`, `Requeue`, and `Delete` actions wired to `POST /api/admin/exercise-results/incoming`
  - per-row action feedback/status text in Overview panel
  - per-row `Add to Specific Student` action (`match`) prompts for a Student ID and resolves queue score to that student profile
  - per-row `Create New User` action (`create-account`) creates the student account, auto-resolves the queued quiz score, and navigates to the new student's `Profile` page
- Moved the uncompleted-student detail panel (`#levelDetailPanel`) to a dedicated Overview card directly under `Students vs Completions (Bar by Level)` and set it to span both Overview columns (full two-column width).
- Added a default placeholder row in the detail table (`Pick a level from the detail buttons above.`) so the panel is visibly present before a level is selected.
- Renamed the panel title from `Level Detail` to `Homework progress` (dynamic title format: `Homework progress - <level>`).
- Updated the default homework reminder message template to bilingual Vietnamese + English with one blank line separator in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html).
- Added dashboard service-control status box in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - service health card + `Refresh` and `Restart` buttons for `exercise-mailer.service`
  - wired to new admin endpoint `GET/POST /api/admin/runtime/service-control`
  - restart path executes `sudo -n systemctl restart exercise-mailer.service` server-side and reports result
  - simplified card layout by removing the duplicate status pill next to action buttons; status now remains on the top-left LED and metadata line
- Added current-week Homework progress auto-fill behavior in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - clicking a level button in `Students vs Completions (Bar by Level)` now resolves the selected level's current-week assignment template
  - auto-fills reminder `Assignment title`, `Assignment link`, and due date
  - link is set to a volatile assignment announcement facsimile page when available (fallback: first live exercise URL)
  - panel auto-scroll now triggers only on small screens (`max-width: 820px`)
- Added explicit `Search` action buttons across tracking data tables in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - attendance: `#attendanceDataSearchBtn`
  - assignments: `#assignmentDataSearchBtn`
  - performance: `#performanceDataSearchBtn`
  - grades: `#gradeDataSearchBtn`
  - all reports: `#reportDataSearchBtn`
  - each button applies the current table search term on click (in addition to existing live input filtering)
- Added volatile assignment announcement preview routes in [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
  - admin create endpoint: `POST /api/admin/assignment-announcements/volatile`
  - public preview page: `GET /assignment-announcements/volatile/:token`
  - preview contains assignment metadata, announcement body, and live exercise links
  - default TTL is `480` minutes (`STUDENT_ADMIN_ASSIGNMENT_ANNOUNCEMENT_PREVIEW_TTL_MINUTES`)
- Added UI regression coverage in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - `overview anonymous exercise submissions panel renders and supports show-all toggle` (now includes add-to-specific-student/create-user actions, archive flow, and service restart controls)
  - `overview level visuals apply brand colors on buttons, bars, and detail border` now verifies current-week homework auto-fill, volatile preview-link creation, and small-screen-only auto-scroll behavior
  - `table sort controls and column-click headers reorder grade/performance data` now verifies tracking-data search-button presence and click-driven filtering across attendance, assignments, grades, performance, and all-reports views
  - `hosted sis-admin path probes auth endpoint instead of healthz` verifies non-loopback hosted admin pages avoid direct `/healthz` polling and use authenticated probe calls
  - `hosted sis-admin path hydrates runtime diagnostics from admin runtime health endpoint` verifies hosted auth-probe mode populates system-health runtime/session/filter/self-heal diagnostics
- Added API coverage in [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - teacher forbidden for volatile preview creation
  - admin preview creation + preview-page retrieval success path
  - unauthenticated create rejection and public preview page behavior
- Added authenticated runtime diagnostics endpoint in [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
  - `GET /api/admin/runtime/health` (teacher/admin readable, unauthenticated rejected)
  - endpoint returns the same runtime payload shape used by `/healthz`, including `studentAdminRuntime`, SMTP verify, pipeline flags, and `runtimeSelfHeal`
- Updated hosted hub-probe runtime hydration in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - when probe mode is auth (`/api/admin/auth/me`), UI now fetches `/api/admin/runtime/health` to populate `Systems Health` diagnostics
  - fixes hosted `/sis-admin/student-admin.html` panels showing `admin runtime config unavailable`, `driver=n/a`, and other `n/a` runtime rows
- Fixed hosted admin hub-probe behavior in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - non-loopback hosted pages now default SIS Hub probing to `/api/admin/auth/me` (with cookie credentials) instead of `/healthz`
  - static preview + loopback paths still probe `/healthz` with `credentials: "omit"`
  - when `/healthz` returns `403`, the probe auto-falls back to auth-endpoint checks and stops repeated forbidden polling noise
- Fixed MEGS exercise submission CORS compatibility in [server/exercise-mailer.mjs](server/exercise-mailer.mjs):
  - when `EXERCISE_MAILER_ORIGIN` includes an `*.eagles.edu.vn` origin (for example `https://ielts.eagles.edu.vn`), sibling `eagles.edu.vn` subdomains are now accepted for CORS echo.
  - this addresses cross-subdomain submissions where the page origin differs from the API host subdomain.
- Added regression coverage in [test/exercise-mailer.spec.mjs](test/exercise-mailer.spec.mjs):
  - `CORS allows sibling eagles.edu.vn origin when one eagles domain is configured`
- Current test run: `npm test` => `107` pass, `0` fail.

## Update (2026-02-28)

- Exercise submission matching now follows a strict account-first rule:
  - if payload `studentId`/`email` matches an existing student account, the submission is recorded directly to `ExerciseSubmission`.
  - if no account match is found, submission is queued in new Prisma model `IncomingExerciseResult` for manual admin disposition (no anonymous `Student` auto-upsert).
- Added incoming exercise-result admin queue APIs:
  - `GET /api/admin/exercise-results/incoming` (filter/list queue items)
  - `POST /api/admin/exercise-results/incoming` actions:
    - `save-temp`
    - `archive`
    - `requeue`
    - `match` (resolve to existing student)
    - `create-account` (create/update student account, then resolve)
    - `delete`
- Added queue resolution workflow contract:
  - resolving an incoming queue item creates an `ExerciseSubmission` row linked to selected student and marks queue item `resolved`.
- Parent-report notification queue is now durable by default via PostgreSQL (`AdminNotificationQueue` in Prisma), with in-memory fallback only when DB queue storage is unavailable.
- Queue API was extended for admin review workflows:
  - `GET /api/admin/notifications/batch-status` now supports queue filtering and list pagination controls (`queueType`, `statuses`, `take`, `showAll`).
  - `POST /api/admin/notifications/batch-status` now supports admin actions: `hold`, `edit`, `requeue`, `sendAll`.
- Parent-report sending is now admin-controlled:
  - default action is queue-only
  - queued reports are sent only when admin executes `Send All`
  - queue scheduling fields still use server local-time windows (Sat/Sun `12:00`, `15:30`, `18:00`, `20:15`) for default `scheduledFor` values
- Teacher role behavior was expanded for parent-tracking workflows:
  - teachers can fill and save parent tracking report forms
  - teachers can queue parent-report notifications for admin review (`weekend-batch` only)
  - immediate send remains admin-only
- Admin dashboard/UI now includes queued parent-report review controls:
  - collapsed queue section on Overview with top `10` rows by default and `Show All`
  - row click opens review modal with previous/next navigation
  - modal actions: `Hold`, `Edit`, `Requeue`, `Send All`
- Admin UI bootstrap now tolerates older runtimes that do not expose `GET /api/admin/notifications/batch-status` (404 is treated as optional queue feature-unavailable, not a login blocker).
- Admin UI no longer auto-fetches `/api/admin/notifications/batch-status` during login bootstrap; queue fetch runs on explicit queue interactions (for example `Show All`, queue refresh, queue actions), reducing startup 404 noise in static-preview/older-runtime paths.
- Admin UI terminology was updated from `Parent` to `Performance` for queue-review labels while keeping existing route slugs/API identifiers (`parent-tracking`, `parent-report`) unchanged for compatibility.
- Tracking menu now uses plain button labels with `Performance` restored:
  - `Attendance` (admin+teacher input page)
  - admin-only data submenu entries: `Attendance data`, `Assignments data`, `Grades data`, `Performance data`
  - `Assignments`
  - `Grades`
  - `Performance`
  - `All Reports`
- Tracking input pages and admin data pages are now fully separated (no combined "twin" pages):
  - `Attendance` (input) -> `Attendance data` (admin only)
  - `Assignments` (input) -> `Assignments data` (admin only)
  - `Grades` (input) -> `Grades data` (admin only)
  - `Performance reports` (input, `parent-tracking`) -> `Performance data` (admin only)
  - `All Reports` remains standalone as `[input-output]`
- Data-page `Edit` actions now route back to the corresponding input page to keep edit workflows intact with the separated IA.
- Admin data pages now support the requested operational controls:
  - view + sort (toolbar + column-click sort)
  - edit + delete + archive/restore
  - data-table search filters
  - print workflow (`Print PDF`, browser print dialog)
  - XLSX export workflow (`Export XLSX`)
- Admin data-page search filters now include class-level and student targeting controls on all data pages:
  - `Class Level` dropdown defaults to `Any` and is populated from known SIS levels
  - `Student Name` is a free-text input backed by a level-aware class-member datalist
  - `Student ID` is a free-text input with datalist memory from prior valid entries
  - Student ID validation enforces `lowercase letters (max 10) + 3 digits` (for example `steve001`)
- Added admin XLSX export endpoint:
  - `POST /api/admin/exports/xlsx` (admin success, teacher forbidden, unauthenticated rejected)
- Static-preview/live-reload compatibility fix:
  - removed literal inline `</body></html>` sequence from print template writer to avoid `Unexpected end of input` breakage in live-reload injectors.
- Column-click sorting is now supported on sortable data-table headers (keyboard accessible with `Enter`/`Space`) in addition to sort toolbars.
- UI regression coverage now includes table-sort controls plus search/archive controls and column-click sorting verification in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs).
- Current test run: `npm test` => `93` pass, `0` fail.

## Update (2026-02-27)

- Canonical SIS class order is now aligned end-to-end as:
  - `Eggs & Chicks`
  - `Pre-A1 Starters`
  - `A1 Movers`
  - `A2 Flyers`
  - `A2 KET`
  - `B1 PET`
  - `B2+ IELTS`
  - `C1+ TAYK`
  - `Private`
- Overview line chart is now a global Mon-Sun weekly student trend (not class-level):
  - `studentsWithAssignments`
  - `studentsCompletedAll`
- Dashboard API now returns `weeklyAssignmentCompletion` in `GET /api/admin/dashboard`.
- Dashboard `today` summary now includes:
  - `totalEnrollment`
  - `attendancePercentOfEnrollment`
  - `unenrolledYtd`
- Overview `Systems Health` now hosts the SIS Hub connection widget (`Connected` badge, `Ping Hub`, endpoint/latency detail).
- Overview header helper sentence was removed, and SIS Hub connection is now styled as a two-slot health card aligned with other system-health boxes.
- Overview chart panels now use tighter internal spacing (reduced chart-shell padding/margin and chart min-heights) to reduce blank space.
- Students list level badges now use fixed-width chip styling so level name widths are normalized in the table.
- Students list panel is assigned to a dedicated admin child page (`Student Admin`) while the top search panel remains visible across pages.
- Attendance IA now separates concerns:
  - `Attendance` main page: starts blank until class level selection, then shows today attendance radio form with default `Absent`.
  - `Attendance Admin` child submenu: per-student attendance stats by selected class level.
- Global class-level tile style controls are now under `Settings` (`title`, `background`, `image`) and apply to all class-level tile modules (Attendance and Assignments).
- Attendance level tile images now render without an overlay mask; blank `Title` input is now allowed and renders no title text on the tile.
- Assignments page now uses class-level tiles and an itemized assignment builder:
  - tile click prefills `level`, `date assigned` (today), and `due date` (next Sunday, editable).
  - each assignment item is added from exercise dropdown + URL and saved as one item in the assignment record.
  - assignment status auto-switches to `Completed` when all items are marked done.
- Assignment record rows now render exercise names as clickable links to the saved URL.
- Tracking now includes a teacher/admin-facing `Parents` page (`parent-tracking`) with:
  - left-column class-level tiles wired to right-column student report form
  - student dropdown filtered by selected class level
  - class date/day + teacher dropdown + class level binding
  - lesson summary memory by `class level + date` for rapid reuse across students
  - auto-filled behavior/participation/academic/homework completion/timeliness from current grade records
  - overdue uncompleted assignment list with dynamic assignment-detail links/panel
  - recipient auto-derivation from student profile (`student`, `mother`, `father`, `signature/proctor` emails)
- Email notifications now support weekend batching:
  - `POST /api/admin/notifications/email` with `deliveryMode=weekend-batch` queues messages
  - batch windows run on Saturday/Sunday at `12:00`, `15:30`, `18:00`, and `20:15` (server local time)
  - queue status is exposed at `GET /api/admin/notifications/batch-status`
- UI coverage includes a regression test for assignment tile prefill, itemized links, and completion recording in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs).
- UI coverage includes a new test for Mon-Sun line-chart labels in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs).
- UI coverage includes a regression test that verifies search/list panels are hidden on non-admin pages and visible on the `Student Admin` page.
- UI coverage includes a regression test that verifies settings-based global level tile style propagates to attendance and assignment tiles in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs).
- UI coverage includes a regression test for parent-tracking autofill + summary reuse + weekend batch queue payload in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs).
- Current test run: `npm test` => `83` pass, `0` fail.

## Simple App/Network Diagram

```text
Client Sites / Apps (Admin UI is one client)
  - URL: /admin/students or /web-asset/admin/student-admin.html
  - SIS Hub check: GET /healthz
  - App API: /api/admin/*
           |
           v
Nginx / Reverse Proxy (optional in front)
  - admin.eagles.edu.vn
  - forwards /api/* and /admin/*
           |
           v
SIS Hub (Node Service: exercise-mailer)
  - file: /server/exercise-mailer.mjs
  - admin router: /server/student-admin-routes.mjs
  - auth: cookie session
           |
           +--> PostgreSQL (Prisma): students, attendance, grades, reports, users
           |
           +--> Redis (optional): session/filter cache
           |
           +--> SMTP (optional): assignment/reminder emails
```

## System Architecture Status (2026-02-26)

| Level | Architecture item | Status | Current implementation |
| --- | --- | --- | --- |
| 1 | Direct Redis session-store tests | Complete | Added [test/student-admin-session-store.spec.mjs](test/student-admin-session-store.spec.mjs) with memory, redis, fallback, and required-redis failure coverage. |
| 2 | Forced-Redis test profile | Complete | Added package scripts: `test:redis` (forces `STUDENT_ADMIN_SESSION_DRIVER=redis`) and `test:session-store`. |
| 3 | Health signal for active session backend | Complete | `/healthz` now includes `studentAdminRuntime` with session driver, page/api config, and filter-cache status. |
| 4 | `REDIS_CACHE_URL` decision | Complete | Implemented Redis-backed level/school filter caching with memory fallback and write invalidation on student save/delete/import. |
| 5 | Admin GUI IA/styling/navigation schema | Complete | `student-admin.html` now has left expandable/hamburger menu, section child links, section-specific pages (`/admin/students/<section>`), and overview dashboard chart/detail-reminder workflow. |

Notes:

- `npm run test:redis` is a CI/ops profile and expects a reachable Redis instance (defaults to `redis://127.0.0.1:6379/0`).
- Redis session connect timeout is now configurable via `STUDENT_ADMIN_SESSION_REDIS_CONNECT_TIMEOUT_MS`.

## Current Endpoint Inventory (from `server/student-admin-routes.mjs`)

- Base API prefix: `STUDENT_ADMIN_API_PREFIX` (default `/api/admin`)
- Admin page path: `STUDENT_ADMIN_PAGE_PATH` (default `/admin/students`)
- Auth endpoints:
  - `POST /api/admin/auth/login`
  - `POST /api/admin/login` (legacy alias, still accepted)
  - `POST /api/admin/auth/logout`
  - `GET /api/admin/auth/me`
- Protected admin endpoints:
  - `GET /api/admin/permissions`
  - `PUT /api/admin/permissions`
  - `GET /api/admin/dashboard`
  - `GET /api/admin/exercise-titles`
  - `POST /api/admin/notifications/email`
  - `GET /api/admin/notifications/batch-status`
  - `GET /api/admin/exercise-results/incoming`
  - `POST /api/admin/exercise-results/incoming`
  - `GET /api/admin/students/import-template.xlsx`
  - `GET /api/admin/filters`
  - `GET /api/admin/students`
  - `POST /api/admin/students`
  - `POST /api/admin/students/import`
  - `GET /api/admin/family?phone=...`
  - `GET /api/admin/students/:studentRefId`
  - `PUT /api/admin/students/:studentRefId`
  - `DELETE /api/admin/students/:studentRefId`
  - `GET /api/admin/students/:studentRefId/report-card.pdf`
  - `POST /api/admin/students/:studentRefId/attendance`
  - `DELETE /api/admin/students/:studentRefId/attendance/:recordId`
  - `POST /api/admin/students/:studentRefId/grades`
  - `DELETE /api/admin/students/:studentRefId/grades/:recordId`
  - `POST /api/admin/students/:studentRefId/reports`
  - `POST /api/admin/students/:studentRefId/reports/generate`
  - `DELETE /api/admin/students/:studentRefId/reports/:reportId`

## Test Completeness Review (2026-02-26)

### Executed

```bash
npm test
```

Result: `61` tests total, `61` pass, `0` fail.

### Verification of Path Fix

- All path links in this file now point to existing files.
- Previous broken style (`/abs/path/file:line`) was removed because it resolves to a non-existent filename.
- Current link style uses file-only targets, with line numbers described in text.

### Findings (ordered by severity)

1. Medium: admin API breadth is still only partially covered.
   - Auth path is now aligned with cookie-session flow in [test/student-admin.spec.mjs](test/student-admin.spec.mjs) (login case around line 164).
   - A large route surface in [server/student-admin-routes.mjs](server/student-admin-routes.mjs) remains minimally covered (`students`, `attendance`, `grades`, `reports`, `family`, `filters`).

2. Low (addressed): session lifecycle endpoint contracts are now covered.
   - Added focused tests for `/api/admin/auth/me` and `/api/admin/auth/logout` with cookie refresh/clear assertions in [test/student-admin.spec.mjs](test/student-admin.spec.mjs).

3. Low (addressed): role enforcement matrix now has direct test coverage.
   - Added `teacher` vs `admin` behavior checks (`GET` read-through vs `POST` forbidden for teacher) in [test/student-admin.spec.mjs](test/student-admin.spec.mjs).

4. Medium: DB-backed behavior is still mostly untested.
   - Current tests disable persistence flags in [test/exercise-mailer.spec.mjs](test/exercise-mailer.spec.mjs) and [test/student-admin.spec.mjs](test/student-admin.spec.mjs).
   - Store modules with limited test coverage:
     - [server/exercise-store.mjs](server/exercise-store.mjs)
     - [server/student-intake-store.mjs](server/student-intake-store.mjs)
     - [server/student-admin-store.mjs](server/student-admin-store.mjs)

5. Medium: parser negative testing is thin.
   - `.xlsx` happy path exists in [test/student-admin.spec.mjs](test/student-admin.spec.mjs) (around line 36).
   - Missing malformed base64, empty payload, unsupported format, and CSV/TSV edge-case tests.

6. Low: malformed/oversize payload branches need explicit tests.
   - `Payload too large` branches exist in [server/exercise-mailer.mjs](server/exercise-mailer.mjs) (around line 296) and [server/student-admin-routes.mjs](server/student-admin-routes.mjs) (around line 437).

7. Low: custom prefix runtime is now covered at route level.
   - Tests include `STUDENT_ADMIN_API_PREFIX` override and verify regex-backed routes match under non-default prefix.

8. Low (addressed): admin UI API-prefix hardcoding has been reduced.
   - [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html) now resolves API targets via:
     - injected runtime prefix (`window.__SIS_ADMIN_API_PREFIX`)
     - optional query overrides (`apiPrefix`, `apiOrigin`) for static preview scenarios
   - Route handler injects runtime prefix into served admin HTML in [server/student-admin-routes.mjs](server/student-admin-routes.mjs).
   - Tests assert injected prefix in:
     - [test/student-admin.spec.mjs](test/student-admin.spec.mjs)
     - [test/student-admin-prefix.spec.mjs](test/student-admin-prefix.spec.mjs)

9. Low (addressed): static preview guard now applies only to `file://` preview contexts.
   - When opened from `/web-asset/admin/student-admin.html` over HTTP(S) without `apiOrigin`, the UI now allows normal auth flow (`/api/admin/auth/me`, login submit).
   - For loopback static-preview ports (for example `127.0.0.1:46145`), UI now auto-targets `http://<host>:8787` for admin API calls by default.
   - Guidance status requiring `?apiOrigin=...` is only enforced when preview is local-file based (`file://` / null origin).

10. Medium (addressed): user-management foundation is now implemented for PostgreSQL-backed admin auth.

- Added `AdminUser` model and migration in `prisma/`.
- Added user store module [server/student-admin-user-store.mjs](server/student-admin-user-store.mjs) with:
  - scrypt password hashing
  - create/list/update/delete operations
  - safeguards against removing the last `admin`
- Added admin-only user APIs in [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
  - `GET /api/admin/users`
  - `POST /api/admin/users`
  - `PUT /api/admin/users/:userId`
  - `DELETE /api/admin/users/:userId`
- Login now checks DB-backed users first (when store enabled), with legacy env-account fallback.
- Admin UI now includes a user-management panel in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html).

1. Low (addressed): static-hosted `/sis-admin/student-admin.html` now infers API prefix from pathname.

- UI fallback now derives `/api/<segment>` from direct static path endings like `/sis-admin/student-admin.html`.
- Prefix precedence now prefers explicit query/injected config, then stored local preference, then pathname inference.
- On auth-path `404`, UI now retries once with alternate prefix (`inferred <-> default`) and persists the working value.

1. Low (addressed): nginx now supports `/api/sis-admin/*` as an alias for admin API routing.

- Added `location /api/sis-admin/` proxying to `http://127.0.0.1:8787/api/admin/`.
- Added `location = /api/sis-admin` redirect to `/api/sis-admin/`.
- This removes 404s for static-hosted admin UI builds that call `/api/sis-admin/auth/me`.

1. High (addressed): runtime drift caused persistent production 404s despite repo fixes.

- `exercise-mailer.service` was running stale code from `/home/eagles/dockerz/megs/server` and that directory had missing route files on disk.
- Added runtime resync workflow in [tools/sis-runtime-resync.sh](tools/sis-runtime-resync.sh) and used it to restore `server/`, `schemas/`, and admin UI assets.
- After resync + service restart, `/api/admin/auth/*` and `/api/sis-admin/auth/*` moved from `404` to expected auth responses.

1. High (addressed): reverse-proxy and port-exposure hardening is now modularized.

- Added reusable nginx snippets:
  - [deploy/nginx/snippets/sis-api-cors.conf](deploy/nginx/snippets/sis-api-cors.conf)
  - [deploy/nginx/snippets/sis-api-proxy-common.conf](deploy/nginx/snippets/sis-api-proxy-common.conf)
- Refactored site configs to shared upstreams and unified admin alias routing:
  - [deploy/nginx/admin.eagles.edu.vn.conf](deploy/nginx/admin.eagles.edu.vn.conf)
  - [deploy/nginx/sis-reverse-proxy.conf](deploy/nginx/sis-reverse-proxy.conf)
- Added repeatable ops scripts:
  - [tools/sis-firewall-harden.sh](tools/sis-firewall-harden.sh)
  - [tools/sis-nginx-deploy.sh](tools/sis-nginx-deploy.sh)
  - [tools/sis-rp-smoke-check.sh](tools/sis-rp-smoke-check.sh)
- Firewall policy now enforces loopback-only for `8088/6379/5540` with persistent rules.

1. High (addressed): Prisma v7 runtime mismatch blocked DB-backed admin APIs.

- With Prisma `v7.4.1`, generated client required adapter-mode initialization and `new PrismaClient()` failed at runtime.
- Added shared client factory [server/prisma-client-factory.mjs](server/prisma-client-factory.mjs) with:
  - compatibility fallback for constructor-shape changes
  - adapter-based initialization (`pg` + `@prisma/adapter-pg`) when required
  - shared connected client reuse across store modules
- Updated store modules to use shared factory:
  - [server/exercise-store.mjs](server/exercise-store.mjs)
  - [server/student-intake-store.mjs](server/student-intake-store.mjs)
  - [server/student-admin-store.mjs](server/student-admin-store.mjs)
  - [server/student-admin-user-store.mjs](server/student-admin-user-store.mjs)
- Provisioned local Postgres (`sis-postgres`), applied migrations, and enabled `DATABASE_URL` in runtime `.env`.
- Verified live endpoints now return expected responses (`/api/sis-admin/auth/me` 200 with cookie, `/api/sis-admin/users` 200 instead of 503).
- Seeded first DB admin account (`username=admin`) so DB-first login path is active.

1. Medium (addressed): operational test fixture dataset seeded for admin flows.

- Added test admin/teacher users through live admin APIs:
  - `1` admin test account (`test_admin_ops`)
  - `2` teacher test accounts (`test_teacher_01`, `test_teacher_02`)
- Added `7` complete test student records (`TST-2026-001` … `TST-2026-007`) with:
  - profile data in `StudentProfile`
  - one attendance record per student
  - one grade record per student
  - one parent class report per student
- Verified role behavior:
  - teacher can `GET /students` (`200`)
  - teacher cannot mutate students (`POST /students` returns `403`)

1. Low (addressed): login UI regression now has direct test coverage.

- Added [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs) to exercise browser-side login behavior in `jsdom`.
- Asserts that invalid credentials produce a visible login-panel status message.
- Asserts successful login transitions from auth panel to app panel and restores login-button state.
- Asserts static preview path (`/web-asset/admin/student-admin.html`) works over HTTP without requiring `apiOrigin`.

1. Medium (addressed): admin API CORS now accepts loopback static-preview origins.

- Backend CORS logic in [server/student-admin-routes.mjs](server/student-admin-routes.mjs) and [server/exercise-mailer.mjs](server/exercise-mailer.mjs) now treats loopback HTTP origins (`127.0.0.1`, `localhost`, `::1`) as allowed even when explicit origin lists are configured.
- Added preflight coverage in [test/student-admin.spec.mjs](test/student-admin.spec.mjs) for `OPTIONS /api/admin/auth/login` from `http://127.0.0.1:46145`.

1. Low (addressed): static-preview hub probe no longer requests cookies for `/healthz`.

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html) so `probeHubConnection()` calls `GET /healthz` with `credentials: "omit"`.
- This prevents browser CORS rejection on static preview origins when the hub health endpoint does not return `Access-Control-Allow-Credentials: true`.
- Added regression assertion in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs) to lock credential mode for the health probe.

1. Low (addressed): runtime drift detector + sync-on-mismatch workflow added.

- Extended [tools/sis-runtime-resync.sh](tools/sis-runtime-resync.sh) with:
  - `--check-only` to detect drift without copying.
  - `--sync-on-mismatch` to update only when drift exists.
  - `--scope html` for fast `student-admin.html` parity checks between `sis` and runtime (`megs`).
- Practical command for this UI path:
  - `tools/sis-runtime-resync.sh --sync-on-mismatch --scope html --no-restart`

1. Low (addressed): service-level self-heal is now explicit and decoupled from runtime targeting heuristics.

- [server/exercise-mailer.mjs](server/exercise-mailer.mjs) now runs a background drift check for `web-asset/admin/student-admin.html`.
- There is no implicit `megs -> sis` source inference anymore.
- Self-heal only activates when explicitly enabled and configured; otherwise it stays disabled in `/healthz` (`runtimeSelfHeal.lastResult = "disabled-by-env"`).
- When enabled and mismatched, runtime HTML is overwritten from source and status is exposed via `/healthz` under `runtimeSelfHeal`.
- Controls:
  - `SIS_RUNTIME_SELF_HEAL_ENABLED` (`false` by default)
  - `SIS_RUNTIME_SELF_HEAL_SOURCE_ROOT` (required when enabled)
  - `SIS_RUNTIME_SELF_HEAL_RUNTIME_ROOT` (optional; defaults to process cwd)
  - `SIS_RUNTIME_SELF_HEAL_INTERVAL_MS` (minimum `1000`, default `15000`)

1. Low (addressed): overview dashboard now includes at-a-glance LED system status cards.

- [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html) now renders a “Systems Health” grid with green/yellow/red/pending indicators.
- Indicators are derived from `/healthz` + hub probe state, including: hub API, admin runtime config, session store, filter cache, runtime self-heal, SMTP verify, and recent pipeline status.

1. Low (addressed): overview information architecture regrouped for faster scanning.

- Overview now uses distinct functional cards in a 2-column desktop layout (collapsing to 1 column on smaller viewports).
- Replaced horizontal per-row bars with a single concise vertical SVG bar chart (`Students` vs `Completions`) plus wrapped Detail action buttons.
- Mobile navigation menu now closes on outside click and clears open state on desktop resize; hamburger toggle behavior remains active.

1. Low (addressed): level labels and chart readability are now system-linked and accessibility-focused.

- [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html) no longer generates synthetic `G1/G2/.../G10` labels.
- Known curriculum levels now render with readable short names (`Starters`, `Movers`, `Flyers`, `KET`, `PET`, `IELTS`, `TAYK`) while grade-like values remain literal (for example `Grade 10`).
- Level names are now sourced and synchronized from runtime system data (`/api/admin/filters`, students, dashboard summaries), reducing cross-panel mislabeling across overview/search/profile/tracking flows.
- Level brand colors are now applied across SIS diagnostics for at-a-glance identification:
  - detail buttons in overview
  - per-level bars in overview completion chart
  - level detail panel border accents
  - level chips in overview/students/assignment-template tables
- Overview charts now use larger axis/value typography, stronger contrast tokens, and expanded chart geometry to improve axis legibility.
- Added/updated UI regression coverage in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs) to assert natural level ordering and full system labels in detail buttons.

1. High (addressed): duplicate anonymous exercise queue items from single submit events are de-duplicated.

- [server/exercise-store.mjs](server/exercise-store.mjs) now detects near-duplicate unmatched submissions (same student/email/page + near-identical completion timestamps) and reuses one queue record instead of inserting a second item.
- When a duplicate pair arrives, richer answer-status payloads overwrite poorer snapshots so queue scoring reflects the evaluated submission.
- [server/exercise-mailer.mjs](server/exercise-mailer.mjs) now serializes per-submission processing with an in-process key lock and suppresses duplicate notifications within a short window for identical submission fingerprints (`student/email/page/completedAt`), including retries that bypass store-level dedupe.
- Added regression coverage in [test/exercise-store.spec.mjs](test/exercise-store.spec.mjs) for duplicate queue suppression and preferred-status replacement.
- Added regression coverage in [test/exercise-mailer.spec.mjs](test/exercise-mailer.spec.mjs) to verify duplicate POST payloads generate only one teacher + learner notification set.

1. High (addressed): incoming queue disposition controls and dashboard service-control are now wired end-to-end.

- [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html) now renders per-row incoming-queue disposition buttons (`Temp`, `Archive`, `Requeue`, `Delete`) and applies them via `POST /api/admin/exercise-results/incoming`.
- [server/student-admin-routes.mjs](server/student-admin-routes.mjs) now exposes `GET/POST /api/admin/runtime/service-control` (admin-only) for runtime status and controlled restart attempts.
- Dashboard `Systems Health` now includes a service-control status box with `Refresh` and `Restart` controls targeting `exercise-mailer.service`.
- Added route coverage in [test/student-admin.spec.mjs](test/student-admin.spec.mjs) for service-control auth/forbidden behavior.
- Updated UI regression in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs) to assert incoming disposition actions and service restart control wiring.

### Latest UI/Admin Update (2026-03-04)

1. Admin data search UX switched to progressive drill-down with instant refresh.

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html) Attendance/Assignments data/Performance data/Grades data/All Reports toolbars to:
  - remove dedicated Search buttons,
  - use `Class Level -> Student` dropdown drill-down,
  - add date-range delimiters (`Date from`, `Date to`),
  - keep free-text search as live filter.
- Table filter state now tracks `level`, `studentRefId`, `dateFrom`, and `dateTo`.
- Filtering logic now applies date ranges per table date field and supports assignment rows with either targeted student IDs or level-based fallbacks.
- Print output now includes active filter summary so printed exports carry the on-screen filter context.

1. Added admin-only School Setup page for school-year/quarter timing.

- New admin page slug: `school-setup` (navigation + role-policy normalization + admin panel visibility).
- School setup stores first/last school day in UI settings and auto-generates 4 near-equal quarters.
- Quarter generation now adjusts quarter-end boundaries away from weekends when possible.
- Attendance defaults and parent-tracking quarter derivation now resolve quarter/school-year from saved school setup first, then fall back to legacy month buckets.
- Expanded school setup profile payload in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - square logo uploader with format validation (`svg/jpg/png/webp`) and max-side dimension check (`<= 650px`);
  - school name + bilingual VN/EN text blocks + motto/mission/values + address + phone;
  - seven extra textarea fields for public/private sites, web/social channels, business tax id, time format, and time zone.

### Latest Test Run (2026-03-04)

- Command: `timeout 40s npm test`
- Result: timed out (`exit 124`) after reporting known failing suites:
  - `test/exercise-mailer.spec.mjs` (failed)
  - `test/student-admin-prefix.spec.mjs` (failed)
  - `test/exercise-store.spec.mjs` and `test/student-admin-session-store.spec.mjs` passed before timeout.
- Additional smoke validation: extracted inline admin script and ran `node --check /tmp/student-admin-inline.js` (pass).

## Coverage Snapshot

| Subsystem | Current coverage | Status |
| --- | --- | --- |
| Exercise submission API | health, success path, invalid answers, recipient decoding, CORS preflight | Partial |
| Intake submission API | valid payload and missing fields | Partial |
| Admin auth | invalid + valid login, `/auth/me` + `/auth/logout` cookie lifecycle, loopback CORS preflight, authenticated template/download/store-disabled checks | Partial |
| Admin UI bootstrap/prefix/navigation wiring | login form markup + runtime prefix/slug injection + file-protocol static-preview guard + left-menu/hamburger section pages + login submit success/failure assertions + static-preview `/healthz` probe credentials mode | Partial |
| Admin user management | UI panel + API surface + disabled-store tests | Partial |
| Admin role permissions matrix | `/api/admin/permissions` read/write contract + role-policy runtime model + UI permissions page | Partial |
| Admin session lifecycle | `me`/`logout` contract and cookie refresh/clear assertions | Partial |
| Admin CRUD APIs | minimal, mostly store-disabled paths | Incomplete |
| PDF generation | buffer/sanity header only | Partial |
| Spreadsheet import parser | xlsx happy path only | Incomplete |
| Session store (memory/redis/fallback) | dedicated unit tests for memory/redis/fallback/required-redis fail cases | Partial |
| Filter cache + runtime observability | `REDIS_CACHE_URL` filter caching + health payload runtime status | Partial |

## Recommended Next Test Work

1. Add full admin endpoint matrix tests (`filters`, `family`, CRUD, attendance, grades, reports, generate/delete, report-card PDF).
2. Add parser hardening tests (invalid base64, empty file, unsupported format, CSV/TSV quoting edge cases).
3. Add DB-enabled integration profile against disposable Postgres schema.
4. Add persistence for role-permission policies (currently runtime-memory + optional env JSON).
5. Add policy-based route scoping tests for `student` and `parent` roles.

## Current Risk Summary

- Auth mismatch blocker is resolved and suite is green.
- Runtime path drift between `/home/eagles/dockerz/sis` and `/home/eagles/dockerz/megs` remains the primary operational risk if resync is skipped.
- Prisma adapter dependencies must remain installed in runtime (`pg`, `@prisma/adapter-pg`) when using Prisma v7 client engine mode.
- Main remaining code risk is insufficient integration depth for DB-backed admin workflows.

## Deployment

Steps for “fully deployed” are

runtime refresh on target SIS:

1. cd /home/admin.eagles.edu.vn/sis
2. npm ci --omit=dev
3. npm run db:generate
4. npm run db:migrate:deploy
5. Restart SIS service
6. `curl http://127.0.0.1:8787/healthz` # Smoke check


copy-paste command block for steps 1-6.

```bash
cd /home/admin.eagles.edu.vn/sis && \
npm ci --omit=dev && \
npm run db:generate && \
npm run db:migrate:deploy && \
sudo systemctl restart exercise-mailer.service && \
sleep 2 && \
curl -fsS http://127.0.0.1:8787/healthz && echo
```

Canonical systemd/unit env policy:

- service runs from deployed root only: `/home/admin.eagles.edu.vn/sis`.
- service unit must use:
  - `WorkingDirectory=/home/admin.eagles.edu.vn/sis`
  - `ExecStart=/home/eagles/.nvm/versions/node/v20.19.4/bin/node /home/admin.eagles.edu.vn/sis/server/exercise-mailer.mjs`
  - `EnvironmentFile=/home/admin.eagles.edu.vn/sis/.env`
  - `Restart=always` and `RestartSec=3`
- self-heal drop-in must use deployed root for both source/runtime:
  - `SIS_RUNTIME_SELF_HEAL_SOURCE_ROOT=/home/admin.eagles.edu.vn/sis`
  - `SIS_RUNTIME_SELF_HEAL_RUNTIME_ROOT=/home/admin.eagles.edu.vn/sis`
- runtime env file policy:
  - path: `/home/admin.eagles.edu.vn/sis/.env`
  - owner/mode: `eagles:eagles`, `0600`
  - keep runtime keys only (`DATABASE_URL`, `SMTP_*`, `REDIS_*`, `EXERCISE_MAILER_*`, `STUDENT_ADMIN_*` required by service).

Verification command:

```bash
sudo systemctl show exercise-mailer.service -p WorkingDirectory -p ExecStart -p EnvironmentFiles --no-pager && \
curl -fsS http://127.0.0.1:8787/healthz
```

Reference: [docs/ffs.md](docs/ffs.md) `Systemd Runtime Policy (Canonical)`.
