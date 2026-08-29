#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-full}"

case "$MODE" in
  full|public|restart-only|boot-prep) ;;
  *)
    echo "Usage: $(basename "$0") [full|public|restart-only|boot-prep]" >&2
    exit 2
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="${SIS_TEST_ROOT:-/home/test.eagles.edu.vn/sis}"
TEST_PORT="${SIS_TEST_PORT:-8786}"
TEST_SERVICE="${SIS_TEST_SERVICE:-exercise-mailer-test.service}"
TEST_HEALTH_URL="${SIS_TEST_HEALTH_URL:-http://127.0.0.1:${TEST_PORT}/healthz}"
TEST_PUBLIC_HEALTH_URL="${SIS_TEST_PUBLIC_HEALTH_URL:-}"
TEST_HEALTH_DELAY="${SIS_TEST_HEALTH_DELAY:-5}"
TEST_NODE_BIN="${SIS_TEST_NODE_BIN:-/home/eagles/.nvm/versions/node/v22.22.1/bin/node}"
TEST_PRIMARY_ORIGIN="${SIS_TEST_PRIMARY_ORIGIN:-https://test.eagles.edu.vn}"
TEST_LIGHTHOUSE_ENABLED="${SIS_SYNC_LIGHTHOUSE_ENABLED:-1}"
TEST_LIGHTHOUSE_THRESHOLD="${SIS_SYNC_LIGHTHOUSE_THRESHOLD:-100}"
TEST_BACKUP_ROOT="${SIS_TEST_BACKUP_ROOT:-/home/eagles/dockerz/backups/test-runtime}"
LIVE_ROOT_CANONICAL="${SIS_LIVE_ROOT_CANONICAL:-/home/admin.eagles.edu.vn/sis}"
DEV_ROOT_CANONICAL="${SIS_DEV_ROOT_CANONICAL:-/home/eagles/dockerz/sis}"
TEST_PUBLIC_ROOT="${SIS_TEST_PUBLIC_ROOT:-/home/test.eagles.edu.vn/public_html}"
TEST_PUBLIC_ADMIN_DIR="${SIS_TEST_PUBLIC_ADMIN_DIR:-${TEST_PUBLIC_ROOT}/sis-admin}"
TEST_PUBLIC_PARENT_DIR="${SIS_TEST_PUBLIC_PARENT_DIR:-${TEST_PUBLIC_ROOT}/sis-parent}"
TEST_PUBLIC_STUDENT_DIR="${SIS_TEST_PUBLIC_STUDENT_DIR:-${TEST_PUBLIC_ROOT}/sis-student}"
TEST_PUBLIC_SHARED_DIR="${SIS_TEST_PUBLIC_SHARED_DIR:-${TEST_PUBLIC_ROOT}/web-asset/shared}"
TEST_LIBRARY_MEDIA_ROOT="${SIS_TEST_LIBRARY_MEDIA_ROOT:-/home/test.eagles.edu.vn/sis-library-media/test}"
ROUTE_CONTRACT_FILE="${SIS_TEST_ROUTE_CONTRACT_FILE:-${REPO_ROOT}/config/test-route-contract.json}"
if [[ ! -f "$ROUTE_CONTRACT_FILE" ]]; then
  echo "missing test route contract file: $ROUTE_CONTRACT_FILE" >&2
  exit 1
fi
ROUTE_CONTRACT_JSON="$(<"$ROUTE_CONTRACT_FILE")"
export ROUTE_CONTRACT_JSON

build_test_route_matrix() {
  env ROUTE_CONTRACT_JSON="$ROUTE_CONTRACT_JSON" TEST_PORT="$TEST_PORT" "$TEST_NODE_BIN" --input-type=module <<'EOF'
const contract = JSON.parse(process.env.ROUTE_CONTRACT_JSON || "{}")
const port = String(process.env.TEST_PORT || "8786")
const runtimeEnv = contract.runtimeEnv || "test"
const adminPagePath = contract.adminPagePath || "/admin"
const adminEnrollmentPagePath = contract.adminEnrollmentPagePath || "/admin/enrollment"
const parentPortalPagePath = contract.parentPortalPagePath || "/parent"
const studentPortalPagePath = contract.studentPortalPagePath || "/student"
const entries = [
  [`http://127.0.0.1:${port}/`, 200, `window.__SIS_RUNTIME_ENV=${JSON.stringify(runtimeEnv)}`, ""],
  [`http://127.0.0.1:${port}/llms.txt`, 200, "#  The Eagles American English Club, Ltd.", ""],
  [`http://127.0.0.1:${port}${adminPagePath}`, 200, "Student Admin Login", ""],
  [`http://127.0.0.1:${port}${adminPagePath}/llms.txt`, 200, "# The Eagles American English Club, Ltd., Admin Portal", ""],
  [`http://127.0.0.1:${port}${adminEnrollmentPagePath}`, 200, "The Eagles Club Student Enrollment", ""],
  [`http://127.0.0.1:${port}${parentPortalPagePath}`, 200, "dành cho phụ huynh", ""],
  [`http://127.0.0.1:${port}${parentPortalPagePath}/llms.txt`, 200, "# The Eagles American English Club, Ltd., Parent Portal", ""],
  [`http://127.0.0.1:${port}${studentPortalPagePath}`, 200, "Student Portal", ""],
  [`http://127.0.0.1:${port}${studentPortalPagePath}/llms.txt`, 200, "# The Eagles American English Club, Ltd., Student Portal", ""],
  [`http://127.0.0.1:${port}${contract.adminLegacyPagePath || "/admin/students"}`, 308, "", adminPagePath],
  [`http://127.0.0.1:${port}${contract.parentLegacyPagePath || "/parent/portal"}`, 308, "", parentPortalPagePath],
  [`http://127.0.0.1:${port}${contract.studentLegacyPagePath || "/student/portal"}`, 308, "", studentPortalPagePath],
]
process.stdout.write(entries.map((entry) => entry.join("|")).join(";"))
EOF
}

TEST_ROUTE_MATRIX="${SIS_TEST_ROUTE_MATRIX:-$(build_test_route_matrix)}"
TEST_BACKUP_BUNDLE_DIR=""
TEST_DATABASE_BACKUP_DIR=""
# Mirror content is synced by file whitelist; full mode also creates a
# restorable PostgreSQL backup. Git commit ancestry is not part of the contract.
if [[ -n "${SIS_TEST_VERBOSE_ENV:-}" ]]; then
  # shellcheck disable=SC2206
  TEST_VERBOSE_ENV=(${SIS_TEST_VERBOSE_ENV})
else
  TEST_VERBOSE_ENV=("SIS_ENV_FILE=.env.test" "DOTENV_CONFIG_PATH=.env.test" "NODE_ENV=test")
fi

log() {
  printf '[sync-test] %s\n' "$*"
}

backup_test_state() {
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"
  local bundle_dir="${TEST_BACKUP_ROOT}/test-sync-${timestamp}"
  local runtime_snapshot_dir="${bundle_dir}/runtime"
  local public_snapshot_dir="${bundle_dir}/public_html"
  local vhost_snapshot_dir="${bundle_dir}/vhost"
  TEST_BACKUP_BUNDLE_DIR="${bundle_dir}"
  TEST_DATABASE_BACKUP_DIR="${bundle_dir}/database"

  log "creating test backup bundle at ${bundle_dir}"
  mkdir -p "${runtime_snapshot_dir}" "${public_snapshot_dir}" "${vhost_snapshot_dir}"

  if [[ -d "${TEST_ROOT}" ]]; then
    rsync -a --delete --exclude='node_modules' --exclude='.git' --exclude='*.BAK-*' "${TEST_ROOT}/" "${runtime_snapshot_dir}/"
  fi

  if [[ -d "${TEST_PUBLIC_ROOT}" ]]; then
    rsync -a --delete --exclude='*.BAK-*' "${TEST_PUBLIC_ROOT}/" "${public_snapshot_dir}/"
  fi

  if [[ -e "/etc/nginx/sites-enabled/test.eagles.edu.vn.conf" ]]; then
    cp -a "/etc/nginx/sites-enabled/test.eagles.edu.vn.conf" "${vhost_snapshot_dir}/sites-enabled-test.eagles.edu.vn.conf"
  fi
  if [[ -e "/etc/nginx/sites-available/test.eagles.edu.vn.conf" ]]; then
    cp -a "/etc/nginx/sites-available/test.eagles.edu.vn.conf" "${vhost_snapshot_dir}/sites-available-test.eagles.edu.vn.conf"
  fi
  if [[ -e "${REPO_ROOT}/deploy/nginx/test.eagles.edu.vn.conf" ]]; then
    cp -a "${REPO_ROOT}/deploy/nginx/test.eagles.edu.vn.conf" "${vhost_snapshot_dir}/repo-test.eagles.edu.vn.conf"
  fi

  if [[ "${MODE}" == "full" ]]; then
    backup_test_database
  fi

  cat > "${bundle_dir}/manifest.json" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repoRoot": "${REPO_ROOT}",
  "testRoot": "${TEST_ROOT}",
  "testPublicRoot": "${TEST_PUBLIC_ROOT}",
  "testOrigin": "${TEST_PRIMARY_ORIGIN}",
  "bundleDir": "${bundle_dir}",
  "runtimeSnapshotDir": "${runtime_snapshot_dir}",
  "publicSnapshotDir": "${public_snapshot_dir}",
  "vhostSnapshotDir": "${vhost_snapshot_dir}",
  "databaseBackupDir": "${TEST_DATABASE_BACKUP_DIR}",
  "databaseBackupRequired": $([[ "${MODE}" == "full" ]] && echo true || echo false),
  "databaseManagedByPrisma": true,
  "mirrorPurgeLeavesDatabaseUntouched": true
}
EOF

  log "test backup bundle ready: ${bundle_dir}"
}

backup_test_database() {
  local test_env_path="${TEST_ROOT}/.env.test"

  if [[ ! -f "${test_env_path}" ]]; then
    echo "cannot back up test database; missing ${test_env_path}" >&2
    return 1
  fi

  mkdir -p "${TEST_DATABASE_BACKUP_DIR}"
  log "backing up test database into ${TEST_DATABASE_BACKUP_DIR}"
  (
    cd "${REPO_ROOT}"
    tools/db-backup-smart.sh \
      --runtime-env "${test_env_path}" \
      --output-dir "${TEST_DATABASE_BACKUP_DIR}" \
      --no-prune
  )
}

