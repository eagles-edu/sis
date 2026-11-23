# SIS Backup and Restore Workflows

This runbook codifies backup/restore details for live SIS operations.

## Scope

- Source workspace: `/home/eagles/dockerz/sis`
- Live runtime: `/home/admin.eagles.edu.vn/sis`
- Service: `exercise-mailer.service`
- Default port: `8787`

## Decision Matrix

| Situation | Recommended workflow |
| --- | --- |
| Routine safety point before change | Full snapshot backup (`tools/sis-full-backup-snapshot.sh`) |
| Roll back app files + DB together | Full snapshot restore (`tools/sis-full-restore-snapshot.sh`) |
| Roll back DB only | DB-only restore (`node tools/db-restore-failsafe.mjs`) |
| Roll back runtime files only | Snapshot restore with `--skip-db` |

## Safety Checklist (Always)

1. Confirm maintenance window and notify impacted users.
2. Take a fresh backup before any restore action.
3. Confirm exact snapshot or dump path and timestamp.
4. Confirm service health before changes.
5. Record commands/output in incident or change notes.

## Workflow 1: Create Restorable Full Snapshot

```bash
cd /home/eagles/dockerz/sis
tools/sis-full-backup-snapshot.sh --label before-change
```

Expected artifacts:

- `/home/eagles/dockerz/backups/full-system/sis-full-snapshot-<timestamp>-before-change/`
- `/home/eagles/dockerz/backups/full-system/sis-full-snapshot-<timestamp>-before-change.tar.gz`
- `meta/manifest.json`
- `meta/RESTORE.md`

## Workflow 2: Full Restore (Files + DB)

1. Validate snapshot path:

```bash
ls -lah /home/eagles/dockerz/backups/full-system/<snapshot-folder>
```

2. Restore:

```bash
cd /home/eagles/dockerz/sis
tools/sis-full-restore-snapshot.sh \
  --snapshot-dir /home/eagles/dockerz/backups/full-system/<snapshot-folder> \
  --yes
```

What the restore script does:

- Creates runtime pre-restore backup: `/home/admin.eagles.edu.vn/sis.BEFORE-RESTORE-<timestamp>/`
- Restores runtime files from snapshot `app/`
- Restores DB from snapshot `db/`
- Restarts `exercise-mailer.service`
- Verifies:
  - `GET /healthz` -> `200`
  - `GET /api/admin/auth/me` (no cookie) -> `401`

## Workflow 3: DB-Only Backup and Restore

Create backup:

```bash
cd /home/eagles/dockerz/sis
tools/db-backup-smart.sh --runtime-env /home/admin.eagles.edu.vn/sis/.env
```

Verify backup archive first:

```bash
cd /home/eagles/dockerz/sis
DATABASE_URL="$(grep '^DATABASE_URL=' /home/admin.eagles.edu.vn/sis/.env | head -n1 | cut -d= -f2-)" \
  node tools/db-restore-failsafe.mjs --file latest --verify-only
```

Restore DB:

```bash
cd /home/eagles/dockerz/sis
DATABASE_URL="$(grep '^DATABASE_URL=' /home/admin.eagles.edu.vn/sis/.env | head -n1 | cut -d= -f2-)" \
  node tools/db-restore-failsafe.mjs --file latest --yes --clean --single-transaction
```

Restart + checks:

```bash
sudo -n systemctl restart exercise-mailer.service
curl -sS -o /tmp/sis-health.out -w '%{http_code}\n' http://127.0.0.1:8787/healthz
curl -sS -o /tmp/sis-auth-me.out -w '%{http_code}\n' http://127.0.0.1:8787/api/admin/auth/me
```

## Workflow 4: Partial Restore from Full Snapshot

Files only (keep current DB):

```bash
cd /home/eagles/dockerz/sis
tools/sis-full-restore-snapshot.sh \
  --snapshot-dir /home/eagles/dockerz/backups/full-system/<snapshot-folder> \
  --skip-db \
  --yes
```

DB only (keep current runtime files):

```bash
cd /home/eagles/dockerz/sis
tools/sis-full-restore-snapshot.sh \
  --snapshot-dir /home/eagles/dockerz/backups/full-system/<snapshot-folder> \
  --skip-files \
  --yes
```

## Post-Restore Verification Checklist

1. `systemctl is-active exercise-mailer.service` is `active`.
2. `GET /healthz` returns `200`.
3. `GET /api/admin/auth/me` without cookie returns `401`.
4. Login with one admin and one teacher account succeeds.
5. Open `/admin/students` and confirm key pages load.
6. Validate the records/queues relevant to the incident.

## Rollback of Failed Restore Attempt

If restore changed files and introduced regressions, use the runtime backup emitted by the restore script:

- `/home/admin.eagles.edu.vn/sis.BEFORE-RESTORE-<timestamp>/`

Re-sync that folder back to runtime and restart the service.

## Guardrails

- `--yes` is mandatory for real restore actions.
- Keep backup labels meaningful (for example `before-user-credential-change`).
- Prefer full snapshot restore for disaster recovery; use DB-only restore for data correction workflows.

## Dev-only backup freshness

The live/admin nightly backup remains owned by the system-level `sis-db-backup.timer`. Dev backup freshness is maintained independently through the existing `sis-db-health-dev.timer`; it does not add a second nightly timer or change the live/admin job. The service runs `tools/dev-db-backup-if-stale.mjs` before its read-only health check every 15 minutes. The guard uses only `.env.dev`, verifies `current_database() = sis_dev`, and creates a restorable dump when the latest verified dev dump is missing, invalid, or older than 24 hours. Dumps go only to `/home/eagles/dockerz/backups/postgres-dev`, with 30-day retention and at least 14 retained dumps. The guard sets the directory to `0700` and files to `0600`. If the backup attempt fails, systemd continues to the health check so `DevDatabaseBackupStale` can report the condition.

Install the dev health timer and its backup freshness guard as the `eagles` user:

```bash
npm run dev:install-db-health-timer
systemctl --user status sis-db-health-dev.timer sis-db-health-dev.service
```

A manual dev-only refresh, if needed, must pin the owning environment and output directory:

```bash
SIS_ENV_FILE=.env.dev DOTENV_CONFIG_PATH=.env.dev NODE_ENV=development \
  /home/eagles/.nvm/versions/node/v22.22.1/bin/node --import dotenv/config \
  tools/db-backup-failsafe.mjs --output-dir /home/eagles/dockerz/backups/postgres-dev \
  --retention-days 30 --keep-min 14
```
