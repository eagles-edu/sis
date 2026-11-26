# SIS Admin API Route Trace

Source of truth: `server/student-admin-routes.mjs` (`handleApiRequest` + preview/page handlers).

## Auth and Role Gate Summary

- Login path(s): `POST /api/admin/auth/login` and legacy alias `POST /api/admin/login`.
- Session check: `requireAuthenticatedSession`.
- Role gate: `enforceRoleAccess`.
- Teacher role is read-only: authenticated `GET` requests are allowed; all other methods return `403 Forbidden`.
- Parent session check: `requireAuthenticatedParentSession`.
- Admin-only capability gate: `assertCanManageUsers` for service-control and user CRUD.
- Settings capability gate: `assertCanManageSettings` for persisted admin UI settings.

## Public Routes

| Method | Path | Handler / Note |
| --- | --- | --- |
| GET | `/assignment-announcements/volatile/{token}` | Volatile assignment announcement preview page (`readAssignmentAnnouncementPreview`) |
| GET | `/admin/students` and `/admin/students/{pageSlug}` | Admin HTML shell with runtime config injection |
| GET | `/parent/portal` | Parent portal HTML shell with runtime config injection |

## Authentication Routes

| Method | Path | Auth Required | Role Gate | Handler |
| --- | --- | --- | --- | --- |
| POST | `/api/admin/auth/login` | No | None | `handleLogin` |
| POST | `/api/admin/login` | No | None | `handleLogin` (legacy alias path) |
| POST | `/api/admin/auth/logout` | No | None | `handleLogout` |
| GET | `/api/admin/auth/me` | Yes | None | `handleMe` |

## Core Admin Routes