verify_portal_sync_proof() {
  log "verifying portal parity proof"
  (cd "${REPO_ROOT}" && tools/verify-portal-sync-proof.sh \
    --source-root "${REPO_ROOT}" \
    --runtime-root "${TEST_ROOT}" \
    --public-root "${TEST_PUBLIC_ROOT}")
}

precompress_test_assets() {
  log "precompressing and verifying test mirror"
  (cd "${REPO_ROOT}" && tools/precompress-web-assets.sh test)
}

verify_lighthouse_performance() {
  if [[ "${TEST_LIGHTHOUSE_ENABLED}" != "1" ]]; then
    log "skip Lighthouse portal gate (SIS_SYNC_LIGHTHOUSE_ENABLED=${TEST_LIGHTHOUSE_ENABLED})"
    return 0
  fi
  log "verifying Lighthouse performance on ${TEST_PRIMARY_ORIGIN}"
  (cd "${REPO_ROOT}" && LIGHTHOUSE_ORIGIN="${TEST_PRIMARY_ORIGIN}" LIGHTHOUSE_MIN_PERF_SCORE="${TEST_LIGHTHOUSE_THRESHOLD}" npm run audit:lighthouse:portals)
}

sync_exact_file() {
  local source_path="$1"
  local target_path="$2"
  local owner
  local group
  local target_dir
  local install_mode="0644"

  if [[ ! -f "$source_path" ]]; then
    echo "missing source file: $source_path" >&2
    return 1
  fi

  owner="$(id -un)"
  group="$(id -gn)"
  target_dir="$(dirname "$target_path")"
  if [[ ! -d "$target_dir" ]]; then
    mkdir -p "$target_dir"
  fi
  if [[ ! -w "$target_dir" ]]; then
    echo "target directory is not writable: $target_dir" >&2
    return 1
  fi

  if [[ -x "$source_path" ]]; then
    install_mode="0755"
  fi
  install -D -m "$install_mode" "$source_path" "$target_path"
}

remove_managed_paths() {
  local target_root="$1"
  shift
  local rel_path=""
  local target_path=""

  for rel_path in "$@"; do
    target_path="${target_root}/${rel_path}"
    if [[ ! -e "$target_path" && ! -L "$target_path" ]]; then
      continue
    fi
    if [[ ! -w "$(dirname "$target_path")" ]]; then
      echo "target path is not writable: $target_path" >&2
      return 1
    fi
    rm -rf -- "$target_path"
  done
}

wipe_target_contents() {
  local target_root="$1"

  if [[ "$MODE" == "boot-prep" && "$target_root" == "$TEST_PUBLIC_ROOT" ]]; then
    log "preserving public_html during mode=boot-prep"
    return 0
  fi

  if [[ ! -d "$target_root" ]]; then
    return 0
  fi

  if [[ ! -w "$target_root" ]]; then
    echo "target root is not writable: $target_root" >&2
    return 1
  fi

  log "emptying ${target_root}"
  find "$target_root" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
}

sha256_file() {
  local target="$1"
  sha256sum "$target" | awk '{print $1}'
}

wipe_test_target_contents() {
  local env_backup=""
  local runtime_file_backup_dir=""
  local env_backup_sha=""
  local env_restored_sha=""
  local rel_path=""
  local backup_sha=""
  local restored_sha=""
  local restore_env=0
  local restore_runtime_files=0

  if [[ -f "${TEST_ROOT}/.env.test" ]]; then
    env_backup="$(mktemp)"
    cp -a "${TEST_ROOT}/.env.test" "${env_backup}"
    env_backup_sha="$(sha256_file "${env_backup}")"
    restore_env=1
  fi

  runtime_file_backup_dir="$(mktemp -d)"
  for rel_path in "${TEST_PRESERVED_RUNTIME_FILES[@]}"; do
    if [[ -f "${TEST_ROOT}/${rel_path}" ]]; then
      mkdir -p "${runtime_file_backup_dir}/$(dirname "${rel_path}")"
      cp -a "${TEST_ROOT}/${rel_path}" "${runtime_file_backup_dir}/${rel_path}"
      restore_runtime_files=1
    fi
  done

  wipe_target_contents "$TEST_ROOT"

  if [[ "${restore_env}" -eq 1 ]]; then
    cp -a "${env_backup}" "${TEST_ROOT}/.env.test"
    env_restored_sha="$(sha256_file "${TEST_ROOT}/.env.test")"
    if [[ "${env_backup_sha}" != "${env_restored_sha}" ]]; then
      echo "immutable restore mismatch: .env.test" >&2
      return 1
    fi
    log "preserved immutable hash verified: .env.test"
    rm -f "${env_backup}"
  fi

  if [[ "${restore_runtime_files}" -eq 1 ]]; then
    for rel_path in "${TEST_PRESERVED_RUNTIME_FILES[@]}"; do
      if [[ -f "${runtime_file_backup_dir}/${rel_path}" ]]; then
        mkdir -p "${TEST_ROOT}/$(dirname "${rel_path}")"
        cp -a "${runtime_file_backup_dir}/${rel_path}" "${TEST_ROOT}/${rel_path}"
        backup_sha="$(sha256_file "${runtime_file_backup_dir}/${rel_path}")"
        restored_sha="$(sha256_file "${TEST_ROOT}/${rel_path}")"
        if [[ "${backup_sha}" != "${restored_sha}" ]]; then
          echo "immutable restore mismatch: ${rel_path}" >&2
          return 1
        fi
        log "preserved immutable hash verified: ${rel_path}"
      fi
    done
  fi
  rm -rf "${runtime_file_backup_dir}"
}

