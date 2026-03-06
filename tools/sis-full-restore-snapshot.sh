#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="/home/eagles/dockerz/sis"
RUNTIME_ROOT="/home/admin.eagles.edu.vn/sis"
SNAPSHOT_DIR=""
SERVICE_NAME="exercise-mailer.service"
MAILER_PORT="${MAILER_PORT:-8787}"
CONFIRM=0
SKIP_FILES=0
SKIP_DB=0
RESTART=1
HEALTH_CHECK=1

usage() {
  cat <<'USAGE'
Usage: sis-full-restore-snapshot.sh --snapshot-dir PATH [options]

Restores a full-system snapshot created by sis-full-backup-snapshot.sh.

Options:
  --snapshot-dir PATH  Snapshot directory path (required).
  --source-root PATH   Source root (default: /home/eagles/dockerz/sis).
  --runtime-root PATH  Runtime root (default: /home/admin.eagles.edu.vn/sis).
  --service NAME       Service name (default: exercise-mailer.service).
  --skip-files         Skip runtime file restore.
  --skip-db            Skip DB restore.
  --no-restart         Skip service restart.
  --skip-health-check  Skip /healthz and /api/admin/auth/me checks.
  --yes                Required to execute restore.
  -h, --help           Show help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --snapshot-dir)
      SNAPSHOT_DIR="$2"
      shift 2
      ;;
    --source-root)
      SOURCE_ROOT="$2"
      shift 2
      ;;
    --runtime-root)
      RUNTIME_ROOT="$2"
      shift 2
      ;;
    --service)
      SERVICE_NAME="$2"
      shift 2
      ;;
    --skip-files)
      SKIP_FILES=1
      shift
      ;;
    --skip-db)
      SKIP_DB=1
      shift
      ;;
    --no-restart)
      RESTART=0
      shift
      ;;
    --skip-health-check)
      HEALTH_CHECK=0
      shift
      ;;
    --yes)
      CONFIRM=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${SNAPSHOT_DIR}" ]]; then
  echo "--snapshot-dir is required" >&2
  usage >&2
  exit 1
fi

if [[ "${CONFIRM}" -ne 1 ]]; then
  echo "Refusing to restore without --yes" >&2
  exit 1
fi

if [[ ! -d "${SOURCE_ROOT}" ]]; then
  echo "Source root not found: ${SOURCE_ROOT}" >&2
  exit 1
fi

if [[ ! -d "${RUNTIME_ROOT}" ]]; then
  echo "Runtime root not found: ${RUNTIME_ROOT}" >&2
  exit 1
fi

if [[ ! -d "${SNAPSHOT_DIR}" ]]; then
  echo "Snapshot directory not found: ${SNAPSHOT_DIR}" >&2
  exit 1
fi

if [[ "${SKIP_FILES}" -ne 1 && ! -d "${SNAPSHOT_DIR}/app" ]]; then
  echo "Snapshot missing app directory: ${SNAPSHOT_DIR}/app" >&2
  exit 1
fi

if [[ "${SKIP_DB}" -ne 1 && ! -f "${SNAPSHOT_DIR}/db/latest.json" ]]; then
  echo "Snapshot missing db/latest.json: ${SNAPSHOT_DIR}/db/latest.json" >&2
  exit 1
fi

HAS_PG_RESTORE=0
if command -v pg_restore >/dev/null 2>&1; then
  HAS_PG_RESTORE=1
fi

