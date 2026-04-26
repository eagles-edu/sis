#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="/home/eagles/dockerz/sis"
DATABASE_URL_INPUT="${DATABASE_URL:-}"
RUNTIME_ENV_PATH=""
OUTPUT_DIR=""
NO_PRUNE=0
DRY_RUN=0
NO_VERIFY=0
CONTAINER_NAME="sis-postgres"

usage() {
  cat <<'USAGE'
Usage: db-backup-smart.sh [options]

Backup wrapper that prefers tools/db-backup-failsafe.mjs when pg_dump is
available, and falls back to dockerized pg_dump/pg_restore (sis-postgres).

Options:
  --database-url URL   PostgreSQL URL (default: DATABASE_URL env var).
  --runtime-env PATH   Read DATABASE_URL from this .env file.
  --output-dir DIR     Backup output directory.
  --dry-run            Print actions only.
  --no-verify          Skip pg_restore --list verification.
  --no-prune           Disable prune behavior.
  --container NAME     Docker container name (default: sis-postgres).
  -h, --help           Show help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database-url)
      DATABASE_URL_INPUT="$2"
      shift 2
      ;;
    --runtime-env)
      RUNTIME_ENV_PATH="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --no-verify)
      NO_VERIFY=1
      shift
      ;;
    --no-prune)
      NO_PRUNE=1
      shift
      ;;
    --container)
      CONTAINER_NAME="$2"
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

if [[ -n "${RUNTIME_ENV_PATH}" && -z "${DATABASE_URL_INPUT}" ]]; then
  if [[ ! -f "${RUNTIME_ENV_PATH}" ]]; then
    echo "Runtime env not found: ${RUNTIME_ENV_PATH}" >&2
    exit 1
  fi
  DATABASE_URL_INPUT="$(
    ENV_PATH="${RUNTIME_ENV_PATH}" node --input-type=module <<'EOF'
import fs from "node:fs"
const envPath = process.env.ENV_PATH
const raw = fs.readFileSync(envPath, "utf8")
let value = ""
for (const rawLine of raw.split(/\r?\n/u)) {
  const line = rawLine.trim()
  if (!line || line.startsWith("#")) continue
  const idx = line.indexOf("=")
  if (idx < 0) continue
  const key = line.slice(0, idx).trim()
  if (key !== "DATABASE_URL") continue
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
fi

if [[ -z "${DATABASE_URL_INPUT}" ]]; then
  echo "DATABASE_URL is required (env, --database-url, or --runtime-env)." >&2
  exit 1
fi

if [[ -z "${OUTPUT_DIR}" ]]; then
  OUTPUT_DIR="${DB_BACKUP_DIR:-${SOURCE_ROOT}/backups/postgres}"
fi

mkdir -p "${OUTPUT_DIR}"

if command -v pg_dump >/dev/null 2>&1 && command -v pg_restore >/dev/null 2>&1; then
  cmd=(node "${SOURCE_ROOT}/tools/db-backup-failsafe.mjs" --database-url "${DATABASE_URL_INPUT}" --output-dir "${OUTPUT_DIR}")
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    cmd+=("--dry-run")
  fi
  if [[ "${NO_VERIFY}" -eq 1 ]]; then
    cmd+=("--no-verify")
  fi
  if [[ "${NO_PRUNE}" -eq 1 ]]; then
    cmd+=("--no-prune")
  fi
  "${cmd[@]}"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "pg_dump missing and docker not available; cannot backup." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
  echo "pg_dump missing and docker container not running: ${CONTAINER_NAME}" >&2
  exit 1
fi

db_parts="$(
  DATABASE_URL="${DATABASE_URL_INPUT}" node --input-type=module <<'EOF'
const url = new URL(process.env.DATABASE_URL)
const user = decodeURIComponent(url.username || "")
const pass = decodeURIComponent(url.password || "")
const host = url.hostname || "127.0.0.1"
const port = String(url.port || "5432")
const db = (url.pathname || "").replace(/^\/+/u, "")
const redacted = process.env.DATABASE_URL.replace(/(postgres(?:ql)?:\/\/)[^/@]+@/u, "$1****@")
process.stdout.write([user, pass, host, port, db, redacted].join("\t"))
EOF
)"
IFS=$'\t' read -r db_user db_pass db_host db_port db_name db_redacted <<< "${db_parts}"

if [[ -z "${db_user}" || -z "${db_name}" ]]; then
  echo "Failed to parse DATABASE_URL user/database." >&2
  exit 1
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
dump_name="db-backup-${timestamp}.dump"
dump_path="${OUTPUT_DIR}/${dump_name}"
sha_path="${OUTPUT_DIR}/db-backup-${timestamp}.sha256"
latest_json="${OUTPUT_DIR}/latest.json"
tmp_in_container="/tmp/${dump_name}"

echo "[backup-smart] mode=docker-fallback container=${CONTAINER_NAME}"
echo "[backup-smart] database=${db_redacted}"
echo "[backup-smart] output=${dump_path}"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "[dry-run] docker exec ... pg_dump > ${dump_path}"
  exit 0
fi

docker exec \
  -e "PGPASSWORD=${db_pass}" \
  "${CONTAINER_NAME}" \
  pg_dump \
    -h "${db_host}" \
    -p "${db_port}" \
    -U "${db_user}" \
    -d "${db_name}" \
    -Fc \
    -f "${tmp_in_container}"

docker cp "${CONTAINER_NAME}:${tmp_in_container}" "${dump_path}"
docker exec "${CONTAINER_NAME}" rm -f "${tmp_in_container}" >/dev/null

if [[ "${NO_VERIFY}" -ne 1 ]]; then
  docker cp "${dump_path}" "${CONTAINER_NAME}:${tmp_in_container}"
  verify_out="$(docker exec "${CONTAINER_NAME}" pg_restore --list "${tmp_in_container}" || true)"
  docker exec "${CONTAINER_NAME}" rm -f "${tmp_in_container}" >/dev/null || true
  if [[ -z "${verify_out}" ]]; then
    echo "pg_restore verification returned empty output for ${dump_path}" >&2
    exit 1
  fi
fi

checksum="$(sha256sum "${dump_path}" | awk '{print $1}')"
echo "${checksum}  ${dump_name}" > "${sha_path}"

DUMP_PATH="${dump_path}" DUMP_NAME="${dump_name}" SHA_PATH="${sha_path}" NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  node --input-type=module <<'EOF' > "${latest_json}"
const payload = {
  createdAt: process.env.NOW_ISO,
  backupFile: process.env.DUMP_NAME,
  backupPath: process.env.DUMP_PATH,
  checksumFile: process.env.SHA_PATH,
}
process.stdout.write(JSON.stringify(payload, null, 2))
EOF

echo "[ok] backup: ${dump_path}"
