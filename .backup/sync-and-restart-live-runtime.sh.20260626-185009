#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-full}"

case "${MODE}" in
  full|backup-only|check-only)
    ;;
  *)
    echo "Usage: $(basename "$0") [full|backup-only|check-only]" >&2
    exit 2
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ROOT="${SIS_SOURCE_ROOT:-${REPO_ROOT}}"
LIVE_ROOT="${SIS_LIVE_ROOT:-/home/admin.eagles.edu.vn/sis}"
PUBLIC_ROOT="${SIS_LIVE_PUBLIC_ROOT:-/home/admin.eagles.edu.vn/public_html}"
LIVE_ORIGIN="${SIS_LIVE_PRIMARY_ORIGIN:-https://admin.eagles.edu.vn}"
LIVE_RUNTIME_ENV="${SIS_LIVE_RUNTIME_ENV:-production}"
LIVE_SERVICE="${SIS_LIVE_SERVICE:-exercise-mailer.service}"
BACKUP_ROOT="${SIS_LIVE_BACKUP_ROOT:-/home/eagles/dockerz/backups/live-admin}"
POSTGRES_BACKUP_DIR="${SIS_LIVE_POSTGRES_BACKUP_DIR:-/home/eagles/dockerz/backups/postgres}"
LIVE_HEALTH_URL="${SIS_LIVE_HEALTH_URL:-http://127.0.0.1:8787/healthz}"
CURL_BROWSER_USER_AGENT="${CURL_BROWSER_USER_AGENT:-Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36}"
RSYNC_EXCLUDES=(
  "--exclude=*.BAK-*"
  "--exclude=*~"
  "--exclude=.DS_Store"
)

LIVE_RUNTIME_CODE_DIRS=(
  "src"
  "server"
  "schemas"
  "prisma"
)

LIVE_RUNTIME_CODE_FILES=(
  "package.json"
  "package-lock.json"
  "prisma.config.ts"
  ".nvmrc"
)

LIVE_RUNTIME_DATA_FILES=(
  "runtime-data/admin-ui-settings.json"
)

LIVE_PRESERVED_RUNTIME_FILES=(
  "SIS_CONFIG.json"
)

LIVE_RUNTIME_WEBFILE_MAP=(
  "web-asset/admin/student-admin.html|web-asset/admin/student-admin.html"
  "web-asset/admin/student-enrollment.html|web-asset/admin/student-enrollment.html"
  "web-asset/admin/portal-hub.html|web-asset/admin/portal-hub.html"
  "web-asset/admin/grades-tabulator.html|web-asset/admin/grades-tabulator.html"
  "web-asset/admin/student-points.html|web-asset/admin/student-points.html"
  "web-asset/admin/assignment-controls-island.mjs|web-asset/admin/assignment-controls-island.mjs"
  "web-asset/admin/attendance-grade-controls-island.mjs|web-asset/admin/attendance-grade-controls-island.mjs"
  "web-asset/admin/news-review-island.mjs|web-asset/admin/news-review-island.mjs"
  "web-asset/admin/overview-news-queue-island.mjs|web-asset/admin/overview-news-queue-island.mjs"
  "web-asset/admin/parent-tracking-island.mjs|web-asset/admin/parent-tracking-island.mjs"
  "web-asset/admin/profile-island.mjs|web-asset/admin/profile-island.mjs"
  "web-asset/admin/queue-hub-island.mjs|web-asset/admin/queue-hub-island.mjs"
  "web-asset/admin/report-settings-island.mjs|web-asset/admin/report-settings-island.mjs"
  "web-asset/admin/school-setup-branding-island.mjs|web-asset/admin/school-setup-branding-island.mjs"
  "web-asset/admin/student-admin-bootstrap.mjs|web-asset/admin/student-admin-bootstrap.mjs"
  "web-asset/admin/student-admin.min.css|web-asset/admin/student-admin.min.css"
  "web-asset/admin/student-admin.min.js|web-asset/admin/student-admin.min.js"
  "web-asset/admin/student-admin.css|web-asset/admin/student-admin.css"
  "web-asset/admin/student-admin.js|web-asset/admin/student-admin.js"
  "web-asset/admin/favicon.ico|web-asset/admin/favicon.ico"
  "web-asset/parent/parent-portal.html|web-asset/parent/parent-portal.html"
  "web-asset/student/student-portal.html|web-asset/student/student-portal.html"
  "web-asset/shared/portal-theme-state.js|web-asset/shared/portal-theme-state.js"
  "web-asset/shared/portal-navigation.js|web-asset/shared/portal-navigation.js"
  "web-asset/shared/portal-theme.css|web-asset/shared/portal-theme.css"
  "web-asset/shared/portal-theme.min.css|web-asset/shared/portal-theme.min.css"
  "web-asset/shared/maintenance.svg|web-asset/shared/maintenance.svg"
  "web-asset/shared/secure-network.svg|web-asset/shared/secure-network.svg"
  "web-asset/images/logo.svg|web-asset/images/logo.svg"
  "web-asset/images/eggs-chicks.svg|web-asset/images/eggs-chicks.svg"
  "web-asset/images/starters.svg|web-asset/images/starters.svg"
  "web-asset/images/movers.svg|web-asset/images/movers.svg"
  "web-asset/images/flyers.svg|web-asset/images/flyers.svg"
  "web-asset/images/ket.svg|web-asset/images/ket.svg"
  "web-asset/images/pet.svg|web-asset/images/pet.svg"
  "web-asset/images/favicon.ico|web-asset/images/favicon.ico"
  "web-asset/icons/web-component/svg-icon.js|web-asset/icons/web-component/svg-icon.js"
  "web-asset/icons/web-component/svgs/theme-moon.svg|web-asset/icons/web-component/svgs/theme-moon.svg"
  "web-asset/icons/web-component/svgs/theme-sun.svg|web-asset/icons/web-component/svgs/theme-sun.svg"
  "web-asset/icons/web-component/svgs/joggling-lava.svg|web-asset/icons/web-component/svgs/joggling-lava.svg"
  "web-asset/icons/web-component/svgs/joggling-triangles.svg|web-asset/icons/web-component/svgs/joggling-triangles.svg"
  "web-asset/icons/web-component/svgs/spiral.svg|web-asset/icons/web-component/svgs/spiral.svg"
  "web-asset/vendor/fullcalendar/index.global.min.js|web-asset/vendor/fullcalendar/index.global.min.js"
  "web-asset/vendor/tabulatorz/tabulator.min.css|web-asset/vendor/tabulatorz/tabulator.min.css"
  "web-asset/vendor/tabulatorz/tabulator.min.js|web-asset/vendor/tabulatorz/tabulator.min.js"
  "web-asset/images/favicon.ico|favicon.ico"
)

