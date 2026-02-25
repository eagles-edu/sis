# SIS Project Notes

## Scope

- Workspace: `/home/eagles/dockerz/sis`
- Runtime: Node `v20.19.4`
- Service entrypoint: `server/exercise-mailer.mjs`
- Admin routing module: `server/student-admin-routes.mjs`

## Test Completeness Review (2026-02-25)

### Executed

```bash
npm test
```

Result: `23` tests total, `18` pass, `5` fail.

### Findings (ordered by severity)

1. High: admin auth contract tests are stale and currently fail.
   - Tests expect bearer token login response and bearer-authenticated requests in [test/student-admin.spec.mjs](/home/eagles/dockerz/sis/test/student-admin.spec.mjs:164).
   - Runtime now uses session cookie auth via `Set-Cookie` and session store in [server/student-admin-routes.mjs](/home/eagles/dockerz/sis/server/student-admin-routes.mjs:464) and [server/student-admin-routes.mjs](/home/eagles/dockerz/sis/server/student-admin-routes.mjs:559).
   - Impact: several tests are asserting unreachable behavior and masking actual auth/session branch coverage.

2. High: authenticated admin API paths are largely unverified.
   - Route handlers from [server/student-admin-routes.mjs](/home/eagles/dockerz/sis/server/student-admin-routes.mjs:573) through [server/student-admin-routes.mjs](/home/eagles/dockerz/sis/server/student-admin-routes.mjs:739) are only minimally exercised.
   - Current suite does not successfully execute cookie-authenticated flows for core CRUD operations (`students`, `attendance`, `grades`, `reports`, `family`, `filters`).

3. Medium: session lifecycle endpoints are not covered.
   - Missing focused tests for `/api/admin/auth/me` and `/api/admin/auth/logout` in [server/student-admin-routes.mjs](/home/eagles/dockerz/sis/server/student-admin-routes.mjs:554) and [server/student-admin-routes.mjs](/home/eagles/dockerz/sis/server/student-admin-routes.mjs:549).
   - No assertions for cookie refresh (`touchSession`) behavior in [server/student-admin-routes.mjs](/home/eagles/dockerz/sis/server/student-admin-routes.mjs:418).

4. Medium: role enforcement is untested.
   - `teacher` role write restrictions (`403` on non-GET) are implemented in [server/student-admin-routes.mjs](/home/eagles/dockerz/sis/server/student-admin-routes.mjs:422) but not validated.

5. Medium: persistence paths are disabled in tests, so DB behavior is mostly untested.
   - Tests set store flags off in [test/exercise-mailer.spec.mjs](/home/eagles/dockerz/sis/test/exercise-mailer.spec.mjs:8) and [test/student-admin.spec.mjs](/home/eagles/dockerz/sis/test/student-admin.spec.mjs:10).
   - DB-backed behavior in:
     - [server/exercise-store.mjs](/home/eagles/dockerz/sis/server/exercise-store.mjs:142)
     - [server/student-intake-store.mjs](/home/eagles/dockerz/sis/server/student-intake-store.mjs:217)
     - [server/student-admin-store.mjs](/home/eagles/dockerz/sis/server/student-admin-store.mjs:291)
   - remains mostly uncovered.

6. Medium: spreadsheet parser negative coverage is thin.
   - Positive `.xlsx` path is tested in [test/student-admin.spec.mjs](/home/eagles/dockerz/sis/test/student-admin.spec.mjs:36).
   - Missing tests for malformed base64, empty files, unsupported formats, CSV/TSV parsing edge cases, and required-column validation behavior.

7. Low: API robustness edge cases are not covered.
   - Missing malformed JSON tests for POST endpoints.
   - Missing payload-too-large branch coverage in:
     - [server/exercise-mailer.mjs](/home/eagles/dockerz/sis/server/exercise-mailer.mjs:296)
     - [server/student-admin-routes.mjs](/home/eagles/dockerz/sis/server/student-admin-routes.mjs:437)
   - Limited CORS coverage for admin endpoints.

## Coverage Snapshot

| Subsystem | Current coverage | Status |
| --- | --- | --- |
| Exercise submission API | health, success path, invalid answers, recipient decoding, CORS preflight | Partial |
| Intake submission API | valid payload and missing fields | Partial |
| Admin auth | invalid login only (success path stale) | Incomplete |
| Admin session lifecycle | no `me`/`logout` contract tests | Incomplete |
| Admin CRUD APIs | mostly untested with valid authenticated flow | Incomplete |
| PDF generation | buffer/sanity header only | Partial |
| Spreadsheet import parser | xlsx happy path only | Incomplete |
| Session store (memory/redis fallback) | no direct unit tests | Incomplete |

## Recommended Next Test Work

1. Update admin tests to cookie-session auth.
   - Capture `Set-Cookie` from login.
   - Use `Cookie` header for subsequent requests.
   - Assert `/auth/me` and `/auth/logout` behavior.

2. Add endpoint contract tests for all admin API branches.
   - `filters`, `family`, `students` CRUD, `attendance`, `grades`, `reports`, `report generate/delete`, report-card PDF.

3. Add role-based tests.
   - Teacher can `GET`.
   - Teacher cannot mutate (`POST/PUT/DELETE` => `403`).

4. Add parser and input-hardening tests.
   - CSV/TSV matrix parsing and quoting edge cases.
   - Invalid base64 and empty payload errors.
   - malformed JSON and oversized payload behavior.

5. Add DB-enabled integration suite (separate command/profile).
   - Run against disposable Postgres schema.
   - Validate store writes and retrieval consistency.

## Current Risk Summary

- The test suite is not currently a reliable release gate for admin auth and most admin operations.
- Main immediate blocker is the bearer-token test contract mismatch against session-cookie runtime.

