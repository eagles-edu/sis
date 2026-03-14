#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="/home/eagles/dockerz/sis"
RUNTIME_ROOT="/home/admin.eagles.edu.vn/sis"
SERVICE_NAME="exercise-mailer.service"
MAILER_PORT="${MAILER_PORT:-8787}"
MODE="sync-on-mismatch"
RESTART=1
HEALTH_CHECK=1
DRIFT_FOUND=0
DRIFT_LINES=()
PINNED_MAILER_HOST="${PINNED_MAILER_HOST:-127.0.0.1}"
PINNED_MAILER_PORT="${PINNED_MAILER_PORT:-8787}"
PINNED_ADMIN_STORE_ENABLED="${PINNED_ADMIN_STORE_ENABLED:-true}"
PINNED_STATIC_PREVIEW_ORIGIN="${PINNED_STATIC_PREVIEW_ORIGIN:-http://127.0.0.1:5500}"
RSYNC_EXCLUDES=(
  "--exclude=*.BAK-*"
  "--exclude=*~"
  "--exclude=.DS_Store"
)

usage() {
  cat <<'USAGE'
Usage: deploy-api-safe.sh [options]

Deploys API runtime code scope only (server/, schemas/, admin HTML, parent/student/vendor/image assets).
This script does not run DB migrations and does not restore DB.

Options:
  --check-only         Report drift and exit without syncing.
  --force-sync         Always sync (skip drift gate).
  --no-restart         Skip service restart.
  --skip-health-check  Skip /healthz and /api/admin/auth/me checks.
  -h, --help           Show help.

Sync contract (applied during sync):
  EXERCISE_MAILER_HOST=127.0.0.1
  EXERCISE_MAILER_PORT=8787
  STUDENT_ADMIN_STORE_ENABLED=true
  EXERCISE_MAILER_ORIGIN includes http://127.0.0.1:5500

Fixed paths:
  SOURCE_ROOT=/home/eagles/dockerz/sis
  RUNTIME_ROOT=/home/admin.eagles.edu.vn/sis
  SERVICE_NAME=exercise-mailer.service
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only)
      MODE="check-only"
      shift
      ;;
    --force-sync)
      MODE="force-sync"
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
  echo "Runtime env file not found: ${RUNTIME_ROOT}/.env" >&2
  exit 1
fi

for required_dir in server schemas web-asset/admin; do
  if [[ ! -e "${SOURCE_ROOT}/${required_dir}" ]]; then
    echo "Missing source path: ${SOURCE_ROOT}/${required_dir}" >&2
    exit 1
  fi
  if [[ ! -e "${RUNTIME_ROOT}/${required_dir}" ]]; then
    echo "Missing runtime path: ${RUNTIME_ROOT}/${required_dir}" >&2
    exit 1
  fi
done

if [[ ! -e "${SOURCE_ROOT}/web-asset/parent" ]]; then
  echo "Missing source path: ${SOURCE_ROOT}/web-asset/parent" >&2
  exit 1
fi

if [[ ! -e "${SOURCE_ROOT}/web-asset/student" ]]; then
  echo "Missing source path: ${SOURCE_ROOT}/web-asset/student" >&2
  exit 1
fi

if [[ ! -e "${SOURCE_ROOT}/web-asset/vendor" ]]; then
  echo "Missing source path: ${SOURCE_ROOT}/web-asset/vendor" >&2
  exit 1
fi

if [[ ! -e "${SOURCE_ROOT}/web-asset/images" ]]; then
  echo "Missing source path: ${SOURCE_ROOT}/web-asset/images" >&2
  exit 1
fi

record_drift() {
  DRIFT_FOUND=1
  DRIFT_LINES+=("$1")
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
  if ! origin_list_contains "${mailer_origin}" "${PINNED_STATIC_PREVIEW_ORIGIN}"; then
    record_drift "[runtime-env] EXERCISE_MAILER_ORIGIN missing ${PINNED_STATIC_PREVIEW_ORIGIN}"
  fi
}

sync_runtime_env_contract() {
  local env_path="${RUNTIME_ROOT}/.env"
  local current_origin
  current_origin="$(read_env_value "${env_path}" "EXERCISE_MAILER_ORIGIN")"
  if [[ -z "${current_origin}" ]]; then
    current_origin="$(read_env_value "${env_path}" "EXERCISE_MAILER_ORIGINS")"
  fi
  local merged_origin
  merged_origin="$(merge_origin_list_with_required "${current_origin}" "${PINNED_STATIC_PREVIEW_ORIGIN}")"

  upsert_env_value "${env_path}" "EXERCISE_MAILER_HOST" "${PINNED_MAILER_HOST}"
  upsert_env_value "${env_path}" "EXERCISE_MAILER_PORT" "${PINNED_MAILER_PORT}"
  upsert_env_value "${env_path}" "STUDENT_ADMIN_STORE_ENABLED" "${PINNED_ADMIN_STORE_ENABLED}"
  upsert_env_value "${env_path}" "EXERCISE_MAILER_ORIGIN" "${merged_origin}"

  echo "[sync] runtime env pinned: EXERCISE_MAILER_HOST=${PINNED_MAILER_HOST}, EXERCISE_MAILER_PORT=${PINNED_MAILER_PORT}, STUDENT_ADMIN_STORE_ENABLED=${PINNED_ADMIN_STORE_ENABLED}"
  echo "[sync] runtime env origin: EXERCISE_MAILER_ORIGIN=${merged_origin}"
}

