#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

RUNTIME_ROOT="${RUNTIME_ROOT:-/home/eagles/dockerz/megs}"
SERVICE_NAME="${SERVICE_NAME:-exercise-mailer.service}"
MAILER_PORT="${MAILER_PORT:-8787}"
RESTART_SERVICE=1
MODE="sync"
SCOPE="full"
RUN_HEALTH_CHECK=1
PINNED_MAILER_HOST="${PINNED_MAILER_HOST:-127.0.0.1}"
PINNED_MAILER_PORT="${PINNED_MAILER_PORT:-8787}"
PINNED_ADMIN_STORE_ENABLED="${PINNED_ADMIN_STORE_ENABLED:-true}"
PINNED_STATIC_PREVIEW_ORIGIN="${PINNED_STATIC_PREVIEW_ORIGIN:-http://127.0.0.1:5500}"
PINNED_RUNTIME_PRIMARY_ORIGIN="${PINNED_RUNTIME_PRIMARY_ORIGIN:-https://admin.eagles.edu.vn}"
STRIP_STATIC_PREVIEW_ORIGIN="${STRIP_STATIC_PREVIEW_ORIGIN:-true}"

usage() {
  cat <<'USAGE'
Usage: sis-runtime-resync.sh [options]

Modes:
  (default)            Always sync selected scope.
  --check-only         Detect runtime drift and exit only.
  --sync-on-mismatch   Detect drift first, sync only when mismatch exists.

Scopes:
  --scope full         Compare/sync server/, schemas/, admin HTML, and parent/student/vendor/image assets (default).
  --scope html         Compare/sync only web-asset/admin/student-admin.html.

Options:
  --runtime-root PATH  Runtime root (default: /home/eagles/dockerz/megs)
  --service NAME       systemd service name (default: exercise-mailer.service)
  --mailer-port PORT   Mailer port for post-sync checks (default: 8787)
  --no-restart         Do not restart service after sync.
  --skip-health-check  Skip post-sync /healthz and /api/admin/auth/me checks.
  -h, --help           Show this help text.

Sync contract (applied during sync):
  EXERCISE_MAILER_HOST=127.0.0.1
  EXERCISE_MAILER_PORT=8787
  STUDENT_ADMIN_STORE_ENABLED=true
  EXERCISE_MAILER_ORIGIN removes http://127.0.0.1:5500
  EXERCISE_MAILER_ORIGIN includes https://admin.eagles.edu.vn

Examples:
  ./tools/sis-runtime-resync.sh --check-only --scope html
  ./tools/sis-runtime-resync.sh --sync-on-mismatch --scope html --no-restart
  ./tools/sis-runtime-resync.sh --sync-on-mismatch --scope full
USAGE
}

validate_scope() {
  case "${SCOPE}" in
    full|html) ;;
    *)
      echo "Invalid --scope value: ${SCOPE} (expected: full|html)" >&2
      exit 1
      ;;
  esac
}

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
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  break
}
process.stdout.write(value)
EOF
}

upsert_env_value() {
  local env_path="$1"
  local key="$2"
  local value="$3"
  ENV_PATH="${env_path}" KEY_NAME="${key}" KEY_VALUE="${value}" node --input-type=module <<'EOF'
import fs from "node:fs"

const envPath = process.env.ENV_PATH
const keyName = process.env.KEY_NAME
const keyValue = process.env.KEY_VALUE || ""
const raw = fs.readFileSync(envPath, "utf8")
const lines = raw.split(/\r?\n/u)
if (lines.length && lines[lines.length - 1] === "") lines.pop()

const updated = []
let replaced = false
for (const line of lines) {
  const trimmed = line.trim()
  const idx = line.indexOf("=")
  if (!trimmed || trimmed.startsWith("#") || idx < 0) {
    updated.push(line)
    continue
  }
  const currentKey = line.slice(0, idx).trim()
  if (currentKey !== keyName) {
    updated.push(line)
    continue
  }
  if (!replaced) {
    updated.push(`${keyName}=${keyValue}`)
    replaced = true
  }
}

if (!replaced) {
  if (updated.length && updated[updated.length - 1] !== "") updated.push("")
  updated.push(`${keyName}=${keyValue}`)
}

const next = `${updated.join("\n").replace(/\n+$/u, "")}\n`
if (next !== raw) fs.writeFileSync(envPath, next)
EOF
}