if [[ "${SKIP_DB}" -ne 1 && "${HAS_PG_RESTORE}" -ne 1 ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "pg_restore missing and docker not available; cannot restore DB." >&2
    exit 1
  fi
  if ! docker ps --format '{{.Names}}' | grep -Fxq "sis-postgres"; then
    echo "pg_restore missing and docker container sis-postgres is not running." >&2
    exit 1
  fi
fi

if [[ "${SKIP_DB}" -ne 1 && "${HAS_PG_RESTORE}" -eq 1 && ! -f "${SOURCE_ROOT}/tools/db-restore-failsafe.mjs" ]]; then
  echo "Missing restore tool: ${SOURCE_ROOT}/tools/db-restore-failsafe.mjs" >&2
  exit 1
fi

read_env_value() {
  local env_path="$1"
  local key="$2"
  ENV_PATH="${env_path}" KEY_NAME="${key}" node --input-type=module <<'EOF'
import fs from "node:fs"
const envPath = process.env.ENV_PATH
const keyName = process.env.KEY_NAME
const raw = fs.readFileSync(envPath, "utf8")
let value = ""
for (const rawLine of raw.split(/\r?\n/u)) {
  const line = rawLine.trim()
  if (!line || line.startsWith("#")) continue
  const idx = line.indexOf("=")
  if (idx < 0) continue
  const key = line.slice(0, idx).trim()
  if (key !== keyName) continue
  value = line.slice(idx + 1).trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  break
}
process.stdout.write(value)
EOF
}

resolve_dump_path() {
  local db_dir="$1"
  DB_DIR="${db_dir}" node --input-type=module <<'EOF'
import fs from "node:fs"
import path from "node:path"
const dbDir = process.env.DB_DIR
const latestPath = path.resolve(dbDir, "latest.json")
const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"))
const candidate = latest.backupPath || latest.backupFile || latest.backupFilename || ""
if (!candidate) process.exit(2)
const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(dbDir, candidate)
process.stdout.write(resolved)
EOF
}

parse_database_url_tsv() {
  local value="$1"
  DATABASE_URL_VALUE="${value}" node --input-type=module <<'EOF'
const url = new URL(process.env.DATABASE_URL_VALUE)
const user = decodeURIComponent(url.username || "")
const pass = decodeURIComponent(url.password || "")
const host = url.hostname || "127.0.0.1"
const port = String(url.port || "5432")
const db = (url.pathname || "").replace(/^\/+/u, "")
process.stdout.write([user, pass, host, port, db].join("\t"))
EOF
}

echo "[restore] snapshot_dir=${SNAPSHOT_DIR}"
echo "[restore] runtime_root=${RUNTIME_ROOT}"
echo "[restore] skip_files=${SKIP_FILES} skip_db=${SKIP_DB} restart=${RESTART} health_check=${HEALTH_CHECK}"

timestamp="$(date +%Y%m%d-%H%M%S)"
runtime_backup_dir="${RUNTIME_ROOT}.BEFORE-RESTORE-${timestamp}"

if [[ "${SKIP_FILES}" -ne 1 ]]; then
  echo "[step] backing up current runtime files -> ${runtime_backup_dir}"
  mkdir -p "${runtime_backup_dir}"
  rsync -a --delete "${RUNTIME_ROOT}/" "${runtime_backup_dir}/"

  echo "[step] restoring runtime files from snapshot"
  rsync -a --delete "${SNAPSHOT_DIR}/app/" "${RUNTIME_ROOT}/"
fi

if [[ "${SKIP_DB}" -ne 1 ]]; then
  echo "[step] resolving DB dump path"
  dump_path="$(resolve_dump_path "${SNAPSHOT_DIR}/db")"
  if [[ ! -f "${dump_path}" ]]; then
    echo "DB dump file not found: ${dump_path}" >&2
    exit 1
  fi

  database_url="$(read_env_value "${RUNTIME_ROOT}/.env" "DATABASE_URL")"
  if [[ -z "${database_url}" ]]; then
    echo "DATABASE_URL missing in ${RUNTIME_ROOT}/.env" >&2
    exit 1
  fi

  echo "[step] restoring database from ${dump_path}"
  if [[ "${HAS_PG_RESTORE}" -eq 1 ]]; then
    (
      cd "${SOURCE_ROOT}"
      DATABASE_URL="${database_url}" node tools/db-restore-failsafe.mjs \
        --yes \
        --clean \
        --single-transaction \
        --file "${dump_path}"
    )
  else
    db_parts="$(parse_database_url_tsv "${database_url}")"
    IFS=$'\t' read -r db_user db_pass db_host db_port db_name <<< "${db_parts}"
    if [[ -z "${db_user}" || -z "${db_name}" ]]; then
      echo "Unable to parse DATABASE_URL for docker restore fallback" >&2
      exit 1
    fi

    tmp_in_container="/tmp/sis-restore-$(date +%Y%m%d-%H%M%S).dump"
    docker cp "${dump_path}" "sis-postgres:${tmp_in_container}"
    docker exec \
      -e "PGPASSWORD=${db_pass}" \
      sis-postgres \
      pg_restore \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges \
        --exit-on-error \
        --single-transaction \
        -h "${db_host}" \
        -p "${db_port}" \
        -U "${db_user}" \
        -d "${db_name}" \
        "${tmp_in_container}"
    docker exec sis-postgres rm -f "${tmp_in_container}" >/dev/null || true
  fi
fi

if [[ "${RESTART}" -eq 1 ]]; then
  echo "[step] restarting ${SERVICE_NAME}"
  sudo -n systemctl restart "${SERVICE_NAME}"
  systemctl is-active "${SERVICE_NAME}" >/dev/null
else
  echo "[step] restart skipped (--no-restart)"
fi

if [[ "${HEALTH_CHECK}" -eq 1 ]]; then
  echo "[step] health checks"
  health_code="$(curl -sS -o /tmp/sis-restore-health.out -w '%{http_code}' "http://127.0.0.1:${MAILER_PORT}/healthz")"
  me_code="$(curl -sS -o /tmp/sis-restore-auth-me.out -w '%{http_code}' "http://127.0.0.1:${MAILER_PORT}/api/admin/auth/me")"
  echo "  /healthz => ${health_code}"
  echo "  /api/admin/auth/me => ${me_code}"

  if [[ "${health_code}" != "200" ]]; then
    echo "Health check failed; expected 200, got ${health_code}" >&2
    exit 1
  fi
  if [[ "${me_code}" != "401" ]]; then
    echo "Auth check failed; expected 401, got ${me_code}" >&2
    exit 1
  fi
else
  echo "[step] health checks skipped (--skip-health-check)"
fi

echo "[ok] restore complete"
if [[ "${SKIP_FILES}" -ne 1 ]]; then
  echo "[info] previous_runtime_backup=${runtime_backup_dir}"
fi