LIVE_PUBLIC_WEBFILE_MAP=(
  "web-asset/admin/student-admin.html|sis-admin/student-admin.html"
  "web-asset/admin/student-enrollment.html|sis-admin/student-enrollment.html"
  "web-asset/admin/portal-hub.html|sis-admin/portal-hub.html"
  "web-asset/admin/grades-tabulator.html|sis-admin/grades-tabulator.html"
  "web-asset/admin/student-points.html|sis-admin/student-points.html"
  "web-asset/admin/assignment-controls-island.mjs|web-asset/admin/assignment-controls-island.mjs"
  "web-asset/admin/attendance-grade-controls-island.mjs|web-asset/admin/attendance-grade-controls-island.mjs"
  "web-asset/admin/news-review-island.mjs|web-asset/admin/news-review-island.mjs"
  "web-asset/admin/overview-news-queue-island.mjs|web-asset/admin/overview-news-queue-island.mjs"
  "web-asset/admin/parent-tracking-island.mjs|web-asset/admin/parent-tracking-island.mjs"
  "web-asset/admin/profile-island.mjs|web-asset/admin/profile-island.mjs"
  "web-asset/admin/queue-hub-island.mjs|web-asset/admin/queue-hub-island.mjs"
  "web-asset/admin/report-settings-island.mjs|web-asset/admin/report-settings-island.mjs"
  "web-asset/admin/school-setup-branding-island.mjs|web-asset/admin/school-setup-branding-island.mjs"
  "web-asset/admin/student-admin-bootstrap.mjs|web-asset/admin/student-admin-bootstrap.mjs"
  "web-asset/admin/student-admin.min.css|web-asset/admin/student-admin.min.css"
  "web-asset/admin/student-admin.min.js|web-asset/admin/student-admin.min.js"
  "web-asset/admin/student-admin.css|web-asset/admin/student-admin.css"
  "web-asset/admin/student-admin.js|web-asset/admin/student-admin.js"
  "web-asset/admin/favicon.ico|web-asset/admin/favicon.ico"
  "web-asset/parent/parent-portal.html|sis-parent/parent-portal.html"
  "web-asset/student/student-portal.html|sis-student/student-portal.html"
  "web-asset/shared/portal-theme-state.js|web-asset/shared/portal-theme-state.js"
  "web-asset/shared/portal-navigation.js|web-asset/shared/portal-navigation.js"
  "web-asset/shared/portal-theme.css|web-asset/shared/portal-theme.css"
  "web-asset/shared/portal-theme.min.css|web-asset/shared/portal-theme.min.css"
  "web-asset/shared/maintenance.svg|web-asset/shared/maintenance.svg"
  "web-asset/shared/secure-network.svg|web-asset/shared/secure-network.svg"
  "web-asset/images/logo.svg|web-asset/images/logo.svg"
  "web-asset/images/eggs-chicks.svg|web-asset/images/eggs-chicks.svg"
  "web-asset/images/starters.svg|web-asset/images/starters.svg"
  "web-asset/images/movers.svg|web-asset/images/movers.svg"
  "web-asset/images/flyers.svg|web-asset/images/flyers.svg"
  "web-asset/images/ket.svg|web-asset/images/ket.svg"
  "web-asset/images/pet.svg|web-asset/images/pet.svg"
  "web-asset/images/favicon.ico|web-asset/images/favicon.ico"
  "web-asset/icons/web-component/svg-icon.js|web-asset/icons/web-component/svg-icon.js"
  "web-asset/icons/web-component/svgs/theme-moon.svg|web-asset/icons/web-component/svgs/theme-moon.svg"
  "web-asset/icons/web-component/svgs/theme-sun.svg|web-asset/icons/web-component/svgs/theme-sun.svg"
  "web-asset/icons/web-component/svgs/joggling-lava.svg|web-asset/icons/web-component/svgs/joggling-lava.svg"
  "web-asset/icons/web-component/svgs/joggling-triangles.svg|web-asset/icons/web-component/svgs/joggling-triangles.svg"
  "web-asset/icons/web-component/svgs/spiral.svg|web-asset/icons/web-component/svgs/spiral.svg"
  "web-asset/vendor/fullcalendar/index.global.min.js|web-asset/vendor/fullcalendar/index.global.min.js"
  "web-asset/images/favicon.ico|favicon.ico"
)