verify_test_preserved_runtime_files() {
  local rel_path=""
  for rel_path in "${TEST_PRESERVED_RUNTIME_FILES[@]}"; do
    if [[ -f "${TEST_ROOT}/${rel_path}" ]]; then
      log "preserved immutable present: ${rel_path}"
    else
      log "preserved immutable missing after wipe restore: ${rel_path}"
    fi
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

TEST_ENV_TEST_MIRROR_KEYS=(
  "REDIS_URL"
  "REDIS_SESSION_URL"
  "REDIS_CACHE_URL"
  "REDIS_INSIGHT_URL"
  "STUDENT_ADMIN_API_PREFIX"
  "STUDENT_ADMIN_PAGE_PATH"
  "STUDENT_ADMIN_USER"
  "STUDENT_ADMIN_PASS"
  "STUDENT_ADMIN_STORE_ENABLED"
  "SMTP_HOST"
  "SMTP_PORT"
  "SMTP_SECURE"
  "SMTP_USER"
  "SMTP_PASS"
  "SMTP_FROM"
  "EMAIL_PROVIDER"
  "BREVO_API_KEY"
  "BREVO_FROM_EMAIL"
  "BREVO_FROM_NAME"
  "BREVO_WEBHOOK_SECRET"
  "BREVO_WEBHOOK_PATH"
  "MOODLE_QUIZ_SYNC_SHARED_SECRET"
  "MOODLE_SIS_QUIZ_SYNC_SECRET"
  "STUDENT_TEACHER_ACCOUNTS_JSON"
  "STUDENT_PARENT_USER"
  "STUDENT_PARENT_PASS"
  "STUDENT_PARENT_PORTAL_ACCOUNTS_JSON"
  "STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON"
  "STUDENT_NEWS_VALIDATION_DISABLED"
  "MERRIAM_WEBSTER_COLLEGIATE_API_KEY"
  "MERRIAM_WEBSTER_LEARNERS_API_KEY"
)

TEST_RUNTIME_CODE_DIRS=(
  "data"
  "src"
  "server"
  "schemas"
  "prisma"
)

TEST_RUNTIME_CODE_FILES=(
  "package.json"
  "package-lock.json"
  "prisma.config.ts"
  ".nvmrc"
  "tools/async-side-effects-worker.mjs"
  "tools/run-assignment-reminder-dispatcher.mjs"
  "tools/run-sis-config-repair-cron.sh"
  "tools/sis-config-repair.mjs"
  "ops/systemd/sis-assignment-reminders.service"
  "ops/systemd/sis-assignment-reminders.timer"
)

TEST_RUNTIME_DATA_FILES=(
)

TEST_PRESERVED_RUNTIME_FILES=(
  "SIS_CONFIG.json"
  "runtime-data/admin-ui-settings.json"
)

TEST_RUNTIME_WEBFILE_MAP=(
  "web-asset/llms.txt|web-asset/llms.txt"
  "web-asset/admin/llms.txt|web-asset/admin/llms.txt"
  "web-asset/parent/llms.txt|web-asset/parent/llms.txt"
  "web-asset/student/llms.txt|web-asset/student/llms.txt"
  "web-asset/admin/student-admin.html|web-asset/admin/student-admin.html"
  "web-asset/admin/student-enrollment.html|web-asset/admin/student-enrollment.html"
  "web-asset/admin/portal-hub.html|web-asset/admin/portal-hub.html"
  "web-asset/admin/library-admin.html|web-asset/admin/library-admin.html"
  "web-asset/admin/library-reference-catalogs.js|web-asset/admin/library-reference-catalogs.js"
  "web-asset/admin/library-definitions.html|web-asset/admin/library-definitions.html"
  "web-asset/admin/library-definitions.min.css|web-asset/admin/library-definitions.min.css"
  "web-asset/admin/library-definitions.min.js|web-asset/admin/library-definitions.min.js"
  "web-asset/admin/library-definitions.min.js.map|web-asset/admin/library-definitions.min.js.map"
  "web-asset/admin/admin-b612-mono-loader.js|web-asset/admin/admin-b612-mono-loader.js"
  "web-asset/admin/report-card.html|web-asset/admin/report-card.html"
  "web-asset/admin/grades-tabulator.html|web-asset/admin/grades-tabulator.html"
  "web-asset/admin/grades-tabulator.css|web-asset/admin/grades-tabulator.css"
  "web-asset/admin/grades-tabulator.min.css|web-asset/admin/grades-tabulator.min.css"
  "web-asset/admin/grades-tabulator.js|web-asset/admin/grades-tabulator.js"
  "web-asset/admin/grades-tabulator.min.js|web-asset/admin/grades-tabulator.min.js"
  "web-asset/admin/grades-tabulator.min.js.map|web-asset/admin/grades-tabulator.min.js.map"
  "web-asset/admin/student-enrollment.css|web-asset/admin/student-enrollment.css"
  "web-asset/admin/student-enrollment.min.css|web-asset/admin/student-enrollment.min.css"
  "web-asset/admin/student-enrollment.js|web-asset/admin/student-enrollment.js"
  "web-asset/admin/student-enrollment.min.js|web-asset/admin/student-enrollment.min.js"
  "web-asset/admin/student-enrollment.min.js.map|web-asset/admin/student-enrollment.min.js.map"
  "web-asset/admin/report-card.css|web-asset/admin/report-card.css"
  "web-asset/admin/report-card.min.css|web-asset/admin/report-card.min.css"
  "web-asset/admin/report-card.js|web-asset/admin/report-card.js"
  "web-asset/admin/report-card.min.js|web-asset/admin/report-card.min.js"
  "web-asset/admin/report-card.min.js.map|web-asset/admin/report-card.min.js.map"
  "web-asset/student/student-portal.css|web-asset/student/student-portal.css"
  "web-asset/student/student-portal.min.css|web-asset/student/student-portal.min.css"
  "web-asset/student/student-portal.js|web-asset/student/student-portal.js"
  "web-asset/student/student-portal.min.js|web-asset/student/student-portal.min.js"
  "web-asset/student/student-portal.min.js.map|web-asset/student/student-portal.min.js.map"
  "web-asset/parent/parent-portal.css|web-asset/parent/parent-portal.css"
  "web-asset/parent/parent-portal.min.css|web-asset/parent/parent-portal.min.css"
  "web-asset/parent/parent-portal.js|web-asset/parent/parent-portal.js"
  "web-asset/parent/parent-portal.min.js|web-asset/parent/parent-portal.min.js"
  "web-asset/parent/parent-portal.min.js.map|web-asset/parent/parent-portal.min.js.map"
  "web-asset/admin/assignment-controls-island.mjs|web-asset/admin/assignment-controls-island.mjs"
  "web-asset/admin/assignment-engagement-island.mjs|web-asset/admin/assignment-engagement-island.mjs"
  "web-asset/admin/performance-engagement-island.mjs|web-asset/admin/performance-engagement-island.mjs"
  "web-asset/admin/engagement-matrix.mjs|web-asset/admin/engagement-matrix.mjs"
  "web-asset/admin/overview-chart-island.mjs|web-asset/admin/overview-chart-island.mjs"
  "web-asset/admin/overview-dashboard-island.mjs|web-asset/admin/overview-dashboard-island.mjs"
  "web-asset/admin/admin-overview-shell.mjs|web-asset/admin/admin-overview-shell.mjs"
  "web-asset/admin/admin-fallbacks.mjs|web-asset/admin/admin-fallbacks.mjs"
  "web-asset/admin/attendance-grade-controls-island.mjs|web-asset/admin/attendance-grade-controls-island.mjs"
  "web-asset/admin/news-review-island.mjs|web-asset/admin/news-review-island.mjs"
  "web-asset/admin/overview-news-queue-island.mjs|web-asset/admin/overview-news-queue-island.mjs"
  "web-asset/admin/parent-tracking-island.mjs|web-asset/admin/parent-tracking-island.mjs"
  "web-asset/admin/profile-island.mjs|web-asset/admin/profile-island.mjs"
  "web-asset/admin/profile-engagement-island.mjs|web-asset/admin/profile-engagement-island.mjs"
  "web-asset/admin/queue-hub-island.mjs|web-asset/admin/queue-hub-island.mjs"
  "web-asset/admin/report-settings-island.mjs|web-asset/admin/report-settings-island.mjs"
  "web-asset/admin/school-setup-branding-island.mjs|web-asset/admin/school-setup-branding-island.mjs"
  "web-asset/admin/student-admin-bootstrap.mjs|web-asset/admin/student-admin-bootstrap.mjs"
  "web-asset/admin/library-review-workbench.js|web-asset/admin/library-review-workbench.js"
  "web-asset/admin/student-admin.min.css|web-asset/admin/student-admin.min.css"
  "web-asset/admin/admin-portal-theme.css|web-asset/admin/admin-portal-theme.css"
  "web-asset/admin/admin-portal-theme.min.css|web-asset/admin/admin-portal-theme.min.css"
  "web-asset/admin/student-admin.critical.css|web-asset/admin/student-admin.critical.css"
  "web-asset/admin/student-admin.min.js|web-asset/admin/student-admin.min.js"
  "web-asset/admin/student-admin.min.js.map|web-asset/admin/student-admin.min.js.map"
  "web-asset/admin/student-admin.css|web-asset/admin/student-admin.css"
  "web-asset/admin/student-admin.js|web-asset/admin/student-admin.js"
  "web-asset/parent/parent-portal.html|web-asset/parent/parent-portal.html"
  "web-asset/student/student-portal.html|web-asset/student/student-portal.html"
  "web-asset/student/library.html|web-asset/student/library.html"
  "web-asset/shared/portal-settings.html|web-asset/shared/portal-settings.html"
  "web-asset/shared/portal-settings.js|web-asset/shared/portal-settings.js"
  "web-asset/shared/portal-theme-state.js|web-asset/shared/portal-theme-state.js"
  "web-asset/shared/portal-preferences.js|web-asset/shared/portal-preferences.js"
  "web-asset/shared/portal-password-visibility.js|web-asset/shared/portal-password-visibility.js"
  "web-asset/shared/portal-navigation.js|web-asset/shared/portal-navigation.js"
  "web-asset/shared/portal-environment.js|web-asset/shared/portal-environment.js"
  "web-asset/shared/portal-action-feedback.js|web-asset/shared/portal-action-feedback.js"
  "web-asset/shared/vocabulary-esl-editor.js|web-asset/shared/vocabulary-esl-editor.js"
  "web-asset/shared/portal-theme.css|web-asset/shared/portal-theme.css"
  "web-asset/shared/portal-theme.min.css|web-asset/shared/portal-theme.min.css"
  "web-asset/fonts/B612Mono/stylesheet.css|web-asset/fonts/B612Mono/stylesheet.css"
  "web-asset/fonts/B612Mono/b612mono-regular-webfont.woff2|web-asset/fonts/B612Mono/b612mono-regular-webfont.woff2"
  "web-asset/fonts/B612Mono/b612mono-regular-webfont.woff|web-asset/fonts/B612Mono/b612mono-regular-webfont.woff"
  "web-asset/fonts/B612Mono/b612mono-bold-webfont.woff2|web-asset/fonts/B612Mono/b612mono-bold-webfont.woff2"
  "web-asset/fonts/B612Mono/b612mono-bold-webfont.woff|web-asset/fonts/B612Mono/b612mono-bold-webfont.woff"
  "web-asset/fonts/B612Mono/b612mono-italic-webfont.woff2|web-asset/fonts/B612Mono/b612mono-italic-webfont.woff2"
  "web-asset/fonts/B612Mono/b612mono-italic-webfont.woff|web-asset/fonts/B612Mono/b612mono-italic-webfont.woff"
  "web-asset/fonts/B612Mono/b612mono-bolditalic-webfont.woff2|web-asset/fonts/B612Mono/b612mono-bolditalic-webfont.woff2"
  "web-asset/fonts/B612Mono/b612mono-bolditalic-webfont.woff|web-asset/fonts/B612Mono/b612mono-bolditalic-webfont.woff"
  "web-asset/shared/maintenance.svg|web-asset/shared/maintenance.svg"
  "web-asset/shared/secure-network.svg|web-asset/shared/secure-network.svg"
  "web-asset/shared/secure-network-white.svg|web-asset/shared/secure-network-white.svg"
  "web-asset/images/logo.svg|web-asset/images/logo.svg"
  "web-asset/images/new-words.png|web-asset/images/new-words.png"
  "web-asset/images/K9f9G9VR1Z.lottie|web-asset/images/K9f9G9VR1Z.lottie"
  "web-asset/images/caret-down.svg|web-asset/images/caret-down.svg"
  "web-asset/images/eggs-chicks.svg|web-asset/images/eggs-chicks.svg"
  "web-asset/images/starters.svg|web-asset/images/starters.svg"
  "web-asset/images/movers.svg|web-asset/images/movers.svg"
  "web-asset/images/flyers.svg|web-asset/images/flyers.svg"
  "web-asset/images/ket.svg|web-asset/images/ket.svg"
  "web-asset/images/pet.svg|web-asset/images/pet.svg"
  "web-asset/images/favicon.ico|web-asset/images/favicon.ico"
  "web-asset/images/favicon.png|web-asset/images/favicon.png"
  "web-asset/images/favicon.svg|web-asset/images/favicon.svg"
  "web-asset/admin/favicon.ico|web-asset/admin/favicon.ico"
  "web-asset/icons/web-component/svg-icon.js|web-asset/icons/web-component/svg-icon.js"
  "web-asset/icons/web-component/svgs/theme-moon.svg|web-asset/icons/web-component/svgs/theme-moon.svg"
  "web-asset/icons/web-component/svgs/theme-sun.svg|web-asset/icons/web-component/svgs/theme-sun.svg"
  "web-asset/icons/web-component/svgs/joggling-lava.svg|web-asset/icons/web-component/svgs/joggling-lava.svg"
  "web-asset/icons/web-component/svgs/joggling-triangles.svg|web-asset/icons/web-component/svgs/joggling-triangles.svg"
  "web-asset/icons/web-component/svgs/spiral.svg|web-asset/icons/web-component/svgs/spiral.svg"
  "web-asset/icons/svg/water-ripples.svg|web-asset/icons/svg/water-ripples.svg"
  "web-asset/vendor/fullcalendar/index.global.min.js|web-asset/vendor/fullcalendar/index.global.min.js"
  "web-asset/vendor/tabulatorz/tabulator.min.css|web-asset/vendor/tabulatorz/tabulator.min.css"
  "web-asset/vendor/tabulatorz/tabulator.min.css.map|web-asset/vendor/tabulatorz/tabulator.min.css.map"
  "web-asset/vendor/tabulatorz/tabulator.min.js|web-asset/vendor/tabulatorz/tabulator.min.js"
  "web-asset/vendor/tabulatorz/tabulator.min.js.map|web-asset/vendor/tabulatorz/tabulator.min.js.map"
  "web-asset/images/favicon.ico|favicon.ico"
  "web-asset/images/favicon.png|favicon.png"
  "web-asset/images/favicon.svg|favicon.svg"
)

# Local portal changes are authored in REPO_ROOT. Keep this explicit parity
# list next to the sync maps so a full test sync cannot silently omit a UI
# source or its generated payload.
TEST_LOCAL_UI_RUNTIME_PARITY_MAP=(
  "web-asset/admin/student-admin.html|web-asset/admin/student-admin.html"
  "web-asset/admin/student-admin.css|web-asset/admin/student-admin.css"
  "web-asset/admin/student-admin.js|web-asset/admin/student-admin.js"
  "web-asset/admin/library-admin.html|web-asset/admin/library-admin.html"
  "web-asset/admin/admin-b612-mono-loader.js|web-asset/admin/admin-b612-mono-loader.js"
  "web-asset/admin/library-review-workbench.js|web-asset/admin/library-review-workbench.js"
  "web-asset/admin/engagement-matrix.mjs|web-asset/admin/engagement-matrix.mjs"
  "web-asset/admin/student-admin.min.css|web-asset/admin/student-admin.min.css"
  "web-asset/admin/admin-portal-theme.css|web-asset/admin/admin-portal-theme.css"
  "web-asset/admin/admin-portal-theme.min.css|web-asset/admin/admin-portal-theme.min.css"
  "web-asset/admin/student-admin.critical.css|web-asset/admin/student-admin.critical.css"
  "web-asset/admin/student-admin.min.js|web-asset/admin/student-admin.min.js"
  "web-asset/admin/student-admin.min.js.map|web-asset/admin/student-admin.min.js.map"
  "web-asset/admin/grades-tabulator.css|web-asset/admin/grades-tabulator.css"
  "web-asset/admin/grades-tabulator.min.css|web-asset/admin/grades-tabulator.min.css"
  "web-asset/admin/grades-tabulator.js|web-asset/admin/grades-tabulator.js"
  "web-asset/admin/grades-tabulator.min.js|web-asset/admin/grades-tabulator.min.js"
  "web-asset/admin/grades-tabulator.min.js.map|web-asset/admin/grades-tabulator.min.js.map"
  "web-asset/admin/student-enrollment.css|web-asset/admin/student-enrollment.css"
  "web-asset/admin/student-enrollment.min.css|web-asset/admin/student-enrollment.min.css"
  "web-asset/admin/student-enrollment.js|web-asset/admin/student-enrollment.js"
  "web-asset/admin/student-enrollment.min.js|web-asset/admin/student-enrollment.min.js"
  "web-asset/admin/student-enrollment.min.js.map|web-asset/admin/student-enrollment.min.js.map"
  "web-asset/admin/report-card.css|web-asset/admin/report-card.css"
  "web-asset/admin/report-card.min.css|web-asset/admin/report-card.min.css"
  "web-asset/admin/report-card.js|web-asset/admin/report-card.js"
  "web-asset/admin/report-card.min.js|web-asset/admin/report-card.min.js"
  "web-asset/admin/report-card.min.js.map|web-asset/admin/report-card.min.js.map"
  "web-asset/student/student-portal.css|web-asset/student/student-portal.css"
  "web-asset/student/student-portal.min.css|web-asset/student/student-portal.min.css"
  "web-asset/student/student-portal.js|web-asset/student/student-portal.js"
  "web-asset/student/student-portal.min.js|web-asset/student/student-portal.min.js"
  "web-asset/student/student-portal.min.js.map|web-asset/student/student-portal.min.js.map"
  "web-asset/parent/parent-portal.css|web-asset/parent/parent-portal.css"
  "web-asset/parent/parent-portal.min.css|web-asset/parent/parent-portal.min.css"
  "web-asset/parent/parent-portal.js|web-asset/parent/parent-portal.js"
  "web-asset/parent/parent-portal.min.js|web-asset/parent/parent-portal.min.js"
  "web-asset/parent/parent-portal.min.js.map|web-asset/parent/parent-portal.min.js.map"
  "web-asset/parent/parent-portal.html|web-asset/parent/parent-portal.html"
  "web-asset/student/student-portal.html|web-asset/student/student-portal.html"
  "web-asset/student/library.html|web-asset/student/library.html"
  "web-asset/shared/portal-settings.html|web-asset/shared/portal-settings.html"
  "web-asset/shared/portal-settings.js|web-asset/shared/portal-settings.js"
  "web-asset/images/K9f9G9VR1Z.lottie|web-asset/images/K9f9G9VR1Z.lottie"
  "web-asset/shared/portal-password-visibility.js|web-asset/shared/portal-password-visibility.js"
  "web-asset/shared/portal-action-feedback.js|web-asset/shared/portal-action-feedback.js"
  "web-asset/shared/vocabulary-esl-editor.js|web-asset/shared/vocabulary-esl-editor.js"
  "web-asset/shared/portal-theme.css|web-asset/shared/portal-theme.css"
  "web-asset/shared/portal-theme.min.css|web-asset/shared/portal-theme.min.css"
  "web-asset/fonts/B612Mono/stylesheet.css|web-asset/fonts/B612Mono/stylesheet.css"
  "web-asset/fonts/B612Mono/b612mono-regular-webfont.woff2|web-asset/fonts/B612Mono/b612mono-regular-webfont.woff2"
  "web-asset/fonts/B612Mono/b612mono-regular-webfont.woff|web-asset/fonts/B612Mono/b612mono-regular-webfont.woff"
  "web-asset/fonts/B612Mono/b612mono-bold-webfont.woff2|web-asset/fonts/B612Mono/b612mono-bold-webfont.woff2"
  "web-asset/fonts/B612Mono/b612mono-bold-webfont.woff|web-asset/fonts/B612Mono/b612mono-bold-webfont.woff"
  "web-asset/fonts/B612Mono/b612mono-italic-webfont.woff2|web-asset/fonts/B612Mono/b612mono-italic-webfont.woff2"
  "web-asset/fonts/B612Mono/b612mono-italic-webfont.woff|web-asset/fonts/B612Mono/b612mono-italic-webfont.woff"
  "web-asset/fonts/B612Mono/b612mono-bolditalic-webfont.woff2|web-asset/fonts/B612Mono/b612mono-bolditalic-webfont.woff2"
  "web-asset/fonts/B612Mono/b612mono-bolditalic-webfont.woff|web-asset/fonts/B612Mono/b612mono-bolditalic-webfont.woff"
)

TEST_PUBLIC_WEBFILE_MAP=(
  "robots.txt|robots.txt"
  "web-asset/llms.txt|llms.txt"
  "web-asset/admin/llms.txt|sis-admin/llms.txt"
  "web-asset/parent/llms.txt|sis-parent/llms.txt"
  "web-asset/student/llms.txt|sis-student/llms.txt"
  "web-asset/admin/student-admin.html|sis-admin/student-admin.html"
  "web-asset/admin/student-enrollment.html|sis-admin/student-enrollment.html"
  "web-asset/admin/portal-hub.html|sis-admin/portal-hub.html"
  "web-asset/admin/portal-hub.html|index.html"
  "web-asset/admin/library-admin.html|sis-admin/library-admin.html"
  "web-asset/admin/library-reference-catalogs.js|web-asset/admin/library-reference-catalogs.js"
  "web-asset/admin/library-definitions.html|sis-admin/library-definitions.html"
  "web-asset/admin/library-definitions.min.css|web-asset/admin/library-definitions.min.css"
  "web-asset/admin/library-definitions.min.js|web-asset/admin/library-definitions.min.js"
  "web-asset/admin/library-definitions.min.js.map|web-asset/admin/library-definitions.min.js.map"
  "web-asset/admin/admin-b612-mono-loader.js|sis-admin/admin-b612-mono-loader.js"
  "web-asset/admin/grades-tabulator.html|sis-admin/grades-tabulator.html"
  "web-asset/admin/grades-tabulator.min.css|web-asset/admin/grades-tabulator.min.css"
  "web-asset/admin/grades-tabulator.min.js|web-asset/admin/grades-tabulator.min.js"
  "web-asset/admin/grades-tabulator.min.js.map|web-asset/admin/grades-tabulator.min.js.map"
  "web-asset/admin/student-enrollment.min.css|web-asset/admin/student-enrollment.min.css"
  "web-asset/admin/student-enrollment.min.js|web-asset/admin/student-enrollment.min.js"
  "web-asset/admin/student-enrollment.min.js.map|web-asset/admin/student-enrollment.min.js.map"
  "web-asset/admin/report-card.min.css|web-asset/admin/report-card.min.css"
  "web-asset/admin/report-card.min.js|web-asset/admin/report-card.min.js"
  "web-asset/admin/report-card.min.js.map|web-asset/admin/report-card.min.js.map"
  "web-asset/admin/assignment-controls-island.mjs|web-asset/admin/assignment-controls-island.mjs"
  "web-asset/admin/assignment-engagement-island.mjs|web-asset/admin/assignment-engagement-island.mjs"
  "web-asset/admin/performance-engagement-island.mjs|web-asset/admin/performance-engagement-island.mjs"
  "web-asset/admin/engagement-matrix.mjs|web-asset/admin/engagement-matrix.mjs"
  "web-asset/admin/overview-chart-island.mjs|web-asset/admin/overview-chart-island.mjs"
  "web-asset/admin/overview-dashboard-island.mjs|web-asset/admin/overview-dashboard-island.mjs"
  "web-asset/admin/admin-overview-shell.mjs|web-asset/admin/admin-overview-shell.mjs"
  "web-asset/admin/admin-fallbacks.mjs|web-asset/admin/admin-fallbacks.mjs"
  "web-asset/admin/attendance-grade-controls-island.mjs|web-asset/admin/attendance-grade-controls-island.mjs"
  "web-asset/admin/news-review-island.mjs|web-asset/admin/news-review-island.mjs"
  "web-asset/admin/overview-news-queue-island.mjs|web-asset/admin/overview-news-queue-island.mjs"
  "web-asset/admin/parent-tracking-island.mjs|web-asset/admin/parent-tracking-island.mjs"
  "web-asset/admin/profile-island.mjs|web-asset/admin/profile-island.mjs"
  "web-asset/admin/profile-engagement-island.mjs|web-asset/admin/profile-engagement-island.mjs"
  "web-asset/admin/queue-hub-island.mjs|web-asset/admin/queue-hub-island.mjs"
  "web-asset/admin/report-settings-island.mjs|web-asset/admin/report-settings-island.mjs"
  "web-asset/admin/school-setup-branding-island.mjs|web-asset/admin/school-setup-branding-island.mjs"
  "web-asset/admin/student-admin-bootstrap.mjs|web-asset/admin/student-admin-bootstrap.mjs"
  "web-asset/parent/parent-portal.html|sis-parent/parent-portal.html"
  "web-asset/parent/parent-portal.min.css|web-asset/parent/parent-portal.min.css"
  "web-asset/parent/parent-portal.min.js|web-asset/parent/parent-portal.min.js"
  "web-asset/parent/parent-portal.min.js.map|web-asset/parent/parent-portal.min.js.map"
  "web-asset/student/student-portal.html|sis-student/student-portal.html"
  "web-asset/student/library.html|sis-student/library.html"
  "web-asset/student/student-portal.min.css|web-asset/student/student-portal.min.css"
  "web-asset/student/student-portal.min.js|web-asset/student/student-portal.min.js"
  "web-asset/student/student-portal.min.js.map|web-asset/student/student-portal.min.js.map"
  "web-asset/admin/student-admin.min.css|web-asset/admin/student-admin.min.css"
  "web-asset/admin/admin-portal-theme.css|web-asset/admin/admin-portal-theme.css"
  "web-asset/admin/admin-portal-theme.min.css|web-asset/admin/admin-portal-theme.min.css"
  "web-asset/admin/student-admin.critical.css|web-asset/admin/student-admin.critical.css"
  "web-asset/admin/student-admin.min.js|web-asset/admin/student-admin.min.js"
  "web-asset/admin/student-admin.min.js.map|web-asset/admin/student-admin.min.js.map"
  "web-asset/admin/student-admin.css|web-asset/admin/student-admin.css"
  "web-asset/admin/student-admin.js|web-asset/admin/student-admin.js"
  "web-asset/admin/library-review-workbench.js|web-asset/admin/library-review-workbench.js"
  "web-asset/shared/portal-theme-state.js|web-asset/shared/portal-theme-state.js"
  "web-asset/shared/portal-settings.js|web-asset/shared/portal-settings.js"
  "web-asset/shared/portal-preferences.js|web-asset/shared/portal-preferences.js"
  "web-asset/shared/portal-password-visibility.js|web-asset/shared/portal-password-visibility.js"
  "web-asset/shared/portal-navigation.js|web-asset/shared/portal-navigation.js"
  "web-asset/shared/portal-environment.js|web-asset/shared/portal-environment.js"
  "web-asset/shared/portal-action-feedback.js|web-asset/shared/portal-action-feedback.js"
  "web-asset/shared/vocabulary-esl-editor.js|web-asset/shared/vocabulary-esl-editor.js"
  "web-asset/shared/portal-theme.css|web-asset/shared/portal-theme.css"
  "web-asset/shared/portal-theme.min.css|web-asset/shared/portal-theme.min.css"
  "web-asset/fonts/B612Mono/stylesheet.css|web-asset/fonts/B612Mono/stylesheet.css"
  "web-asset/fonts/B612Mono/b612mono-regular-webfont.woff2|web-asset/fonts/B612Mono/b612mono-regular-webfont.woff2"
  "web-asset/fonts/B612Mono/b612mono-regular-webfont.woff|web-asset/fonts/B612Mono/b612mono-regular-webfont.woff"
  "web-asset/fonts/B612Mono/b612mono-bold-webfont.woff2|web-asset/fonts/B612Mono/b612mono-bold-webfont.woff2"
  "web-asset/fonts/B612Mono/b612mono-bold-webfont.woff|web-asset/fonts/B612Mono/b612mono-bold-webfont.woff"
  "web-asset/fonts/B612Mono/b612mono-italic-webfont.woff2|web-asset/fonts/B612Mono/b612mono-italic-webfont.woff2"
  "web-asset/fonts/B612Mono/b612mono-italic-webfont.woff|web-asset/fonts/B612Mono/b612mono-italic-webfont.woff"
  "web-asset/fonts/B612Mono/b612mono-bolditalic-webfont.woff2|web-asset/fonts/B612Mono/b612mono-bolditalic-webfont.woff2"
  "web-asset/fonts/B612Mono/b612mono-bolditalic-webfont.woff|web-asset/fonts/B612Mono/b612mono-bolditalic-webfont.woff"
  "web-asset/shared/maintenance.svg|web-asset/shared/maintenance.svg"
  "web-asset/shared/secure-network.svg|web-asset/shared/secure-network.svg"
  "web-asset/shared/secure-network-white.svg|web-asset/shared/secure-network-white.svg"
  "web-asset/images/logo.svg|web-asset/images/logo.svg"
  "web-asset/images/new-words.png|web-asset/images/new-words.png"
  "web-asset/images/K9f9G9VR1Z.lottie|web-asset/images/K9f9G9VR1Z.lottie"
  "web-asset/images/caret-down.svg|web-asset/images/caret-down.svg"
  "web-asset/images/eggs-chicks.svg|web-asset/images/eggs-chicks.svg"
  "web-asset/images/starters.svg|web-asset/images/starters.svg"
  "web-asset/images/movers.svg|web-asset/images/movers.svg"
  "web-asset/images/flyers.svg|web-asset/images/flyers.svg"
  "web-asset/images/ket.svg|web-asset/images/ket.svg"
  "web-asset/images/pet.svg|web-asset/images/pet.svg"
  "web-asset/images/favicon.ico|web-asset/images/favicon.ico"
  "web-asset/images/favicon.png|web-asset/images/favicon.png"
  "web-asset/images/favicon.svg|web-asset/images/favicon.svg"
  "web-asset/admin/favicon.ico|web-asset/admin/favicon.ico"
  "web-asset/icons/web-component/svg-icon.js|web-asset/icons/web-component/svg-icon.js"
  "web-asset/icons/web-component/svgs/theme-moon.svg|web-asset/icons/web-component/svgs/theme-moon.svg"
  "web-asset/icons/web-component/svgs/theme-sun.svg|web-asset/icons/web-component/svgs/theme-sun.svg"
  "web-asset/icons/web-component/svgs/joggling-lava.svg|web-asset/icons/web-component/svgs/joggling-lava.svg"
  "web-asset/icons/web-component/svgs/joggling-triangles.svg|web-asset/icons/web-component/svgs/joggling-triangles.svg"
  "web-asset/icons/web-component/svgs/spiral.svg|web-asset/icons/web-component/svgs/spiral.svg"
  "web-asset/icons/svg/water-ripples.svg|web-asset/icons/svg/water-ripples.svg"
  "web-asset/vendor/fullcalendar/index.global.min.js|web-asset/vendor/fullcalendar/index.global.min.js"
  "web-asset/vendor/tabulatorz/tabulator.min.css|web-asset/vendor/tabulatorz/tabulator.min.css"
  "web-asset/vendor/tabulatorz/tabulator.min.css.map|web-asset/vendor/tabulatorz/tabulator.min.css.map"
  "web-asset/vendor/tabulatorz/tabulator.min.js|web-asset/vendor/tabulatorz/tabulator.min.js"
  "web-asset/vendor/tabulatorz/tabulator.min.js.map|web-asset/vendor/tabulatorz/tabulator.min.js.map"
  "web-asset/images/favicon.ico|favicon.ico"
  "web-asset/images/favicon.png|favicon.png"
  "web-asset/images/favicon.svg|favicon.svg"
)

read_env_value() {
  local env_file="$1"
  local key="$2"
  if [[ ! -f "$env_file" ]]; then
    return 0
  fi
  awk -F= -v env_key="$key" '
    $0 ~ "^[[:space:]]*" env_key "=" {
      value = substr($0, index($0, "=") + 1)
      print value
      exit
    }
  ' "$env_file"
}

upsert_env_value() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  local env_dir
  local can_write=0

  env_dir="$(dirname "$env_file")"
  if [[ -w "$env_file" || ( ! -e "$env_file" && -w "$env_dir" ) ]]; then
    can_write=1
  fi

  env PATH="$(dirname "$TEST_NODE_BIN"):$PATH" ENV_FILE="$env_file" ENV_KEY="$key" ENV_VALUE="$value" CAN_WRITE="$can_write" "$TEST_NODE_BIN" --input-type=module <<'EOF'
import fs from "node:fs"
import { execFileSync } from "node:child_process"

const envFile = process.env.ENV_FILE
const envKey = process.env.ENV_KEY
const envValue = process.env.ENV_VALUE || ""
const canWrite = process.env.CAN_WRITE === "1"
const raw = fs.readFileSync(envFile, "utf8")
const lines = raw.split(/\r?\n/u)
const trailingNewline = raw.endsWith("\n")
const nextLines = []
let replaced = false

for (const line of lines) {
  if (line.startsWith(`${envKey}=`)) {
    if (!replaced) {
      nextLines.push(`${envKey}=${envValue}`)
      replaced = true
    }
    continue
  }
  nextLines.push(line)
}

if (!replaced) {
  nextLines.push(`${envKey}=${envValue}`)
}

let next = nextLines.join("\n")
if (!trailingNewline) {
  while (next.endsWith("\n")) {
    next = next.slice(0, -1)
  }
} else if (!next.endsWith("\n")) {
  next += "\n"
}

if (next !== raw) {
  if (canWrite) {
    fs.writeFileSync(envFile, next)
  } else {
    try {
      execFileSync("sudo", ["tee", envFile], {
        input: next,
        stdio: ["pipe", "ignore", "inherit"],
      })
    } catch (error) {
      console.log(`[sync-test] skip env update for ${envFile} (requires elevated permissions)`)
    }
  }
}
EOF
}

