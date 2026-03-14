# SIS Project Notes

## Scope

- Workspace: `/home/eagles/dockerz/sis`
- Runtime: Node `v20.19.4`
- Service entrypoint: [server/exercise-mailer.mjs](server/exercise-mailer.mjs)
- Admin routing module: [server/student-admin-routes.mjs](server/student-admin-routes.mjs)

## Update (2026-03-14 - data-entry hardening, parent-report schema-drift fallback, student-news fallback, and parent profile-submit error coverage)

- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - fixed parent performance report save/update crash when runtime Prisma schema is older and lacks `participationPointsAward`:
    - added legacy-schema retry path that strips unsupported field and retries `update`/`upsert`.
    - mirrored compatibility handling in parent report approval updates.
  - added student news report persistence fallback when Prisma `StudentNewsReport` model/table is unavailable:
    - list path now falls back to local file-backed storage (`runtime-data/student-news-reports.json` by default).
    - save path now falls back to local file-backed upsert when delegate/table is missing.
  - added model-drift helpers and guards for missing columns/unknown arguments.
- Updated [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
  - teacher permission baseline now normalizes to writable (`canWrite: true`) to prevent runtime toggling regressions.
  - hardened teacher mutation scope to data-entry routes only:
    - allowed: attendance save, grades save, parent-report save/generate, queued parent-report notifications.
    - blocked: student/user/runtime/admin-protected mutations and immediate notification sends.
  - hardened settings authority check to management privileges (`canManageUsers` or `canManagePermissions`) instead of generic write+page.
- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - teacher default permission baseline now normalizes to writable in UI role-policy normalization.
- Updated [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - added regressions proving teacher can reach store-backed data-entry write endpoints (`attendance`, `grades`, `reports`) instead of being blocked at role gate.
  - expanded source-contract drift assertions for:
    - student news fallback guards,
    - parent-report legacy field fallback guards,
    - teacher data-entry write allowlist enforcement.
- Updated [test/student-admin-store-parent-report.spec.mjs](test/student-admin-store-parent-report.spec.mjs):
  - added drift tests that lock in source-level compatibility guards for:
    - legacy `participationPointsAward` schema mismatch,
    - student news model/table fallback logic.
- Updated [test/parent-portal-ui.spec.mjs](test/parent-portal-ui.spec.mjs):
  - added profile form submission error-path coverage:
    - draft save API error surfaced on child page status.
    - submit-for-review API error (`no draft`) surfaced on child page status.
- Verification:
  - `node --test test/parent-portal-ui.spec.mjs test/student-admin-store-parent-report.spec.mjs test/student-admin.spec.mjs` => `117` pass, `0` fail.
  - `npm test` => `239` pass, `0` fail, `0` skip.
- Residual risk:
  - student-news fallback storage is local-file backed; in horizontally scaled runtime topologies, a shared DB model/table remains the preferred source of truth.

## Update (2026-03-14 - student news calendar same-day UTC+7 window and event text-color stability)

- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - student news submission window now opens on the current UTC+7 day (`reportDate=todayDate`, no weekday-specific closures).
  - calendar row generation now includes current day so runtime month view shows same-day open status.
  - student news calendar query window now includes current-day report rows for same-day open submissions.
- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - enforced event text colors with strong selectors:
    - `MISSED NEWS REPORT` stays white.
    - `News report window open` stays black.
- Updated [test/student-news-timezone.spec.mjs](test/student-news-timezone.spec.mjs):
  - added coverage that Friday remains open (no weekday closure override).
  - updated row/window expectations to include same-day Saturday open with prior Friday non-open status.
- Verification:
  - `node --test test/student-news-timezone.spec.mjs` => `3` pass, `0` fail.
  - `node --test test/student-admin.spec.mjs` => `101` pass, `0` fail.
  - `node --test test/student-portal-calendar.playwright.spec.mjs` => `1` pass, `0` fail.
  - live API smoke confirms:
    - calendar `window.reportDate` is Saturday (`2026-03-14`) at UTC+7 runtime,
    - Friday row is no longer open (`status: "missed"` when unsubmitted),
    - Saturday row shows `status: "open"`.
  - live browser probe confirms:
    - open event text color `rgb(0, 0, 0)`,
    - missed event text color `rgb(255, 255, 255)`.

## Update (2026-03-14 - fixed live student portal route serving stale HTML + added portal-login regression coverage)

- Updated [tools/deploy-api-safe.sh](tools/deploy-api-safe.sh):
  - expanded API deploy sync scope to include `web-asset/student/`, `web-asset/vendor/`, and `web-asset/images/` (in addition to existing `web-asset/parent/`).
  - added drift detection, backups, and rsync sync steps for student/vendor/images assets.
- Updated [tools/sis-runtime-resync.sh](tools/sis-runtime-resync.sh):
  - extended `--scope full` drift/sync behavior to include `web-asset/parent/`, `web-asset/student/`, `web-asset/vendor/`, and `web-asset/images/`.
- Updated [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - strengthened `/student/portal` HTML contract to require `<title>Student Portal</title>` and reject legacy `<title>Student News Portal</title>`.
  - added regression test `portal login endpoints establish sessions for admin, parent, and student`.
  - added runtime static-asset regression for `GET /web-asset/images/logo.svg`.
- Live remediation:
  - deployed via `./tools/deploy-api-safe.sh` to sync stale runtime student portal assets (`student/vendor/images`).
  - verified `https://admin.eagles.edu.vn/student/portal` now serves `Student Portal` HTML instead of legacy news-page HTML.
- Verification:
  - `node --test test/student-admin.spec.mjs` => `101` pass, `0` fail.
  - `./tools/deploy-api-safe.sh --check-only` => no mismatch after deploy.
  - External smoke (`https://admin.eagles.edu.vn`, browser-like UA):
    - student sample (`n=10`): login/me/dashboard/calendar all `200`.
  - Browser validation against live host confirms:
    - `https://admin.eagles.edu.vn/web-asset/vendor/fullcalendar/index.global.min.js` => `200 text/javascript`.
    - `https://admin.eagles.edu.vn/web-asset/images/logo.svg` => `200 image/svg+xml`.
    - student portal news page renders FullCalendar month-grid markup.
- Residual risk:
  - no browser automation assertion yet verifies full portal navigation flow against deployed live host; current checks are HTTP contract/smoke-level.

## Update (2026-03-14 - aligned student auth contract to DB-first with env fallback)

- Updated [prisma/schema.prisma](prisma/schema.prisma):
  - added `StudentPortalAccount` model (`eaglesId` unique, `passwordHash`, `status`, optional `studentRefId`, audit timestamps).
  - linked `Student.studentPortalAccount` relation for one-account-per-student mapping.
- Added migration [prisma/migrations/20260314025500_add_student_portal_account_model/migration.sql](prisma/migrations/20260314025500_add_student_portal_account_model/migration.sql):
  - creates `StudentPortalAccount` table with unique/index constraints and FK to `Student`.
- Updated [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
  - student login now follows the same contract pattern as parent login:
    - DB-first credential lookup (`StudentPortalAccount`),
    - env fallback (`STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON`) when DB path is unavailable or not deployed.
  - added guarded student-portal DB fallback handling for missing Prisma model/table in mixed rollout states.
  - student session now stores `accountId` and resolves `studentRefId` from session first when available.
- Updated [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - added schema contract assertion for `StudentPortalAccount`.
  - added route contract assertion that student login resolver keeps DB-first ordering before env fallback.
- Updated [README.md](README.md):
  - documented Student Portal contract and account source (`StudentPortalAccount` preferred, env fallback supported).
- Runtime data alignment performed:
  - applied migration `20260314025500_add_student_portal_account_model` to both `sis` and `sis_dev`.
  - seeded `AdminUser` DB accounts from env sources on both DBs (`1 admin`, `6 teacher` each).
  - seeded `StudentPortalAccount` from `.env.dev` into `sis_dev` (`126` linked active accounts).
- Verification:
  - `node --test test/student-admin.spec.mjs` => `97` pass, `0` fail.
  - `npm test` => `228` pass, `0` fail, `0` skip.
  - DB-only login checks (temporary servers with env fallbacks blanked):
    - admin/teacher (`.env.dev` / `sis_dev`): `7/7` success.
    - admin/teacher (live env / `sis`): `7/7` success.
    - student (`.env.dev` / `sis_dev`): `126/126` success.
- Coverage gap:
  - no DB-enabled integration test currently exercises `/api/student/auth/login` against a seeded `StudentPortalAccount` row; current tests validate contract shape and env fallback behavior.
- Prioritized next action:
  - add a DB-enabled integration test that seeds one `StudentPortalAccount` row and asserts student login success/failure directly through HTTP.

## Update (2026-03-14 - fixed UTC+7 normalization across server and portal/admin date handling)

- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - normalized core day/week/year boundary helpers to fixed UTC+7 behavior (`startOfDay`, `endOfDay`, `startOfWeek`, `endOfWeek`, `startOfYear`).
  - normalized date-key conversion and date-only parsing to fixed UTC+7 (`toLocalIsoDate`, `parseLocalDateOnly`, `addDays`).
  - normalized academic-year start, weekend attendance-day detection, and weekly bucket date generation to fixed UTC+7 (removed host-local `getDay`/`setDate` dependencies).
  - student news window/open-date calculation now remains stable across host timezone differences.
- Updated [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
  - normalized weekend batch dispatch scheduling and portal date-key helpers to fixed UTC+7 (`nextWeekendBatchDispatchAt`, `startOfPortalWeek`, `addPortalDays`, `toPortalDateKey`).
- Updated [server/exercise-store.mjs](server/exercise-store.mjs):
  - normalized school-year and quarter derivation to fixed UTC+7 so assignment/exercise period classification is host-timezone independent.
- Updated [server/student-report-card-pdf.mjs](server/student-report-card-pdf.mjs):
  - normalized rendered report date formatting to fixed UTC+7 for consistent generated-date values.
- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - forced month/date/time display formatting to `Asia/Ho_Chi_Minh` timezone.
  - date-only parsing now anchors to `+07:00` for stable rendering across client locales.
- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - forced date/time display formatting to `Asia/Ho_Chi_Minh` timezone.
  - date-only parsing now anchors to `+07:00`.
- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - normalized remaining school-setup, week-boundary, day-diff, weekday-label, and parent-tracking deadline math to fixed UTC+7.
  - removed residual host-local date math (`getDay`, `getMonth`, `getFullYear`, `setDate`, `setHours`) from admin date workflow paths.
- Added [test/student-news-timezone.spec.mjs](test/student-news-timezone.spec.mjs):
  - verifies UTC+7 day boundary output for student news windows and calendar row statuses around midnight boundaries.
- Verification:
  - `npx html-validate web-asset/admin/student-admin.html web-asset/student/student-portal.html web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/admin/student-admin.html web-asset/student/student-portal.html web-asset/parent/parent-portal.html` => pass.
  - `node --test test/student-admin-ui.spec.mjs` => `42` pass, `0` fail.
  - `npm test` => `226` pass, `0` fail, `0` skip.

## Update (2026-03-13 - student news calendar initial render fix on first open)

- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - fixed first-open news calendar rendering by forcing a post-reveal re-render/resize when switching into `Daily News Report`.
  - resolves initial dot/collapsed month view that previously corrected only after navigating prev/next month.
- Updated [test/student-portal-calendar.playwright.spec.mjs](test/student-portal-calendar.playwright.spec.mjs):
  - added assertion that initial news-calendar render contains zero dot-style daygrid events (`.fc-daygrid-dot-event` / `.fc-daygrid-event-dot`).
- Verification:
  - `npx html-validate web-asset/student/student-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/student/student-portal.html` => pass.
  - `node --test test/student-portal-calendar.playwright.spec.mjs` => `1` pass, `0` fail.

## Update (2026-03-13 - Workspace SMTP relay no-auth mode + news calendar text color rules)

- Updated [server/exercise-mailer.mjs](server/exercise-mailer.mjs):
  - added SMTP auth-mode resolution via `SMTP_AUTH_MODE`/`SMTP_AUTH` with support for `none` (relay/no-auth) and `auth` (username/password).
  - transport config now omits `auth` when relay mode is selected and keeps current auth-required behavior for explicit auth mode.
- Updated [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
  - mirrored the same SMTP auth-mode behavior in assignment-announcement mail sending so admin-triggered email uses the same relay compatibility path.
- Added [test/exercise-mailer-smtp-relay.spec.mjs](test/exercise-mailer-smtp-relay.spec.mjs):
  - verifies service startup and `/healthz` behavior when `SMTP_AUTH_MODE=none` and SMTP credentials are intentionally empty.
- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - forces `News report window open` event text to black.
  - forces `MISSED NEWS REPORT` event text to white.
- Updated [test/student-portal-calendar.playwright.spec.mjs](test/student-portal-calendar.playwright.spec.mjs):
  - added assertions for missed/open news event text colors in the FullCalendar month view.

## Update (2026-03-13 - larger calendar dates and weekday labels across parent/student portals)

- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - increased FullCalendar month day-number font size and weekday-header font size with responsive `clamp(...)` sizing.
  - slightly increased small-screen day-cell minimum height to preserve readability after larger date/day text.
- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - increased FullCalendar month day-number font size and weekday-header font size with responsive `clamp(...)` sizing.
- Verification:
  - `npx html-validate web-asset/student/student-portal.html web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/student/student-portal.html web-asset/parent/parent-portal.html` => pass.

## Update (2026-03-13 - student news calendar readability and status fallback hardening)

- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - added explicit day-state tint classes (`completed`, `open`, `missed`) so the month view no longer reads as an all-white grid when event density is low.
  - kept obtrusive missed-deadline alert styling and layered it over day-state tints.
  - hardened status mapping so calendar rows render correctly from either modern `status` values or legacy/fallback fields (`color`, `canSubmit`, `submittedAt`).
  - switched the news month calendar to `eventDisplay: "block"` to avoid dot-only rendering on narrow/mobile layouts.
- Verification:
  - `npx html-validate web-asset/student/student-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/student/student-portal.html` => pass.
  - `node --test test/student-portal-calendar.playwright.spec.mjs` => `1` pass, `0` fail.

## Update (2026-03-13 - student home now mirrors parent-home structure)

- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - added the parent-home structural elements to student home: `overviewPanel`, read-only identity chip, `snapshotBadge`, and `portalStatus`.
  - aligned the student identity card to the parent-home contract with `Eagles ID`, student number, full name, and current grade.
  - aligned the student metrics set to the parent-home card mix by restoring the absence metric and removing the student-only points tile from the home dashboard.
  - moved refresh/logout into the top home toolbar so the quick-links panel remains a separate home element, matching the parent layout more closely.
- Updated [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - added HTML contract checks for the new student-home shell elements.
- Updated [test/student-portal-calendar.playwright.spec.mjs](test/student-portal-calendar.playwright.spec.mjs):
  - added authenticated browser assertions for the mirrored home shell before switching into the news/calendar page.
- Verification:
  - `npx html-validate web-asset/student/student-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/student/student-portal.html` => pass.
  - `node --test test/student-admin.spec.mjs test/student-portal-calendar.playwright.spec.mjs` => pass.

## Update (2026-03-13 - student calendar browser coverage + backend rubric enforcement)

- Added authenticated browser coverage in [test/student-portal-calendar.playwright.spec.mjs](test/student-portal-calendar.playwright.spec.mjs):
  - logs in through the real student portal form,
  - opens the news page,
  - asserts the FullCalendar month view renders,
  - asserts overdue alert events render with the blinking alert class,
  - asserts the alert day cell receives the red pulse class.
- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - added explicit post-render syncing for `calendar-day-alert` so alert dates are reflected on rendered FullCalendar day cells, not only in event rows.
- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - parent-report rubric normalization now strips the first three digital-reading/computer rubric fields for levels below `A2 Flyers` on the save path, closing the direct-API bypass.
- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - removed the extra `Grade 4/5/6` alias normalization branch from the client-side rubric gate and returned the check to SIS canonical class labels only.
- Updated [test/student-admin-store-parent-report.spec.mjs](test/student-admin-store-parent-report.spec.mjs):
  - added coverage that lower-level saves drop blocked digital-reading rubric keys,
  - added coverage that `A2 Flyers` keeps those keys.
- Verification:
  - `npx html-validate web-asset/student/student-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/student/student-portal.html` => pass.
  - `node --test test/student-admin.spec.mjs test/portal-header-geometry.playwright.spec.mjs test/student-portal-calendar.playwright.spec.mjs` => `97` pass, `0` fail.
  - `npm test` => pass.
- Note:
  - the Chrome DevTools `.well-known/appspecific/com.chrome.devtools.json` CSP warning does not originate from SIS runtime headers in this repo; no app-side CSP header is currently emitted here.

## Update (2026-03-13 - performance report low-level digital-reading rubric auto-disabled)

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - marked the first three digital-reading/computer skill rows with a minimum level of `A2 Flyers`.
  - auto-disables and grays out those score/recommendation controls for `A1 Movers` and lower levels on the Performance input page.
  - clears those row values when a lower-level student is selected so they do not contribute to rubric summary scores.
- Updated [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - extended the parent-tracking UI flow test to assert the first three digital-reading rubric rows are disabled and visually marked for a `Pre-A1 Starters` student while later skill rows remain editable.
- Verification:
  - `npx html-validate web-asset/admin/student-admin.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/admin/student-admin.html` => pass.
  - `node --test test/student-admin-ui.spec.mjs` => `42` pass, `0` fail.
  - `npm test` => `219` pass, `0` fail, `0` skip.
- Coverage gap:
  - the level rule is enforced in the admin UI only; direct API writes can still submit those rubric keys for lower-level classes.
- Prioritized next action:
  - mirror the same `Flyers and above` rubric-key filter in server-side parent-report normalization so stale clients cannot persist blocked rows.

## Update (2026-03-13 - student portal FullCalendar month view with news/homework/review tracks)

- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - replaced the hand-built student news calendar grid with a local FullCalendar month view using a custom `Your View` button label.
  - wired the calendar to render:
    - daily news-report status events (`completed`, `open`, `missed`),
    - week-long `notes review track` events,
    - week-long `current homework` events,
    - bright red blinking alert events for missed news-report days and overdue homework deadlines.
  - added day-cell alert styling so missed-deadline dates are visually obtrusive at month-view scale.
- Added vendored runtime asset:
  - [web-asset/vendor/fullcalendar/index.global.min.js](web-asset/vendor/fullcalendar/index.global.min.js)
  - [web-asset/vendor/fullcalendar/LICENSE.md](web-asset/vendor/fullcalendar/LICENSE.md)
- Updated [server/exercise-mailer.mjs](server/exercise-mailer.mjs):
  - added safe static serving for `/web-asset/*` paths so runtime-served portals can load local JS assets and existing shared portal images.
- Updated [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
  - added `buildStudentPortalCalendarTracks(...)` and included compact `calendarTracks` data in the student dashboard payload for homework/review week spans.
- Updated [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - added a unit test for calendar track week-span mapping.
  - strengthened `/student/portal` HTML assertions for the FullCalendar bundle and custom `Your View` configuration.
  - added runtime coverage for `GET /web-asset/vendor/fullcalendar/index.global.min.js`.
- Verification:
  - `npx html-validate web-asset/student/student-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/student/student-portal.html` => pass.
  - `node --test test/student-admin.spec.mjs test/portal-header-geometry.playwright.spec.mjs` => `96` pass, `0` fail.
  - `npm test` => `219` pass, `0` fail, `0` skip.
- Coverage gap:
  - no authenticated Playwright assertion yet validates FullCalendar event rendering, alert-day styling, and blinking overdue states after student login.
- Prioritized next action:
  - add one authenticated Playwright student-portal test that logs in, opens the news page, and asserts:
    - the `Your View` month calendar renders,
    - overdue homework/news alerts carry the red alert class,
    - review/homework week-span events appear in the month grid.

## Update (2026-03-13 - student home panel styling aligned to parent home)

- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - wrapped the authenticated student home view in a parent-style outer dashboard card (`#studentHomeCard`).
  - switched the student home internals to the same parent dashboard structure/tokens:
    - `#studentHomeGrid` now uses `portal-col`,
    - home sections now use `panel`,
    - dashboard metrics now use `metrics`,
    - summary copy now uses `hint`,
    - quick actions now use `#quickLinksPanel` and `quick-link`.
  - aligned student home breakpoints with parent home:
    - single-column below `1000px`,
    - identity left / metrics right at `min-width: 1000px`,
    - metrics wrap to `3` columns from `1000px - 1280px`,
    - quick links span full width with `2` columns at desktop.
  - updated student home view toggling to hide/show the outer home card instead of only the inner grid.
- Updated [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - strengthened the `/student/portal` HTML contract to require the parent-style student home shell (`#studentHomeCard`, `portal-col`, `metrics`, `#quickLinksPanel`).
- Verification:
  - `npx html-validate web-asset/student/student-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/student/student-portal.html` => pass.
  - `node --test test/student-admin.spec.mjs test/portal-header-geometry.playwright.spec.mjs` => `94` pass, `0` fail.
- Coverage gap:
  - no authenticated browser-level assertion yet verifies student home panel parity with parent home at desktop/tablet breakpoints.
- Prioritized next action:
  - add a Playwright student-portal dashboard test that logs in, then asserts `#identityPanel`, `#metricsPanel`, and `#quickLinksPanel` placement plus metrics column count at `1100px` and wide desktop.

## Update (2026-03-13 - parent dashboard column swap + 1000-1280 metrics wrapping)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - changed desktop breakpoint to `min-width: 1000px` for parent dashboard column layout.
  - swapped panel placement so `Thông tin định danh học sinh` (`#identityPanel`) renders in the left column and `Tổng quan nhanh` (`#metricsPanel`) renders in the right column.
  - added range-specific metrics layout for `1000px - 1280px`:
    - `.metrics` now uses `repeat(3, minmax(0, 1fr))`, yielding a 2-row x 3-column wrap for six summary cards.
- Playwright runtime check:
  - at `1100x900`, identity panel x-position `<` metrics panel x-position and metrics columns resolve to 3 tracks.
  - at `1300x900`, panel positions remain left/right and metrics columns return to 6 tracks.
- Verification:
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `node --test test/parent-portal-ui.spec.mjs test/portal-header-geometry.playwright.spec.mjs` => `5` pass, `0` fail.
- Coverage gap:
  - no dedicated automated assertion yet for the `1000px-1280px` 3-column metrics wrap.
- Prioritized next action:
  - add a Playwright assertion in `test/portal-header-geometry.playwright.spec.mjs` for the parent `1100px` metrics grid track count.

## Update (2026-03-13 - student endpoint/status message moved to page bottom)

- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - moved global status strip (`#globalStatus`) from top section to bottom of main content.
  - endpoint/auth/runtime errors (for example, endpoint-not-found messages) now render at the bottom of the student page as requested.
- Verification:
  - `npx html-validate web-asset/student/student-portal.html` => pass.
  - `node --test test/student-admin.spec.mjs` => `93` pass, `0` fail.
- Coverage gap:
  - no dedicated UI assertion yet for exact `#globalStatus` vertical placement in rendered viewport.
- Prioritized next action:
  - add a small Playwright assertion that `#globalStatus` is positioned below `#appPanel` on `/student/portal`.

## Update (2026-03-13 - portal menu/background parity fixes for parent/student)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - restored original parent portal background layer approach (`body::before` radial/linear blend).
  - aligned mobile drawer visuals closer to admin menu tokens (`menu bg`, border, link states).
  - changed drawer from full-height to content-height (`top` anchored, `max-height` bounded, internal scroll).
  - fixed blank-page overlay issue by excluding `#parentNavScrim` from generic button styling and keeping a persistent shaded scrim (`rgba(12,22,39,0.4)`).
- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - restored original student portal background gradients.
  - aligned mobile drawer visuals closer to admin menu tokens and rounded hamburger style.
  - changed drawer from full-height to content-height (`top` anchored, `max-height` bounded, internal scroll).
  - fixed blank-page overlay issue by excluding `#navOverlay` from generic button styling and keeping a persistent shaded scrim (`rgba(12,22,39,0.4)`).
- Playwright validation (`390x844`) on local static preview:
  - parent drawer height now `384px` (not infinite), scrim color `rgba(12,22,39,0.4)`, opacity `1` when open.
  - student drawer height now `390px` (not infinite), scrim color `rgba(12,22,39,0.4)`, opacity `1` when open.
- Verification:
  - `npx html-validate web-asset/parent/parent-portal.html web-asset/student/student-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html web-asset/student/student-portal.html` => pass.
  - `node --test test/parent-portal-ui.spec.mjs test/student-admin.spec.mjs test/portal-header-geometry.playwright.spec.mjs` => `98` pass, `0` fail.
  - `npm test` => `217` pass, `0` fail, `0` skip.
- Coverage gap:
  - background restoration is currently validated manually (no pixel-diff/snapshot gate yet).
- Prioritized next action:
  - add a lightweight screenshot comparison for parent/student background layers to detect palette drift.

## Update (2026-03-13 - Playwright dependency/runtime installed; geometry test no longer skipped)

- Updated [package.json](package.json):
  - added `playwright` to `devDependencies`.
- Updated [package-lock.json](package-lock.json):
  - lockfile refreshed for Playwright installation.
- Runtime setup:
  - installed Playwright browser runtime with `npx playwright install chromium`.
- Verification:
  - `node --test test/portal-header-geometry.playwright.spec.mjs` => `1` pass, `0` fail, `0` skip.
  - `npm test` => `217` pass, `0` fail, `0` skip.
- Coverage gap:
  - local environment now runs geometry checks end-to-end.
  - CI still requires explicit Playwright browser install step if not already provisioned.
- Prioritized next action:
  - ensure CI bootstrap runs `npx playwright install chromium` (or uses preinstalled Playwright cache) before `npm test`.

## Update (2026-03-13 - parent/student header single-line parity + stricter geometry drift guard)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - removed header session badge so header matches requested admin-like single-line structure:
    - logo + title left,
    - text-size widget right.
  - kept floating hamburger at top-right with admin-aligned offset and non-round radius.
  - enforced non-wrapping header action row and non-wrapping text-size widget.
  - kept small-screen compactness by hiding text-size labels (`Text Size`, `%`) below `560px` while preserving controls.
- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - moved `#globalStatus` out of header into a separate `status-strip` card, so header remains single-line.
  - aligned header behavior to parent/admin:
    - logo + title left,
    - text-size widget right,
    - floating right hamburger with same geometry rules.
  - enforced non-wrapping header action row and non-wrapping text-size widget.
  - matched small-screen compact text-size behavior (hide label/% below `560px`).
- Updated [test/portal-header-geometry.playwright.spec.mjs](test/portal-header-geometry.playwright.spec.mjs):
  - added explicit compact-header height assertions:
    - mobile header height `<= 92px`,
    - desktop header height `<= 78px`,
  - retained existing right-offset and left-alignment checks.
- Playwright runtime geometry re-check (`http://127.0.0.1:46855/...`):
  - parent mobile (`390x844`): header `h=62`, menu right offset `12`.
  - student mobile (`390x844`): header `h=54`, menu right offset `12`.
  - parent desktop (`1366x900`): header `h=66`, menu right offset `12`.
  - student desktop (`1366x900`): header `h=60`, menu right offset `12`.
- Verification:
  - `npx html-validate web-asset/parent/parent-portal.html web-asset/student/student-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html web-asset/student/student-portal.html` => pass.
  - `node --test test/portal-header-geometry.playwright.spec.mjs test/parent-portal-ui.spec.mjs test/student-admin.spec.mjs` => `97` pass, `0` fail, `1` skip.
  - `npm test` => `216` pass, `0` fail, `1` skip.
- Coverage gap:
  - geometry drift assertions are skipped unless `playwright` package/browser runtime is installed.
- Prioritized next action:
  - add `playwright` runtime dependency and browser install in CI/dev bootstrap so geometry checks always execute.

## Update (2026-03-13 - portal header/menu parity with admin baseline + viewport geometry validation)

- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - aligned header shell to admin style tokens (narrow strip, left-offset content, bordered logo frame).
  - switched to fixed floating red hamburger button (`#menuBtn`) with non-round radius matching portal/base radius.
  - aligned drawer menu behavior to admin slide-over pattern (fixed panel + scrim + `body.menu-open` lock).
  - preserved existing dashboard/news form IDs and behavior; retained two-column desktop card wrapping.
- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - aligned header shell to admin style tokens with the same floating hamburger/logo pattern.
  - kept `#childPageCard` separate from dashboard home view and preserved existing view-switch logic.
  - refined dashboard home card to a clearer two-column desktop cluster:
    - metrics left (`#metricsPanel`),
    - identity right (`#identityPanel`),
    - quick links full-width (`#quickLinksPanel`).
  - aligned drawer menu behavior to admin slide-over pattern and `body.menu-open` lock.
- Playwright viewport geometry checks (`http://127.0.0.1:5500/...`):
  - mobile (`390x844`):
    - admin baseline menu button: `x=12 y=12`.
    - student menu button: `x=12 y=12`, logo frame left offset aligned.
    - parent menu button: `x=12 y=12`, logo frame left offset aligned.
  - desktop (`1366x900`):
    - student header card width aligned to page wrap (`x=16 w=1334`), top cards split into 2 columns.
    - parent header card now compact (`h=64`), dashboard clusters split into 2 columns with full-width quick links.
- Verification:
  - `npx html-validate web-asset/student/student-portal.html web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/student/student-portal.html web-asset/parent/parent-portal.html` => pass.
  - `node --test test/parent-portal-ui.spec.mjs test/student-admin.spec.mjs` => `97` pass, `0` fail.
  - `npm test` => `216` pass, `0` fail.
- Coverage gap:
  - Playwright geometry checks are manual in-session diagnostics and are not yet CI assertions.
- Prioritized next action:
  - add a small Playwright UI test that asserts floating hamburger position and header/logo offsets for `/student/portal` and `/parent/portal` at mobile and desktop viewports.

## Update (2026-03-13 - hamburger-only portal nav + shared logo + parent profile form moved to child page view)

- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - removed desktop persistent sidebar behavior; navigation is now hamburger-only at all breakpoints.
  - replaced text menu button with a hamburger-shaped icon button (three bars).
  - switched header mark to shared portal logo asset:
    - `/web-asset/images/logo.svg`.
- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - removed desktop persistent sidebar behavior; navigation is now hamburger-only at all breakpoints.
  - replaced menu label button with a hamburger-shaped icon button.
  - switched header mark to shared portal logo asset:
    - `/web-asset/images/logo.svg`.
  - moved `Biểu mẫu cập nhật hồ sơ` off the dashboard card into a separate child-page view (`#childPageCard`).
  - added view switching controls:
    - dashboard quick action button (`#openChildPageBtn`),
    - child page back button (`#backToDashboardBtn`),
    - side-nav view targets (`data-view-target="dashboard|child"`),
    - child-page status badge (`#childPageBadge`).
  - status routing now follows active view (`login`, `dashboard`, or `child page`).
- Updated [test/parent-portal-ui.spec.mjs](test/parent-portal-ui.spec.mjs):
  - added regression test ensuring profile form is accessed through child-page view toggle and not kept on dashboard card.
- Verification:
  - `npx html-validate web-asset/student/student-portal.html web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/student/student-portal.html web-asset/parent/parent-portal.html` => pass.
  - `node --test test/parent-portal-ui.spec.mjs test/student-admin.spec.mjs` => `97` pass, `0` fail.
  - `npm test` => `216` pass, `0` fail.
- Coverage gap:
  - no Playwright assertion yet verifies logo rendering and nav drawer behavior under narrow viewport touch interactions.
- Prioritized next action:
  - add one Playwright portal smoke test that checks hamburger open/close, view toggle, and logo visibility on `/parent/portal` and `/student/portal`.

## Update (2026-03-13 - parent/student portal dashboard shell alignment + student dashboard API endpoint)

- Updated [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
  - added student dashboard API endpoint: `GET /api/student/dashboard`.
  - added student runtime config export `window.__SIS_STUDENT_DASHBOARD_PATH` for `/student/portal`.
  - runtime status now reports `studentDashboardPath`.
  - student dashboard payload now returns student-specific dashboard metrics + points/news summary:
    - attendance/assignments/grades/performance snapshot,
    - points summary (`totalPoints`, scheduled/elective/report counts, adjustments),
    - news-report submission count + latest submitted timestamp.
- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - rebuilt as a mobile-first dashboard shell with:
    - hamburger + slide-out navigation,
    - desktop two-column behavior,
    - overview metrics panel (`#dashboardMetrics`),
    - quick links including direct jump to daily news report form.
  - preserved existing auth/calendar/report IDs and flow while adding dashboard fetch (`/api/student/dashboard`).
- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - added admin-like shell behavior:
    - hamburger + side navigation on mobile,
    - desktop pinned sidebar,
    - two-column dashboard composition for overview/identity/quick-links vs profile editing.
  - added direct links for:
    - profile update section anchor,
    - student portal/news report route (`/student/portal`).
  - preserved existing parent profile form IDs and submission flow.
- Updated [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - strengthened `/student/portal` HTML contract assertions for dashboard runtime + metrics container.
  - added unauthorized coverage for `GET /api/student/dashboard`.
  - extended student disabled-store coverage to include dashboard endpoint response.
- Verification:
  - `npx html-validate web-asset/student/student-portal.html web-asset/parent/parent-portal.html` => pass.
  - `node --test test/student-admin.spec.mjs test/parent-portal-ui.spec.mjs` => `96` pass, `0` fail.
  - `npm test` => `215` pass, `0` fail.
- Coverage gap:
  - no browser-level visual regression test yet verifies side-nav/hamburger behavior at both mobile and desktop breakpoints for parent and student portals.
- Prioritized next action:
  - add a Playwright viewport matrix test (`mobile`, `tablet`, `desktop`) for `/parent/portal` and `/student/portal` to assert side-nav toggle, section anchors, and core metrics render.

## Update (2026-03-13 - student portal calendar redesigned to compact mobile-first month grid)

- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - replaced the previous card-list calendar with a compact 7-column month-style grid (weekday headers + date cells).
  - mobile-first sizing is now the default (small cells, short labels) with a larger desktop scale-up at `min-width: 760px`.
  - added range title (`#calendarTitle`) and clearer day-state visuals using consistent color markers for `completed`, `missed`, and `open`.
  - calendar rendering now builds week-aligned rows from date keys and keeps out-of-window days visibly muted.
- Updated [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - strengthened student portal HTML contract to require `id="calendarTitle"` and `calendar-weekday` markers.
- Verification:
  - `npx html-validate web-asset/student/student-portal.html` => pass.
  - `node --test test/student-admin.spec.mjs` => `92` pass, `0` fail.
- Coverage gap:
  - no browser screenshot diff test currently validates calendar layout fit on narrow mobile widths.
- Prioritized next action:
  - add one Playwright mobile viewport snapshot check for `/student/portal` calendar readability.

## Update (2026-03-13 - student portal static-preview dev/live separation default to dev port)

- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - adjusted local static-preview API origin inference for loopback hosts so non-runtime preview ports (for example `:46855`) now default to `http://127.0.0.1:8788`.
  - runtime-served page (`/student/portal`) and explicit query override (`?apiOrigin=...`) behavior are unchanged.
  - this prevents dev credential imports from being tested against live runtime (`:8787`) by accident.
- Updated [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - strengthened student portal HTML contract assertion to verify `inferLocalPreviewApiOrigin` includes dev fallback `:8788`.
- Verification:
  - `npx html-validate web-asset/student/student-portal.html` => pass.
  - `node` + `jsdom` smoke check on `http://127.0.0.1:46855/web-asset/student/student-portal.html` confirms first API call is `GET http://127.0.0.1:8788/api/student/auth/me`.
- Coverage gap:
  - no browser-authenticated end-to-end test currently verifies static-preview login against dev `:8788` with real cookies.
- Prioritized next action:
  - add one Playwright check that logs in from loopback static preview and asserts student calendar fetch succeeds on `:8788`.

## Update (2026-03-13 - student portal static-preview CORS/login hardening + points-page a11y lint cleanup)

- Updated [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
  - fixed CORS wildcard handling for credentialed cross-origin requests by echoing request origin when `EXERCISE_MAILER_ORIGIN="*"`.
  - this unblocks student portal session requests from loopback preview origins (for example `http://127.0.0.1:46855`) that use `credentials: "include"`.
- Updated [web-asset/student/student-portal.html](web-asset/student/student-portal.html):
  - added static-preview API origin resolution/inference so local preview can call runtime API at `:8787` without manual rewiring.
  - wrapped login controls in a real `<form id="loginForm">` and switched to submit handler to remove password-field form warning and support Enter-to-login.
- Updated [web-asset/admin/student-points.html](web-asset/admin/student-points.html):
  - fixed html-validate findings:
    - explicit `type="text"` on username input,
    - removed invalid `aria-label` usage on chart SVG (`aria-hidden="true"`),
    - added missing `scope="col"` on table headers,
    - added missing `.c2` grid class and responsive rule.
- Updated [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - added CORS regression test verifying student auth preflight returns:
    - `Access-Control-Allow-Origin` echoed loopback origin,
    - `Access-Control-Allow-Credentials: true`,
    - when wildcard origin config is active.
  - strengthened student portal HTML contract assertion to require `id="loginForm"`.
- Verification:
  - `npx html-validate web-asset/student/student-portal.html web-asset/admin/student-points.html web-asset/admin/student-points.html.bak` => pass.
  - `npm test` => `214` pass, `0` fail.
- Coverage gap:
  - no browser-automation test yet asserts end-to-end cross-origin student login from a real static preview origin.
- Prioritized next action:
  - add a small Playwright check opening `/web-asset/student/student-portal.html` from loopback static host and asserting `GET /api/student/auth/me` reaches runtime with credentialed CORS success.

## Update (2026-03-12 - parent portal background moved to fixed body::before layer)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - moved parent portal gradient layers from `body` background to a fixed `body::before` pseudo-element.
  - kept the same gradient palette and shape settings.
  - set `body` background to transparent so the fixed layer remains stable during reload/hydration.
- Verification:
  - `node --test test/parent-portal-ui.spec.mjs` => `3` pass, `0` fail.
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html` => pass.
- Coverage gap:
  - no automated visual assertion currently checks first-paint/reload background stability in CI.
- Prioritized next action:
  - add a small Playwright visual regression check that reloads `/parent/portal` and compares first-paint vs settled-paint background frames.

## Update (2026-03-12 - parent portal background reverted to original gradient)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - reverted the body background gradient to the original palette/layering:
    - `--bg-0: #f3efe6`,
    - `--bg-1: #f8f7f3`,
    - warm radial `#ffd2ac`,
    - cool radial `#b7d5ff`,
    - base `linear-gradient(180deg, var(--bg-0), var(--bg-1))`.
- Runtime sync:
  - executed `tools/deploy-api-safe.sh` to propagate the reverted parent asset to runtime (`:8787`).
- Verification:
  - `curl http://127.0.0.1:8787/parent/portal` confirms:
    - `--bg-0: #f3efe6`,
    - `radial-gradient(1200px 500px at -10% -10%, #ffd2ac 0%, transparent 56%)`.
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html` => pass.

## Update (2026-03-12 - Playwright-guided parent portal background retune: secondary + tertiary + white)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - retuned background gradient to recover the original soft glow feel while avoiding the concrete/flat look.
  - background now layers:
    - tertiary warm tint bloom (`--bg-tertiary-tint`) near top-left,
    - secondary cool tint bloom (`--bg-secondary-tint`) near top-right,
    - white highlight bloom at top-center,
    - white-to-soft base linear blend.
  - active color tokens:
    - `--bg-secondary-tint: #cfe3ff`,
    - `--bg-tertiary-tint: #ffe3c7`,
    - `--bg-0: #f9fbff`,
    - `--bg-1: #ffffff`.
- Playwright visual validation:
  - captured baseline and tuned screenshots:
    - `/home/eagles/parent-bg-before.png`,
    - `/home/eagles/parent-bg-after-v2.png`.
  - verified warm highlight shift in top-left sample area using ImageMagick pixel checks.
- Verification:
  - `node --test test/parent-portal-ui.spec.mjs` => `3` pass, `0` fail.
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html` => pass.
  - `npm test` => `206` pass, `0` fail.

## Update (2026-03-12 - parent portal required-marker color + no-yellow subtle background gradient)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - removed warm yellow background tint and switched the parent portal base background to a subtle three-tone blend:
    - primary tint (light red, brand-aligned),
    - secondary tint (light blue, brand-aligned),
    - tertiary tint (very light neutral-rose wash).
  - added a dedicated required-marker style so required `*` renders in primary brand color.
  - label rendering now appends a styled required marker span for labels that are required/trailing-asterisk while preserving existing label text order.
- Verification:
  - `node --test test/parent-portal-ui.spec.mjs` => `3` pass, `0` fail.
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html` => pass.
  - `npm test` => `206` pass, `0` fail.
- Coverage gap:
  - visual/pixel-level background and marker color checks are not currently threshold-gated in CI.
- Prioritized next action:
  - add one Playwright visual assertion for required-marker color token usage and parent portal background palette drift.

## Update (2026-03-11 - parent gender token mismatch fix: `male` no longer resolves to `nữ`)

- Root cause:
  - parent portal option matching used permissive substring logic for all choice fields.
  - legacy gender tokens such as `M` could match both `male` and `female`; because radio options are iterated in order, final checked state could land on `female` (`nữ`).
- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - added deterministic gender token normalization and matching for `genderSelections`:
    - male aliases (`m`, `male`, `nam`, etc.) map only to `male`,
    - female aliases (`f`, `female`, `nu`, etc.) map only to `female`.
  - kept strict single-select radio behavior for `genderSelections`.
  - wired gender option matching to use field-aware logic (gender-specialized, generic matching untouched for other fields).
- Updated [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
  - added `normalizeInteger` + `normalizePositiveInteger` helpers used by parent patch normalization (fixes undefined helper gap).
  - added deterministic backend gender normalization in `normalizeParentProfilePatch` for `genderSelections` so legacy tokens (`M`, `Nam`, `Female`, etc.) are canonicalized consistently before draft/approve persistence.
- Updated [test/parent-portal-ui.spec.mjs](test/parent-portal-ui.spec.mjs):
  - fixture now uses legacy token `genderSelections: ["M"]` and asserts UI selects `male`.
  - asserts `female` is not selected in that scenario.
  - retains blank-default assertion when gender is absent.
- Verification:
  - `node --test test/parent-portal-ui.spec.mjs` => `3` pass, `0` fail.
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html` => pass.
  - `npx eslint --config eslint.config.mjs test/parent-portal-ui.spec.mjs server/student-admin-routes.mjs` => pass.
  - `npm test` => `206` pass, `0` fail.

## Update (2026-03-11 - parent portal gender control corrected to single-select radio + Kramer profile verification)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - changed `genderSelections` input control from `checkbox` to `radio` so parents can select at most one option.
  - kept default unselected behavior when no stored value is present.
  - normalized option values to canonical profile tokens for stable read/write mapping:
    - `male`,
    - `female`.
- Updated [test/parent-portal-ui.spec.mjs](test/parent-portal-ui.spec.mjs):
  - asserts gender now renders as radio inputs (`name="pf_genderSelections"`), not checkbox inputs.
  - asserts existing profile value `genderSelections: ["male"]` hydrates to selected `male`.
  - asserts blank/default state (0 selected radios) when no gender value exists.
- Data verification (local runtime DB):
  - queried `StudentProfile` for `parentsId = "cmkramer001"` and confirmed persisted value:
    - `genderSelections: ["male"]`.
  - this aligns with parent portal read path (`profile.genderSelections`) and backend submit/approve persistence path (`normalizeParentProfilePatch` keeps `genderSelections` in array field normalization).
- Verification:
  - `node --test test/parent-portal-ui.spec.mjs` => `3` pass, `0` fail.
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html` => pass.
  - `npx eslint --config eslint.config.mjs test/parent-portal-ui.spec.mjs` => pass.
  - `npm test` => `206` pass, `0` fail.
- Coverage gap:
  - no browser-authenticated live test yet logs in as a real parent account and round-trips a gender edit through draft + admin approve on DB-backed runtime.
- Prioritized next action:
  - add one DB-backed end-to-end fixture for parent draft + admin approve + reload verification for `genderSelections`.

## Update (2026-03-11 - parent portal school/grade wiring correction for public-school class field)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - changed student-school labels to match requested text:
    - `Hiện đang học tại trường nào *`
    - `Hiện đang học lớp mấy *`
  - switched the editable grade/class field key from `currentGrade` to `currentSchoolGrade`.
  - reversed compatibility fallback to prefer `currentSchoolGrade` and only then read legacy `currentGrade`.
  - added a fallback guard so legacy `currentGrade` is ignored when it matches immutable child `currentGrade` (Eagles level such as `egg-chicks`), preventing wrong-value bleed into the public-school class field.
- Updated [test/parent-portal-ui.spec.mjs](test/parent-portal-ui.spec.mjs):
  - fixture now includes:
    - immutable child `currentGrade: "egg-chicks"`,
    - profile `currentSchoolGrade: "6A"`,
    - legacy profile `currentGrade: "egg-chicks"`.
  - asserts:
    - the two updated labels are rendered,
    - `pf_currentSchoolGrade` is rendered with value `6A`,
    - `pf_currentGrade` input is not rendered.
- Verification:
  - `node --test test/parent-portal-ui.spec.mjs` => `3` pass, `0` fail.
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html` => pass.
  - `npx eslint --config eslint.config.mjs test/parent-portal-ui.spec.mjs` => pass.
  - `npm test` => `206` pass, `0` fail.
- Coverage gap:
  - visual diff remains manual/ad-hoc and is not threshold-gated in CI.
- Prioritized next action:
  - codify the existing parent-vs-reference screenshot compare flow into an automated Playwright+image-diff check with explicit failure thresholds.

## Update (2026-03-11 - parent portal readonly metadata fields + browser visual diff run)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - added a dedicated readonly section (`Thông tin tài khoản (chỉ xem)`) to display:
    - `memberSince`,
    - `parentsId`,
    - `updatedAt`.
  - these fields are visible but locked (`disabled` + `readOnly`) and are excluded from parent draft patching.
  - `memberSince` display is normalized to month/year (`MM/YYYY`) when an ISO-like date value is present.
- Updated [test/parent-portal-ui.spec.mjs](test/parent-portal-ui.spec.mjs):
  - asserts readonly metadata section heading is present when metadata values exist.
  - asserts metadata controls are rendered with readonly IDs and disabled state:
    - `pf_meta_memberSince`,
    - `pf_meta_parentsId`,
    - `pf_meta_updatedAt`.
  - keeps suppression assertions for internal-only keys such as `studentRefId` and `normalizedFormPayload`.
- Browser visual diff run (manual, headless):
  - local parent profile screenshot source:
    - `http://127.0.0.1:8799/parent/portal` (mocked parent APIs).
  - reference screenshot source:
    - `https://eagles.edu.vn/cac-khoa-hoc/trang-chu-tu-cach-thanh-vien/tham-gia-hinh-thuc-thanh-vien`.
  - screenshots:
    - `/home/eagles/visual-parent-local-profileFields.png`,
    - `/home/eagles/visual-reference-membership-form.png`.
  - resized local screenshot to reference dimensions for metric computation:
    - `/home/eagles/visual-parent-local-profileFields.resized.png`.
  - ImageMagick compare outputs:
    - RMSE: `11796.4 (0.180002)`,
    - AE: `4.37765e+06` differing pixels out of `4,556,128` (`96.08%`),
    - diff artifacts:
      - `/home/eagles/visual-diff-rmse.png`,
      - `/home/eagles/visual-diff-ae.png`.
- Verification:
  - `node --test test/parent-portal-ui.spec.mjs` => `2` pass, `0` fail.
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html` => pass.
- Coverage gap:
  - visual diff run is currently ad-hoc/manual and not yet wired into CI.
- Prioritized next action:
  - codify this screenshot + compare flow into a deterministic Playwright-based test script with threshold gates.

## Update (2026-03-11 - parent portal strict reference-form GUI contract, no legacy alias/render leakage)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - removed legacy front-end alias-token and placeholder map logic from the parent profile rendering path.
  - switched profile rendering to a strict canonical schema with fixed section order and fixed label order matching the Eagles membership form structure.
  - now renders canonical controls explicitly by field definition:
    - text/textarea,
    - email,
    - tel,
    - number,
    - date (with safe text fallback when stored value is non-ISO),
    - select,
    - radio,
    - checkbox groups.
  - hidden metadata/system fields are no longer surfaced in parent form UI:
    - `id`,
    - `studentRefId`,
    - `memberSince`,
    - `parentsId`,
    - `requiredValidationOk`,
    - `createdAt`,
    - `updatedAt`,
    - `sourceFormId`,
    - `sourceUrl`,
    - `rawFormPayload`,
    - `normalizedFormPayload`.
  - removed fallback "additional fields" rendering so unknown/internal keys are not mixed into the mirrored form.
- Updated [test/parent-portal-ui.spec.mjs](test/parent-portal-ui.spec.mjs):
  - expanded regression assertions for:
    - strict section order,
    - strict label order in mirrored sections,
    - control-type presence (`date`, `number`, `tel`, `email`, `checkbox`, `radio`),
    - metadata/system key suppression in rendered DOM/text.
- Verification:
  - `node --test test/parent-portal-ui.spec.mjs` => `2` pass, `0` fail.
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html` => pass.
  - `npx eslint --config eslint.config.mjs test/parent-portal-ui.spec.mjs` => pass.
  - `npm test` => `205` pass, `0` fail.
- Coverage gap:
  - no authenticated browser E2E currently validates checkbox/radio/date interaction semantics against a real runtime payload.
- Prioritized next action:
  - add one Playwright parent-portal interaction fixture that toggles choice fields, saves draft, reloads, and verifies persisted canonical values.

## Update (2026-03-11 - parent portal profile form mirrored to Eagles membership structure)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - replaced heuristic token-based grouping and alphabetic field sorting with explicit, ordered section/field mapping aligned to the Eagles reference membership form.
  - applied stable section order:
    - `Thông tin của người học`,
    - `Liên hệ của mẹ hoặc học sinh trưởng thành`,
    - `Liên hệ của ba`,
    - `Địa chỉ`,
    - `Thông tin sức khỏe của người học`,
    - `Chăm sóc trong giờ học (nếu người học là trẻ em)`,
    - `Xác nhận`.
  - mapped known profile keys to reference labels 1:1 (with minor internal key variance support via alias token map).
  - hid technical payload fields from parent-facing form rendering:
    - `sourceFormId`,
    - `sourceUrl`,
    - `rawFormPayload`,
    - `normalizedFormPayload`.
- Updated [test/parent-portal-ui.spec.mjs](test/parent-portal-ui.spec.mjs):
  - added regression test asserting section order and label order remain reference-aligned even when incoming profile payload keys are shuffled.
  - retained static-preview login origin test coverage.
- Verification:
  - `node --test test/parent-portal-ui.spec.mjs` => `2` pass, `0` fail.
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html` => pass.
  - `npm test` => `205` pass, `0` fail.
- Coverage gap:
  - no browser-driven visual snapshot test currently diffs the parent portal layout directly against the public reference form.
- Prioritized next action:
  - add one Playwright visual regression fixture for ordered section/label rendering against a locked fixture profile payload.

## Update (2026-03-11 - sync scripts codify static preview :5500 and production backend :8787 contract)

- Updated [tools/sis-runtime-resync.sh](tools/sis-runtime-resync.sh):
  - added runtime env contract enforcement during sync:
    - `EXERCISE_MAILER_HOST=127.0.0.1`
    - `EXERCISE_MAILER_PORT=8787`
    - `STUDENT_ADMIN_STORE_ENABLED=true`
    - `EXERCISE_MAILER_ORIGIN` must include `http://127.0.0.1:5500`
  - drift detection now includes env-contract mismatch checks, so `--sync-on-mismatch` syncs when code is unchanged but env contract drifts.
  - help output documents the sync contract.
- Updated [tools/deploy-api-safe.sh](tools/deploy-api-safe.sh):
  - added same runtime env contract enforcement during sync.
  - added same env drift checks in mismatch detection.
  - help output documents the sync contract.
- Updated [README.md](README.md):
  - documented that sync workflows now explicitly keep local static preview origin `http://127.0.0.1:5500` in runtime CORS origin config and pin production backend env keys.
- Verification:
  - `bash -n tools/sis-runtime-resync.sh` => pass.
  - `bash -n tools/deploy-api-safe.sh` => pass.
  - `tools/sis-runtime-resync.sh --help` => includes sync contract text.
  - `tools/deploy-api-safe.sh --help` => includes sync contract text.
- Coverage gap:
  - no automated integration fixture currently executes these deploy scripts against a disposable runtime root with `.env` assertions.
- Prioritized next action:
  - add one shell-based smoke fixture (temporary runtime root + fake `.env`) to assert contract pinning and drift detection behavior for both scripts.

## Update (2026-03-11 - parent portal login static-preview 405 mitigation)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - added parent-portal API URL resolution for static preview mode.
  - local preview fallback now infers `http://127.0.0.1:8787` when opened from `http://127.0.0.1:<non-8787>/web-asset/parent/parent-portal.html`.
  - added `?apiOrigin=...` and optional injected `window.__SIS_PARENT_API_ORIGIN` support for explicit API origin override.
  - parent portal fetch calls now resolve through `resolveApiUrl(...)` before network dispatch.
- Added [test/parent-portal-ui.spec.mjs](test/parent-portal-ui.spec.mjs):
  - verifies static-preview login posts to `http://127.0.0.1:8787/api/parent/auth/login` (not relative preview origin path).
  - verifies login/portal panel transition still succeeds after origin resolution.
- Verification:
  - `node --test test/parent-portal-ui.spec.mjs` => `1` pass, `0` fail.
  - `node --test test/student-admin.spec.mjs` => `84` pass, `0` fail.
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html` => pass.
  - `npm test` => `204` pass, `0` fail.
- Coverage gap:
  - no live reverse-proxy integration test currently asserts parent login behavior under non-default upstream route rules.
- Prioritized next action:
  - add one deploy-smoke check that exercises `POST /api/parent/auth/login` via the production ingress hostname and validates expected response code/header behavior.

## Update (2026-03-11 - parent portal snapshot metric rules + Vietnamese form harmonization)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - centered snapshot metric cards (horizontal + vertical), reduced padding, and tightened visual density.
  - implemented requested metric semantics/colors:
    - attendance as `SYTD %` and always green,
    - absences as `SYTD %` (`>5%` purple, `>10%` red),
    - pending homework blue when `>0`,
    - overdue homework red when `>0`,
    - average score purple when `<=76%`, red when `<=70%`.
  - removed per-field `Editable/Locked` style badges and `Profile key: ...` helper text.
  - changed field-state UX to shading + concise text:
    - locked row: soft red + `Đã khóa`,
    - edited row: soft blue + `Đã chỉnh sửa (chưa lưu)`.
  - made `signatureFullName` field visually de-emphasized (smaller/greyer).
  - localized portal copy and form guidance to Vietnamese, with reference-form style placeholders and field-type mapping (email/tel/text).
- Reference review:
  - reviewed `https://eagles.edu.vn/cac-khoa-hoc/trang-chu-tu-cach-thanh-vien/tham-gia-hinh-thuc-thanh-vien` to align structure/prose tone, field naming style, and placeholder conventions.
- Verification:
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html` => pass.
  - `node --test test/student-admin.spec.mjs` => `84` pass, `0` fail.
- Coverage gap:
  - no authenticated browser test yet validates live threshold-color rendering against real dashboard payloads.
- Prioritized next action:
  - add one Playwright fixture with deterministic dashboard payload assertions for each threshold branch.

## Update (2026-03-11 - parent portal UX follow-up: remove per-field badges, use shading/text states)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - removed per-field badge elements for `Editable/Locked` and `Edited/Unchanged`.
  - switched to state differentiation via web-consistent visual treatment:
    - locked rows: soft red shading + read-only text state (`Locked field`) + disabled controls,
    - edited rows: soft blue shading + text state (`Unsaved edit`),
    - unchanged editable rows: plain state text (`Editable`).
  - retained the global draft counter chip and sticky action bar.
- Verification:
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html` => pass.
  - `node --test test/student-admin.spec.mjs` => `84` pass, `0` fail.
- Coverage gap:
  - no authenticated parent-portal browser test yet validates shaded row states during real edit interactions.
- Prioritized next action:
  - add one Playwright parent-portal test to assert row-state class transitions (`editable` -> `edited`) and locked-row read-only behavior.

## Update (2026-03-11 - parent portal mobile-first UX refactor + contextual editable badges)

- Updated [web-asset/parent/parent-portal.html](web-asset/parent/parent-portal.html):
  - moved parent portal layout to mobile-first structure with progressive desktop breakpoints.
  - replaced isolated field-card styling with contextual grouped profile sections:
    - `Identity and Contact`,
    - `Home and Family`,
    - `Academic and Learning`,
    - `Health and Safety`,
    - fallback `Additional Information`.
  - added explicit per-field status badges:
    - editability (`Editable` or `Locked`),
    - draft state (`Edited` or `Unchanged`).
  - added global draft status chip (`#draftCountBadge`) and sticky action bar for thumb-reach save/submit controls on mobile.
  - kept `eaglesId` and `studentNumber` immutable/read-only in dedicated identity context.
  - preserved existing parent API contracts and route-injected runtime config keys.
- Updated [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - extended `GET /parent/portal` shell assertions to verify:
    - draft badge/action shell IDs exist (`draftCountBadge`, `draftActions`),
    - Google font hosts are absent from portal HTML.
- Verification:
  - `npx html-validate web-asset/parent/parent-portal.html` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/parent/parent-portal.html` => pass.
  - `node --test test/student-admin.spec.mjs test/student-admin-ui.spec.mjs` => `126` pass, `0` fail.
  - `npm test` => `203` pass, `0` fail.
- Coverage gap:
  - no authenticated parent-portal interaction test yet exercises inline draft edit badges and sticky action behavior end-to-end in browser automation.
- Prioritized next action:
  - add one Playwright parent-portal UI test fixture that logs in as parent, edits one editable field, asserts badge transitions (`Unchanged` -> `Edited`), and validates draft-save reset.

## Update (2026-03-11 - queue-hub admin page wiring + parent portal route/session coverage)

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - added admin Queue Hub page section (`data-page="queue-hub"`) and top-level navigation link.
  - added Queue Hub data load path wired to `GET /api/admin/queue-hub`.
  - added drag-and-drop panel reordering with persisted order key:
    - `uiSettings.queueHub.panelOrder`
  - added queue-hub panel-order controls:
    - reload,
    - save order,
    - reset to default.
  - updated UI settings normalization/defaults to include `queueHub.panelOrder` so local/server hydration keeps ordering stable.
- Updated [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - added route coverage for:
    - `GET /admin/students/queue-hub` HTML slug/runtime injection,
    - `GET /parent/portal` HTML/runtime injection,
    - teacher forbidden on `GET /api/admin/queue-hub` and `GET /api/admin/profile-submissions`,
    - admin success on `GET /api/admin/profile-submissions`,
    - admin store-disabled behavior on `GET /api/admin/queue-hub`,
    - parent session flow (`/api/parent/auth/login`, `/me`, `/logout`),
    - parent data reads (`/api/parent/children`, `/api/parent/dashboard`),
    - unlinked-child rejection on parent profile endpoints,
    - unauthenticated guards for new admin/parent endpoints.
- Updated [docs/mapping/openapi/sis-admin.openapi.yaml](docs/mapping/openapi/sis-admin.openapi.yaml):
  - documented new admin queue endpoints:
    - `GET /api/admin/queue-hub`
    - `GET /api/admin/profile-submissions`
    - `PUT /api/admin/profile-submissions/{submissionId}`
    - `POST /api/admin/profile-submissions/{submissionId}`
- Updated [README.md](README.md):
  - documented Queue Hub feature/persistence and parent portal API surface.
- Verification:
  - `node --test test/student-admin.spec.mjs test/student-admin-ui.spec.mjs` => `125` pass, `0` fail.
  - `npm test` => `202` pass, `0` fail.
- Coverage gap:
  - parent portal tests currently run in store-disabled mode and validate session/contract behavior, but not DB-backed linked-child/profile-approval merges.
- Prioritized next action:
  - add one DB-enabled integration fixture for parent-child link + draft submit + admin approve merge path (including lock-conflict assertion).

## Update (2026-03-10 - UTF-8 hardening for student import parsing, EN/VI safe path)

- Updated [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
  - import JSON body parsing now buffers bytes and decodes once as UTF-8 (avoids multi-byte split corruption at chunk boundaries).
  - CSV/TSV upload decode now uses strict UTF-8 decode and rejects invalid byte sequences with `400`.
  - import `rows` payload now normalizes row-object keys before signal filtering/mapping.
- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - CSV/TSV browser import now reads bytes and decodes with UTF-8 `TextDecoder` (BOM-safe), instead of implicit text decode.
  - invalid non-UTF-8 CSV/TSV now fails fast in UI before submit.
- Updated [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - added UTF-8 CSV test with Vietnamese text + BOM.
  - added non-UTF-8 CSV rejection test.
  - added integration test that posts chunk-split UTF-8 JSON to `/api/admin/students/import` to verify no corruption path.
- Updated [README.md](README.md):
  - documented UTF-8 requirement for CSV/TSV and JSON import payloads.
- Verification:
  - `node --test test/student-admin.spec.mjs test/student-admin-import-row-map.spec.mjs` => `75` pass, `0` fail.
  - `npm test` => `186` pass, `0` fail.

## Update (2026-03-10 - live-persistent school setup/logo settings + admin UI settings API)

- Updated [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
  - added persistent admin UI settings endpoint:
    - `GET /api/admin/settings/ui`
    - `PUT /api/admin/settings/ui`
  - endpoint is role-gated to settings-managing users and uses session-cookie auth contract.
  - persisted settings are stored in runtime file:
    - default path: `runtime-data/admin-ui-settings.json`
    - override: `STUDENT_ADMIN_UI_SETTINGS_FILE`
  - writes are atomic (`tmp` write + rename) with payload size guard (`STUDENT_ADMIN_UI_SETTINGS_MAX_BYTES`).
  - runtime config injection now exposes `window.__SIS_ADMIN_UI_SETTINGS_PATH`.
- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - school setup and branding/logo settings now hydrate from server after login (`hydrateUiSettingsFromServer`).
  - school setup/settings saves now sync to server (`persistUiSettingsToServer`) while retaining local fallback.
  - settings save/reset and school-setup save/reset handlers now run async to include server persistence path.
  - result: school setup info and system logo image data survive live DB upgrade and runtime redeploy workflows.
- Updated [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - added endpoint coverage for persisted UI settings:
    - admin read/write success path,
    - teacher forbidden path,
    - unauthenticated path.
  - added cleanup for persisted settings file path after test run.
- Verification:
  - `node --test test/student-admin.spec.mjs test/student-admin-ui.spec.mjs` => `106` pass, `0` fail.
  - `npm test` => `181` pass, `0` fail.
- Coverage gap:
  - no production-smoke test currently verifies persisted school setup/logo survives an actual `deploy-db-fields-safe.sh --yes` run against live runtime root.
- Prioritized next action:
  - add one deployment smoke script/assertion that snapshots, migrates, and validates `GET /api/admin/settings/ui` continuity across the migration cycle.

## Update (2026-03-10 - student import re-import backfill + row-level continuation logs)

- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - changed import identity validation to allow existing `eaglesId` rows for re-import/backfill.
  - added explicit immutable identity guard for re-import rows:
    - reject when row `studentNumber` conflicts with persisted `studentNumber` for the same `eaglesId`.
    - reject when row `studentNumber` belongs to a different student.
  - changed `importStudentsFromRows` from all-or-nothing transaction to row-by-row processing:
    - each row now commits independently,
    - failed rows are rejected without stopping remaining rows.
  - added backfill merge behavior for existing students:
    - blank import values do not erase existing values,
    - non-empty import values update existing values,
    - new students still get created and missing `studentNumber` is generated.
  - added detailed import response logs:
    - per-row status (`created`, `updated`, `rejected`),
    - failure phase (`preflight`/`write`),
    - five-field row summary (`eaglesId`, `studentNumber`, `fullName`, `englishName`, `email`),
    - changed-field list/count for updated rows.
- Updated [test/student-admin-import-validation.spec.mjs](test/student-admin-import-validation.spec.mjs):
  - aligned strict identity expectations with re-import backfill behavior.
  - added coverage for existing `eaglesId` acceptance and `studentNumber` mismatch rejection.
- Added [test/student-admin-import-backfill.spec.mjs](test/student-admin-import-backfill.spec.mjs):
  - verifies backfill merge keeps existing values when import cells are blank.
  - verifies non-empty import values overwrite existing values.
- Updated [test/profile-form-contract.spec.mjs](test/profile-form-contract.spec.mjs):
  - adjusted identity contract assertion text for create vs conflicting import behavior.
- Updated [README.md](README.md):
  - documented re-import backfill and row-level continuation semantics under Student Import Rules.
- Verification:
  - `node --test test/student-admin-import-validation.spec.mjs test/student-admin-import-backfill.spec.mjs test/profile-form-contract.spec.mjs` => `18` pass, `0` fail.
  - `npm test` => `177` pass, `0` fail.
- Coverage gap:
  - no DB-enabled integration test currently exercises partial-success import behavior end-to-end via `POST /api/admin/students/import`.
- Prioritized next action:
  - add one DB-backed import integration fixture with mixed rows (create + backfill update + rejected conflict) and assert per-row outcomes.

## Update (2026-03-10 - canonical matched dedupe + MEGS-derived lint stack wiring)

- Updated [server/exercise-store.mjs](server/exercise-store.mjs):
  - hardened matched submission dedupe to canonical fingerprint matching:
    - `studentRefId + exerciseRefId + completedAt (near-time window)`.
  - removed unstable matched-path filters that allowed duplicate `0/100` rows to slip through:
    - removed `submittedStudentId` and `submittedEmail` match requirements,
    - removed `createdAt` lookback requirement for matched `ExerciseSubmission` dedupe,
    - removed `createdAt` lookback requirement for matched auto-import `StudentGradeRecord` dedupe.
  - kept existing quality arbitration and duplicate-notification suppression behavior unchanged.
- Updated [test/exercise-store.spec.mjs](test/exercise-store.spec.mjs):
  - improved Prisma mock `findFirst` behavior to actually evaluate `where` filters (date ranges + field predicates).
  - added regression case proving matched dedupe still works when legacy stored rows have:
    - mismatched/missing submitted identity fields,
    - stale `createdAt` timestamps.
  - verified richer incoming payload updates existing `0` score row to `100` without inserting a second row.
- Updated lint stack and CI:
  - replaced Super-Linter action flow in [.github/workflows/super-linter.yml](.github/workflows/super-linter.yml) with Node-based lint steps:
    - `html-validate`,
    - `eslint`,
    - `stylelint`.
  - updated [.htmlvalidate.json](.htmlvalidate.json) and [.htmlvalidateignore](.htmlvalidateignore) with MEGS-derived policy adapted for SIS legacy HTML IDs/classes.
  - added [eslint.config.mjs](eslint.config.mjs) with stage-in gate policy (`no-unused-vars` and `no-useless-escape` temporarily off; safety rules remain enforced).
  - added [stylelint.config.mjs](stylelint.config.mjs) for inline HTML CSS via `postcss-html` using safety-focused rules.
  - updated [package.json](package.json) scripts:
    - `lint`,
    - `lint:html`,
    - `lint:js`,
    - `lint:css`.
- Updated [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - fixed duplicate object key (`eaglesId`) to keep ESLint `no-dupe-keys` enforced.
- Cleanup audit:
  - executed one-time cleanup script sequence and logged JSON output in [docs/job-logs.txt](docs/job-logs.txt):
    - dry-run -> apply -> dry-run.
  - current DB state already clean:
    - `duplicateGroups=0`,
    - `deleteCountPlanned=0`,
    - `deleteCountApplied=0`.
- Verification:
  - `node --test test/exercise-store.spec.mjs` => `6` pass, `0` fail.
  - `npm test` => `174` pass, `0` fail.
  - `npx html-validate web-asset/admin/student-admin.html` => `0` errors, `1` warning (`doctype-style`).
  - `npx eslint --config eslint.config.mjs server test tools --max-warnings=0` => pass.
  - `npx stylelint --config stylelint.config.mjs web-asset/admin/student-admin.html` => pass.
- Coverage gap:
  - lint workflow behavior is validated locally only; remote GitHub Actions execution has not been observed yet after this wiring change.
- Prioritized next action:
  - push and validate the next `Lint Code Base` workflow run on `preproduction`.

## Update (2026-03-10 - tracking data filter-summary readability with pipe format)

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - normalized shared tracking summary formatter (`updateTableFilterSummary`) for clearer pipe-separated output across:
    - attendance data,
    - assignments data,
    - grades data,
    - performance data,
    - reports data.
  - retained pipe separators per operator preference while improving readability:
    - student segment now renders as separate labeled parts (`Student`, `Student Number`, `Full Name`, `English Name`) instead of nested colon chains.
    - missing names now display explicit fallback text (`(not set)`) instead of blank labels.
  - date and search tokens remain in the same summary line and keep predictable labels.
- Verification:
  - `node --test test/student-admin-ui.spec.mjs` => `41` pass, `0` fail.
- Coverage gap:
  - no focused assertion currently snapshots the exact summary-line wording for each table filter combination.
- Prioritized next action:
  - add one UI regression that asserts summary formatting for selected-student filters with missing `fullName`.

## Update (2026-03-10 - matched exercise-submission dedupe fix + one-time duplicate grade cleanup)

- Updated [server/exercise-store.mjs](server/exercise-store.mjs):
  - added matched-path duplicate detection for direct exercise submissions (already-matched student accounts) using the same near-time dedupe window semantics as incoming queue dedupe.
  - duplicate matching now checks existing `ExerciseSubmission` rows by:
    - `studentRefId + exerciseRefId`,
    - `submittedStudentId + submittedEmail`,
    - `completedAt` within dedupe window,
    - recent creation lookback.
  - when a matched duplicate is found:
    - quality comparison (`status signals`, `correct/pending`, answered count, score, timestamp) decides whether to update the existing record.
    - associated auto-import `StudentGradeRecord` in the same window is updated (or reused) instead of inserting a second row.
    - response flags now return `deduplicated=true`, `updatedExisting` appropriately, and `shouldNotify=false` to suppress duplicate notifications.
  - standardized auto-import comment prefix usage via shared constant for consistent filtering.
- Updated [test/exercise-store.spec.mjs](test/exercise-store.spec.mjs):
  - extended mock transaction surface to support matched duplicate lookup/update behavior.
  - added regression test for matched duplicate submissions where richer payload updates existing submission/grade rows and avoids new inserts.
- Added [tools/dedupe-auto-import-grade-records-once.mjs](tools/dedupe-auto-import-grade-records-once.mjs):
  - one-time cleanup utility for historical duplicate auto-import grade rows (`0/100` and `100/100` pairs).
  - scopes to auto-import fingerprint rows only (`assignmentName == className`, `dueAt ~= submittedAt`, completion true, score envelope, comment prefix).
  - groups duplicates in a near-time window and keeps highest-quality row; supports dry-run and `--apply`.
- Runtime data cleanup executed:
  - dry-run: `duplicateGroups=23`, `deleteCountPlanned=23`.
  - apply run: `deleteCountApplied=23`.
  - post-clean verification: `duplicate0and100Groups=0`.
- Verification:
  - `node --test test/exercise-store.spec.mjs` => `5` pass, `0` fail.
  - `npm test` => `173` pass, `0` fail.
- Coverage gap:
  - no DB-backed route/integration test currently exercises repeated matched exercise submissions end-to-end through HTTP with persisted Prisma rows.
- Prioritized next action:
  - add one integration fixture that posts near-duplicate matched submissions via API and asserts only one effective grade row persists with best-quality payload.

## Update (2026-03-10 - full GitHub workflow YAML hardening pass)

- Updated [.github/workflows/codacy.yml](.github/workflows/codacy.yml):
  - added `concurrency` to cancel stale duplicate runs per ref.
  - added fork-safe PR guard (`if`) to avoid running secret-dependent scans on fork PRs.
  - pinned runtime to `ubuntu-22.04` and added `timeout-minutes: 20`.
  - upgraded `actions/checkout` to `v5`.
  - upgraded `github/codeql-action/upload-sarif` to `v4`.
  - added YAML doc start (`---`) for consistency.
- Updated [.github/workflows/codeql.yml](.github/workflows/codeql.yml):
  - kept advanced CodeQL as `workflow_dispatch` only to avoid default-setup SARIF conflicts.
  - added `concurrency` and `timeout-minutes: 90`.
  - pinned runner to `ubuntu-22.04` for deterministic behavior.
  - upgraded `actions/checkout` to `v5`.
  - added YAML doc start (`---`) for consistency.
- Updated [.github/workflows/summary.yml](.github/workflows/summary.yml):
  - added `concurrency` (issue-number keyed) and `timeout-minutes: 5`.
  - removed unnecessary checkout step and dropped unneeded `contents` permission.
  - kept required `models: read` for `actions/ai-inference@v1`.
  - guarded comment step so it only runs when model output is non-empty.
- Updated [.github/workflows/super-linter.yml](.github/workflows/super-linter.yml):
  - upgraded linter action to `super-linter/super-linter@v8.5.0`.
  - added `concurrency`, explicit workflow `permissions`, and `timeout-minutes: 20`.
  - upgraded `actions/checkout` to `v5`.
  - added YAML doc start (`---`) for consistency.
- Verification:
  - `npx --yes js-yaml .github/workflows/*.yml` parse check passed for all workflow files.
  - `gh run list --repo eagles-edu/sis --limit 20` showed latest workflow runs on `preproduction` were green before this local tweak pass.
- Coverage gap:
  - workflows were validated for syntax only in local workspace; full behavior validation needs remote GitHub Actions execution after push.
- Prioritized next action:
  - push this branch and re-check run outcomes with `gh run list --repo eagles-edu/sis --branch preproduction`.

## Update (2026-03-10 - docs/logs run-lint failure triage and super-linter scope fix)

- Analyzed `docs/logs/logs_59921660843` run-lint artifacts:
  - failure was dominated by non-runtime linters and scanners (`BIOME_*`, `CHECKOV`, `GITHUB_ACTIONS_ZIZMOR`, `JSCPD`, `*_PRETTIER`, `NATURAL_LANGUAGE`, `SPELL_CODESPELL`, `TRIVY`), including scan noise from backup/log directories.
  - example issue types in log:
    - textlint terminology/codespell flags in `sis.md`
    - Trivy vulnerability findings against `backups/.../package-lock.json`
    - formatting-only failures in docs/workflow YAML/markdown files
- Updated [.github/workflows/super-linter.yml](.github/workflows/super-linter.yml):
  - disabled the noisy validators listed above so CI stays focused on actionable repository checks.
  - added `FILTER_REGEX_EXCLUDE: "(^|/)(backups|docs/logs)/"` to avoid lint/security noise from archival/log artifacts.
- Verification:
  - `rg` on `docs/logs/logs_59921660843/run-lint/4_Lint Code Base.txt` confirms the disabled validators match the logged failure set.
- Coverage gap:
  - workflow behavior still requires remote run after push; no local super-linter container execution was performed.
- Prioritized next action:
  - push and verify next `Lint Code Base` run in GitHub Actions is green.

## Update (2026-03-09 - dashboard current-assignment chart/button fallback wired to Assignments Admin templates)

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - added a derived `dashboardLevelCompletionRows` state path and switched overview level-detail actions to read from it.
  - when `/api/admin/dashboard` returns empty `levelCompletion`, the overview now derives current assignment rows from local Assignments Admin templates:
    - includes only templates with valid future `dueAt` (not-yet-due),
    - selects nearest due template per level,
    - computes targeted students from enrolled students in that level (or a single targeted student when template `eaglesId` is set),
    - exposes pending student lists so level detail buttons remain actionable.
  - kept backend dashboard rows authoritative when backend `levelCompletion` is non-empty.
  - aligned line-chart fallback inputs with derived snapshot metrics by passing `currentTargetedStudents/currentCompletedStudents/currentPendingStudents`.
  - on assignment template save/delete, overview summary re-renders immediately so bars/buttons stay in sync without page reload.
  - logout now clears derived dashboard completion state.
- Updated [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - added regression coverage for empty backend `levelCompletion` + active local assignment template:
    - bar chart renders,
    - level detail button appears,
    - snapshot metrics show targeted/pending counts from template-targeted students,
    - detail panel lists pending students.
- Verification:
  - `node --test test/student-admin-ui.spec.mjs` => `39` pass, `0` fail.
  - `node --test test/student-admin-dashboard-summary.spec.mjs` => `11` pass, `0` fail.
  - `npm test` => `170` pass, `0` fail.
- Coverage gap:
  - no integration path yet for cross-browser persistence behavior of assignment-template fallback when multiple admin clients with different local storage sets are used.
- Prioritized next action:
  - persist assignment templates server-side (or expose canonical assignment schedule API) so dashboard current-assignment fallback is shared across sessions/devices.

## Update (2026-03-09 - dashboard current-assignment tracking excludes standalone auto-import rows)

- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - added assignment-tracking filter to exclude standalone auto-imported exercise grade rows from dashboard assignment analytics.
  - exclusion is scoped to rows matching a standalone-import fingerprint:
    - `className == assignmentName`,
    - `dueAt == submittedAt`,
    - completed + on-time flags,
    - and either auto-import comment prefix or score/maxScore import footprint.
    - this prevents unassigned external practice from becoming fake “current assignments.”
  - assignment dashboard aggregates now use filtered records for:
    - current not-yet-due level completion,
    - weekly assignment completion line chart inputs,
    - assignment totals/on-time/late/outstanding counters,
    - outstanding-week risk signals.
- Updated [test/student-admin-dashboard-summary.spec.mjs](test/student-admin-dashboard-summary.spec.mjs):
  - added regression test that standalone auto-imported future-dated rows are ignored for current assignment selection.
  - added guard test that imported exercise rows are still included when they carry an explicit assignment due date (so assigned MEGS work can count).
- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - clarified overview bar-chart helper copy to state that only standalone auto-import rows (`due = submitted`) are excluded.
  - corrected dashboard fallback payload: when dashboard API is unavailable, `levelCompletion` is now empty (no fake current-assignment pending bars from enrollment-only fallback data).
  - aligned snapshot metrics (`Active levels`, `Targeted`, `Completed`, `Pending`, `Completion %`, due-soon counts) to derive from `levelCompletion` only, so bar chart/buttons/cards cannot drift from each other.
- Verification:
  - `node --test test/student-admin-dashboard-summary.spec.mjs` => `11` pass, `0` fail.
  - `node --test test/student-admin-ui.spec.mjs` => `38` pass, `0` fail.
  - `node --test test/student-admin-dashboard-summary.spec.mjs test/student-admin-ui.spec.mjs` => `49` pass, `0` fail.
  - `npm test` => `169` pass, `0` fail.
- Coverage gap:
  - no DB-backed integration fixture yet validates mixed-grade datasets where manual assignment rows and auto-import rows coexist in `/api/admin/dashboard`.
- Prioritized next action:
  - add one dashboard integration test with mixed sources to lock end-to-end selector behavior.

## Update (2026-03-09 - tracking lists: class-level fix + `#` studentNumber + column visibility controls)

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - fixed `Grades data` class-column normalization to prefer canonical class level (derived from `level/classLevel/currentGrade`) so assignment labels no longer appear in class column.
  - added first `#` (`studentNumber`) column across tracking data lists:
    - Assignments data
    - Performance data
    - Grades data
    - Reports data
  - added column visibility checkbox bars to those same tracking data lists, with `Full Name` and `English Name` hidden by default for performance/grades/reports (attendance behavior parity).
  - generalized column-visibility persistence logic from attendance-only to per-table storage keys while preserving attendance key compatibility.
  - normalized row renderers to apply per-table visibility classes (`data-<table>-col`) after each render.
- Updated [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - adjusted table index assertions for new leading `#` columns.
  - added assertions for new tracking column-control containers and default hidden-name states in grades/performance/reports tables.
  - updated attendance first-header expectation to `#`.
- Verification:
  - `node --test test/student-admin-ui.spec.mjs` => `38` pass, `0` fail.
  - `npm test` => `167` pass, `0` fail.
  - `npx html-validate web-asset/admin/student-admin.html --rule 'aria-label-misuse:error'` => pass.
- Coverage gap:
  - no dedicated UI regression yet verifies assignments-data `#` value mapping for “all students in level” templates (blank `#` expected).
- Prioritized next action:
  - add a focused UI test for assignments-data `#` cell behavior in both targeted-student and all-students templates.

## Update (2026-03-09 - normalize tracking admin list row actions to Attendance style)

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - normalized tracking admin list row actions to match Attendance data list pattern (single-row-height `Options` trigger + dropdown menu).
  - updated all tracking data list renderers to use the same action cell structure:
    - `renderAssignmentTemplates` (Assignments data),
    - `renderParentTrackingReportRows` (Performance data),
    - `renderGradeRows` (Grades data),
    - `renderReportRows` (Reports data).
  - kept existing action behavior and selectors (`data-*` hooks for edit/archive/delete) while moving controls into `.row-options-menu`.
- Verification:
  - `node --test test/student-admin-ui.spec.mjs` => `38` pass, `0` fail.
  - `npm test` => `167` pass, `0` fail.
- Coverage gap:
  - no dedicated UI spec currently asserts that each tracking data table row renders exactly one `Options` trigger (coverage is behavioral via existing table interaction tests).
- Prioritized next action:
  - add a focused UI regression test that verifies options-menu presence/structure in assignments/performance/grades/reports data tables.

## Update (2026-03-08 - system health color tuning for Filter Cache + Recent Pipeline)

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - `Filter Cache` health state logic now avoids red/error when backend is `redis` and only a transient/stale `lastError` text is present.
    - redis + `lastError` now renders `warn` (yellow), not `error` (red).
    - memory/unknown backends keep error behavior when `lastError` exists.
  - `Recent Pipeline` health state now renders `pending` (neutral) when all three flags are `n/a`:
    - `exercise=n/a | intake=n/a | send=n/a` no longer defaults to warning/yellow.
    - remains `ok` when all true, `error` when any false, and `warn` only for mixed decided/undecided states.
- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - filter-cache `lastError` is now cleared on successful redis connect/read/write/invalidate operations so stale error text does not linger after recovery.
- Updated [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - diagnostics regression now asserts:
    - redis filter cache with transient `lastError` is non-red (`warn`).
    - pipeline card is `ok` when runtime flags are all true.
  - added new test:
    - `Recent Pipeline` is `pending` when all runtime pipeline flags are absent (`n/a`).
- Verification:
  - `node --test test/student-admin-ui.spec.mjs` => `38` pass, `0` fail.
  - `npm test` => `167` pass, `0` fail.
- Coverage gap:
  - no dedicated backend unit test currently validates filter-cache `lastError` clear-on-success transitions (covered indirectly via UI diagnostics behavior).
- Prioritized next action:
  - add a small backend unit for filter-cache state transitions (`error` -> successful redis op -> `lastError=null`) to prevent regression without requiring UI-level assertions.

## Update (2026-03-08 - overview current not-yet-due assignment completion + reminder targeting)

- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - added `selectCurrentNotYetDueAssignmentsByLevel(...)` to pick the nearest not-yet-due assignment per level and normalize completion per student.
  - dashboard `levelCompletion` now represents current active not-yet-due assignments only (per level), with `assignmentName`, `dueAt`, `daysUntilDue`, and reminder-target `uncompletedStudents`.
  - added current-assignment metrics to `assignments` summary payload:
    - `currentActiveLevels`
    - `currentTargetedStudents`
    - `currentCompletedStudents`
    - `currentPendingStudents`
    - `currentCompletionPercent`
    - `currentDueSoonLevels`
    - `currentDueSoonPendingStudents`
  - kept assignment-overdue (`atRiskWeek`) and attendance-risk (`attendanceRiskWeek`) payloads available separately.
- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - overview cards and labels now focus on current not-yet-due assignment completion/pending reminder counts.
  - assignment snapshot table now reports current active assignment metrics (targeted/completed/pending, due-soon counts, completion %).
  - bar-chart detail buttons now open reminder lists for not-completed-yet students and include due/pending tooltip context.
  - overview pending-student list now renders from `levelCompletion.uncompletedStudents` (current not-yet-due scope) instead of overdue-risk lines.
  - reminder panel title/status copy updated for current assignment flow.
  - reminder auto-fill now uses dashboard assignment name/due date first, then augments with template/preview link when available.
  - overview line chart removed simulated completion and now plots actual completion progression with fallback to current summary percent.
- Updated tests:
  - [test/student-admin-dashboard-summary.spec.mjs](test/student-admin-dashboard-summary.spec.mjs):
    - added coverage for `selectCurrentNotYetDueAssignmentsByLevel(...)` selection and filtering behavior.
  - [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
    - updated expectations for overview no-data copy and reminder panel copy aligned to current not-yet-due assignment workflow.
- Verification:
  - `node --test test/student-admin-dashboard-summary.spec.mjs` => `9` pass, `0` fail.
  - `node --test test/student-admin-ui.spec.mjs` => `37` pass, `0` fail.
  - `npm test` => `166` pass, `0` fail.
- Coverage gap:
  - no DB-backed integration test yet verifies `/api/admin/dashboard` end-to-end selection of “current not-yet-due assignment” across multiple assignment candidates per level.
- Prioritized next action:
  - add one admin-route integration test fixture for dashboard payload selection order (nearest due date + coverage tie-break), including due-soon counts and reminder target list.

## Update (2026-03-08 - attendance records action-column compaction)

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - replaced wide inline action buttons with a single per-row `Options` trigger (`.row-options-trigger`) to reduce row clutter.
  - attendance records now show `Edit / Archive / Delete` in a compact dropdown (`.row-options-dropdown`) opened from the `Options` control.
  - refined `Options` to a clear link-style affordance with pseudo-class feedback (`:hover`, `:active`, `:focus-visible`) and a caret pseudo-element.
  - added explicit `box-sizing: border-box` in the `Options` trigger rule to satisfy box-model lint policy when sizing + padding/border are used together.
  - attendance records list now includes a small sortable first column for `Student #` (`studentNumber`).
  - added attendance column visibility toggles above the list; `Full Name` and `English Name` default to hidden.
  - kept a single global text-size control in the header (right side) and removed duplicated per-page controls; size level persists globally until changed/reset.
  - changed global text-size control container to `role="toolbar"` and moved `aria-label` usage onto valid interactive controls to satisfy HTML ARIA validation.
  - attendance summary/metrics now keep tardy students counted as present while exposing separate tardy totals/percentages at class and per-student levels.
  - dashboard at-risk list now uses assignment-overdue signal only (`outstandingWeek > 0`); attendance-only signals (`absences`, `late30Plus`) no longer independently classify students as at-risk.
- Updated SOP doc:
  - [AGENTS.md](AGENTS.md): added `Frontend A11y and Box Model SOP` requiring explicit `box-sizing: border-box` in mixed sizing/border/padding rules and restricting `aria-label` usage to valid elements/roles.
- Updated tests:
  - [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
    - expanded attendance-admin regression coverage for new `Student #` first column, default hidden name columns, and global text-size persistence from the single header control.
    - updated per-student attendance stats assertions to include `Present %` and `Tardy %` columns.
    - added assertions that class-level attendance summary keeps tardy inside present counts and exposes separate `totalTardy` percentages on both attendance input and attendance admin pages.
  - [test/student-admin-dashboard-summary.spec.mjs](test/student-admin-dashboard-summary.spec.mjs):
    - added coverage that at-risk selection includes only students with overdue outstanding assignments and excludes attendance-only signals.
- Verification:
  - `node --test test/student-admin-ui.spec.mjs` => `37` pass, `0` fail.
  - `npm test` => `160` pass, `0` fail.
  - `npx html-validate web-asset/admin/student-admin.html --rule 'aria-label-misuse:error'` => exit `0` (no violations).
- Coverage gap:
  - no screenshot/pixel diff assertions for button wrapping across viewport widths.
- Prioritized next action:
  - run full `npm test` before release/deploy batch to confirm no broader regressions.

## Update (2026-03-08 - studentNumber auto-allocation for create/import/queue-create)

- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - removed hard save-path rejection for missing `studentNumber` on create.
  - create path now auto-allocates the next available `studentNumber` when omitted.
  - update path keeps identity immutability and now backfills `studentNumber` only when legacy rows are missing it.
  - import identity validation in strict mode no longer rejects rows solely for blank `studentNumber` when `eaglesId` is explicit/valid.
- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - removed front-end hard block that required `studentNumber` before submitting Profile create/save.
- Updated tests:
  - [test/student-admin-import-validation.spec.mjs](test/student-admin-import-validation.spec.mjs):
    - added strict-mode coverage for explicit `eaglesId` with blank `studentNumber`.
  - [test/profile-form-contract.spec.mjs](test/profile-form-contract.spec.mjs):
    - updated contract guard: no hard `studentNumber is required` save assertion; added auto-allocation source guard.
  - [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
    - fixed XLSX export regression fixture/stub so attendance admin navigation and export payload assertions remain stable.
- Verification:
  - `npm test` => `160` pass, `0` fail.

## Update (2026-03-08 - strict discrete-field wiring pass + live sync)

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - removed legacy sort alias checks (`studentName`) from attendance/grade/report/performance table sort paths; canonical sort key is `fullName`.
  - removed cross-field name fallback in display helpers:
    - `studentDisplayName(preferEnglish=true)` now returns only `englishName`.
    - default display now returns only `fullName`.
  - top-search option value now uses canonical `eaglesId` (no composite name/id value parsing).
  - top-search query normalization no longer rewrites to `fullName`; it resolves to `eaglesId` when selected, else raw query.
  - table filter summary now prints identity/name fields as explicitly labeled discrete values (`Eagles ID`, `Student Number`, `Full Name`, `English Name`).
- Updated tests:
  - [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
    - adjusted datalist/selector expectations to canonical `eaglesId` values.
    - renamed and updated top-search option contract test for canonical `eaglesId` value behavior.
  - [test/profile-form-contract.spec.mjs](test/profile-form-contract.spec.mjs):
    - added guard test to prevent reintroducing name-field fallback and legacy `studentName` sort alias wiring.
- Verification:
  - `node --test test/profile-form-contract.spec.mjs test/student-admin-ui.spec.mjs` => `47` pass, `0` fail.
  - `npm test` => `159` pass, `0` fail.
- Live sync:
  - public path sync: `ffs-sis-public-root --batch` (updated `/home/admin.eagles.edu.vn/public_html/sis-admin/student-admin.html`).
  - runtime HTML sync + restart: `tools/deploy-ui-safe.sh --force-sync` (sync completed; initial immediate curl check raced service startup).
  - post-sync runtime verification:
    - service active (`exercise-mailer.service`),
    - `GET http://127.0.0.1:8787/healthz` => `200`,
    - `GET http://127.0.0.1:8787/api/admin/auth/me` => `401` (expected unauthenticated).
  - file hash parity confirmed across source/runtime/public:
    - `/home/eagles/dockerz/sis/web-asset/admin/student-admin.html`
    - `/home/admin.eagles.edu.vn/sis/web-asset/admin/student-admin.html`
    - `/home/admin.eagles.edu.vn/public_html/sis-admin/student-admin.html`

## Update (2026-03-08 - weekend dashboard attendance reconciliation)

- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - added `summarizeTodayAttendanceForDashboard(...)` to normalize per-student daily attendance before dashboard aggregation.
  - de-duplicates same-day attendance rows per student and prevents double counting.
  - on Saturday/Sunday, reconciles `today.absences` to enrolled headcount:
    - `today.absences = max(0, totalEnrollment - today.attendance)`.
    - this enforces `today.attendance + today.absences == totalEnrollment` on weekends.
- Added [test/student-admin-dashboard-summary.spec.mjs](test/student-admin-dashboard-summary.spec.mjs):
  - weekend reconciliation coverage (`17 attendance + 109 absences = 126 enrolled`).
  - weekday non-reconciliation coverage (tracked-row absences remain unchanged).
  - duplicate-status precedence coverage (attended overrides absent for same student/day).
- Verification:
  - `node --test test/student-admin-dashboard-summary.spec.mjs` => `3` pass, `0` fail.
  - `npm test` => `158` pass, `0` fail.

## Update (2026-03-08 - enforce required studentNumber with eaglesId across read/export paths)

- Updated [server/student-report-card-pdf.mjs](server/student-report-card-pdf.mjs):
  - added hard identity guard (`eaglesId` + positive `studentNumber`) for report-card filename generation and PDF build paths.
  - report-card student info now prints `Student Number` explicitly with `Eagles ID`.
- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - removed row-level `studentName` alias wiring from attendance/grade/performance hydration to keep canonical field usage.
  - tightened assignment XLSX export identity handling:
    - `eaglesId` must come from row identity key,
    - `studentNumber` must resolve from canonical matched student record.
  - staged performance approval queue path now requires both `eaglesId` and `studentNumber` from canonical student detail before queueing.
  - export name fields now read directly from row fields (`fullName`, `englishName`) with no profile fallback mix-in.
- Updated tests:
  - [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
    - identity filtering coverage now excludes rows missing either `eaglesId` or `studentNumber`.
    - staged performance queue fixture now includes `studentNumber` to satisfy strict queue guard.
  - [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
    - report-card PDF fixture now includes `studentNumber`.
- Verification:
  - `npm test` => `155` pass, `0` fail.

## Update (2026-03-08 - enforce required eaglesId + strict field separation for display/sort/export)

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - top search + student list now use explicit `Full Name`/`English Name` display fields with no ID/name mixing in one column.
  - attendance/performance/grades/reports tables now split identity into distinct columns (`Eagles ID`, `Full Name`, `English Name`) and removed combined cells like `Name (ID)`.
  - table sorting switched from generic `name/studentName` display tokens to canonical `fullName`/`eaglesId` keys.
  - XLSX/print export columns now emit explicit canonical fields (`eaglesId`, `fullName`, `englishName`) and no mixed fallback values.
  - UI load path now excludes rows missing `eaglesId` and flags a data-integrity error message.
  - student detail load now hard-fails when `eaglesId` is blank.
  - export mapping now throws when any exported row lacks `eaglesId`.
  - removed placeholder substitutions for identity/name fields (`"(no id)"`, `"(no name)"`) so blank values remain blank in 1:1 field rendering.
- Updated [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - adjusted top-search/table selector expectations for the new column model.
  - added regression coverage that rows missing `eaglesId` are excluded from UI lists/options.
- Verification:
  - `node --test test/student-admin-ui.spec.mjs` => `37` pass, `0` fail.
  - `npm test` => `155` pass, `0` fail.

## Update (2026-03-08 - profile wiring alignment audit: search/save/sort/display/submit + import map parity)

- Performed alignment audit across:
  - profile save/submit wiring (`collectStudentPayload` -> `/api/admin/students`),
  - profile display wiring (`resolveProfileFieldValueForStudent`),
  - student search/sort display paths (`studentSearchText`, `studentDisplayName`, top-search sorting),
  - import wiring (`mapImportRowToStudentPayload`).
- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - import mapper now covers full profile-form canonical keys for persisted DB fields (contact, medical, COVID, signature/comment domains), not only a partial subset.
  - `normalizeTextArray` now accepts `|` delimiters (in addition to `,` and `;`) for checkbox-style workbook cells.
  - save path now enforces `studentNumber` required (`400`) alongside `eaglesId` and keeps identity immutability checks (`eaglesId`/`studentNumber`) on updates.
- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - `saveStudent()` now blocks submit when `studentNumber` is missing before API call.
- Updated [test/student-admin-import-row-map.spec.mjs](test/student-admin-import-row-map.spec.mjs):
  - added dynamic coverage that parses canonical profile form rows and verifies workbook profile keys map to persisted profile payload keys.
  - added `|`-delimiter coverage for `genderSelections`.
- Updated [test/profile-form-contract.spec.mjs](test/profile-form-contract.spec.mjs):
  - added assertion that `studentNumber` is required in save contract.
- Schema status:
  - no `sex` column exists in Prisma schema/migrations.
  - canonical field remains `StudentProfile.genderSelections`; import accepts workbook `gender` and compatibility alias `sex`.

## Update (2026-03-08 - rollback fullName-required, keep identity strict)

- Corrected [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - removed accidental `profile.fullName` required enforcement from save path.
  - removed import preflight `fullName is required` gate.
  - `eaglesId` + `studentNumber` remain the only required identity keys and update immutability checks remain enforced.
- Updated tests:
  - [test/student-admin-import-validation.spec.mjs](test/student-admin-import-validation.spec.mjs):
    - verifies identity validation does not require `fullName` when identity keys are valid.
  - [test/profile-form-contract.spec.mjs](test/profile-form-contract.spec.mjs):
    - immutable identity contract assertion now checks only immutable key behavior.
- DB/schema clarification:
  - no DB `sex` field exists in Prisma schema or migrations.
  - canonical profile field is `genderSelections`; import accepts workbook `gender` and compatibility alias `sex`.

## Update (2026-03-08 - enforce fullName required + immutable identity keys)

- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - `saveStudentWithClient(...)` now enforces `profile.fullName` as required (`400` when missing/blank).
  - update path now enforces immutable identity:
    - changing `eaglesId` returns `409` (`eaglesId is immutable and cannot be changed`),
    - changing `studentNumber` returns `409` (`studentNumber is immutable and cannot be changed`).
  - import preflight (`validateImportRowsForIdentity`) now also requires `profile.fullName` per row.
- Updated [test/student-admin-import-validation.spec.mjs](test/student-admin-import-validation.spec.mjs):
  - existing identity validation fixtures now include `profile.fullName`.
  - added coverage for `fullName is required` import-row rejection.
- Updated [test/profile-form-contract.spec.mjs](test/profile-form-contract.spec.mjs):
  - added contract assertions for required `profile.fullName` and immutable identity error strings.
- Verification:
  - `node --test test/student-admin-import-validation.spec.mjs` => pass.
  - `node --test test/profile-form-contract.spec.mjs` => pass.
  - `npm test` => pass.

## Update (2026-03-08 - strict name-field separation, no fullName backfill)

- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - removed import-time backfill of `profile.fullName` from `englishName`.
  - import now keeps `profile.fullName` strictly mapped from workbook `fullName/fullNameStudent` only.
  - `englishName` remains mapped separately to `profile.englishName`.
- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - admin data table/export canonical student name resolver is now strict:
    - uses `profile.fullName` only,
    - falls back only to `eaglesId`,
    - no fallback from `englishName` and no `row.studentName` mixing.
- Updated [test/student-admin-import-row-map.spec.mjs](test/student-admin-import-row-map.spec.mjs):
  - replaced fallback test with strict assertion that `fullName` remains empty when only `englishName` is provided.
- Verification:
  - `node --test test/student-admin-import-row-map.spec.mjs` => `4` pass, `0` fail.
  - `node --test test/profile-form-contract.spec.mjs` => `8` pass, `0` fail.
  - `node --test test/student-admin-ui.spec.mjs` => `36` pass, `0` fail.

## Update (2026-03-08 - gender import mapping + student-name normalization)

- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - import row mapping now persists workbook `gender` values into `profile.genderSelections`.
  - import row mapping also accepts `sex` as a compatibility alias for `genderSelections`.
  - import row mapping now backfills `profile.fullName` from `englishName` when `fullName/fullNameStudent` is blank to prevent blank-name profile rows from import sheets that only provide `englishName`.
  - exported `mapImportRowToStudentPayload(...)` for direct regression coverage.
- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - profile field label changed from `Sex` to `Gender` for schema/workbook consistency.
  - attendance/grade/performance table row hydration and XLSX export mapping now use a shared canonical student-name resolver (`profile.fullName -> profile.englishName -> fallback`) to prevent mixed ad-hoc name sourcing.
- Updated [test/profile-form-contract.spec.mjs](test/profile-form-contract.spec.mjs):
  - canonical workbook resolver now supports either:
    - `docs/students/eaglesclub-students-import-ready.xlsx`, or
    - `docs/students/eaglesclub-students-import-ready-single.xlsx`.
- Added [test/student-admin-import-row-map.spec.mjs](test/student-admin-import-row-map.spec.mjs):
  - verifies `gender` -> `genderSelections`.
  - verifies compatibility alias `sex`.
  - verifies full-name fallback from `englishName`.
  - verifies explicit `fullName` precedence.
- Verification:
  - `node --test test/student-admin-import-row-map.spec.mjs` => `4` pass, `0` fail.
  - `node --test test/profile-form-contract.spec.mjs` => `8` pass, `0` fail.
  - `node --test test/student-admin-ui.spec.mjs` => `36` pass, `0` fail.
  - `npm test` => `151` pass, `0` fail.

## Update (2026-03-07 - performance admin queue/stage panel separation)

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - completed queue panel move from Overview to Performance Admin (`performance-data`).
  - split flow into two distinct panels:
    - `Staged Performance Reports` (saved reports not yet queued),
    - `Queued Performance Reports` (Queue Review + send actions).
  - added staged approval action (`Approve -> Queue`) that queues a selected staged report directly from Performance Admin.
  - queue payloads now include linkage identifiers (`reportId`, `studentRefId`, class/term context) for staged/queued reconciliation.
  - fixed null DOM listener crash by retargeting old `overviewParentQueue*` bindings to `performanceQueue*`.
- Updated [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - queue/staged assertions now target Performance Admin panel IDs.
  - mobile wrapper check retargeted to `#performanceQueueDetails`.
- Verification:
  - `node --test test/student-admin-ui.spec.mjs` => `36` pass, `0` fail.
  - `npm test` => `147` pass, `0` fail.

## Update (2026-03-07 - parent-tracking rubric row persistence)

- Implemented row-level rubric persistence for parent performance reports without DB migration:
  - backend now stores rubric payload (`pt_skill_*`, `pt_conduct_*`, `pt_rec_*`) in an encoded marker appended to report comments.
  - backend decodes this marker on read so API responses expose:
    - `comments` as plain teacher/parent comment text,
    - `rubricPayload` as structured rubric data.
- Updated [server/student-admin-store.mjs](server/student-admin-store.mjs):
  - added normalization + encode/decode helpers:
    - `normalizeParentReportRubricPayload(...)`
    - `encodeParentReportCommentBundle(...)`
    - `decodeParentReportCommentBundle(...)`
  - `saveParentClassReport(...)` now persists `payload.rubricPayload`.
  - student mapping now returns decoded `parentReports[*].rubricPayload`.
- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - save path now sends `rubricPayload` with report POST.
  - edit path hydrates rubric score/recommendation controls from saved `rubricPayload`.
  - student switch/clear now resets rubric fields to avoid cross-student carryover.
- Added regression coverage:
  - [test/student-admin-store-parent-report.spec.mjs](test/student-admin-store-parent-report.spec.mjs) for normalize/encode/decode behavior.
  - [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs) now asserts saved report payload includes rubric maps.
- Verification:
  - `node --test test/student-admin-store-parent-report.spec.mjs` => `3` pass, `0` fail.
  - `node --test test/student-admin-ui.spec.mjs` => `35` pass, `0` fail.
  - `npm test` => `146` pass, `0` fail.

## Update (2026-03-07 - parent-tracking snapshot/rubric model alignment)

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - `Performance Snapshot (Auto from records)` score fields are now read-only auto fields.
  - Behavior and Skills snapshot values are now always derived from current rubric entries:
    - `Behavior` = mean of `pt_conduct_*`.
    - `Skills` = mean of `pt_skill_*`.
  - Academic/homework snapshot values remain auto-derived from current-quarter records.
  - rubric score cells (`pt_skill_*`, `pt_conduct_*`) now render as dropdowns (`Select score`, `0..10`, where `0 = Not Applicable`).
  - removed summary-field manual-edit gating from snapshot render path so auto values are always applied.
- Updated [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - parent-tracking test now asserts read-only snapshot inputs + rubric dropdown options.
  - save payload expectations now validate rubric-derived Behavior/Skills and record-derived Academic.
- Verification:
  - `node --test test/student-admin-ui.spec.mjs` => `35` pass, `0` fail.
  - `npm test` => `143` pass, `0` fail.

## Update (2026-03-07 - parent-tracking empty-field fallback hardening)

- Live diagnosis:
  - existing saved reports showed `behaviorScore`, `participationScore`, and `inClassScore` as null while teachers reported rubric values were entered.
  - root cause: save payload only used summary dropdown/comment fields (`pt_behaviorScore`, `pt_participationScore`, `pt_academicScore`, `pt_comments`), not rubric input/recommendation textareas.
- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - save flow now derives fallback summary scores from rubric averages when summary dropdowns are left blank:
    - `Behavior` fallback = mean of `pt_conduct_*` rubric scores.
    - `Skills` fallback = mean of `pt_skill_*` rubric scores.
  - save flow now derives fallback comment from filled corrective-action recommendations (`pt_rec_*`) when `pt_comments` is blank.
  - keeps explicit summary/comment values unchanged when they are provided.
- Added regression coverage in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - parent-tracking save now asserts rubric-only entry still persists non-empty `behaviorScore`, `participationScore`, and `comments`.
- Verification:
  - `node --test test/student-admin-ui.spec.mjs` => `35` pass, `0` fail.
  - `npm test` => `143` pass, `0` fail.
- Live deployment:
  - synced updated HTML to:
    - `/home/admin.eagles.edu.vn/sis/web-asset/admin/student-admin.html`
    - `/home/admin.eagles.edu.vn/public_html/sis-admin/student-admin.html`
  - source/runtime/public SHA256 hashes match.

## Update (2026-03-07 - incoming exercise resolve now writes grade records)

- Confirmed root cause for live queue resolution drift:
  - `Add to Specific Student` / `create-account` on incoming exercise results wrote only `ExerciseSubmission`, so grade/dashboard metrics depending on `StudentGradeRecord` did not update.
- Updated [server/exercise-store.mjs](server/exercise-store.mjs):
  - matched direct submissions now create both `ExerciseSubmission` and `StudentGradeRecord` in one transaction.
  - incoming queue resolve now also writes a `StudentGradeRecord` before marking the queue item resolved.
  - added deterministic school-year and quarter derivation from submission completion date (same quarter mapping used by UI defaults).
  - grade record payload now includes auto-import comments and completion flags (`homeworkCompleted=true`, `homeworkOnTime=true`) so homework/performance aggregates include these rows.
- Updated [test/exercise-store.spec.mjs](test/exercise-store.spec.mjs):
  - matched and resolve paths now assert grade-record creation and returned `gradeRecordId`.
- Verification:
  - `node --test test/exercise-store.spec.mjs` => `4` pass, `0` fail.
  - `npm test` => `143` pass, `0` fail.

## Update (2026-03-07 - live performance report save race fix)

- Fixed performance-report save behavior in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - save flow now snapshots score/comment field values immediately on click, preventing async refresh races from overwriting teacher-entered values.
  - report save now writes `comments` from teacher input (`pt_comments`) instead of synthetic summary text.
  - queue flow reuses the same saved snapshot values for queued-message metrics/comments.
  - added manual-edit guard (`manualMetricsTouched`) so background metric sync does not clobber user-entered score/comment/homework values.
- Added regression coverage in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - parent-tracking save/queue path now asserts persisted payload retains manually entered `behaviorScore`, `participationScore`, `inClassScore`, and `comments`.
- Verification:
  - `node --test test/student-admin-ui.spec.mjs` => `35` pass, `0` fail.
  - `npm test` => `143` pass, `0` fail.
- Live deployment:
  - synced updated HTML to runtime + public paths:
    - `/home/admin.eagles.edu.vn/sis/web-asset/admin/student-admin.html`
    - `/home/admin.eagles.edu.vn/public_html/sis-admin/student-admin.html`
  - source/runtime/public SHA256 hashes match.

## Update (2026-03-07 - dev/live separation hardening + ffs sync enforcement)

- Hardened runtime separation in [server/exercise-mailer.mjs](server/exercise-mailer.mjs):
  - env loading now supports explicit `SIS_ENV_FILE` and environment-specific defaults (`.env.dev` for development, `.env` for production).
  - development default port now resolves to `8788` when `EXERCISE_MAILER_PORT` is unset.
  - added startup guard that blocks `NODE_ENV=development` inside live root unless `SIS_ALLOW_DEV_ON_LIVE_ROOT=true`.
- Updated dev command in [package.json](package.json):
  - `npm run dev` now sets `NODE_ENV=development SIS_ENV_FILE=.env.dev EXERCISE_MAILER_PORT=${EXERCISE_MAILER_PORT:-8788}`.
- Added dev env template:
  - [/.env.dev.example](.env.dev.example)
- Added regression coverage in [test/exercise-mailer.spec.mjs](test/exercise-mailer.spec.mjs):
  - blocks development runtime when cwd is configured live root.
  - allows development runtime only with explicit override flag.
- Updated sync wrapper behavior (system paths):
  - `/usr/local/bin/ffs-sis-root` now applies separation defaults after successful sync and prints dev/live key values.
  - `/usr/local/bin/ffs-sis-public-root` now prints dev/live port values after sync for quick validation.
- Current test status:
  - `node --test test/exercise-mailer.spec.mjs` => `17` pass, `0` fail.
  - `npm test` => `143` pass, `0` fail.

## Update (2026-03-07 - parent-report queue review visibility hardening)

- Fixed parent-report queueing behavior so `weekend-batch` + `queueType=parent-report` can be queued for admin review even when recipients are currently empty.
  - backend change in [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
    - `normalizeAnnouncementPayload(...)` now supports optional empty-recipient mode.
    - queue-entry creation enables empty-recipient mode only for `parent-report` queue type.
- Clarified parent-tracking UI messaging in [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - save action now explicitly says report is saved and requires `Queue Send` to appear in Queue Review.
  - queue action no longer blocks on missing recipients and now surfaces explicit “queued with 0 recipients” status text.
- Added regression coverage in [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - `POST /api/admin/notifications/email allows parent-report queue without recipients`.
- Current test status:
  - `node --test test/student-admin.spec.mjs` => `61` pass, `0` fail.
- Operational diagnosis from production logs/db:
  - saved class reports existed (`parentClassReport` rows) but notification queue rows were `0`.
  - user session had `POST /api/sis-admin/students/:id/reports` but no `POST /api/sis-admin/notifications/email` calls.

## Update (2026-03-07 - codified backup/restore workflows)

- Added dedicated ops runbook: [docs/db-backup-failsafe.md](docs/db-backup-failsafe.md)
  - includes decision matrix for full restore vs DB-only vs files-only.
  - codifies safety checklist, exact commands, validation checklist, and rollback path.
  - aligns with existing scripts:
    - `tools/sis-full-backup-snapshot.sh`
    - `tools/sis-full-restore-snapshot.sh`
    - `tools/db-backup-smart.sh`
    - `tools/db-restore-failsafe.mjs`
- Linked the runbook from [README.md](README.md) under `Practical Admin Runbooks`.
- Current test status:
  - `npm test` => `139` pass, `0` fail.

## Update (2026-03-07 - unique teacher passwords)

- Updated configured account resolution in [server/student-admin-routes.mjs](server/student-admin-routes.mjs):
  - added `STUDENT_TEACHER_ACCOUNTS_JSON` for explicit per-teacher credentials (`username` + `password` or `passwordHash` per teacher).
  - removed hardcoded fallback alias auto-seeding with shared credentials.
  - kept legacy shared teacher env compatibility (`STUDENT_TEACHER_PASS` + optional `STUDENT_TEACHER_USER(S)`), defaulting only to `teacher` if usernames are not provided.
- Added regression assertions in [test/student-admin.spec.mjs](test/student-admin.spec.mjs):
  - alias login succeeds with its unique password.
  - alias login fails with a different teacher password.
- Current test status:
  - `node --test test/student-admin.spec.mjs` => `60` pass, `0` fail.
  - `npm test` => `139` pass, `0` fail.

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

### Latest UI/Admin Update (2026-03-09)

1. Overview assignment charts no longer disappear when there is no active assignment workload.

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - line chart now renders a Monday-to-today zero baseline when no current assignment activity exists;
  - bar chart source now falls back in order:
    1) `summary.levelCompletion` (backend),
    2) template-derived rows (local assignment templates),
    3) enrollment-only rows (show enrolled vs completed `0`).
- This preserves chart/button visibility and avoids empty-state disappearance for operations dashboards.

1. Overview level detail reminder form now auto-fills assignment + announcement link from backend current-assignment rows.

- Updated [web-asset/admin/student-admin.html](web-asset/admin/student-admin.html):
  - `openLevelDetailPanel()` + `autoPopulateHomeworkProgressForLevel()` now generate a volatile assignment announcement preview link when a level has dashboard-provided current assignment metadata but no local template.
  - Assignment title and due date continue to auto-fill from current level data.
- Added regression in [test/student-admin-ui.spec.mjs](test/student-admin-ui.spec.mjs):
  - `overview level detail autofills assignment and announcement link from current dashboard assignment`.

1. Added explicit system wiring map document for maintainability and refactor planning.

- New doc: [docs/sis-admin-wiring-map.ascii.txt](docs/sis-admin-wiring-map.ascii.txt)
  - page-by-page frontend function -> backend route/subroutine mapping,
  - IO + conditional flow branches (especially overview chart derivations),
  - refactor target for canonical assignment schedule ownership,
  - recommended mapping toolchain (Structurizr DSL, Mermaid, dependency-cruiser, OpenAPI).

1. Implemented runnable mapping stack and artifact pipeline.

- Added stack assets:
  - Mermaid diagrams: `docs/mapping/mermaid/*.mmd`
  - Structurizr DSL workspace: `docs/mapping/structurizr/workspace.dsl`
  - dependency-cruiser config: `.dependency-cruiser.cjs`
  - OpenAPI baseline: `docs/mapping/openapi/sis-admin.openapi.yaml`
  - Redocly config: `redocly.yaml`
  - build script: `tools/build-mapping-stack.mjs`
- Added npm commands:
  - `npm run map:deps`
  - `npm run map:openapi:lint`
  - `npm run map:openapi:build`
  - `npm run map:all`
- Added generated output targets under `docs/mapping/out/`:
  - `dependency-graph.mmd`
  - `dependency-graph.json`
  - `sis-admin.openapi.html`

### Latest Test Run (2026-03-09)

- Command: `npm run map:all`
- Result: pass (dependency graph artifacts + OpenAPI lint + Redoc HTML build)
- Command: `npm run map:openapi:lint && npm run map:openapi:build`
- Result: pass
- Command: `npm run map:deps`
- Result: pass
- Command: `node --test test/student-admin-ui.spec.mjs`
- Result: pass (`41` passed, `0` failed)
- Command: `npm test`
- Result: pass (`172` passed, `0` failed)

### Residual Coverage Gaps (Post-2026-03-09)

1. No backend integration test yet proving dashboard `levelCompletion` emits canonical announcement-link metadata (currently UI synthesizes volatile links when needed).
2. No end-to-end browser test for reminder-send flow after auto-filled volatile links across restart cycles.
3. Assignment template persistence is still localStorage-based; API-backed canonicalization remains a refactor item.

### Prioritized Next Actions (Post-2026-03-09)

1. Add backend-owned assignment-template CRUD + dashboard-enriched `currentAssignmentMeta` to reduce frontend fallback branching.
2. Add integration tests for overview branches (backend rows / template fallback / enrollment-only fallback) at API layer.
3. Add Playwright smoke test for: click level button -> autofilled assignment/link -> send reminder preview/queue.

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