LIVE_ROUTE_MATRIX=(
  "https://admin.eagles.edu.vn/|200|Cổng Thông Tin Sinh Viên|"
  "https://admin.eagles.edu.vn/admin|200|Student Admin Login|"
  "https://admin.eagles.edu.vn/admin/enrollment|200|The Eagles Club Student Enrollment|"
  "https://admin.eagles.edu.vn/parent|200|dành cho phụ huynh|"
  "https://admin.eagles.edu.vn/student|200|Student Portal|"
  "https://admin.eagles.edu.vn/admin/students|308||/admin"
  "https://admin.eagles.edu.vn/parent/portal|308||/parent"
  "https://admin.eagles.edu.vn/student/portal|308||/student"
)

LIVE_WRITE_PREFIX=()
PUBLIC_WRITE_PREFIX=()

if [[ ! -d "${LIVE_ROOT}" ]]; then
  echo "Live root not found: ${LIVE_ROOT}" >&2
  exit 1
fi
if [[ ! -d "${PUBLIC_ROOT}" ]]; then
  echo "Public root not found: ${PUBLIC_ROOT}" >&2
  exit 1
fi
if [[ ! -f "${LIVE_ROOT}/.env" ]]; then
  echo "Live runtime env not found: ${LIVE_ROOT}/.env" >&2
  exit 1
fi

if [[ ! -w "${LIVE_ROOT}" ]]; then
  LIVE_WRITE_PREFIX=(sudo -n)
fi
if [[ ! -w "${PUBLIC_ROOT}" ]]; then
  PUBLIC_WRITE_PREFIX=(sudo -n)
fi

log() {
  printf '[sync-live] %s\n' "$*"
}

verify_portal_sync_proof() {
  log "verifying portal parity proof"
  (cd "${REPO_ROOT}" && tools/verify-portal-sync-proof.sh \
    --source-root "${SOURCE_ROOT}" \
    --runtime-root "${LIVE_ROOT}" \
    --public-root "${PUBLIC_ROOT}")
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
if (next !== raw) {
  fs.writeFileSync(envPath, next)
}
EOF
}

sync_exact_file() {
  local source_path="$1"
  local target_path="$2"

  if [[ ! -f "${source_path}" ]]; then
    echo "missing source file: ${source_path}" >&2
    return 1
  fi

  "${LIVE_WRITE_PREFIX[@]}" install -D -m 0644 "${source_path}" "${target_path}"
}

remove_managed_paths() {
  local target_root="$1"
  shift
  local rel_path=""
  local target_path=""

  for rel_path in "$@"; do
    target_path="${target_root}/${rel_path}"
    if [[ ! -e "${target_path}" && ! -L "${target_path}" ]]; then
      continue
    fi
    "${LIVE_WRITE_PREFIX[@]}" rm -rf -- "${target_path}"
  done
}

sync_file_map() {
  local source_root="$1"
  local target_root="$2"
  local map_name="$3"
  local -n map_ref="$map_name"
  local entry=""
  local source_rel=""
  local target_rel=""

  for entry in "${map_ref[@]}"; do
    source_rel="${entry%%|*}"
    target_rel="${entry#*|}"
    sync_exact_file "${source_root}/${source_rel}" "${target_root}/${target_rel}"
  done
}