sync_env_keys_between_files() {
  local source_env_path="$1"
  local target_env_path="$2"
  shift 2

  if [[ ! -f "$source_env_path" ]]; then
    log "skip env alignment (missing source env: ${source_env_path})"
    return 0
  fi
  if [[ ! -f "$target_env_path" ]]; then
    log "skip env alignment (missing target env: ${target_env_path})"
    return 0
  fi

  local mirrored=0
  local key=""
  local value=""
  for key in "$@"; do
    value="$(read_env_value "$source_env_path" "$key")"
    if [[ -z "$value" ]]; then
      continue
    fi
    upsert_env_value "$target_env_path" "$key" "$value"
    mirrored=$((mirrored + 1))
  done

  log "aligned ${mirrored} env keys from $(basename "$source_env_path") to $(basename "$target_env_path")"
}

align_test_env_from_test_source() {
  local test_env_path="${TEST_ROOT}/.env.test"
  local source_env_path="${REPO_ROOT}/.env.test"

  if [[ ! -f "$test_env_path" ]]; then
    log "skip test env alignment (missing .env.test in ${TEST_ROOT})"
    return 0
  fi
  if [[ ! -f "$source_env_path" ]]; then
    log "skip test env alignment (missing ${source_env_path})"
    return 0
  fi

  sync_env_keys_between_files "$source_env_path" "$test_env_path" "${TEST_ENV_TEST_MIRROR_KEYS[@]}"
}