| Method | Path | Auth Required | Role Gate | Store Gate | Handler |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/admin/permissions` | Yes | any readable role | No | `handlePermissionsGet` |
| PUT | `/api/admin/permissions` | Yes | `canManagePermissions` | No | `handlePermissionsPut` |
| GET | `/api/admin/settings/ui` | Yes | `canManageSettings` | No | `readPersistedUiSettings` |
| PUT | `/api/admin/settings/ui` | Yes | `canManageSettings` | No | `writePersistedUiSettings` |
| GET | `/api/admin/runtime/health` | Yes | any readable role | No | `resolveAdminRuntimeHealthPayload` |
| GET | `/api/admin/runtime/service-control` | Yes | `canManageUsers` | No | `getExerciseMailerServiceControlStatus` |
| POST | `/api/admin/runtime/service-control` | Yes | `canManageUsers` | No | `restartExerciseMailerServiceControl` |
| POST | `/api/admin/assignment-announcements/volatile` | Yes | write role | No | `createAssignmentAnnouncementPreview` |
| GET | `/api/admin/dashboard` | Yes | any readable role | Yes | `getAdminDashboardSummary` (`src/modules/admin/dashboard-summary.mjs`, `currentAssignmentMeta`, `enrollmentOnlyLevels`, + queue snippet for managers) |
| POST | `/api/admin/library/contributions/{contributionId}/review` | Yes | admin write role | Yes | `reviewLibraryContribution`; repeated same decisions are idempotent, conflicting decisions return 409 |
| GET | `/api/admin/news-reports` | Yes | any readable role | Yes | `listStudentNewsReportsForReview` (`src/modules/admin/student-news-review.mjs`) |
| POST | `/api/admin/news-reports/{reportId}` | Yes | `canManageUsers` | Yes | `reviewStudentNewsReport` (`src/modules/admin/student-news-review.mjs`) |
| GET | `/api/admin/assignment-templates` | Yes | any readable role | Yes | `listAssignmentTemplates` |
| POST | `/api/admin/assignment-templates` | Yes | write role | Yes | `saveAssignmentTemplate` |
| GET | `/api/admin/assignment-templates/{templateId}` | Yes | any readable role | Yes | `getAssignmentTemplateById` |
| PUT | `/api/admin/assignment-templates/{templateId}` | Yes | write role | Yes | `saveAssignmentTemplate` |
| DELETE | `/api/admin/assignment-templates/{templateId}` | Yes | write role | Yes | `deleteAssignmentTemplateById` |
| POST | `/api/admin/assignment-templates/import` | Yes | write role | Yes | `importAssignmentTemplates` |
| GET | `/api/admin/queue-hub` | Yes | `canManageUsers` | No | `buildQueueHubPayload` |
| POST | `/api/admin/news-vocabulary-help/{requestId}/resolve` | Yes | `canManageUsers` | Yes | Resolve an in-app Student News vocabulary help request |
| POST | `/api/admin/news-vocabulary-help/{requestId}/approve-override` | Yes | `canManageUsers` | Yes | Validate, approve, and store the News syllabication override; subsequent Student News checks consult it before dictionary providers |
| GET | `/api/admin/exercise-titles` | Yes | any readable role | Yes | `listExerciseTitles` (`src/modules/admin/student-admin-queries.mjs`) |
| GET | `/api/admin/exercise-results/incoming` | Yes | any readable role | No | `listIncomingExerciseResults` |
| POST | `/api/admin/exercise-results/incoming` | Yes | `canManageUsers` | No | queue triage actions (`set...`, `resolve...`, `delete...`) |
| GET | `/api/admin/profile-submissions` | Yes | `canManageUsers` | No | `listParentProfileSubmissions` |
| PUT | `/api/admin/profile-submissions/{submissionId}` | Yes | `canManageUsers` | No | admin draft patch update (`updateParentProfileSubmissionById`) |
| POST | `/api/admin/profile-submissions/{submissionId}` | Yes | `canManageUsers` | No | profile review actions (`approve`, `reject`); repeated same-decision requests are idempotent, conflicting decisions return 409 |
| GET | `/api/admin/notifications/batch-status` | Yes | any readable role | No | `listQueuedAnnouncements` + `getEmailBatchQueueStatus` |
| POST | `/api/admin/notifications/batch-status` | Yes | `canManageUsers` | No | batch actions (`send-all`, `hold`, `requeue`, `edit`) |
| POST | `/api/admin/notifications/email` | Yes | write role (admin only) | No | `queueAnnouncementEmail` or `sendAnnouncementEmail` |
| POST | `/api/admin/exports/xlsx` | Yes | write role | No | `buildXlsxFromPayload` |
| GET | `/api/admin/students/import-template.xlsx` | Yes | any readable role | No | template file streaming |
| GET | `/api/admin/students/moodle-import.xlsx` | Yes | `canManageUsers` | Yes | Moodle current-student workbook with native-upload and SIS-link sheets |
| GET | `/api/admin/students/moodle-import.csv` | Yes | `canManageUsers` | Yes | Moodle-native Upload users CSV companion |
| GET | `/api/admin/students/moodle-fixes.xlsx` | Yes | `canManageUsers` | Yes | SIS import workbook containing only active students blocked from Moodle export |
| GET | `/api/admin/filters` | Yes | any readable role | Yes | `listLevelAndSchoolFilters` (`src/modules/admin/student-admin-queries.mjs`) |
| GET | `/api/admin/students/next-student-number` | Yes | any readable role | Yes | `getNextStudentNumber` (`src/modules/admin/student-roster.mjs`) |
| GET | `/api/admin/students` | Yes | any readable role | Yes | `listStudents` (`src/modules/admin/student-roster.mjs`) |
| POST | `/api/admin/students` | Yes | write role | Yes | `saveStudent`; student persistence remains successful if optional parent invitation setup fails, with `invitationWarning: true` |
| POST | `/api/admin/students/import` | Yes | write role | Yes | `importStudentsFromRows` |
| POST | `/api/admin/students/{studentRefId}/moodle/disable` | Yes | `canManageUsers` | Yes | queue SIS-owned Moodle disable and suspend SIS student login pending signed receipt |
| GET | `/api/admin/family` | Yes | any readable role | Yes | `findFamilyByEmergencyPhone` (`phone` query parameter) in `src/modules/admin/student-records.mjs` |
| GET | `/api/admin/users` | Yes | `canManageUsers` | Yes | `listAdminUsers` |
| POST | `/api/admin/users` | Yes | `canManageUsers` | Yes | `createAdminUser` |
| PUT | `/api/admin/users/{userId}` | Yes | `canManageUsers` | Yes | `updateAdminUserById` |
| DELETE | `/api/admin/users/{userId}` | Yes | `canManageUsers` | Yes | `deleteAdminUserById` |
| GET | `/api/admin/students/{studentRefId}` | Yes | any readable role | Yes | `getStudentById` (`src/modules/admin/student-roster.mjs`) |
| PUT | `/api/admin/students/{studentRefId}` | Yes | write role | Yes | `saveStudent` (update) |
| DELETE | `/api/admin/students/{studentRefId}` | Yes | write role | Yes | `deleteStudent`; returns 409 and preserves all SIS records while a Moodle account link exists |

## Signed Moodle Provisioning Routes

| Method | Path | Auth Required | Handler |
| --- | --- | --- | --- |
| POST | `/api/moodle/provisioning/poll` | Moodle HMAC signature, timestamp, and one-use nonce | ordered SIS command polling |
| POST | `/api/moodle/provisioning/receipt` | Moodle HMAC signature, timestamp, and one-use nonce | command receipt processing |
| POST | `/api/moodle/provisioning/link` | Moodle HMAC signature, timestamp, and one-use nonce | idempotent Moodle numeric-user-ID to SIS student identity link |

| GET | `/api/admin/students/{studentRefId}/report-card.pdf` | Yes | any readable role | Yes | `generateStudentReportCardPdf` |
| POST | `/api/admin/students/{studentRefId}/attendance` | Yes | write role | Yes | `saveAttendanceRecord` in `src/modules/admin/student-records.mjs` |
| DELETE | `/api/admin/students/{studentRefId}/attendance/{recordId}` | Yes | write role | Yes | `deleteAttendanceRecord` in `src/modules/admin/student-records.mjs` |
| POST | `/api/admin/students/{studentRefId}/grades` | Yes | write role | Yes | `saveGradeRecord` in `src/modules/admin/student-records.mjs` |
| DELETE | `/api/admin/students/{studentRefId}/grades/{recordId}` | Yes | write role | Yes | `deleteGradeRecord` in `src/modules/admin/student-records.mjs` |
| POST | `/api/admin/students/{studentRefId}/reports` | Yes | write role (admin only) | Yes | `saveParentClassReport` |
| POST | `/api/admin/students/{studentRefId}/reports/generate` | Yes | write role | Yes | `generateParentClassReportFromGrades` |
| DELETE | `/api/admin/students/{studentRefId}/reports/{reportId}` | Yes | write role | Yes | `deleteParentClassReport` |

## Parent Portal API Routes

| Method | Path | Auth Required | Role Gate | Handler |
| --- | --- | --- | --- | --- |
| POST | `/api/parent/auth/login` | No | None | parent credential verify + session issue |
| POST | `/api/parent/auth/logout` | No | None | parent logout + cookie clear |
| GET | `/api/parent/auth/me` | Yes (parent session) | parent session | parent session identity payload |
| GET | `/api/parent/children` | Yes (parent session) | linked-child scope | `listParentLinkedStudents` |
| GET | `/api/parent/dashboard` | Yes (parent session) | linked-child scope | `buildParentDashboardPayload` |
| GET | `/api/parent/children/{eaglesId}/profile` | Yes (parent session) | linked-child scope | official child profile, latest saved draft payload, and lock/immutable metadata |
| PUT | `/api/parent/children/{eaglesId}/profile-draft` | Yes (parent session) | linked-child scope + lock enforcement | `saveParentProfileDraftSubmission` |
| POST | `/api/parent/children/{eaglesId}/profile-submit` | Yes (parent session) | linked-child scope | `setParentProfileSubmissionSubmitted` |
| POST | `/api/parent/reports/{reportId}/acknowledge` | Yes (parent session) | report must be published and linked to this parent account | `getAuthorizedReportRecordForViewer` then idempotent `acknowledgeParentClassReportReview` |

## Student Portal API Routes

| Method | Path | Auth Required | Role Gate | Handler |
| --- | --- | --- | --- | --- |
| POST | `/api/student/auth/login` | No | None | student credential verify + session issue |
| POST | `/api/student/auth/logout` | No | None | student logout + cookie clear |
| GET | `/api/student/auth/me` | Yes (student session) | student session | student session identity payload |
| GET | `/api/student/news-reports/calendar` | Yes (student session) | linked student record | Student News report calendar |
| POST | `/api/student/news-reports` | Yes (student session) | linked student record | save and submit; validation failures persist with revision guidance |
| POST | `/api/student/news-reports/draft` | Yes (student session) | linked student record | save a draft without running Check |
| POST | `/api/student/news-reports/check` | Yes (student session) | linked student record | save and validate a draft; on session-store miss, preserve the cookie for `/auth/me` confirmation before sign-out |
| POST | `/api/student/news-reports/vocabulary-help` | Yes (student session) | linked student record | Submit an idempotent in-app vocabulary help request to Queue Hub |
| POST | `/api/student/reports/{reportId}/acknowledge` | Yes (student session) | report must be published and linked to this student account | `getAuthorizedReportRecordForViewer` then idempotent `acknowledgeParentClassReportReview` |

## Public Report Engagement Asset

| Method | Path | Auth Required | Validation | Handler |
| --- | --- | --- | --- | --- |
| GET | `/api/report-events/email-open.gif` | No (email client asset request) | records only when a sent `BrevoEmailDelivery` matches both report ID and normalized recipient email | returns transparent GIF and stores `email_opened`; storage failures do not change the asset response |

## Google Forms Grade Submission

| Method | Path | Auth Required | Handler |
| --- | --- | --- | --- |
| POST | `/api/integrations/google-forms/grades` | `GOOGLE_FORMS_GRADES_SECRET` HMAC signature, timestamp, and one-use nonce | idempotent `saveGradeRecord` submission from the Google Forms response-sheet trigger |

The signed grade data requires `eaglesId`, `title`, `score`, `maxScore`, `correctCount`, `totalQuestions`, `submittedAt`, `sourceEmail`, and a non-empty `sourceAttemptId` no longer than 255 characters. `startedAt` is optional and accepted only as a valid source timestamp; omitted start times remain empty. `maxScore` is required for percentage calculation, and `score` must equal `correctCount` while `maxScore` equals `totalQuestions` so question counts are exact. The Apps Script source is `integrations/google-forms/grades.gs`; it maps response-sheet `EaglesID`, `Score`, `Timestamp`, and `Email Address`, optionally maps a genuine `Started At` column, and hashes spreadsheet/sheet/row identity into the required stable attempt ID. The server rejects requests without that ID because a receipt-time fallback assigns a different identity to a later retry and can create a duplicate grade. The handler maps `title` to the grade assignment name, assigns the grade to the school year and quarter current at receipt using authoritative SIS school setup, and derives class and enrollment period from the student's single active enrollment in that school year. It fails closed if that SIS context is invalid or ambiguous.

## Incoming Exercise Queue Action Values (`POST /api/admin/exercise-results/incoming`)

- `save-temp` / `temporary` / `temp`
- `archive`
- `requeue`
- `delete`
- `match` / `resolve` (requires `studentRefId`)
- `create-account` (requires resolvable `eaglesId`)

## Batch Queue Action Values (`POST /api/admin/notifications/batch-status`)

- `sendall` / `send-all`
- `hold`
- `requeue`
- `edit`