merge_origin_list_with_required() {
  local current_value="$1"
  local required_origin="$2"
  CURRENT_VALUE="${current_value}" REQUIRED_ORIGIN="${required_origin}" node --input-type=module <<'EOF'
const currentValue = String(process.env.CURRENT_VALUE || "")
const requiredOrigin = String(process.env.REQUIRED_ORIGIN || "").trim()
const ordered = []
const seen = new Set()

function pushOrigin(value) {
  const normalized = String(value || "").trim()
  if (!normalized || seen.has(normalized)) return
  seen.add(normalized)
  ordered.push(normalized)
}

pushOrigin(requiredOrigin)
for (const entry of currentValue.split(",")) pushOrigin(entry)

process.stdout.write(ordered.join(","))
EOF
}

remove_origin_from_list() {
  local current_value="$1"
  local remove_origin="$2"
  CURRENT_VALUE="${current_value}" REMOVE_ORIGIN="${remove_origin}" node --input-type=module <<'EOF'
const currentValue = String(process.env.CURRENT_VALUE || "")
const removeOrigin = String(process.env.REMOVE_ORIGIN || "").trim()
const ordered = []
const seen = new Set()

for (const entry of currentValue.split(",")) {
  const normalized = String(entry || "").trim()
  if (!normalized || normalized === removeOrigin || seen.has(normalized)) continue
  seen.add(normalized)
  ordered.push(normalized)
}

process.stdout.write(ordered.join(","))
EOF
}

