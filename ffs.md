# FreeFileSync Deployment Guide (SIS)

## Usage

### FreeFileSync

Kept sync dirs ACL-safe so root-created `.sync.ffs_db` remains writable by `eagles`.

`-> open` or `→ open` in notes is descriptive text, not a command argument.

#### FreeFileSync CLI syntax reference

```text
FreeFileSync
    [config files: *.ffs_gui/*.ffs_batch]
    [-DirPair directory directory]
    [-Edit]
    [global config file: GlobalSettings.xml]
```

- `config files`: one or more `.ffs_gui` and/or `.ffs_batch` files.
- `-DirPair`: optional override pair(s), supported for at most one config file.
- `-Edit`: open selected config for editing only (do not execute sync).
- `global config file`: optional alternate `GlobalSettings.xml`.

#### List 1. Definitive wrapper commands by mode

##### List 1.1 GUI mode

1. `ffs-sis-public-root --gui`
2. `ffs-sis-public-root --edit`
3. `ffs-sis-root --gui`
4. `ffs-sis-root --edit`
5. `ffs-megs-root --gui`
6. `ffs-megs-root --edit`

##### List 1.2 CLI/BATCH mode

#### SIS

Use both `sis-public-root` & `sis-root for full` sync

```bash
ffs-sis-public-root
```

- above cmd runs `ffs-sis-public-root --batch`

```bash
ffs-sis-root
```

- above cmd runs `ffs-sis-root --batch`

---

#### MEGS

1. `ffs-megs-root`
2. `ffs-megs-root --batch`

#### Table 1. Usage by mode and batch (function-focused)

| Mode      | Batch name   | Wrapper command(s)                                     | Function                                                         |
|-----------|--------------|--------------------------------------------------------|------------------------------------------------------------------|
| GUI       | `sis-public` | `ffs-sis-public-root --gui`                            | Open FreeFileSync UI with the sis-public profile loaded.¹        |
| GUI       | `sis-public` | `ffs-sis-public-root --edit`                           | Open sis-public profile in edit-only mode; do not execute sync.² |
| CLI/BATCH | `sis-public` | `ffs-sis-public-root` or `ffs-sis-public-root --batch` | Execute sis-public batch synchronization.³                       |
| GUI       | `sis`        | `ffs-sis-root --gui`                                   | Open FreeFileSync UI with the sis profile loaded.⁴               |
| GUI       | `sis`        | `ffs-sis-root --edit`                                  | Open sis profile in edit-only mode; do not execute sync.⁵        |
| CLI/BATCH | `sis`        | `ffs-sis-root` or `ffs-sis-root --batch`               | Execute sis batch synchronization.⁶                              |
| GUI       | `megs`       | `ffs-megs-root --gui`                                  | Open FreeFileSync UI with the megs profile loaded.⁷              |
| GUI       | `megs`       | `ffs-megs-root --edit`                                 | Open megs profile in edit-only mode; do not execute sync.⁸       |
| CLI/BATCH | `megs`       | `ffs-megs-root` or `ffs-megs-root --batch`             | Execute megs batch synchronization.⁹                             |

#### Table 2. Addendum: config file mapping for Table 1 footnotes