sha256_or_missing() {
  local file_path="$1"
  if [[ ! -f "${file_path}" ]]; then
    echo "missing"
    return
  fi
  sha256sum "${file_path}" | awk '{print $1}'
}

collect_dir_drift() {
  local source_dir="$1"
  local target_dir="$2"
  local label="$3"
  local diff_output
  diff_output="$(rsync -nrc --delete --itemize-changes "${RSYNC_EXCLUDES[@]}" "${source_dir}/" "${target_dir}/" | sed '/^$/d')"
  if [[ -n "${diff_output}" ]]; then
    echo "[drift] ${label} mismatch:"
    while IFS= read -r line; do
      echo "  ${line}"
    done <<< "${diff_output}"
    return 1
  fi
  return 0
}

verify_cleared_root() {
  local target_root="$1"
  local label="$2"
  shift 2
  local allowed_paths=("$@")
  local remaining

  remaining="$(
    TARGET_ROOT="${target_root}" ALLOWED_PATHS_TEXT="$(printf '%s\n' "${allowed_paths[@]}")" node --input-type=module <<'EOF'
import fs from "node:fs"
import path from "node:path"

const targetRoot = process.env.TARGET_ROOT || ""
const allowedPaths = new Set(
  String(process.env.ALLOWED_PATHS_TEXT || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean),
)
const entries = fs.existsSync(targetRoot) ? fs.readdirSync(targetRoot, { withFileTypes: true }) : []
const remaining = []

for (const entry of entries) {
  const entryPath = path.join(targetRoot, entry.name)
  if (allowedPaths.has(entryPath)) continue
  remaining.push(entry.name)
}

process.stdout.write(remaining.join("\n"))
EOF
  )"

  if [[ -n "${remaining}" ]]; then
    echo "[drift] ${label} not empty after wipe:" >&2
    while IFS= read -r line; do
      [[ -n "${line}" ]] && echo "  ${line}" >&2
    done <<< "${remaining}"
    return 1
  fi
}

check_whitelist_drift() {
  local status=0

  for entry in "${LIVE_RUNTIME_WEBFILE_MAP[@]}"; do
    local source_rel="${entry%%|*}"
    local target_rel="${entry#*|}"
    local source_hash
    local live_hash
    source_hash="$(sha256_or_missing "${SOURCE_ROOT}/${source_rel}")"
    live_hash="$(sha256_or_missing "${LIVE_ROOT}/${target_rel}")"
    if [[ "${source_hash}" != "${live_hash}" ]]; then
      echo "[drift] runtime ${target_rel} source=${source_hash} live=${live_hash}"
      status=1
    fi
  done

  for entry in "${LIVE_PUBLIC_WEBFILE_MAP[@]}"; do
    local source_rel="${entry%%|*}"
    local target_rel="${entry#*|}"
    local source_hash
    local public_hash
    source_hash="$(sha256_or_missing "${SOURCE_ROOT}/${source_rel}")"
    public_hash="$(sha256_or_missing "${PUBLIC_ROOT}/${target_rel}")"
    if [[ "${source_hash}" != "${public_hash}" ]]; then
      echo "[drift] public ${target_rel} source=${source_hash} public=${public_hash}"
      status=1
    fi
  done

  local code_dir=""
  for code_dir in "${LIVE_RUNTIME_CODE_DIRS[@]}"; do
    collect_dir_drift "${SOURCE_ROOT}/${code_dir}" "${LIVE_ROOT}/${code_dir}" "${code_dir}" || status=1
  done

  local code_file=""
  for code_file in "${LIVE_RUNTIME_CODE_FILES[@]}"; do
    local source_hash
    local live_hash
    source_hash="$(sha256_or_missing "${SOURCE_ROOT}/${code_file}")"
    live_hash="$(sha256_or_missing "${LIVE_ROOT}/${code_file}")"
    if [[ "${source_hash}" != "${live_hash}" ]]; then
      echo "[drift] code file ${code_file} source=${source_hash} live=${live_hash}"
      status=1
    fi
  done

  for data_file in "${LIVE_RUNTIME_DATA_FILES[@]}"; do
    local source_hash
    local live_hash
    source_hash="$(sha256_or_missing "${SOURCE_ROOT}/${data_file}")"
    live_hash="$(sha256_or_missing "${LIVE_ROOT}/${data_file}")"
    if [[ "${source_hash}" != "${live_hash}" ]]; then
      echo "[drift] data file ${data_file} source=${source_hash} live=${live_hash}"
      status=1
    fi
  done

  return "${status}"
}