repair_test_source_redis_env() {
  local source_env_path="${REPO_ROOT}/.env.test"
  if [[ ! -f "$source_env_path" ]]; then
    echo "cannot repair test Redis source env; missing ${source_env_path}" >&2
    return 1
  fi

  local redis_args=""
  local redis_password=""
  redis_args="$(docker inspect redis-stack --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | awk -F= '$1=="REDIS_ARGS" {print $2}')"
  redis_password="$(printf '%s\n' "$redis_args" | sed -n 's/.*--requirepass[[:space:]]\+\([^[:space:]]\+\).*/\1/p')"
  if [[ -z "$redis_password" ]]; then
    echo "cannot repair test Redis source env; redis-stack authoritative password is unavailable" >&2
    return 1
  fi

  local key=""
  local source_url=""
  local repaired_url=""
  for key in REDIS_URL REDIS_SESSION_URL REDIS_CACHE_URL; do
    source_url="$(read_env_value "$source_env_path" "$key")"
    if [[ -z "$source_url" ]]; then
      echo "cannot repair test Redis source env; missing ${key}" >&2
      return 1
    fi
    repaired_url="$(SIS_TASK_REDIS_SOURCE_URL="$source_url" SIS_TASK_REDIS_PASSWORD="$redis_password" "$TEST_NODE_BIN" --input-type=module <<'EOF'
const sourceUrl = String(process.env.SIS_TASK_REDIS_SOURCE_URL || "")
const password = String(process.env.SIS_TASK_REDIS_PASSWORD || "")
if (!sourceUrl || !password) throw new Error("missing Redis URL or authoritative password")
const url = new URL(sourceUrl)
url.username = ""
url.password = password
process.stdout.write(url.toString())
EOF
    )"
    upsert_env_value "$source_env_path" "$key" "$repaired_url"
  done
  log "repaired test Redis source URLs from redis-stack authoritative configuration"
}

