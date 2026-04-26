#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="/home/eagles/dockerz/sis"
RUNTIME_ROOT="/home/admin.eagles.edu.vn/sis"
EXPECTED_DB_NAME="sis"
CHECK_ONLY=0
CONFIRM=0
SKIP_BACKUP=0

usage() {
  cat <<'USAGE'
Usage: deploy-db-fields-safe.sh [options]

Safe live DB workflow for adding fields via Prisma migrations:
1) verify target DB identity
2) run migration preflight
3) backup DB
4) apply migrate deploy
5) verify post-status

Write operations are blocked unless --yes is provided.

Options:
  --check-only            Run preflight only; no backup, no migration.
  --yes                   Required for real backup + migration apply.
  --skip-backup           Skip backup step (not recommended).
  --expected-db-name NAME Expected current_database() value (default: sis).
  -h, --help              Show help.

Fixed paths:
  SOURCE_ROOT=/home/eagles/dockerz/sis
  RUNTIME_ROOT=/home/admin.eagles.edu.vn/sis
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only)
      CHECK_ONLY=1
      shift
      ;;
    --yes)
      CONFIRM=1
      shift
      ;;
    --skip-backup)
      SKIP_BACKUP=1
      shift
      ;;
    --expected-db-name)
      EXPECTED_DB_NAME="${2:-}"
      shift 2
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

if [[ ! -d "${SOURCE_ROOT}" ]]; then
  echo "Source root not found: ${SOURCE_ROOT}" >&2
  exit 1
fi

if [[ ! -d "${RUNTIME_ROOT}" ]]; then
  echo "Runtime root not found: ${RUNTIME_ROOT}" >&2
  exit 1
fi

if [[ ! -f "${RUNTIME_ROOT}/.env" ]]; then
  echo "Runtime .env not found: ${RUNTIME_ROOT}/.env" >&2
  exit 1
fi

if [[ ! -x "${SOURCE_ROOT}/tools/db-backup-smart.sh" ]]; then
  echo "Missing backup tool: ${SOURCE_ROOT}/tools/db-backup-smart.sh" >&2
  exit 1
fi

if [[ ! -f "${SOURCE_ROOT}/prisma/schema.prisma" ]]; then
  echo "Missing source Prisma schema: ${SOURCE_ROOT}/prisma/schema.prisma" >&2
  exit 1
fi

NODE_BIN="$(command -v node)"
if [[ -z "${NODE_BIN}" ]]; then
  echo "node is required" >&2
  exit 1
fi

DATABASE_URL="$(
  RUNTIME_ROOT="${RUNTIME_ROOT}" "${NODE_BIN}" --input-type=module <<'EOF'
import fs from 'node:fs'
import path from 'node:path'
const envPath = path.resolve(process.env.RUNTIME_ROOT, '.env')
const raw = fs.readFileSync(envPath, 'utf8')
let value = ''
for (const rawLine of raw.split(/\r?\n/u)) {
  const line = rawLine.trim()
  if (!line || line.startsWith('#')) continue
  const idx = line.indexOf('=')
  if (idx < 0) continue
  const key = line.slice(0, idx).trim()
  if (key !== 'DATABASE_URL') continue
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
)"

if [[ -z "${DATABASE_URL}" ]]; then
  echo "DATABASE_URL is missing in ${RUNTIME_ROOT}/.env" >&2
  exit 1
fi

redact_url() {
  local raw="$1"
  echo "${raw}" | sed -E 's#(postgres(ql)?://)[^/@]+@#\1****@#'
}

is_pending_migrate_status_output() {
  local output="$1"
  if echo "${output}" | grep -qi "have not yet been applied"; then
    return 0
  fi
  return 1
}

run_prisma_migrate_status() {
  local phase="$1"
  local allow_pending="${2:-0}"
  local output=""
  local status_code=0

  set +e
  output="$(
    cd "${RUNTIME_ROOT}" && npx prisma migrate status 2>&1
  )"
  status_code=$?
  set -e

  echo "${output}"

  if [[ "${status_code}" -eq 0 ]]; then
    return 0
  fi

  if [[ "${allow_pending}" -eq 1 ]] && is_pending_migrate_status_output "${output}"; then
    echo "[preflight] pending migrations detected; continuing workflow."
    return 0
  fi

  echo "[error] prisma migrate status failed during ${phase} (exit=${status_code})" >&2
  return "${status_code}"
}

echo "[deploy-db-fields-safe] source=${SOURCE_ROOT}"
echo "[deploy-db-fields-safe] runtime=${RUNTIME_ROOT}"
echo "[deploy-db-fields-safe] database=$(redact_url "${DATABASE_URL}")"
echo "[deploy-db-fields-safe] expected_db_name=${EXPECTED_DB_NAME}"

echo "[step] preflight: database identity check"
db_identity="$(
  cd "${SOURCE_ROOT}"
  DATABASE_URL="${DATABASE_URL}" "${NODE_BIN}" --input-type=module <<'EOF'
import process from 'node:process'
import { Client } from 'pg'

const client = new Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
const result = await client.query('SELECT current_database() AS db_name, current_schema() AS schema_name, NOW() AS snapshot_at')
await client.end()
const row = result.rows[0] || {}
const snapshot = row.snapshot_at ? new Date(row.snapshot_at).toISOString() : ''
process.stdout.write([String(row.db_name || ''), String(row.schema_name || ''), snapshot].join('\t'))
EOF
)"
IFS=$'\t' read -r actual_db_name actual_schema snapshot_at <<< "${db_identity}"

echo "[preflight] current_database=${actual_db_name} schema=${actual_schema} snapshot=${snapshot_at}"

if [[ -n "${EXPECTED_DB_NAME}" && "${actual_db_name}" != "${EXPECTED_DB_NAME}" ]]; then
  echo "Refusing to continue: expected current_database()=${EXPECTED_DB_NAME}, got ${actual_db_name}" >&2
  exit 1
fi

echo "[step] preflight: prisma migrate status (runtime root)"
run_prisma_migrate_status "preflight" 1

if [[ "${CHECK_ONLY}" -eq 1 ]]; then
  echo "[ok] check-only complete (no writes performed)"
  exit 0
fi

if [[ "${CONFIRM}" -ne 1 ]]; then
  echo "Refusing to write: pass --yes to run backup + migrate deploy" >&2
  exit 1
fi

if [[ "${SKIP_BACKUP}" -ne 1 ]]; then
  echo "[step] backup: creating DB backup before migration"
  (
    cd "${SOURCE_ROOT}"
    tools/db-backup-smart.sh --database-url "${DATABASE_URL}"
  )
else
  echo "[warn] backup skipped (--skip-backup)"
fi

echo "[step] migrate: npm run db:migrate:deploy (runtime root)"
(
  cd "${RUNTIME_ROOT}"
  npm run db:migrate:deploy
)

echo "[step] verify: prisma migrate status (runtime root)"
run_prisma_migrate_status "post-deploy verification" 0

echo "[ok] live DB field migration workflow complete"