verify_live_public_html_index() {
  local target_index_path="${PUBLIC_ROOT}/index.html"

  if [[ ! -f "${target_index_path}" ]]; then
    echo "live public index missing: ${target_index_path}" >&2
    return 1
  fi

  if ! grep -Fq "https://admin.eagles.edu.vn" "${target_index_path}"; then
    echo "live public index missing live admin origin: ${target_index_path}" >&2
    return 1
  fi

  if ! grep -Fq 'window.__SIS_RUNTIME_ENV="production"' "${target_index_path}"; then
    echo "live public index missing runtime env injection: ${target_index_path}" >&2
    return 1
  fi

  if ! grep -Fq 'window.__SIS_ADMIN_PAGE_PATH="/admin"' "${target_index_path}"; then
    echo "live public index missing admin page injection: ${target_index_path}" >&2
    return 1
  fi

  if ! grep -Fq 'window.__SIS_PARENT_PORTAL_PAGE_PATH="/parent"' "${target_index_path}"; then
    echo "live public index missing parent page injection: ${target_index_path}" >&2
    return 1
  fi

  if ! grep -Fq 'window.__SIS_STUDENT_PORTAL_PAGE_PATH="/student"' "${target_index_path}"; then
    echo "live public index missing student page injection: ${target_index_path}" >&2
    return 1
  fi

  if grep -Fq 'href="https://eagles.edu.vn"' "${target_index_path}"; then
    echo "live public index still references the bare eagles origin: ${target_index_path}" >&2
    return 1
  fi

  if grep -Fq "https://test.eagles.edu.vn" "${target_index_path}"; then
    echo "live public index still references the test origin: ${target_index_path}" >&2
    return 1
  fi
}

verify_live_roots_cleared() {
  log "verifying cleared live runtime root"
  verify_cleared_root "${LIVE_ROOT}" "runtime root" "${LIVE_ROOT}/.env" "${LIVE_ROOT}/SIS_CONFIG.json"
  log "verifying cleared live public root"
  verify_cleared_root "${PUBLIC_ROOT}" "public root"
}

verify_live_sync_whitelist() {
  log "verifying synced runtime and public whitelist"
  check_whitelist_drift
}

backup_live_state() {
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"
  local bundle_dir="${BACKUP_ROOT}/live-admin-${timestamp}"
  local runtime_snapshot_dir="${bundle_dir}/runtime"
  local public_snapshot_dir="${bundle_dir}/public_html"
  local db_snapshot_dir="${bundle_dir}/postgres"
  local live_env_path="${LIVE_ROOT}/.env"
  local database_url
  local db_backup_dir="${POSTGRES_BACKUP_DIR}"

  database_url="$(read_env_value "${live_env_path}" "DATABASE_URL")"
  if [[ -z "${database_url}" ]]; then
    echo "Live DATABASE_URL missing from ${live_env_path}" >&2
    return 1
  fi

  log "creating backup bundle at ${bundle_dir}"
  mkdir -p "${runtime_snapshot_dir}" "${public_snapshot_dir}" "${db_snapshot_dir}"

  log "backing up postgres into ${db_backup_dir}"
  mkdir -p "${db_backup_dir}"
  node "${REPO_ROOT}/tools/db-backup-failsafe.mjs" --output-dir "${db_backup_dir}" --database-url "${database_url}"

  local db_latest_json="${db_backup_dir}/latest.json"
  if [[ ! -f "${db_latest_json}" ]]; then
    echo "database backup did not produce latest.json: ${db_latest_json}" >&2
    return 1
  fi

  local db_dump_path=""
  local db_checksum_path=""
  local db_metadata_path=""
  IFS=$'\t' read -r db_dump_path db_checksum_path db_metadata_path <<EOF
$(DB_LATEST_JSON="${db_latest_json}" node --input-type=module <<'NODE'
import fs from "node:fs"
const latest = JSON.parse(fs.readFileSync(process.env.DB_LATEST_JSON, "utf8"))
const dumpPath = latest.backupPath || ""
const checksumPath = dumpPath ? dumpPath.replace(/\.dump$/u, ".sha256") : ""
const metadataPath = dumpPath ? dumpPath.replace(/\.dump$/u, ".json") : ""
process.stdout.write([dumpPath, checksumPath, metadataPath].join("\t"))
NODE
)
EOF

  if [[ -z "${db_dump_path}" || ! -f "${db_dump_path}" ]]; then
    echo "database dump missing from latest.json: ${db_dump_path}" >&2
    return 1
  fi

  rsync -a --delete --exclude='node_modules' --exclude='.git' --exclude='*.BAK-*' "${LIVE_ROOT}/" "${runtime_snapshot_dir}/"
  rsync -a --delete --exclude='*.BAK-*' "${PUBLIC_ROOT}/" "${public_snapshot_dir}/"

  cp -a "${db_latest_json}" "${db_snapshot_dir}/latest.json"
  cp -a "${db_dump_path}" "${db_snapshot_dir}/$(basename "${db_dump_path}")"
  if [[ -f "${db_checksum_path}" ]]; then
    cp -a "${db_checksum_path}" "${db_snapshot_dir}/$(basename "${db_checksum_path}")"
  fi
  if [[ -f "${db_metadata_path}" ]]; then
    cp -a "${db_metadata_path}" "${db_snapshot_dir}/$(basename "${db_metadata_path}")"
  fi

  cat > "${bundle_dir}/manifest.json" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sourceRoot": "${SOURCE_ROOT}",
  "liveRoot": "${LIVE_ROOT}",
  "publicRoot": "${PUBLIC_ROOT}",
  "liveOrigin": "${LIVE_ORIGIN}",
  "bundleDir": "${bundle_dir}",
  "runtimeSnapshotDir": "${runtime_snapshot_dir}",
  "publicSnapshotDir": "${public_snapshot_dir}",
  "postgresBackupDir": "${db_snapshot_dir}",
  "postgresLatestJson": "${db_snapshot_dir}/latest.json",
  "postgresDumpPath": "${db_snapshot_dir}/$(basename "${db_dump_path}")",
  "postgresChecksumPath": "${db_snapshot_dir}/$(basename "${db_checksum_path}")",
  "postgresMetadataPath": "${db_snapshot_dir}/$(basename "${db_metadata_path}")"
}
EOF

  log "backup bundle ready: ${bundle_dir}"
}

