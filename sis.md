# SIS Project Notes

## Scope

- Workspace: `/home/eagles/dockerz/sis`
- Runtime: Node `v20.19.4`
- Service entrypoint: `server/exercise-mailer.mjs`
- Admin routing module: `server/student-admin-routes.mjs`

## Active Docs

- `AGENTS.md`: short always-loaded contract
- `docs/sop.md`: operational procedure and workflow
- `docs/history.md`: historical migration log
- `docs/plan-upgrade-0426.md`: current upgrade plan

## Current Baseline

- Single-service Node.js + Prisma workspace.
- Cookie-session auth remains the admin contract.
- Assignment templates are backend-owned.
- Admin, parent, and student portals are all active.
- The current extraction focus is the UI decomposition boundary in Phase 6 after the async side-effects outbox/worker cutover.
- The first Phase 6 islands are the queue-hub page wiring in `web-asset/admin/queue-hub-island.mjs` and the overview news queue wiring in `web-asset/admin/overview-news-queue-island.mjs`.

## Test Status

- Latest full suite run in this session: pass, `385` pass and `0` fail.
- The outbox/worker cutover is now covered by the passing suite; no extra rerun was needed after the last doc-only update.

## Prioritized Next Actions

1. Split the next page slice out of `web-asset/admin/student-admin.js`.
2. Keep the async side-effects worker boundary as the reference path for new side effects.
3. Update `docs/history.md` only when the milestone log changes.