ensure_test_redis_env() {
  local test_env_path="${TEST_ROOT}/.env.test"
  if [[ ! -f "$test_env_path" ]]; then
    log "skip Redis wiring (missing .env.test in ${TEST_ROOT})"
    return 0
  fi

  local redis_url=""
  local redis_session_url=""
  local redis_cache_url=""
  local redis_insight_url=""

  redis_url="$(read_env_value "$test_env_path" "REDIS_URL")"
  redis_session_url="$(read_env_value "$test_env_path" "REDIS_SESSION_URL")"
  redis_cache_url="$(read_env_value "$test_env_path" "REDIS_CACHE_URL")"
  redis_insight_url="$(read_env_value "$test_env_path" "REDIS_INSIGHT_URL")"

  if [[ -z "$redis_url" || -z "$redis_session_url" || -z "$redis_cache_url" ]]; then
    log "skip Redis wiring (one or more Redis URLs are missing)"
    return 0
  fi

  upsert_env_value "$test_env_path" "REDIS_URL" "$redis_url"
  upsert_env_value "$test_env_path" "REDIS_SESSION_URL" "$redis_session_url"
  upsert_env_value "$test_env_path" "REDIS_CACHE_URL" "$redis_cache_url"
  if [[ -n "$redis_insight_url" ]]; then
    upsert_env_value "$test_env_path" "REDIS_INSIGHT_URL" "$redis_insight_url"
  fi
  upsert_env_value "$test_env_path" "STUDENT_ADMIN_SESSION_DRIVER" "redis"
  log "ensured test Redis wiring in ${test_env_path}"
}

ensure_test_redis_runtime_config() {
  local test_env_path="${TEST_ROOT}/.env.test"
  local test_config_path="${TEST_ROOT}/SIS_CONFIG.json"
  if [[ ! -f "$test_env_path" || ! -f "$test_config_path" ]]; then
    echo "cannot repair test Redis runtime config; missing test env or SIS_CONFIG.json" >&2
    return 1
  fi

  local redis_url=""
  local redis_timeout_ms=""
  redis_url="$(read_env_value "$test_env_path" "REDIS_SESSION_URL")"
  if [[ -z "$redis_url" ]]; then
    redis_url="$(read_env_value "$test_env_path" "REDIS_URL")"
  fi
  redis_timeout_ms="$(read_env_value "$test_env_path" "STUDENT_ADMIN_SESSION_REDIS_CONNECT_TIMEOUT_MS")"
  if [[ -z "$redis_timeout_ms" ]]; then
    redis_timeout_ms="5000"
  fi
  if [[ -z "$redis_url" ]]; then
    echo "cannot repair test Redis runtime config; no Redis URL is configured" >&2
    return 1
  fi

  log "repairing test SIS_CONFIG runtime to use Redis"
  (
    cd "$TEST_ROOT"
    env PATH="$(dirname "$TEST_NODE_BIN"):$PATH" \
      NODE_ENV=test \
      SIS_ENV_FILE=.env.test \
      DOTENV_CONFIG_PATH=.env.test \
      SIS_CONFIG_FILE=SIS_CONFIG.json \
      REDIS_SESSION_URL="$redis_url" \
      REDIS_URL="$redis_url" \
      SIS_RUNTIME_SYNC_REDIS_URL="$redis_url" \
      SIS_RUNTIME_SYNC_REDIS_TIMEOUT_MS="$redis_timeout_ms" \
      "$TEST_NODE_BIN" --input-type=module <<'EOF'
import { ensureSisConfigLoaded, saveSisConfigFromRuntime } from "./src/modules/admin/sis-config-store.mjs"

const redisUrl = String(process.env.SIS_RUNTIME_SYNC_REDIS_URL || "").trim()
const timeoutMs = Number.parseInt(String(process.env.SIS_RUNTIME_SYNC_REDIS_TIMEOUT_MS || ""), 10) || 5000
if (!redisUrl) throw new Error("test Redis runtime repair received no Redis URL")

const current = await ensureSisConfigLoaded({ refresh: true })
const runtime = {
  ...(current.runtime || {}),
  redisUrl,
  sessionDriver: "redis",
  redisConnectTimeoutMs: timeoutMs,
}
await saveSisConfigFromRuntime(runtime, "test-runtime-sync")
const repaired = await ensureSisConfigLoaded({ refresh: true })
if (repaired.runtime?.sessionDriver !== "redis" || repaired.runtime?.redisUrl !== redisUrl) {
  throw new Error("test SIS_CONFIG runtime Redis repair did not persist")
}
console.log("[sync-test] test SIS_CONFIG runtime now uses Redis")
EOF
  )
}

ensure_test_runtime_env_contract() {
  local test_env_path="${TEST_ROOT}/.env.test"
  local default_env_path="${TEST_ROOT}/.env"

  seed_test_runtime_env_file

  local test_dev_roots="${DEV_ROOT_CANONICAL},${TEST_ROOT}"
  local source_env_path="${REPO_ROOT}/.env.test"
  local moodle_secret=""

  if [[ -f "$source_env_path" ]]; then
    moodle_secret="$(read_env_value "$source_env_path" "MOODLE_QUIZ_SYNC_SHARED_SECRET")"
    if [[ -z "$moodle_secret" ]]; then
      moodle_secret="$(read_env_value "$source_env_path" "MOODLE_SIS_QUIZ_SYNC_SECRET")"
    fi
  fi

  local test_database_url=""
  if [[ -f "${REPO_ROOT}/.env.test" ]]; then
    test_database_url="$(read_env_value "${REPO_ROOT}/.env.test" "DATABASE_URL")"
  fi

  upsert_env_value "$test_env_path" "EXERCISE_MAILER_HOST" "127.0.0.1"
  upsert_env_value "$test_env_path" "EXERCISE_MAILER_PORT" "$TEST_PORT"
  upsert_env_value "$test_env_path" "EXERCISE_MAILER_ORIGIN" "$TEST_PRIMARY_ORIGIN"
  if [[ -n "$test_database_url" ]]; then
    upsert_env_value "$test_env_path" "DATABASE_URL" "$test_database_url"
  fi
  upsert_env_value "$test_env_path" "NODE_ENV" "test"
  upsert_env_value "$test_env_path" "SIS_LIVE_ROOT" "$LIVE_ROOT_CANONICAL"
  upsert_env_value "$test_env_path" "SIS_DEV_ROOT" "$test_dev_roots"
  upsert_env_value "$test_env_path" "SIS_RUNTIME_SELF_HEAL_ENABLED" "false"
  if [[ -n "$moodle_secret" ]]; then
    upsert_env_value "$test_env_path" "MOODLE_QUIZ_SYNC_SHARED_SECRET" "$moodle_secret"
  fi

  if [[ -f "$default_env_path" ]]; then
    upsert_env_value "$default_env_path" "EXERCISE_MAILER_HOST" "127.0.0.1"
    upsert_env_value "$default_env_path" "EXERCISE_MAILER_PORT" "$TEST_PORT"
    upsert_env_value "$default_env_path" "EXERCISE_MAILER_ORIGIN" "$TEST_PRIMARY_ORIGIN"
    upsert_env_value "$default_env_path" "SIS_LIVE_ROOT" "$LIVE_ROOT_CANONICAL"
    upsert_env_value "$default_env_path" "SIS_DEV_ROOT" "$test_dev_roots"
    upsert_env_value "$default_env_path" "SIS_RUNTIME_SELF_HEAL_ENABLED" "false"
    if [[ -n "$moodle_secret" ]]; then
      upsert_env_value "$default_env_path" "MOODLE_QUIZ_SYNC_SHARED_SECRET" "$moodle_secret"
    fi
  fi

  log "pinned test env contract in ${test_env_path}"
}