build_admin_assets() {
  log "building admin assets before live sync"
  (cd "${REPO_ROOT}" && npm run build:admin-assets)
}

sync_runtime_code_trees() {
  local code_dir=""
  local code_file=""
  for code_dir in "${LIVE_RUNTIME_CODE_DIRS[@]}"; do
    log "syncing runtime tree ${code_dir}"
    "${LIVE_WRITE_PREFIX[@]}" mkdir -p "${LIVE_ROOT}/${code_dir}"
    "${LIVE_WRITE_PREFIX[@]}" rsync -a --delete "${RSYNC_EXCLUDES[@]}" "${SOURCE_ROOT}/${code_dir}/" "${LIVE_ROOT}/${code_dir}/"
  done

  for code_file in "${LIVE_RUNTIME_CODE_FILES[@]}"; do
    if [[ ! -f "${SOURCE_ROOT}/${code_file}" ]]; then
      log "skip missing code file ${code_file}"
      continue
    fi
    sync_exact_file "${SOURCE_ROOT}/${code_file}" "${LIVE_ROOT}/${code_file}"
  done
}

sync_live_runtime_data_files() {
  local data_file=""

  for data_file in "${LIVE_RUNTIME_DATA_FILES[@]}"; do
    if [[ ! -f "${SOURCE_ROOT}/${data_file}" ]]; then
      log "skip missing data file ${data_file}"
      continue
    fi
    log "syncing runtime data ${data_file}"
    sync_exact_file "${SOURCE_ROOT}/${data_file}" "${LIVE_ROOT}/${data_file}"
  done
}

sync_live_runtime_assets() {
  local managed_paths=(
    "favicon.ico"
    "web-asset/admin"
    "web-asset/parent"
    "web-asset/student"
    "web-asset/shared"
    "web-asset/images"
    "web-asset/icons"
    "web-asset/vendor"
  )

  remove_managed_paths "${LIVE_ROOT}" "${managed_paths[@]}"
  log "syncing strict runtime whitelist into ${LIVE_ROOT}"
  sync_file_map "${SOURCE_ROOT}" "${LIVE_ROOT}" LIVE_RUNTIME_WEBFILE_MAP
}

sync_live_public_assets() {
  local managed_paths=(
    "favicon.ico"
    "sis-admin"
    "sis-parent"
    "sis-student"
    "web-asset"
  )

  remove_managed_paths "${PUBLIC_ROOT}" "${managed_paths[@]}"
  log "syncing strict public whitelist into ${PUBLIC_ROOT}"
  sync_file_map "${SOURCE_ROOT}" "${PUBLIC_ROOT}" LIVE_PUBLIC_WEBFILE_MAP
}

