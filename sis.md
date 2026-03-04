# SIS Project Notes

## Scope

- Workspace: `/home/eagles/dockerz/sis`
- Runtime: Node `v20.19.4`
- Service entrypoint: [server/exercise-mailer.mjs](server/exercise-mailer.mjs)
- Admin routing module: [server/student-admin-routes.mjs](server/student-admin-routes.mjs)

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

### Latest Test Run (2026-03-01)

- Command: `npm test`
- Result: `103` tests, `103` pass, `0` fail.

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