origin_list_contains() {
  local origin_list="$1"
  local expected_origin="$2"
  ORIGIN_LIST="${origin_list}" EXPECTED_ORIGIN="${expected_origin}" node --input-type=module <<'EOF'
const originList = String(process.env.ORIGIN_LIST || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
const expectedOrigin = String(process.env.EXPECTED_ORIGIN || "").trim()
process.exit(originList.includes(expectedOrigin) ? 0 : 1)
EOF
}

collect_env_contract_drift() {
  local env_path="${RUNTIME_ROOT}/.env"
  if [[ ! -f "${env_path}" ]]; then
    record_drift "[runtime-env] missing runtime env file: ${env_path}"
    return
  fi

  local mailer_host
  mailer_host="$(read_env_value "${env_path}" "EXERCISE_MAILER_HOST")"
  if [[ "${mailer_host}" != "${PINNED_MAILER_HOST}" ]]; then
    record_drift "[runtime-env] EXERCISE_MAILER_HOST=${mailer_host:-<missing>} (expected ${PINNED_MAILER_HOST})"
  fi

  local mailer_port
  mailer_port="$(read_env_value "${env_path}" "EXERCISE_MAILER_PORT")"
  if [[ "${mailer_port}" != "${PINNED_MAILER_PORT}" ]]; then
    record_drift "[runtime-env] EXERCISE_MAILER_PORT=${mailer_port:-<missing>} (expected ${PINNED_MAILER_PORT})"
  fi

  local admin_store_enabled
  admin_store_enabled="$(read_env_value "${env_path}" "STUDENT_ADMIN_STORE_ENABLED")"
  if [[ "${admin_store_enabled}" != "${PINNED_ADMIN_STORE_ENABLED}" ]]; then
    record_drift "[runtime-env] STUDENT_ADMIN_STORE_ENABLED=${admin_store_enabled:-<missing>} (expected ${PINNED_ADMIN_STORE_ENABLED})"
  fi

  local mailer_origin
  mailer_origin="$(read_env_value "${env_path}" "EXERCISE_MAILER_ORIGIN")"
  if [[ -z "${mailer_origin}" ]]; then
    mailer_origin="$(read_env_value "${env_path}" "EXERCISE_MAILER_ORIGINS")"
  fi
  if [[ "${STRIP_STATIC_PREVIEW_ORIGIN}" != "false" ]] && origin_list_contains "${mailer_origin}" "${PINNED_STATIC_PREVIEW_ORIGIN}"; then
    record_drift "[runtime-env] EXERCISE_MAILER_ORIGIN contains dev-only origin ${PINNED_STATIC_PREVIEW_ORIGIN}"
  fi
  if [[ -n "${PINNED_RUNTIME_PRIMARY_ORIGIN}" ]] && ! origin_list_contains "${mailer_origin}" "${PINNED_RUNTIME_PRIMARY_ORIGIN}"; then
    record_drift "[runtime-env] EXERCISE_MAILER_ORIGIN missing ${PINNED_RUNTIME_PRIMARY_ORIGIN}"
  fi
}

sync_runtime_env_contract() {
  local env_path="${RUNTIME_ROOT}/.env"
  if [[ ! -f "${env_path}" ]]; then
    echo "Runtime env file not found: ${env_path}" >&2
    exit 1
  fi

  local current_origin
  current_origin="$(read_env_value "${env_path}" "EXERCISE_MAILER_ORIGIN")"
  if [[ -z "${current_origin}" ]]; then
    current_origin="$(read_env_value "${env_path}" "EXERCISE_MAILER_ORIGINS")"
  fi
  local transformed_origin
  transformed_origin="${current_origin}"
  if [[ "${STRIP_STATIC_PREVIEW_ORIGIN}" != "false" ]]; then
    transformed_origin="$(remove_origin_from_list "${transformed_origin}" "${PINNED_STATIC_PREVIEW_ORIGIN}")"
  fi
  if [[ -n "${PINNED_RUNTIME_PRIMARY_ORIGIN}" ]]; then
    transformed_origin="$(merge_origin_list_with_required "${transformed_origin}" "${PINNED_RUNTIME_PRIMARY_ORIGIN}")"
  fi
  if [[ -z "${transformed_origin}" ]]; then
    echo "Runtime env origin transform produced empty EXERCISE_MAILER_ORIGIN; set PINNED_RUNTIME_PRIMARY_ORIGIN before syncing." >&2
    exit 1
  fi

  upsert_env_value "${env_path}" "EXERCISE_MAILER_HOST" "${PINNED_MAILER_HOST}"
  upsert_env_value "${env_path}" "EXERCISE_MAILER_PORT" "${PINNED_MAILER_PORT}"
  upsert_env_value "${env_path}" "STUDENT_ADMIN_STORE_ENABLED" "${PINNED_ADMIN_STORE_ENABLED}"
  upsert_env_value "${env_path}" "EXERCISE_MAILER_ORIGIN" "${transformed_origin}"

  echo "[sync] runtime env pinned: EXERCISE_MAILER_HOST=${PINNED_MAILER_HOST}, EXERCISE_MAILER_PORT=${PINNED_MAILER_PORT}, STUDENT_ADMIN_STORE_ENABLED=${PINNED_ADMIN_STORE_ENABLED}"
  echo "[sync] runtime env origin: EXERCISE_MAILER_ORIGIN=${transformed_origin}"
}

DRIFT_FOUND=0
DRIFT_LINES=()

record_drift() {
  DRIFT_FOUND=1
  DRIFT_LINES+=("$1")
}

collect_dir_drift() {
  local source_dir="$1"
  local runtime_dir="$2"
  local label="$3"
  if [[ ! -d "${runtime_dir}" ]]; then
    record_drift "[${label}] missing runtime directory: ${runtime_dir}"
    return
  fi
  local diff_output
  diff_output="$(rsync -nrc --delete --itemize-changes "${source_dir}" "${runtime_dir}" | sed '/^$/d')"
  if [[ -n "${diff_output}" ]]; then
    record_drift "[${label}] content mismatch:"
    while IFS= read -r line; do
      record_drift "  ${line}"
    done <<< "${diff_output}"
  fi
}

collect_html_drift() {
  local source_file="${REPO_ROOT}/web-asset/admin/student-admin.html"
  local runtime_file="${RUNTIME_ROOT}/web-asset/admin/student-admin.html"
  if [[ ! -f "${runtime_file}" ]]; then
    record_drift "[admin-html] missing runtime file: ${runtime_file}"
    return
  fi
  if ! cmp -s "${source_file}" "${runtime_file}"; then
    record_drift "[admin-html] content mismatch: ${runtime_file}"
  fi
}

collect_drift() {
  DRIFT_FOUND=0
  DRIFT_LINES=()
  if [[ "${SCOPE}" == "full" ]]; then
    collect_dir_drift "${REPO_ROOT}/server/" "${RUNTIME_ROOT}/server/" "server"
    collect_dir_drift "${REPO_ROOT}/schemas/" "${RUNTIME_ROOT}/schemas/" "schemas"
    collect_dir_drift "${REPO_ROOT}/web-asset/parent/" "${RUNTIME_ROOT}/web-asset/parent/" "parent-assets"
    collect_dir_drift "${REPO_ROOT}/web-asset/student/" "${RUNTIME_ROOT}/web-asset/student/" "student-assets"
    collect_dir_drift "${REPO_ROOT}/web-asset/vendor/" "${RUNTIME_ROOT}/web-asset/vendor/" "vendor-assets"
    collect_dir_drift "${REPO_ROOT}/web-asset/images/" "${RUNTIME_ROOT}/web-asset/images/" "images-assets"
  fi
  collect_html_drift
  collect_env_contract_drift
}

print_drift_report() {
  if [[ "${DRIFT_FOUND}" -eq 0 ]]; then
    echo "[drift] no mismatch detected for scope=${SCOPE}"
    return
  fi
  echo "[drift] mismatch detected for scope=${SCOPE}"
  for line in "${DRIFT_LINES[@]}"; do
    echo "${line}"
  done
}

perform_sync() {
  local timestamp="$1"
  echo "[sync] runtime root: ${RUNTIME_ROOT}"
  echo "[sync] backup timestamp: ${timestamp}"
  echo "[sync] scope: ${SCOPE}"

  mkdir -p "${RUNTIME_ROOT}/web-asset/admin"

  if [[ "${SCOPE}" == "full" ]]; then
    mkdir -p "${RUNTIME_ROOT}/server" "${RUNTIME_ROOT}/schemas" "${RUNTIME_ROOT}/web-asset/parent" "${RUNTIME_ROOT}/web-asset/student" "${RUNTIME_ROOT}/web-asset/vendor" "${RUNTIME_ROOT}/web-asset/images"
    mkdir -p \
      "${RUNTIME_ROOT}/server.BAK-${timestamp}" \
      "${RUNTIME_ROOT}/schemas.BAK-${timestamp}" \
      "${RUNTIME_ROOT}/web-asset/admin.BAK-${timestamp}" \
      "${RUNTIME_ROOT}/web-asset/parent.BAK-${timestamp}" \
      "${RUNTIME_ROOT}/web-asset/student.BAK-${timestamp}" \
      "${RUNTIME_ROOT}/web-asset/vendor.BAK-${timestamp}" \
      "${RUNTIME_ROOT}/web-asset/images.BAK-${timestamp}"

    rsync -a --delete "${RUNTIME_ROOT}/server/" "${RUNTIME_ROOT}/server.BAK-${timestamp}/"
    rsync -a --delete "${RUNTIME_ROOT}/schemas/" "${RUNTIME_ROOT}/schemas.BAK-${timestamp}/"
    rsync -a --delete "${RUNTIME_ROOT}/web-asset/admin/" "${RUNTIME_ROOT}/web-asset/admin.BAK-${timestamp}/"
    rsync -a --delete "${RUNTIME_ROOT}/web-asset/parent/" "${RUNTIME_ROOT}/web-asset/parent.BAK-${timestamp}/"
    rsync -a --delete "${RUNTIME_ROOT}/web-asset/student/" "${RUNTIME_ROOT}/web-asset/student.BAK-${timestamp}/"
    rsync -a --delete "${RUNTIME_ROOT}/web-asset/vendor/" "${RUNTIME_ROOT}/web-asset/vendor.BAK-${timestamp}/"
    rsync -a --delete "${RUNTIME_ROOT}/web-asset/images/" "${RUNTIME_ROOT}/web-asset/images.BAK-${timestamp}/"

    rsync -a "${REPO_ROOT}/server/" "${RUNTIME_ROOT}/server/"
    rsync -a "${REPO_ROOT}/schemas/" "${RUNTIME_ROOT}/schemas/"
    rsync -a "${REPO_ROOT}/web-asset/parent/" "${RUNTIME_ROOT}/web-asset/parent/"
    rsync -a "${REPO_ROOT}/web-asset/student/" "${RUNTIME_ROOT}/web-asset/student/"
    rsync -a "${REPO_ROOT}/web-asset/vendor/" "${RUNTIME_ROOT}/web-asset/vendor/"
    rsync -a "${REPO_ROOT}/web-asset/images/" "${RUNTIME_ROOT}/web-asset/images/"
  else
    mkdir -p "${RUNTIME_ROOT}/web-asset/admin.BAK-${timestamp}"
    if [[ -f "${RUNTIME_ROOT}/web-asset/admin/student-admin.html" ]]; then
      cp "${RUNTIME_ROOT}/web-asset/admin/student-admin.html" "${RUNTIME_ROOT}/web-asset/admin.BAK-${timestamp}/student-admin.html"
    fi
  fi

  rsync -a "${REPO_ROOT}/web-asset/admin/student-admin.html" "${RUNTIME_ROOT}/web-asset/admin/student-admin.html"
  sync_runtime_env_contract
  echo "[sync] runtime files updated"
}

restart_if_requested() {
  if [[ "${RESTART_SERVICE}" -ne 1 ]]; then
    echo "[sync] service restart skipped (--no-restart)"
    return
  fi
  echo "[sync] restarting ${SERVICE_NAME}"
  sudo -n systemctl restart "${SERVICE_NAME}"
  systemctl is-active "${SERVICE_NAME}" >/dev/null
}

run_health_checks() {
  if [[ "${RUN_HEALTH_CHECK}" -ne 1 ]]; then
    echo "[check] skipped (--skip-health-check)"
    return
  fi

  echo "[check] local health and auth routes"
  HEALTH_CODE="$(curl -sS -o /tmp/sis-health.out -w '%{http_code}' "http://127.0.0.1:${MAILER_PORT}/healthz")"
  ME_CODE="$(curl -sS -o /tmp/sis-auth-me.out -w '%{http_code}' "http://127.0.0.1:${MAILER_PORT}/api/admin/auth/me")"

  echo "  /healthz => ${HEALTH_CODE}"
  echo "  /api/admin/auth/me => ${ME_CODE}"

  if [[ "${HEALTH_CODE}" != "200" ]]; then
    echo "Health check failed; expected 200, got ${HEALTH_CODE}" >&2
    exit 1
  fi

  if [[ "${ME_CODE}" != "401" ]]; then
    echo "Admin route check failed; expected 401 (unauthenticated), got ${ME_CODE}" >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime-root)
      RUNTIME_ROOT="$2"
      shift 2
      ;;
    --service)
      SERVICE_NAME="$2"
      shift 2
      ;;
    --mailer-port)
      MAILER_PORT="$2"
      shift 2
      ;;
    --scope)
      SCOPE="$2"
      shift 2
      ;;
    --check-only)
      MODE="check"
      shift
      ;;
    --sync-on-mismatch)
      MODE="sync_on_mismatch"
      shift
      ;;
    --no-restart)
      RESTART_SERVICE=0
      shift
      ;;
    --skip-health-check)
      RUN_HEALTH_CHECK=0
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

validate_scope

collect_drift

if [[ "${MODE}" == "check" ]]; then
  print_drift_report
  if [[ "${DRIFT_FOUND}" -eq 0 ]]; then
    exit 0
  fi
  exit 2
fi

if [[ "${MODE}" == "sync_on_mismatch" ]]; then
  print_drift_report
  if [[ "${DRIFT_FOUND}" -eq 0 ]]; then
    echo "[ok] runtime already in sync"
    exit 0
  fi
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
perform_sync "${TIMESTAMP}"
restart_if_requested
run_health_checks

echo "[ok] runtime sync complete (scope=${SCOPE}, mode=${MODE})"
