# DB Backup Failsafe Runbook

This project now includes automated PostgreSQL backup and guarded restore tooling.

## Scripts

- `npm run db:backup`
  - Runs `pg_dump` in custom format.
  - Writes checksum (`.sha256`) and metadata (`.json`).
  - Verifies archive with `pg_restore --list`.
  - Updates `latest.json` pointer.
  - Applies retention cleanup.

- `npm run db:backup:dry`
  - Prints the exact planned actions, no writes.

- `npm run db:backup:no-prune`
  - Creates/updates backup artifacts but skips retention deletes.

- `npm run db:restore -- --file latest --yes --clean`
  - Restores a backup archive into the configured `DATABASE_URL`.
  - Requires `--yes` for real restore.
  - `--clean` enables `pg_restore --clean --if-exists`.

- `npm run db:restore:verify -- --file latest`
  - Verifies archive structure and checksum only.

## Required Environment

- `DATABASE_URL` (required for backup/restore unless passed by flag)

Optional:

- `DB_BACKUP_DIR` (default: `backups/postgres`)
- `DB_BACKUP_RETENTION_DAYS` (default: `30`)
- `DB_BACKUP_KEEP_MIN` (default: `14`)
- `DB_BACKUP_STALE_LOCK_MINUTES` (default: `180`)

Required binaries on the host:

- `pg_dump`
- `pg_restore`

On Ubuntu/Debian:

```bash
sudo apt-get update && sudo apt-get install -y postgresql-client
```

## Backup Output Layout

Inside `DB_BACKUP_DIR`:

- `postgres-YYYYMMDD-HHMMSSZ.dump` - custom archive
- `postgres-YYYYMMDD-HHMMSSZ.sha256` - SHA-256 checksum sidecar
- `postgres-YYYYMMDD-HHMMSSZ.json` - metadata sidecar
- `manifest.jsonl` - append-only backup history
- `latest.json` - pointer to newest successful backup
- `.backup.lock` - active lock file while backup is running

## Scheduling

Cron example (every 2 hours):

```bash
0 */2 * * * cd /home/eagles/dockerz/megs && /usr/bin/npm run db:backup >> /var/log/megs-db-backup.log 2>&1
```

Systemd timer is preferred for production:

```ini
# /etc/systemd/system/megs-db-backup.service
[Unit]
Description=MEGS PostgreSQL backup

[Service]
Type=oneshot
WorkingDirectory=/home/eagles/dockerz/megs
ExecStart=/usr/bin/npm run db:backup
```

```ini
# /etc/systemd/system/megs-db-backup.timer
[Unit]
Description=Run MEGS PostgreSQL backup every 2 hours

[Timer]
OnCalendar=hourly
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
```

## Fail-safe Behavior

- Lock file prevents concurrent backup runs.
- Stale lock replacement is bounded by `DB_BACKUP_STALE_LOCK_MINUTES`.
- Temporary dump file is cleaned up on failure.
- Backup considered successful only after:
  - `pg_dump` completes
  - optional `pg_restore --list` verification completes
  - checksum and metadata are written
- Retention never removes the newest `DB_BACKUP_KEEP_MIN` backups.

## Restore Guardrails

- Real restore requires explicit `--yes`.
- `--verify-only` validates archive and checksum without modifying DB.
- Use `--dry-run` to inspect restore command first.

Example restore flow:

```bash
npm run db:restore:verify -- --file latest
npm run db:restore -- --file latest --yes --clean
```

## Operational Recommendation

Keep one additional off-host copy:

- Rsync/S3/Backblaze target from `DB_BACKUP_DIR`
- Encrypt at rest if backups leave the database host