sync_live_public_html_index() {
  local source_hub_html="${SOURCE_ROOT}/web-asset/admin/portal-hub.html"
  local target_index_path="${PUBLIC_ROOT}/index.html"

  if [[ ! -f "${source_hub_html}" ]]; then
    log "skip public_html index sync (portal hub source missing)"
    return 0
  fi

  mkdir -p "${PUBLIC_ROOT}"
  if [[ ! -w "${PUBLIC_ROOT}" ]]; then
    echo "public root is not writable: ${PUBLIC_ROOT}" >&2
    return 1
  fi

  log "syncing portal hub into ${target_index_path}"
  install -m 0644 "${source_hub_html}" "${target_index_path}"

  env TARGET_INDEX_PATH="${target_index_path}" LIVE_RUNTIME_ENV="${LIVE_RUNTIME_ENV}" node --input-type=module <<'EOF'
import fs from "node:fs"

const targetIndexPath = process.env.TARGET_INDEX_PATH
const runtimeEnv = process.env.LIVE_RUNTIME_ENV || "production"
const raw = fs.readFileSync(targetIndexPath, "utf8")
const replacements = [
  ["https://test.eagles.edu.vn", "https://admin.eagles.edu.vn"],
  ["https://eagles.edu.vn", "https://admin.eagles.edu.vn"],
]
const injectedRuntimeConfig =
  `<script>window.__SIS_RUNTIME_ENV=${JSON.stringify(runtimeEnv)};window.__SIS_ADMIN_PAGE_PATH="/admin";window.__SIS_PARENT_PORTAL_PAGE_PATH="/parent";window.__SIS_STUDENT_PORTAL_PAGE_PATH="/student";</script>`

let next = raw
if (next.includes("</head>")) {
  next = next.replace("</head>", `  ${injectedRuntimeConfig}\n</head>`)
}
for (const [from, to] of replacements) {
  next = next.split(from).join(to)
}

if (next !== raw) {
  fs.writeFileSync(targetIndexPath, next)
}
EOF
}

ensure_live_dependencies() {
  log "installing live dependencies in ${LIVE_ROOT}"
  (cd "${LIVE_ROOT}" && npm ci --no-audit --no-fund)
}

wipe_live_target_contents() {
  local env_backup=""
  local runtime_file_backup_dir=""
  local restore_env=0
  local restore_runtime_files=0

  if [[ -f "${LIVE_ROOT}/.env" ]]; then
    env_backup="$(mktemp)"
    cp -a "${LIVE_ROOT}/.env" "${env_backup}"
    restore_env=1
  fi

  runtime_file_backup_dir="$(mktemp -d)"
  for rel_path in "${LIVE_PRESERVED_RUNTIME_FILES[@]}"; do
    if [[ -f "${LIVE_ROOT}/${rel_path}" ]]; then
      mkdir -p "${runtime_file_backup_dir}/$(dirname "${rel_path}")"
      cp -a "${LIVE_ROOT}/${rel_path}" "${runtime_file_backup_dir}/${rel_path}"
      restore_runtime_files=1
    fi
  done

  log "emptying live runtime root ${LIVE_ROOT}"
  "${LIVE_WRITE_PREFIX[@]}" find "${LIVE_ROOT}" -mindepth 1 -maxdepth 1 ! -name '.env' -exec rm -rf -- {} +

  if [[ "${restore_env}" -eq 1 ]]; then
    "${LIVE_WRITE_PREFIX[@]}" cp -a "${env_backup}" "${LIVE_ROOT}/.env"
    rm -f "${env_backup}"
  fi

  if [[ "${restore_runtime_files}" -eq 1 ]]; then
    for rel_path in "${LIVE_PRESERVED_RUNTIME_FILES[@]}"; do
      if [[ -f "${runtime_file_backup_dir}/${rel_path}" ]]; then
        "${LIVE_WRITE_PREFIX[@]}" mkdir -p "${LIVE_ROOT}/$(dirname "${rel_path}")"
        "${LIVE_WRITE_PREFIX[@]}" cp -a "${runtime_file_backup_dir}/${rel_path}" "${LIVE_ROOT}/${rel_path}"
      fi
    done
  fi
  rm -rf "${runtime_file_backup_dir}"

  log "emptying live public root ${PUBLIC_ROOT}"
  "${PUBLIC_WRITE_PREFIX[@]}" find "${PUBLIC_ROOT}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
}

pin_live_env_contract() {
  local env_path="${LIVE_ROOT}/.env"
  upsert_env_value "${env_path}" "EXERCISE_MAILER_HOST" "127.0.0.1"
  upsert_env_value "${env_path}" "EXERCISE_MAILER_PORT" "8787"
  upsert_env_value "${env_path}" "EXERCISE_MAILER_ORIGIN" "${LIVE_ORIGIN}"
  upsert_env_value "${env_path}" "STUDENT_ADMIN_STORE_ENABLED" "true"
  log "pinned live env contract in ${env_path}"
}

refresh_runtime_prisma_client() {
  log "refreshing Prisma client and applying migrations in ${LIVE_ROOT}"
  (cd "${LIVE_ROOT}" && npm run db:generate && npm run db:migrate:deploy)
}

restart_live_service() {
  log "restarting ${LIVE_SERVICE}"
  sudo -n systemctl restart "${LIVE_SERVICE}"
  systemctl is-active "${LIVE_SERVICE}" >/dev/null
}

