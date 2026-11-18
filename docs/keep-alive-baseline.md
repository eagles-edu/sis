# Keep-Alive Subsystem Baseline

Recorded 2026-11-18, before work on the remaining checklist items. This baseline combines the latest subsystem-specific evidence already recorded in `docs/keep-alive-plan.md` with one read-only dev runtime snapshot. Historical test passes are identified by checklist reference; they do not imply that every workflow was rerun in this snapshot or that test/live mirrors have parity.

## Development runtime snapshot

Observed at approximately 2026-11-18 23:10 +07, from `/home/eagles/dockerz/sis`:

- `http://127.0.0.1:8788/healthz` returned `status=ok`.
- `sisConfigMirrorHealth` reported both file and database copies present, `synced=true`, and `state=ok`.
- The runtime session store reported Redis connected and ready for admin, parent, and student sessions.
- The maintenance substatus was `warn`; its last database-health check timestamp was 2026-08-05T10:30:00.730Z. This is stale status and is not treated as a current database-health pass. The last backup timestamp reported by the endpoint was 2026-11-18T13:12:12.724Z.
- Runtime self-heal was disabled by environment (`disabled-by-env`).
- Prometheus had four active targets (`blackbox-test-mirror`, `node`, `process-diagnostics`, `prometheus`); all four reported `up` with no target error.
- Three Prometheus alerts were firing: `DevNewsOldReviewQueue`, `DevAnnouncementQueueStale`, and `DevNotificationQueueStale`. These are actionable queue-age warnings, not a healthy all-clear.
- The dev user timers for News, engagement, Library, and grade/feed monitoring were listed as scheduled. No parent-report monitor timer appeared in that user timer listing. The system timer list showed the assignment-reminder, database-health, backup, and incoming-vacuum jobs; those jobs are not evidence of per-subsystem monitor coverage.

The snapshot did not query or mutate application records, send notifications, restart services, or access production. Existing checklist entries record environment-pinned `sis_dev` verification where relevant. No current claim is made here about test or live runtime health.

## Per-subsystem baseline

| Subsystem | Latest baseline evidence | Result at baseline and open gap |
| --- | --- | --- |
| Parent invitations, profile drafts, submission, and approval | KA-027–033 | Authenticated synthetic invitation-to-approval and persisted reload passed; pending-draft reload and later edit-save were separately verified. Synthetic cleanup passed. This is dev evidence; it does not prove all parent-report workflows. |
| Engagement systems | KA-034–041 | Synthetic ingestion, attribution, duplication, access, retention, freshness, and failure checks were recorded as passing. Current dev engagement timer was scheduled in the snapshot. |
| Student Library | KA-042–047 | Authenticated New Words save/reload/repeat-save and monitor evidence exists. The combined visible admin-approval-to-student-result journey remains an explicit gap; earlier test cleanup incident is documented at KA-043. |
| News reports, vocabulary, and grammar | KA-048–058, KA-095 | Authenticated draft/Check, review/revision/resubmission, provider behavior, secret redaction, and `dem-o-LI-tion` Check/Save/Check/Submit evidence is recorded. The current dev News queue-age alert was firing. |
| Admin definitions and Dictionary Builder | KA-059–065 | Authenticated structured definition save/reload, access denial, malformed input, large text, provider retry/recovery, and a synthetic monitor were verified. No current provider/monitor run was performed for this baseline. |
| Assignments and notifications | KA-066–074 | Assignment targeting, notification behavior, retries/idempotency, and monitor evidence are recorded. The current announcement and notification queue-age alerts were firing; those backlogs require follow-up. |
| Grades, external exercise feeds, and tables | KA-076–083 | Grade/feed source trace, authenticated consistency checks, signed-feed idempotency/failure coverage, table contracts, and monitor evidence are recorded. The dev grade/feed timer was scheduled. |
| Attendance | KA-084–090 | Configured school-date boundaries, authenticated save/retry/correction, concurrency, authorization, desktop/mobile rendering, cleanup, and grade/feed monitor evidence are recorded. Current monitoring is represented by the grade/feed group, not a separately observed attendance timer. |
| Parent site, profiles, reports, and notifications | KA-091–094 | Source trace, acknowledgment retry repair, desktop/mobile browser evidence, and read-only profile/report reconciliation are recorded. Multiple-child isolation, missing-report cases, notification failure, and parent-report monitoring remain open; no parent-report timer appeared in the current user-timer listing. |
| Student profiles, enrollment, and notifications | KA-009 inventory | Entry points, authorization, data stores, dependencies, and existing tests were inventoried. Checklist-specific lifecycle, archive/reactivation, provisioning, and monitoring verification remains open; no result is inferred from the inventory. |
| Monitoring workers, alerts, retries, and controlled restarts | KA-014, KA-032, KA-040, KA-046, KA-057, KA-064, KA-069, KA-082, KA-089, KA-096 | Several workflow monitors and local Prometheus rules have historical dev evidence. At this snapshot four Prometheus targets were up, three queue-age alerts were firing, maintenance health was stale/warn, and runtime self-heal was disabled. Alert delivery beyond local Prometheus and bounded automatic restart/recovery behavior are not verified as implemented. The monitoring docs contain topology/delivery-state conflicts and need reconciliation before changing the stack. |

## Evidence sources

- Read-only dev runtime response: `/healthz` on port 8788.
- Read-only Prometheus APIs: `/api/v1/targets` and `/api/v1/alerts` on loopback port 9090.
- System and user `systemd` timer listings on 2026-11-18.
- [Keep-alive subsystem inventory](keep-alive-inventory.md), which maps source entry points, authorization, storage, dependencies, existing coverage, and known gaps.
- [Keep-alive plan](keep-alive-plan.md), especially the per-item evidence records cited in the table above.
- [Monitoring operations](monitoring.md) and [test-mirror monitoring](test-mirror-monitoring.md); both contain documented stale or conflicting topology/delivery statements, so runtime claims above use live observations and preserve that documentation gap.