sync_runtime_code_trees() {
  local target_root="$1"
  local code_dir=""
  local code_file=""
  local rsync_prefix=()

  if [[ ! -d "$target_root" ]]; then
    mkdir -p "$target_root"
  fi
  if [[ ! -w "$target_root" ]]; then
    echo "test root is not writable: $target_root" >&2
    return 1
  fi

  for code_dir in "${TEST_RUNTIME_CODE_DIRS[@]}"; do
    if [[ ! -d "${REPO_ROOT}/${code_dir}" ]]; then
      log "skip ${code_dir} sync (source missing)"
      continue
    fi
    log "syncing ${code_dir} tree into ${target_root}/${code_dir}"
    "${rsync_prefix[@]}" rsync -a --delete "${REPO_ROOT}/${code_dir}/" "${target_root}/${code_dir}/"
  done

  for code_file in "${TEST_RUNTIME_CODE_FILES[@]}"; do
    if [[ ! -f "${REPO_ROOT}/${code_file}" ]]; then
      log "skip ${code_file} sync (source missing)"
      continue
    fi
    sync_exact_file "${REPO_ROOT}/${code_file}" "${target_root}/${code_file}"
  done
}

sync_runtime_data_files() {
  local target_root="$1"
  local data_file=""

  for data_file in "${TEST_RUNTIME_DATA_FILES[@]}"; do
    if [[ ! -f "${REPO_ROOT}/${data_file}" ]]; then
      log "skip ${data_file} sync (source missing)"
      continue
    fi
    log "syncing ${data_file} into ${target_root}/${data_file}"
    sync_exact_file "${REPO_ROOT}/${data_file}" "${target_root}/${data_file}"
  done
}

run_sync() {
  case "$MODE" in
    full|public|restart-only|boot-prep)
      log "syncing test code trees and runtime files into ${TEST_ROOT}"
      sync_runtime_code_trees "$TEST_ROOT"
      sync_runtime_data_files "$TEST_ROOT"
      ;;
  esac
}

build_admin_assets() {
  case "$MODE" in
    full|public)
      log "building admin minified assets from source"
      (cd "$REPO_ROOT" && npm run build:admin-assets)
      ;;
    restart-only|boot-prep)
      log "skip admin asset build for mode=${MODE}"
      ;;
  esac
}

sync_test_runtime_assets() {
  log "syncing strict runtime asset whitelist into ${TEST_ROOT}"
  sync_file_map "$REPO_ROOT" "$TEST_ROOT" TEST_RUNTIME_WEBFILE_MAP
}

verify_local_ui_runtime_parity() {
  local entry=""
  local source_rel=""
  local target_rel=""
  local source_hash=""
  local target_hash=""

  log "verifying local UI source parity in ${TEST_ROOT}"
  for entry in "${TEST_LOCAL_UI_RUNTIME_PARITY_MAP[@]}"; do
    source_rel="${entry%%|*}"
    target_rel="${entry#*|}"
    if [[ ! -f "${REPO_ROOT}/${source_rel}" || ! -f "${TEST_ROOT}/${target_rel}" ]]; then
      echo "local UI parity file missing: ${source_rel} -> ${target_rel}" >&2
      return 1
    fi
    source_hash="$(sha256sum "${REPO_ROOT}/${source_rel}" | awk '{print $1}')"
    target_hash="$(sha256sum "${TEST_ROOT}/${target_rel}" | awk '{print $1}')"
    if [[ "${source_hash}" != "${target_hash}" ]]; then
      echo "local UI parity mismatch: ${source_rel} -> ${target_rel}" >&2
      return 1
    fi
  done
}

cleanup_test_backup_artifacts() {
  if [[ ! -d "$TEST_ROOT" ]]; then
    log "skip backup artifact cleanup (test root missing)"
    return 0
  fi

  log "removing backup artifacts from ${TEST_ROOT}"
  find "$TEST_ROOT" -type f -name '*.BAK-*' -delete
}

ensure_test_library_media_root() {
  log "ensuring test Library media root ${TEST_LIBRARY_MEDIA_ROOT}"
  if [[ -d "${TEST_LIBRARY_MEDIA_ROOT}" && -w "${TEST_LIBRARY_MEDIA_ROOT}" ]]; then
    return 0
  fi
  if [[ "${EUID}" -eq 0 ]]; then
    install -d -o eagles -g eagles -m 0750 "${TEST_LIBRARY_MEDIA_ROOT}"
  else
    sudo -n install -d -o eagles -g eagles -m 0750 "${TEST_LIBRARY_MEDIA_ROOT}"
  fi
}