verify_route() {
  local url="$1"
  local expected_status="$2"
  local expected_needle="$3"
  local expected_location="$4"
  if [[ "$url" == https://admin.eagles.edu.vn/* ]]; then
    env \
      PROBE_URL="${url}" \
      EXPECTED_STATUS="${expected_status}" \
      EXPECTED_NEEDLE="${expected_needle}" \
      EXPECTED_LOCATION="${expected_location}" \
      CURL_BROWSER_USER_AGENT="${CURL_BROWSER_USER_AGENT}" \
      node --input-type=module <<'EOF'
import assert from "node:assert/strict"
import { chromium } from "playwright"

const probeUrl = process.env.PROBE_URL || ""
const expectedStatus = Number.parseInt(process.env.EXPECTED_STATUS || "0", 10)
const expectedNeedle = process.env.EXPECTED_NEEDLE || ""
const expectedLocation = process.env.EXPECTED_LOCATION || ""
const browser = await chromium.launch({ headless: true })

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const page = await context.newPage()
  const response = await page.goto(probeUrl, { waitUntil: "commit", timeout: 30000 })

  if (expectedStatus === 308) {
    const finalUrl = page.url()
    assert.ok(
      finalUrl.endsWith(expectedLocation),
      `${probeUrl} expected redirect to ${expectedLocation}, got ${finalUrl}`,
    )
  } else {
    assert.equal(
      response?.status() || 0,
      expectedStatus,
      `${probeUrl} expected ${expectedStatus}, got ${response?.status() || 0}`,
    )
    const bodyText = await page.textContent("body")
    const titleText = await page.title()
    const acceptsLoginGate =
      probeUrl.endsWith("/admin/enrollment") &&
      (String(bodyText || "").includes("Student Admin Login") ||
        String(titleText || "").includes("Student Admin Login"))
    assert.ok(
      String(bodyText || "").includes(expectedNeedle) ||
        String(titleText || "").includes(expectedNeedle) ||
        acceptsLoginGate,
      `${probeUrl} missing body needle: ${expectedNeedle}`,
    )
  }
} finally {
  await browser.close().catch(() => {})
}
EOF
    return
  fi

  local headers_file
  headers_file="$(mktemp)"
  local body_file
  body_file="$(mktemp)"
  local code

  code="$(
    curl -A "${CURL_BROWSER_USER_AGENT}" -sS -D "${headers_file}" -o "${body_file}" -w '%{http_code}' "${url}" || true
  )"

  if [[ "${code}" != "${expected_status}" ]]; then
    echo "[route] ${url} expected ${expected_status} got ${code}" >&2
    rm -f "${headers_file}" "${body_file}"
    return 1
  fi

  if [[ -n "${expected_needle}" ]] && ! grep -Fq "${expected_needle}" "${body_file}"; then
    echo "[route] ${url} missing body needle: ${expected_needle}" >&2
    rm -f "${headers_file}" "${body_file}"
    return 1
  fi

  if [[ -n "${expected_location}" ]] && ! grep -Eiq "^Location: .*${expected_location}" "${headers_file}"; then
    echo "[route] ${url} missing redirect location: ${expected_location}" >&2
    rm -f "${headers_file}" "${body_file}"
    return 1
  fi

  rm -f "${headers_file}" "${body_file}"
}

verify_live_routes() {
  local entry=""
  for entry in "${LIVE_ROUTE_MATRIX[@]}"; do
    local url status needle location
    IFS='|' read -r url status needle location <<< "${entry}"
    verify_route "${url}" "${status}" "${needle}" "${location}"
  done
}

run_check_only() {
  log "checking live whitelist drift"
  check_whitelist_drift
  log "checking public hub index derivation"
  verify_live_public_html_index
  log "checking admin asset build parity"
  (cd "${REPO_ROOT}" && npm run build:admin-assets:check)
  log "checking live route coverage"
  verify_live_routes
}

run_apply() {
  backup_live_state
  build_admin_assets
  wipe_live_target_contents
  verify_live_roots_cleared
  sync_runtime_code_trees
  sync_live_runtime_data_files
  sync_live_runtime_assets
  sync_live_public_assets
  sync_live_public_html_index
  ensure_live_dependencies
  pin_live_env_contract
  refresh_runtime_prisma_client
  restart_live_service
  sleep 3
  verify_live_sync_whitelist
  verify_live_public_html_index
  verify_live_routes
  verify_portal_sync_proof
  curl -fsS "${LIVE_HEALTH_URL}" >/dev/null
  log "live admin sync complete"
}

case "${MODE}" in
  check-only)
    run_check_only
    ;;
  backup-only)
    backup_live_state
    ;;
  full)
    run_apply
    ;;
esac