collect_dir_drift() {
  local source_dir="$1"
  local runtime_dir="$2"
  local label="$3"
  local diff_output
  diff_output="$(rsync -nrc --itemize-changes "${RSYNC_EXCLUDES[@]}" "${source_dir}/" "${runtime_dir}/" | sed '/^$/d')"
  if [[ -n "${diff_output}" ]]; then
    record_drift "[${label}] content mismatch:"
    while IFS= read -r line; do
      record_drift "  ${line}"
    done <<< "${diff_output}"
  fi
}

collect_html_drift() {
  local source_file="${SOURCE_ROOT}/web-asset/admin/student-admin.html"
  local runtime_file="${RUNTIME_ROOT}/web-asset/admin/student-admin.html"
  if ! cmp -s "${source_file}" "${runtime_file}"; then
    record_drift "[admin-html] content mismatch: ${runtime_file}"
  fi
}

collect_parent_assets_drift() {
  local source_dir="${SOURCE_ROOT}/web-asset/parent"
  local runtime_dir="${RUNTIME_ROOT}/web-asset/parent"
  if [[ ! -d "${runtime_dir}" ]]; then
    record_drift "[parent-assets] missing runtime path: ${runtime_dir}"
    return
  fi
  collect_dir_drift "${source_dir}" "${runtime_dir}" "parent-assets"
}

collect_student_assets_drift() {
  local source_dir="${SOURCE_ROOT}/web-asset/student"
  local runtime_dir="${RUNTIME_ROOT}/web-asset/student"
  if [[ ! -d "${runtime_dir}" ]]; then
    record_drift "[student-assets] missing runtime path: ${runtime_dir}"
    return
  fi
  collect_dir_drift "${source_dir}" "${runtime_dir}" "student-assets"
}

collect_vendor_assets_drift() {
  local source_dir="${SOURCE_ROOT}/web-asset/vendor"
  local runtime_dir="${RUNTIME_ROOT}/web-asset/vendor"
  if [[ ! -d "${runtime_dir}" ]]; then
    record_drift "[vendor-assets] missing runtime path: ${runtime_dir}"
    return
  fi
  collect_dir_drift "${source_dir}" "${runtime_dir}" "vendor-assets"
}

collect_images_assets_drift() {
  local source_dir="${SOURCE_ROOT}/web-asset/images"
  local runtime_dir="${RUNTIME_ROOT}/web-asset/images"
  if [[ ! -d "${runtime_dir}" ]]; then
    record_drift "[images-assets] missing runtime path: ${runtime_dir}"
    return
  fi
  collect_dir_drift "${source_dir}" "${runtime_dir}" "images-assets"
}

collect_drift() {
  DRIFT_FOUND=0
  DRIFT_LINES=()
  collect_dir_drift "${SOURCE_ROOT}/server" "${RUNTIME_ROOT}/server" "server"
  collect_dir_drift "${SOURCE_ROOT}/schemas" "${RUNTIME_ROOT}/schemas" "schemas"
  collect_html_drift
  collect_parent_assets_drift
  collect_student_assets_drift
  collect_vendor_assets_drift
  collect_images_assets_drift
  collect_env_contract_drift
}

print_drift_report() {
  if [[ "${DRIFT_FOUND}" -eq 0 ]]; then
    echo "[drift] no mismatch detected"
    return
  fi
  echo "[drift] mismatch detected"
  for line in "${DRIFT_LINES[@]}"; do
    echo "${line}"
  done
}