sync_test_public_html_index() {
  local source_hub_html="${REPO_ROOT}/web-asset/admin/portal-hub.html"
  local target_public_root="/home/test.eagles.edu.vn/public_html"
  local target_index_path="${target_public_root}/index.html"

  if [[ ! -f "$source_hub_html" ]]; then
    log "skip public_html index sync (portal hub source missing)"
    return 0
  fi

  if [[ ! -d "$target_public_root" ]]; then
    mkdir -p "$target_public_root"
  fi
  if [[ ! -w "$target_public_root" ]]; then
    echo "public_html root is not writable: $target_public_root" >&2
    return 1
  fi

  log "syncing portal hub into ${target_index_path}"
  install -m 644 "$source_hub_html" "$target_index_path"

  env PATH="$(dirname "$TEST_NODE_BIN"):$PATH" ROUTE_CONTRACT_JSON="$ROUTE_CONTRACT_JSON" TARGET_INDEX_PATH="$target_index_path" "$TEST_NODE_BIN" --input-type=module <<'EOF'
import fs from "node:fs"

const targetIndexPath = process.env.TARGET_INDEX_PATH
const raw = fs.readFileSync(targetIndexPath, "utf8")
const replacements = [
  ["https://admin.eagles.edu.vn", "https://test.eagles.edu.vn"],
  ["https://eagles.edu.vn", "https://test.eagles.edu.vn"],
]

const contract = JSON.parse(process.env.ROUTE_CONTRACT_JSON || "{}")
const injectedRuntimeConfig =
  `<script>window.__SIS_RUNTIME_ENV=${JSON.stringify(contract.runtimeEnv || "test")};window.__SIS_ADMIN_PAGE_PATH=${JSON.stringify(contract.adminPagePath || "/admin")};window.__SIS_PARENT_PORTAL_PAGE_PATH=${JSON.stringify(contract.parentPortalPagePath || "/parent/portal")};window.__SIS_STUDENT_PORTAL_PAGE_PATH=${JSON.stringify(contract.studentPortalPagePath || "/student/portal")};</script>`

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

sync_test_public_assets() {
  log "syncing strict public_html asset whitelist into ${TEST_PUBLIC_ROOT}"
  sync_file_map "$REPO_ROOT" "$TEST_PUBLIC_ROOT" TEST_PUBLIC_WEBFILE_MAP
}

seed_test_runtime_env_file() {
  local test_env_path="${TEST_ROOT}/.env.test"
  local source_env_path="${REPO_ROOT}/.env.test"

  if [[ ! -f "$source_env_path" && -f "${REPO_ROOT}/.env.test.example" ]]; then
    source_env_path="${REPO_ROOT}/.env.test.example"
  fi

  if [[ -f "$test_env_path" ]]; then
    return 0
  fi

  if [[ -z "$source_env_path" ]]; then
    echo "cannot seed test env contract; no source env template found" >&2
    return 1
  fi

  log "seeding ${test_env_path} from $(basename "$source_env_path")"
  install -m 644 "$source_env_path" "$test_env_path"
}

verify_test_public_html_index() {
  local target_index_path="/home/test.eagles.edu.vn/public_html/index.html"
  if [[ ! -f "$target_index_path" ]]; then
    echo "test public index missing: $target_index_path" >&2
    return 1
  fi

  env PATH="$(dirname "$TEST_NODE_BIN"):$PATH" ROUTE_CONTRACT_JSON="$ROUTE_CONTRACT_JSON" TARGET_INDEX_PATH="$target_index_path" "$TEST_NODE_BIN" --input-type=module <<'EOF'
import fs from "node:fs"

const targetIndexPath = process.env.TARGET_INDEX_PATH
const html = fs.readFileSync(targetIndexPath, "utf8")

const contract = JSON.parse(process.env.ROUTE_CONTRACT_JSON || "{}")
const requiredSnippets = [
  "https://test.eagles.edu.vn",
  '<script src="/web-asset/shared/portal-theme-state.js"></script>',
  '<link rel="stylesheet" href="/web-asset/shared/portal-theme.min.css">',
  '<img class="brand-logo" src="/web-asset/images/logo.svg" alt="The Eagles Club logo">',
  `window.__SIS_ADMIN_PAGE_PATH=${JSON.stringify(contract.adminPagePath || "/admin")}`,
  `window.__SIS_PARENT_PORTAL_PAGE_PATH=${JSON.stringify(contract.parentPortalPagePath || "/parent/portal")}`,
  `window.__SIS_STUDENT_PORTAL_PAGE_PATH=${JSON.stringify(contract.studentPortalPagePath || "/student/portal")}`,
  'data-portal-target="admin"',
  'data-portal-target="parent"',
  'data-portal-target="student"',
]

for (const snippet of requiredSnippets) {
  if (!html.includes(snippet)) {
    throw new Error(`test public index missing required snippet: ${snippet}`)
  }
}
EOF
}

verify_test_public_assets() {
  local target_public_root="/home/test.eagles.edu.vn/public_html"
  local required_assets=(
    "${target_public_root}/favicon.ico"
    "${target_public_root}/favicon.png"
    "${target_public_root}/favicon.svg"
    "${target_public_root}/sis-admin/student-admin.html"
    "${target_public_root}/sis-admin/portal-hub.html"
    "${target_public_root}/sis-admin/library-admin.html"
    "${target_public_root}/sis-admin/grades-tabulator.html"
    "${target_public_root}/sis-parent/parent-portal.html"
    "${target_public_root}/sis-student/student-portal.html"
    "${target_public_root}/sis-student/library.html"
    "${target_public_root}/web-asset/shared/portal-theme.min.css"
    "${target_public_root}/web-asset/shared/portal-theme-state.js"
    "${target_public_root}/web-asset/shared/portal-preferences.js"
    "${target_public_root}/web-asset/shared/portal-navigation.js"
    "${target_public_root}/web-asset/shared/portal-environment.js"
    "${target_public_root}/web-asset/shared/portal-action-feedback.js"
    "${target_public_root}/web-asset/shared/vocabulary-esl-editor.js"
    "${target_public_root}/web-asset/shared/maintenance.svg"
    "${target_public_root}/web-asset/shared/secure-network.svg"
    "${target_public_root}/web-asset/shared/secure-network-white.svg"
    "${target_public_root}/web-asset/images/logo.svg"
    "${target_public_root}/web-asset/images/new-words.png"
    "${target_public_root}/web-asset/images/K9f9G9VR1Z.lottie"
    "${target_public_root}/web-asset/images/eggs-chicks.svg"
    "${target_public_root}/web-asset/images/starters.svg"
    "${target_public_root}/web-asset/images/movers.svg"
    "${target_public_root}/web-asset/images/flyers.svg"
    "${target_public_root}/web-asset/images/ket.svg"
    "${target_public_root}/web-asset/images/pet.svg"
    "${target_public_root}/web-asset/images/favicon.ico"
    "${target_public_root}/web-asset/images/favicon.png"
    "${target_public_root}/web-asset/images/favicon.svg"
    "${target_public_root}/web-asset/admin/favicon.ico"
    "${target_public_root}/web-asset/admin/student-admin.min.css"
    "${target_public_root}/web-asset/admin/student-admin.critical.css"
    "${target_public_root}/web-asset/admin/student-admin.min.js"
    "${target_public_root}/web-asset/admin/library-review-workbench.js"
    "${target_public_root}/web-asset/icons/web-component/svg-icon.js"
    "${target_public_root}/web-asset/icons/web-component/svgs/theme-moon.svg"
    "${target_public_root}/web-asset/icons/web-component/svgs/theme-sun.svg"
    "${target_public_root}/web-asset/icons/web-component/svgs/joggling-lava.svg"
    "${target_public_root}/web-asset/icons/web-component/svgs/joggling-triangles.svg"
    "${target_public_root}/web-asset/icons/web-component/svgs/spiral.svg"
    "${target_public_root}/web-asset/icons/svg/water-ripples.svg"
    "${target_public_root}/web-asset/vendor/fullcalendar/index.global.min.js"
  )

  local asset_path=""
  for asset_path in "${required_assets[@]}"; do
    if [[ ! -f "$asset_path" ]]; then
      echo "test public asset missing: $asset_path" >&2
      return 1
    fi
  done
}

verify_favicon_mobile_contract() {
  local mode="$1"
  local command=(
    "${TEST_NODE_BIN}"
    "${REPO_ROOT}/tools/verify-portal-favicon-and-mobile.mjs"
    --repo-root "${REPO_ROOT}"
  )
  if [[ "$mode" == "repo" ]]; then
    log "verifying repository portal favicon and 320px contract"
  else
    command+=(
      --runtime-root "${TEST_ROOT}"
      --public-root "${TEST_PUBLIC_ROOT}"
      --origin "${TEST_PRIMARY_ORIGIN}"
    )
    log "verifying test portal favicon, public copies, and 320px contract"
  fi
  (cd "${REPO_ROOT}" && "${command[@]}")
}

verify_test_runtime_routes() {
  local route_matrix="$1"
  env PATH="$(dirname "$TEST_NODE_BIN"):$PATH" TEST_ROUTE_MATRIX="$route_matrix" "$TEST_NODE_BIN" --input-type=module <<'EOF'
const matrix = String(process.env.TEST_ROUTE_MATRIX || "")
  .split(";")
  .map((entry) => entry.trim())
  .filter(Boolean)

if (!matrix.length) {
  console.log("no test route matrix configured")
  process.exit(0)
}

for (const entry of matrix) {
  const [url, statusText, needle = "", locationNeedle = ""] = entry.split("|")
  const expectedStatus = Number(statusText)
  const response = await fetch(url, { redirect: "manual" })
  const body = await response.text()
  if (response.status !== expectedStatus) {
    throw new Error(`route ${url} expected ${expectedStatus}, got ${response.status}`)
  }
  if (needle && !body.includes(needle)) {
    throw new Error(`route ${url} missing expected text: ${needle}`)
  }
  if (locationNeedle) {
    const actualLocation = response.headers.get("location") || ""
    if (actualLocation !== locationNeedle) {
      throw new Error(`route ${url} expected Location ${locationNeedle}, got ${actualLocation || "(empty)"}`)
    }
  }
  if (body.includes("Static preview mode requires ?apiOrigin=http://127.0.0.1:<mailer-port> or opening /admin.")) {
    throw new Error(`route ${url} still shows static preview guidance`)
  }
}
EOF
}

refresh_test_prisma() {
  if [[ ! -d "$TEST_ROOT" ]]; then
    log "skip Prisma generate (test root missing): ${TEST_ROOT}"
    return 0
  fi
  if [[ ! -f "$TEST_ROOT/package.json" ]]; then
    log "skip Prisma generate (package.json missing): ${TEST_ROOT}"
    return 0
  fi
  if [[ ! -f "$TEST_ROOT/.env.test" ]]; then
    log "skip Prisma commands (missing .env.test)"
    return 0
  fi
  if [[ ! -x "$TEST_NODE_BIN" ]]; then
    echo "test Node runtime missing or not executable: $TEST_NODE_BIN" >&2
    return 1
  fi

  log "installing test runtime dependencies in ${TEST_ROOT}"
  (cd "$TEST_ROOT" && env PATH="$(dirname "$TEST_NODE_BIN"):$PATH" "${TEST_VERBOSE_ENV[@]}" npm ci --include=dev)

  log "refreshing test Prisma client in ${TEST_ROOT}"
  (cd "$TEST_ROOT" && env PATH="$(dirname "$TEST_NODE_BIN"):$PATH" "${TEST_VERBOSE_ENV[@]}" npm run db:generate)

  if [[ "${SIS_LEGACY_PRE_CUTOVER:-0}" == "1" ]]; then
    log "skipping Prisma migrations for legacy pre-cutover preview"
  else
    log "running Prisma migrations against test database"
    (cd "$TEST_ROOT" && env PATH="$(dirname "$TEST_NODE_BIN"):$PATH" "${TEST_VERBOSE_ENV[@]}" npm run db:migrate:deploy)
  fi
}

should_refresh_prisma() {
  [[ "$MODE" == "full" || "$MODE" == "restart-only" || "$MODE" == "boot-prep" ]]
}

should_restart_runtime() {
  [[ "$MODE" != "boot-prep" ]]
}

wait_for_port_release() {
  local port="$1"
  local retries="${2:-10}"
  local delay="${3:-1}"
  for _ in $(seq 1 "$retries"); do
    if ! ss -lnt "( sport = :${port} )" 2>/dev/null | grep -q LISTEN; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

restart_test_runtime() {
  log "ensuring port :${TEST_PORT} is available"
  wait_for_port_release "$TEST_PORT" 5 1 || true

  log "restarting test systemd service"
  sudo systemctl restart "$TEST_SERVICE"
  sudo systemctl is-active --quiet "$TEST_SERVICE"

  if [[ "$TEST_HEALTH_DELAY" -gt 0 ]]; then
    log "waiting ${TEST_HEALTH_DELAY}s for runtime to settle before health check"
    sleep "$TEST_HEALTH_DELAY"
  fi

  for _ in $(seq 1 30); do
    if curl -fsS "$TEST_HEALTH_URL" >/dev/null 2>&1; then
      log "test health ok on :${TEST_PORT}"
      if [[ -n "$TEST_PUBLIC_HEALTH_URL" ]]; then
        curl -fsS "$TEST_PUBLIC_HEALTH_URL" >/dev/null 2>&1 \
          && log "public health ok (${TEST_PUBLIC_HEALTH_URL})" \
          || log "public health probe failed (${TEST_PUBLIC_HEALTH_URL})"
      fi
      return 0
    fi
    sleep 1
  done

  log "test runtime health check failed"
  sudo systemctl status "$TEST_SERVICE" --no-pager -l | sed -n '1,80p' || true
  return 1
}

main() {
  log "file mirror sync; full mode includes a restorable test DB backup; git commit matching is not part of the contract"
  build_admin_assets
  verify_favicon_mobile_contract repo
  backup_test_state
  wipe_test_target_contents
  verify_test_preserved_runtime_files
  wipe_target_contents "$TEST_PUBLIC_ROOT"
  run_sync
  log "syncing test runtime web assets into ${TEST_ROOT}"
  sync_test_runtime_assets
  verify_local_ui_runtime_parity
  cleanup_test_backup_artifacts
  ensure_test_library_media_root
  ensure_test_runtime_env_contract
  repair_test_source_redis_env
  align_test_env_from_test_source
  ensure_test_redis_env
  if should_refresh_prisma; then
    refresh_test_prisma
    ensure_test_redis_runtime_config
  else
    log "skip Prisma refresh for mode=${MODE}"
  fi
  if should_restart_runtime; then
    restart_test_runtime
    if [[ "$MODE" != "boot-prep" ]]; then
      log "syncing test public mirror into ${TEST_PUBLIC_ROOT}"
      sync_test_public_assets
      sync_test_public_html_index
    else
      log "skip public_html sync for mode=boot-prep"
      log "skip public web asset sync for mode=boot-prep"
    fi
    verify_test_public_html_index
    verify_test_public_assets
    verify_favicon_mobile_contract test
    verify_test_runtime_routes "$TEST_ROUTE_MATRIX"
    verify_portal_sync_proof
    precompress_test_assets
    verify_lighthouse_performance
  else
    log "skip runtime restart and route probes for mode=${MODE}"
  fi
  log "completed mode=${MODE}"
}

main "$@"
