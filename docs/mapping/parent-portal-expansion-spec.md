# Parent Portal Expansion Spec (Queue Hub + Parent Public Portal)

Status: Approved for implementation
Date: 2026-03-11
Owner: SIS Engineering

## 1) Objective

Deliver a public parent portal and an admin queue hub without identity drift.

Required outcomes:
- Parent access is session-based by `parentsId`.
- Parent account can map to multiple children.
- Public child identity is `eaglesId`.
- Parent profile edits go to queue, then admin review/edit, then approve/reject.
- Queue processing is row/item-continuation (errors do not block other items).
- Queue Hub is one admin page with reorderable panels and persistent order.

## 2) Locked Product Decisions

- `studentId` is not used in parent-facing contracts.
- Parent-facing child key is `eaglesId`.
- Parent-facing opaque ref key is `eaglesRefId`.
- Internal relational key remains `studentRefId` in existing store/schema.
- `parentsId` is family-level and can map multiple children.
- `parentsId` default bootstrap pattern is `cm<eaglesId>` and can be overridden for sibling grouping.
- Parent can edit all profile tabs, except locked fields.
- Lock granularity is per-field per-student and enforced server-side.
- Approval strategy is field-by-field merge with diff preview.
- Notifications are email on received, approved, and rejected.
- Queue Hub is a new admin page slug: `queue-hub`.
- Queue Hub panel order is global/shared and persisted in admin UI settings.

## 3) Queue Hub Scope and Panel Contract

Queue Hub panel IDs (default order):
0. `queued-performance-reports`
1. `unmatched-exercise-submissions`
2. `current-assignments-pending`
3. `overdue-homework`
4. `attendance-risk`
5. `pending-profile-submissions`

Queue Hub page behavior:
- Admin-only access.
- Drag-and-drop reorder from front/top.
- Order persistence key: `uiSettings.queueHub.panelOrder`.
- Unknown/new panel IDs append to end during hydration.

Panel data sources:
- Queued performance reports: existing parent-report notification queue source.
- Unmatched exercise submissions: existing incoming exercise-result queue source.
- Current assignments pending: existing dashboard level-completion source.
- Overdue homework: new query for due date < now and incomplete state.
- Attendance risk: existing weekly attendance-risk source.
- Pending profile submissions: new parent profile submission queue source.

## 4) Parent Portal Functional Scope

Portal pages:
- Parent login/session.
- Dashboard snapshot (grades, performance, reports, attendance, current/past due homework, quarter/YTD).
- Child selector (all linked children under same `parentsId`).
- Profile form tabs (same canonical field definitions as admin profile).
- Submission status history (draft/submitted/approved/rejected).

Field editability policy:
- Not editable: `eaglesId`, `studentNumber`.
- Editable: all other profile fields unless explicitly locked.
- Locks are shown in UI and revalidated on submit.

Submission workflow:
- Parent saves draft edits.
- Parent submits for review.
- Admin reviews diff, optionally edits draft, then approve/reject.
- Approve merges touched fields onto latest profile.
- Reject stores reason and keeps student profile unchanged.

## 5) Data Model Additions (Prisma)

- `ParentPortalAccount`
  - `id`, `parentsId` (unique), `passwordHash`, `status`, `lastLoginAt`, `createdAt`, `updatedAt`
- `ParentPortalStudentLink`
  - `id`, `parentAccountId`, `studentRefId`, `createdAt`
  - unique composite: (`parentAccountId`, `studentRefId`)
- `ParentProfileSubmissionQueue`
  - `id`, `parentAccountId`, `studentRefId`, `status`, `draftPayloadJson`, `adminEditedPayloadJson`, `diffPayloadJson`
  - `failurePoint`, `rejectionReason`, `submittedAt`, `reviewedAt`, `reviewedByUsername`, `createdAt`, `updatedAt`
- `ParentProfileFieldLock`
  - `id`, `studentRefId`, `fieldKey`, `locked`, `reason`, `lockedByUsername`, `createdAt`, `updatedAt`

Optional later:
- `ParentPortalNotificationPreference` for per-parent channel preferences.

## 6) API Surfaces to Implement

Admin API additions:
- `GET /api/admin/queue-hub`
- `GET /api/admin/profile-submissions`
- `PUT /api/admin/profile-submissions/{submissionId}/draft`
- `POST /api/admin/profile-submissions/{submissionId}/approve`
- `POST /api/admin/profile-submissions/{submissionId}/reject`
- Existing UI settings endpoint persists queue panel order (`PUT /api/admin/settings/ui`).

Parent API additions:
- `POST /api/parent/auth/login`
- `POST /api/parent/auth/logout`
- `GET /api/parent/auth/me`
- `GET /api/parent/children`
- `GET /api/parent/dashboard`
- `GET /api/parent/children/{eaglesId}/profile`
- `PUT /api/parent/children/{eaglesId}/profile-draft`
- `POST /api/parent/children/{eaglesId}/profile-submit`

Response naming rules:
- Parent API payloads expose `eaglesId` and `eaglesRefId`.
- Parent API payloads do not expose `studentId`.

## 7) Merge, Diff, and Failure Semantics

Patch semantics:
- Use touched-field payload shape (explicitly distinguish unchanged vs clear-empty).
- Blank value with touched=true clears field.
- Field omitted means unchanged.

Approval merge rules:
- Immutable guard: reject attempts to mutate `eaglesId` and `studentNumber`.
- Lock guard: locked fields cannot be changed by parent submission.
- Merge target: latest profile snapshot at approval time.
- Conflict policy: admin-edited draft wins over parent draft for same touched field.

Failure logging:
- Record failure point enum values: `validation`, `lock-conflict`, `merge-write`, `notification`.
- Reject only failing item; continue processing remaining queue items.

## 8) Security and Privacy

- Cookie session auth for parent namespace with dedicated cookie name.
- HttpOnly, SameSite, Secure behavior aligned with existing admin session policy.
- No password or sensitive PII in logs.
- Parent can only access linked children via `parentsId` mapping.

## 9) Testing and Acceptance Criteria

Minimum test coverage:
- Parent auth/login/logout/me cookie flow.
- Multi-child mapping for one `parentsId`.
- Parent profile draft/submit happy path.
- Admin approve merge and reject flow.
- Locked-field enforcement and immutable field enforcement.
- Queue Hub 6 panels render and counts map correctly.
- Queue Hub drag reorder persists and rehydrates globally from UI settings.
- Notification events fire for received/approved/rejected.

Definition of done:
- Endpoints implemented and documented.
- OpenAPI mapping files updated.
- Route + UI tests passing.
- No regression in existing admin import/dashboard/queue tests.

## 10) Anti-Drift Controls

- This spec is normative for v1 parent portal.
- ADR `ADR-parent-identity-naming` is normative for naming and identity boundaries.
- OpenAPI specs must match implemented routes before merge.
- Parent profile form field contract must reuse one canonical definition source shared with admin profile UI.