perform_sync() {
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"

  echo "[sync] backup timestamp=${timestamp}"
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
  if [[ -d "${RUNTIME_ROOT}/web-asset/parent" ]]; then
    rsync -a --delete "${RUNTIME_ROOT}/web-asset/parent/" "${RUNTIME_ROOT}/web-asset/parent.BAK-${timestamp}/"
  fi
  if [[ -d "${RUNTIME_ROOT}/web-asset/student" ]]; then
    rsync -a --delete "${RUNTIME_ROOT}/web-asset/student/" "${RUNTIME_ROOT}/web-asset/student.BAK-${timestamp}/"
  fi
  if [[ -d "${RUNTIME_ROOT}/web-asset/vendor" ]]; then
    rsync -a --delete "${RUNTIME_ROOT}/web-asset/vendor/" "${RUNTIME_ROOT}/web-asset/vendor.BAK-${timestamp}/"
  fi
  if [[ -d "${RUNTIME_ROOT}/web-asset/images" ]]; then
    rsync -a --delete "${RUNTIME_ROOT}/web-asset/images/" "${RUNTIME_ROOT}/web-asset/images.BAK-${timestamp}/"
  fi

  rsync -a "${RSYNC_EXCLUDES[@]}" "${SOURCE_ROOT}/server/" "${RUNTIME_ROOT}/server/"
  rsync -a "${RSYNC_EXCLUDES[@]}" "${SOURCE_ROOT}/schemas/" "${RUNTIME_ROOT}/schemas/"
  rsync -a "${SOURCE_ROOT}/web-asset/admin/student-admin.html" "${RUNTIME_ROOT}/web-asset/admin/student-admin.html"
  mkdir -p "${RUNTIME_ROOT}/web-asset/parent"
  rsync -a "${RSYNC_EXCLUDES[@]}" "${SOURCE_ROOT}/web-asset/parent/" "${RUNTIME_ROOT}/web-asset/parent/"
  mkdir -p "${RUNTIME_ROOT}/web-asset/student"
  rsync -a "${RSYNC_EXCLUDES[@]}" "${SOURCE_ROOT}/web-asset/student/" "${RUNTIME_ROOT}/web-asset/student/"
  mkdir -p "${RUNTIME_ROOT}/web-asset/vendor"
  rsync -a "${RSYNC_EXCLUDES[@]}" "${SOURCE_ROOT}/web-asset/vendor/" "${RUNTIME_ROOT}/web-asset/vendor/"
  mkdir -p "${RUNTIME_ROOT}/web-asset/images"
  rsync -a "${RSYNC_EXCLUDES[@]}" "${SOURCE_ROOT}/web-asset/images/" "${RUNTIME_ROOT}/web-asset/images/"
  sync_runtime_env_contract
}

restart_if_requested() {
  if [[ "${RESTART}" -ne 1 ]]; then
    echo "[sync] service restart skipped (--no-restart)"
    return
  fi
  echo "[sync] restarting ${SERVICE_NAME}"
  sudo -n systemctl restart "${SERVICE_NAME}"
  systemctl is-active "${SERVICE_NAME}" >/dev/null
}

run_health_checks() {
  if [[ "${HEALTH_CHECK}" -ne 1 ]]; then
    echo "[check] skipped (--skip-health-check)"
    return
  fi

  fetch_http_code_with_retry() {
    local url="$1"
    local output_file="$2"
    local attempts="${3:-15}"
    local wait_seconds="${4:-1}"
    local code="000"
    local attempt=1
    while [[ "${attempt}" -le "${attempts}" ]]; do
      code="$(curl -sS -o "${output_file}" -w '%{http_code}' "${url}" || true)"
      if [[ "${code}" =~ ^[0-9]{3}$ && "${code}" != "000" ]]; then
        echo "${code}"
        return 0
      fi
      sleep "${wait_seconds}"
      attempt=$((attempt + 1))
    done
    echo "${code}"
    return 0
  }

  echo "[check] local health and auth routes"
  health_code="$(fetch_http_code_with_retry "http://127.0.0.1:${MAILER_PORT}/healthz" /tmp/sis-health.out 15 1)"
  me_code="$(fetch_http_code_with_retry "http://127.0.0.1:${MAILER_PORT}/api/admin/auth/me" /tmp/sis-auth-me.out 15 1)"
  echo "  /healthz => ${health_code}"
  echo "  /api/admin/auth/me => ${me_code}"

  if [[ "${health_code}" != "200" ]]; then
    echo "Health check failed; expected 200, got ${health_code}" >&2
    exit 1
  fi

  if [[ "${me_code}" != "401" ]]; then
    echo "Admin route check failed; expected 401 (unauthenticated), got ${me_code}" >&2
    exit 1
  fi
}

echo "[deploy-api-safe] source=${SOURCE_ROOT}"
echo "[deploy-api-safe] runtime=${RUNTIME_ROOT}"
echo "[deploy-api-safe] mode=${MODE} restart=${RESTART} health_check=${HEALTH_CHECK}"
echo "[deploy-api-safe] note=DB unchanged (no migrate, no restore)"

collect_drift

if [[ "${MODE}" == "check-only" ]]; then
  print_drift_report
  if [[ "${DRIFT_FOUND}" -eq 0 ]]; then
    exit 0
  fi
  exit 2
fi

if [[ "${MODE}" == "sync-on-mismatch" ]]; then
  print_drift_report
  if [[ "${DRIFT_FOUND}" -eq 0 ]]; then
    echo "[ok] runtime already in sync"
    exit 0
  fi
fi

perform_sync
restart_if_requested
run_health_checks

echo "[ok] API deploy sync complete"
