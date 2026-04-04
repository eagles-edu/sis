# chips

## SSOT Scope

- One codified chip contract for news-report chips across admin, student, and parent.
- SSOT sources are both [docs/chips.md](docs/chips.md) and [docs/chips.xlsx](docs/chips.xlsx); they must stay in parity.
- Internal persistence keys remain unchanged (`submitted`, `approved`, `revision-requested`).
- Admin keeps separate columns for `Status` (condition) and `Action` (workflow task).

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
4. `WAITING` when `reviewStatus=submitted` and `awaitingReReview=true`.
5. `APPROVED` when `reviewStatus=approved`.
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
- `WAITING`: all remaining student/parent week sets with submitted items.
- Student/parent week-set queue chips must only render `APPROVED`, `WAITING`, `REVISE`.
- Compliance failures during student re-submit do not auto-set `revision-requested`; they remain `WAITING` until admin review action.

### Waiting precedence note

- `WAITING` covers all non-approved, non-revise submitted week sets in student/parent queues.

## Week `Action` (admin workflow)

- `COMPLETED`: `reportCount>=7` and `approvedCount>=7`.
- `INCOMPLETE`: no unapproved submissions and `<7` approved (`submittedCount+revisionRequestedCount=0`).
- `UNAPPROVED-X`: otherwise, where `X=submittedCount+revisionRequestedCount`.

## Surface Matrix

- Admin queue surfaces: `Status` + `Action`.
- Student and parent queue/set surfaces: admin-style columns minus `Action` (`Week Set`, `Student`, `Level`, `Reports`, `Status`, `Latest Submission`, `Open`) with week-set `Status` limited to `APPROVED`/`WAITING`/`REVISE`.
- Calendar event chips (student + parent): report-chip contract above.
- Modal rows (all portals): report-chip contract above.

## Modal Contract Matrix (Blocking Gate)

- `submitted + awaitingReReview=false` => `Submitted` (amber/warn).
- `submitted + awaitingReReview=true` => `Waiting` (purple/revise).
- `revision-requested` => `Revise` (purple/revise).
- `approved` => `Approved` (green/good).
- Enforced by [test/portal-chip-contract.spec.mjs](test/portal-chip-contract.spec.mjs) in CI and post-sync deploy gates.