| Wrapper command(s)                                      | Config file(s) used                                                                                                        |
|---------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------|
| `ffs-sis-public-root --gui`¹                            | `/home/eagles/Documents/sync-settings/SyncSettings.sis-public.ffs_gui`                                                     |
| `ffs-sis-public-root --edit`²                           | `/home/eagles/Documents/sync-settings/SyncSettings.sis-public.ffs_gui` + FreeFileSync `-Edit`                              |
| `ffs-sis-public-root` or `ffs-sis-public-root --batch`³ | `/home/eagles/Documents/sync-settings/SyncSettings.sis-public.ffs_batch` + `/root/.config/FreeFileSync/GlobalSettings.xml` |
| `ffs-sis-root --gui`⁴                                   | `/home/eagles/Documents/sync-settings/SyncSettings-sis.ffs_gui`                                                            |
| `ffs-sis-root --edit`⁵                                  | `/home/eagles/Documents/sync-settings/SyncSettings-sis.ffs_gui` + FreeFileSync `-Edit`                                     |
| `ffs-sis-root` or `ffs-sis-root --batch`⁶               | `/home/eagles/Documents/sync-settings/SyncSettings-sis.ffs_batch` + `/root/.config/FreeFileSync/GlobalSettings.xml`        |
| `ffs-megs-root --gui`⁷                                  | `/home/eagles/Documents/sync-settings/SyncSettings-megs.ffs_gui`                                                           |
| `ffs-megs-root --edit`⁸                                 | `/home/eagles/Documents/sync-settings/SyncSettings-megs.ffs_gui` + FreeFileSync `-Edit`                                    |
| `ffs-megs-root` or `ffs-megs-root --batch`⁹             | `/home/eagles/Documents/sync-settings/SyncSettings-megs.ffs_batch` + `/root/.config/FreeFileSync/GlobalSettings.xml`       |

#### List 2. Operational notes

1. Wrappers run `FreeFileSync` as root with `HOME=/root` and root config home `/root/.config`.
2. Extra trailing args are passed through to `FreeFileSync` in both GUI and batch modes.
3. `--batch` is optional because batch mode is the default when no mode flag is provided.
4. GUI and batch completion dialogs stay open for manual review (`AutoClose=false`).
5. CLI batch wrappers print changed file/folder entries from the run log after sync finishes.

#### List 3. Runtime log and ACL notes

1. `_gtk2-engines-pixbuf_` is installed.
2. New logs are written under `/root/.config/FreeFileSync/Logs/...`.
3. `/home/eagles/.config/FreeFileSync/Logs` is no longer touched by root.
4. New `.sync.ffs_db` files are `root:eagles` with writable ACL for `eagles`.

## FreeFileSync setup to deploy SIS

This document codifies the FreeFileSync setup to deploy SIS to:

- `/home/admin.eagles.edu.vn/sis` (backend runtime)
- `/home/admin.eagles.edu.vn/public_html` (public web files)

## Goal

Deploy only what is needed:

- Runtime app code + Prisma assets into `/home/admin.eagles.edu.vn/sis`
- Admin UI HTML into `/home/admin.eagles.edu.vn/public_html/sis-admin`

## Important Filter Rule

In FreeFileSync, entries are matched relative to the selected folder pair root.

- Include list: item must match at least one include rule.
- Exclude list: item must match none of the exclude rules.
- Do not put `*` (or `\*`) in Exclude unless you intentionally want to hide everything.

## Pair A: SIS Runtime Deploy

- Source (left): `/home/eagles/dockerz/sis`
- Target (right): `/home/admin.eagles.edu.vn/sis`
- Sync variant: `Mirror`

Include filter:

```text
\server\
\prisma\
\schemas\
\web-asset\
\package.json
\package-lock.json
\prisma.config.ts
\.nvmrc
```

Exclude filter:

```text

```

Optional Exclude additions (safe):

```text
\web-asset\admin\*.bak
```

## Pair B: Public Admin UI Deploy

- Source (left): `/home/eagles/dockerz/sis`
- Target (right): `/home/admin.eagles.edu.vn/public_html/sis-admin`
- Sync variant: `Mirror`

Include filter:

```text
\web-asset\admin\student-admin.html
```

Exclude filter:

```text

```

If you set Source to `/home/eagles/dockerz/sis/web-asset/admin` instead, then include must be:

```text
\student-admin.html
```

## Run Order

1. Run Pair A (`sis-runtime`) sync.
2. On target runtime dir:
   - `cd /home/admin.eagles.edu.vn/sis`
   - `npm ci --omit=dev`
   - `npm run db:generate`
   - `npm run db:migrate:deploy`
   - restart SIS service on port `8787`
