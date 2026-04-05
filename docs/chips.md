# chips

## SSOT Scope

- One codified chip contract for news-report chips across admin, student, and parent.
- SSOT sources are both [chips.md](chips.md) and [docs/chips.xlsx](chips.xlsx); they must stay in parity.
- Internal persistence keys remain unchanged (`submitted`, `approved`, `revision-requested`).
- Admin queue columns are `Action` then `Status` (separate semantics: workflow task vs condition).

## Report Chip Contract (calendar / modal / report rows)

- `OPEN` (blue): submission window is open and no submission exists.
- `NONE SUBMITTED` (red): no submission for that report date.
- `SUBMITTED` (amber): submitted and pending first review.
- `REVISE` (purple): admin requested revision (`reviewStatus=revision-requested`).
- `WAITING` (purple): valid resubmission after revision request, pending re-review.
- `APPROVED` (green): admin approved.

### Report precedence

1. `REVISE` when `reviewStatus=revision-requested`.
2. `OPEN` when date is open and no submission.
3. `NONE SUBMITTED` when date is missed/no submission.
4. `APPROVED` when `reviewStatus=approved`.
5. `WAITING` when `reviewStatus=submitted` and `awaitingReReview=true`.
6. Otherwise `SUBMITTED`.

## Week `Status` (condition)

### Admin week-set `Status` (queue/set surfaces)

- `APPROVED`: `reportCount>=7` and `approvedCount>=7`.
- `CHECKED`: `submittedCount=0` and `revisionRequestedCount=0` (approved-only but not 7/7).
- `WAITING`: default for all remaining admin-reviewable week sets (`submitted`/`revision-requested` collapsed).

### Student/Parent week-set `Status`

- Queue source is submitted `items` payload only (`listStudentNewsCalendar(...).items`), not full calendar rows.
- `APPROVED`: `reportCount>=7` and `approvedCount>=7`.
- `REVISE`: `revisionRequestedCount>0`.
- `WAITING`: `awaitingReReviewCount>0` and no revise entries in that week set.
- `SUBMITTED`: all remaining non-approved, non-revise week sets with initial submissions.
- Student/parent week-set queue chips must only render `APPROVED`, `SUBMITTED`, `WAITING`, `REVISE`.
- Compliance failures during student re-submit do not auto-set `revision-requested`; they remain `WAITING` until admin review action.

### Waiting precedence note

- `WAITING` is reserved for re-review wait (`submitted + awaitingReReview=true`), not initial submit.
- Initial submit must be rendered as `SUBMITTED` (amber/warn), never `WAITING`.

## Week `Action` (admin workflow)

- Derived counter (required):
  - `unapprovedCount = max(0, submittedCount)`
  - `submittedCount` includes all yet-to-be-checked `submitted` rows:
    - initial submissions (YTBC),
    - resubmissions (YTBC, including awaiting re-review).
  - `submittedCount` excludes `revision-requested` rows (returned/waiting for revision), so those do not increase `UNAPPROVED-X`.
- Action mapping (strict precedence):
  1. `COMPLETED` when `reportCount>=7` and `approvedCount>=7`.
  2. `INCOMPLETE` when not completed and `unapprovedCount=0`.
  3. `UNAPPROVED-X` when not completed and `unapprovedCount>0`, where `X=unapprovedCount`.
- Hard rule:
  - `UNAPPROVED-X` must include YTBC initial submissions and YTBC resubmissions.
  - `revisionRequested` items are already reviewed/returned and must not increase `X`.

## Surface Matrix

- Admin queue surfaces: `Action` + `Status`.
- Student and parent queue/set surfaces: compact parity columns (`Week Set`, `#`, `Status`, `Latest Submission`, `Open`) with week-set `Status` limited to `APPROVED`/`SUBMITTED`/`WAITING`/`REVISE`.
- Calendar event chips (student + parent): report-chip contract above.
- Modal rows (all portals): report-chip contract above.

## Modal Contract Matrix (Blocking Gate)

- `submitted + awaitingReReview=false` => `Submitted` (amber/warn).
- `submitted + awaitingReReview=true` => `Waiting` (purple/revise).
- `revision-requested` => `Revise` (purple/revise).
- `approved` => `Approved` (green/good).
- Enforced by [test/portal-chip-contract.spec.mjs](../test/portal-chip-contract.spec.mjs) in CI and post-sync deploy gates.
