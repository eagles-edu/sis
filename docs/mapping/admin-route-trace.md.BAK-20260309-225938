# SIS Admin API Route Trace

Source of truth: `server/student-admin-routes.mjs` (`handleApiRequest` + preview/page handlers).

## Auth and Role Gate Summary

- Login path(s): `POST /api/admin/auth/login` and legacy alias `POST /api/admin/login`.
- Session check: `requireAuthenticatedSession`.
- Role gate: `enforceRoleAccess`.
- Teacher write exceptions:
- `POST /api/admin/notifications/email` only when `deliveryMode=weekend-batch` and `queueType=parent-report`.
- `POST /api/admin/students/{studentRefId}/reports`.
- Admin-only capability gate: `assertCanManageUsers` for service-control and user CRUD.

## Public Routes

| Method | Path | Handler / Note |
| --- | --- | --- |
| GET | `/assignment-announcements/volatile/{token}` | Volatile assignment announcement preview page (`readAssignmentAnnouncementPreview`) |
| GET | `/admin/students` and `/admin/students/{pageSlug}` | Admin HTML shell with runtime config injection |

## Authentication Routes

| Method | Path | Auth Required | Role Gate | Handler |
| --- | --- | --- | --- | --- |
| POST | `/api/admin/auth/login` | No | None | `handleLogin` |
| POST | `/api/admin/login` (legacy) | No | None | `handleLogin` |
| POST | `/api/admin/auth/logout` | No | None | `handleLogout` |
| GET | `/api/admin/auth/me` | No (self-check endpoint) | None | `handleMe` |

## Core Admin Routes

| Method | Path | Auth Required | Role Gate | Store Gate | Handler |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/admin/permissions` | Yes | any readable role | No | `handlePermissionsGet` |
| PUT | `/api/admin/permissions` | Yes | `canManagePermissions` | No | `handlePermissionsPut` |
| GET | `/api/admin/runtime/health` | Yes | any readable role | No | `resolveAdminRuntimeHealthPayload` |
| GET | `/api/admin/runtime/service-control` | Yes | `canManageUsers` | No | `getExerciseMailerServiceControlStatus` |
| POST | `/api/admin/runtime/service-control` | Yes | `canManageUsers` | No | `restartExerciseMailerServiceControl` |
| POST | `/api/admin/assignment-announcements/volatile` | Yes | write role | No | `createAssignmentAnnouncementPreview` |
| GET | `/api/admin/dashboard` | Yes | any readable role | Yes | `getAdminDashboardSummary` (+ queue snippet for managers) |
| GET | `/api/admin/exercise-titles` | Yes | any readable role | Yes | `listExerciseTitles` |
| GET | `/api/admin/exercise-results/incoming` | Yes | any readable role | No | `listIncomingExerciseResults` |
| POST | `/api/admin/exercise-results/incoming` | Yes | `canManageUsers` | No | queue triage actions (`set...`, `resolve...`, `delete...`) |
| GET | `/api/admin/notifications/batch-status` | Yes | any readable role | No | `listQueuedAnnouncements` + `getEmailBatchQueueStatus` |
| POST | `/api/admin/notifications/batch-status` | Yes | `canManageUsers` | No | batch actions (`send-all`, `hold`, `requeue`, `edit`) |
| POST | `/api/admin/notifications/email` | Yes | write role (teacher restricted exception) | No | `queueAnnouncementEmail` or `sendAnnouncementEmail` |
| POST | `/api/admin/exports/xlsx` | Yes | write role | No | `buildXlsxFromPayload` |
| GET | `/api/admin/students/import-template.xlsx` | Yes | any readable role | No | template file streaming |
| GET | `/api/admin/filters` | Yes | any readable role | Yes | `listLevelAndSchoolFilters` |
| GET | `/api/admin/students/next-student-number` | Yes | any readable role | Yes | `getNextStudentNumber` |
| GET | `/api/admin/students` | Yes | any readable role | Yes | `listStudents` |
| POST | `/api/admin/students` | Yes | write role | Yes | `saveStudent` (create) |
| POST | `/api/admin/students/import` | Yes | write role | Yes | `importStudentsFromRows` |
| GET | `/api/admin/family?phone=...` | Yes | any readable role | Yes | `findFamilyByEmergencyPhone` |
| GET | `/api/admin/users` | Yes | `canManageUsers` | Yes | `listAdminUsers` |
| POST | `/api/admin/users` | Yes | `canManageUsers` | Yes | `createAdminUser` |
| PUT | `/api/admin/users/{userId}` | Yes | `canManageUsers` | Yes | `updateAdminUserById` |
| DELETE | `/api/admin/users/{userId}` | Yes | `canManageUsers` | Yes | `deleteAdminUserById` |
| GET | `/api/admin/students/{studentRefId}` | Yes | any readable role | Yes | `getStudentById` |
| PUT | `/api/admin/students/{studentRefId}` | Yes | write role | Yes | `saveStudent` (update) |
| DELETE | `/api/admin/students/{studentRefId}` | Yes | write role | Yes | `deleteStudent` |
| GET | `/api/admin/students/{studentRefId}/report-card.pdf` | Yes | any readable role | Yes | `generateStudentReportCardPdf` |
| POST | `/api/admin/students/{studentRefId}/attendance` | Yes | write role | Yes | `saveAttendanceRecord` |
| DELETE | `/api/admin/students/{studentRefId}/attendance/{recordId}` | Yes | write role | Yes | `deleteAttendanceRecord` |
| POST | `/api/admin/students/{studentRefId}/grades` | Yes | write role | Yes | `saveGradeRecord` |
| DELETE | `/api/admin/students/{studentRefId}/grades/{recordId}` | Yes | write role | Yes | `deleteGradeRecord` |
| POST | `/api/admin/students/{studentRefId}/reports` | Yes | write role (teacher exception allowed) | Yes | `saveParentClassReport` |
| POST | `/api/admin/students/{studentRefId}/reports/generate` | Yes | write role | Yes | `generateParentClassReportFromGrades` |
| DELETE | `/api/admin/students/{studentRefId}/reports/{reportId}` | Yes | write role | Yes | `deleteParentClassReport` |

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