3. Run Pair B (`sis-public`) sync.
4. Reload nginx after config update.

## Codified Commands (Sync + Runtime Restart)

Use these npm commands from `/home/eagles/dockerz/sis` to enforce restart-after-sync policy:

```bash
npm run sync:full:sis-root:restart-runtimes
npm run sync:full:sis-public-root:restart-runtimes
```

Behavior:

1. Runs the selected FreeFileSync batch profile.
2. Restarts live runtime (`exercise-mailer.service`, port `8787`) and checks `/healthz`.
3. Restarts local dev runtime (port `8788`) and checks `/healthz`.

Restart-only helper (no sync):

```bash
npm run runtimes:restart
```

## Systemd Runtime Policy (Canonical)

Use one runtime root only: `/home/admin.eagles.edu.vn/sis`.
Do not run the service from `/home/eagles/dockerz/sis`.

### Unit contract

Service file: `/etc/systemd/system/exercise-mailer.service`

```ini
[Service]
WorkingDirectory=/home/admin.eagles.edu.vn/sis
ExecStart=/home/eagles/.nvm/versions/node/v20.19.4/bin/node /home/admin.eagles.edu.vn/sis/server/exercise-mailer.mjs
EnvironmentFile=/home/admin.eagles.edu.vn/sis/.env
User=eagles
Group=eagles
Restart=always
RestartSec=3
```

Drop-in file: `/etc/systemd/system/exercise-mailer.service.d/10-self-heal.conf`

```ini
[Service]
Environment=SIS_RUNTIME_SELF_HEAL_ENABLED=true
Environment=SIS_RUNTIME_SELF_HEAL_SOURCE_ROOT=/home/admin.eagles.edu.vn/sis
Environment=SIS_RUNTIME_SELF_HEAL_RUNTIME_ROOT=/home/admin.eagles.edu.vn/sis
Environment=SIS_RUNTIME_SELF_HEAL_INTERVAL_MS=15000
```

### Runtime `.env` policy

Runtime env file must be `/home/admin.eagles.edu.vn/sis/.env` with mode `0600` and owner `eagles:eagles`.
Keep only runtime keys needed by SIS service:

```text
DATABASE_URL
EXERCISE_MAILER_HOST
EXERCISE_MAILER_ORIGIN
EXERCISE_MAILER_PATH
EXERCISE_MAILER_PORT
EXERCISE_MAILER_RECIPIENTS
MAILER_DEBUG
REDIS_URL
REDIS_SESSION_URL
REDIS_CACHE_URL
SMTP_FROM
SMTP_HOST
SMTP_PASS
SMTP_PORT
SMTP_SECURE
SMTP_USER
STUDENT_ADMIN_STORE_ENABLED
STUDENT_ADMIN_USER
STUDENT_ADMIN_PASS
```

### Post-deploy verification

```bash
sudo systemctl daemon-reload
sudo systemctl restart exercise-mailer.service
sudo systemctl show exercise-mailer.service -p WorkingDirectory -p ExecStart -p EnvironmentFiles --no-pager
curl -fsS http://127.0.0.1:8787/healthz
```

## Nginx Wiring (Required)

For [admin.eagles.edu.vn.conf](deploy/nginx/admin.eagles.edu.vn.conf), ensure these blocks exist:

```nginx
location = /admin/students {
    include /etc/nginx/snippets/ielts-security-headers.conf;
    expires off;
    add_header Cache-Control "no-cache, must-revalidate" always;
    try_files /sis-admin/student-admin.html =404;
}

location = /admin/students/ {
    return 308 /admin/students;
}
```

API routes stay proxied to `127.0.0.1:8787` (already configured in this repo config).

## Quick Troubleshooting

If `student-admin.html` does not appear on the left panel:

1. Confirm source root is `/home/eagles/dockerz/sis`.
2. Include only:
   - `\web-asset\admin\student-admin.html`
3. Exclude must be empty.
4. Clear any conflicting Global Filter.
5. Re-run Compare.
