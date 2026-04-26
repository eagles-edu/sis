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
TEST_NODE_BIN="${SIS_TEST_NODE_BIN:-/home/eagles/node-v20.19.4-linux-x64/bin/node}"
TEST_PRIMARY_ORIGIN="${SIS_TEST_PRIMARY_ORIGIN:-https://test.eagles.edu.vn}"
LIVE_ROOT_CANONICAL="${SIS_LIVE_ROOT_CANONICAL:-/home/admin.eagles.edu.vn/sis}"
DEV_ROOT_CANONICAL="${SIS_DEV_ROOT_CANONICAL:-/home/eagles/dockerz/sis}"
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
const parentPortalPagePath = contract.parentPortalPagePath || "/parent"
const studentPortalPagePath = contract.studentPortalPagePath || "/student"
const entries = [
  [`http://127.0.0.1:${port}/`, 200, `window.__SIS_RUNTIME_ENV=${JSON.stringify(runtimeEnv)}`, ""],
  [`http://127.0.0.1:${port}${adminPagePath}`, 200, "Student Admin Login", ""],
  [`http://127.0.0.1:${port}${parentPortalPagePath}`, 200, "dành cho phụ huynh", ""],
  [`http://127.0.0.1:${port}${studentPortalPagePath}`, 200, "Student Portal", ""],
  [`http://127.0.0.1:${port}${contract.adminLegacyPagePath || "/admin/students"}`, 308, "", adminPagePath],
  [`http://127.0.0.1:${port}${contract.parentLegacyPagePath || "/parent/portal"}`, 308, "", parentPortalPagePath],
  [`http://127.0.0.1:${port}${contract.studentLegacyPagePath || "/student/portal"}`, 308, "", studentPortalPagePath],
]
process.stdout.write(entries.map((entry) => entry.join("|")).join(";"))
EOF
}

TEST_ROUTE_MATRIX="${SIS_TEST_ROUTE_MATRIX:-$(build_test_route_matrix)}"
# File mirror only: this wrapper syncs content into the test host and does not
# use git commit ancestry as part of the sync contract.
if [[ -n "${SIS_TEST_VERBOSE_ENV:-}" ]]; then
  # shellcheck disable=SC2206
  TEST_VERBOSE_ENV=(${SIS_TEST_VERBOSE_ENV})
else
  TEST_VERBOSE_ENV=("SIS_ENV_FILE=.env.test" "DOTENV_CONFIG_PATH=.env.test" "NODE_ENV=test")
fi

log() {
  printf '[sync-test] %s\n' "$*"
}

TEST_ENV_DEV_MIRROR_KEYS=(
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
  "MOODLE_QUIZ_SYNC_SHARED_SECRET"
  "MOODLE_SIS_QUIZ_SYNC_SECRET"
  "STUDENT_TEACHER_ACCOUNTS_JSON"
  "STUDENT_PARENT_USER"
  "STUDENT_PARENT_PASS"
  "STUDENT_PARENT_PORTAL_ACCOUNTS_JSON"
  "STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON"
  "STUDENT_NEWS_VALIDATION_DISABLED"
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
  env PATH="$(dirname "$TEST_NODE_BIN"):$PATH" ENV_FILE="$env_file" ENV_KEY="$key" ENV_VALUE="$value" "$TEST_NODE_BIN" --input-type=module <<'EOF'
import fs from "node:fs"

const envFile = process.env.ENV_FILE
const envKey = process.env.ENV_KEY
const envValue = process.env.ENV_VALUE || ""
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
  fs.writeFileSync(envFile, next)
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

align_test_env_from_dev_source() {
  local test_env_path="${TEST_ROOT}/.env.test"
  local source_env_path="${REPO_ROOT}/.env.dev"

  if [[ ! -f "$test_env_path" ]]; then
    log "skip dev->test env alignment (missing .env.test in ${TEST_ROOT})"
    return 0
  fi
  if [[ ! -f "$source_env_path" ]]; then
    log "skip dev->test env alignment (missing ${source_env_path})"
    return 0
  fi

  sync_env_keys_between_files "$source_env_path" "$test_env_path" "${TEST_ENV_DEV_MIRROR_KEYS[@]}"
}

ensure_test_redis_env() {
  local test_env_path="${TEST_ROOT}/.env.test"
  if [[ ! -f "$test_env_path" ]]; then
    log "skip Redis wiring (missing .env.test in ${TEST_ROOT})"
    return 0
  fi

  local source_env_path=""
  if [[ -f "${REPO_ROOT}/.env" ]]; then
    source_env_path="${REPO_ROOT}/.env"
  elif [[ -f "${REPO_ROOT}/.env.dev" ]]; then
    source_env_path="${REPO_ROOT}/.env.dev"
  fi

  local redis_url=""
  local redis_session_url=""
  local redis_cache_url=""
  local redis_insight_url=""

  if [[ -n "$source_env_path" ]]; then
    redis_url="$(read_env_value "$source_env_path" "REDIS_URL")"
    redis_session_url="$(read_env_value "$source_env_path" "REDIS_SESSION_URL")"
    redis_cache_url="$(read_env_value "$source_env_path" "REDIS_CACHE_URL")"
    redis_insight_url="$(read_env_value "$source_env_path" "REDIS_INSIGHT_URL")"
  fi

  if [[ -z "$redis_url" ]]; then
    redis_url="$(read_env_value "$test_env_path" "REDIS_URL")"
  fi
  if [[ -z "$redis_session_url" ]]; then
    redis_session_url="$(read_env_value "$test_env_path" "REDIS_SESSION_URL")"
  fi
  if [[ -z "$redis_cache_url" ]]; then
    redis_cache_url="$(read_env_value "$test_env_path" "REDIS_CACHE_URL")"
  fi
  if [[ -z "$redis_insight_url" ]]; then
    redis_insight_url="$(read_env_value "$test_env_path" "REDIS_INSIGHT_URL")"
  fi

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

ensure_test_runtime_env_contract() {
  local test_env_path="${TEST_ROOT}/.env.test"
  local default_env_path="${TEST_ROOT}/.env"

  if [[ ! -f "$test_env_path" ]]; then
    log "skip test env contract pinning (missing .env.test in ${TEST_ROOT})"
    return 0
  fi

  local test_dev_roots="${DEV_ROOT_CANONICAL},${TEST_ROOT}"
  local source_env_path=""
  local moodle_secret=""

  if [[ -f "${REPO_ROOT}/.env.dev" ]]; then
    source_env_path="${REPO_ROOT}/.env.dev"
  elif [[ -f "${REPO_ROOT}/.env" ]]; then
    source_env_path="${REPO_ROOT}/.env"
  fi

  if [[ -n "$source_env_path" ]]; then
    moodle_secret="$(read_env_value "$source_env_path" "MOODLE_QUIZ_SYNC_SHARED_SECRET")"
    if [[ -z "$moodle_secret" ]]; then
      moodle_secret="$(read_env_value "$source_env_path" "MOODLE_SIS_QUIZ_SYNC_SECRET")"
    fi
  fi

  upsert_env_value "$test_env_path" "EXERCISE_MAILER_HOST" "127.0.0.1"
  upsert_env_value "$test_env_path" "EXERCISE_MAILER_PORT" "$TEST_PORT"
  upsert_env_value "$test_env_path" "EXERCISE_MAILER_ORIGIN" "$TEST_PRIMARY_ORIGIN"
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

run_sync() {
  run_ffs() {
    local label="$1"
    shift

    if "$@"; then
      return 0
    else
      local status=$?
      if [[ "$status" == "3" ]]; then
        log "${label} reported no changes; continuing"
        return 0
      fi

      return "$status"
    fi
  }

  case "$MODE" in
    full)
      log "running ffs-sis-root-test --batch"
      (cd "$REPO_ROOT" && run_ffs "ffs-sis-root-test" ffs-sis-root-test --batch)
      log "running ffs-sis-public-root-test --batch"
      (cd "$REPO_ROOT" && run_ffs "ffs-sis-public-root-test" ffs-sis-public-root-test --batch)
      ;;
    public)
      log "running ffs-sis-public-root-test --batch"
      (cd "$REPO_ROOT" && run_ffs "ffs-sis-public-root-test" ffs-sis-public-root-test --batch)
      ;;
    restart-only)
      log "skip sync (restart-only mode)"
      ;;
  esac
}

sync_test_src_tree() {
  if [[ ! -d "${REPO_ROOT}/src" ]]; then
    log "skip src tree sync (repo src missing)"
    return 0
  fi

  mkdir -p "${TEST_ROOT}/src"
  log "syncing repo src tree into ${TEST_ROOT}/src"
  rsync -a --delete "${REPO_ROOT}/src/" "${TEST_ROOT}/src/"

  if [[ ! -f "${TEST_ROOT}/src/modules/exercises/exercise-store.mjs" ]]; then
    echo "src tree sync failed: ${TEST_ROOT}/src/modules/exercises/exercise-store.mjs missing" >&2
    return 1
  fi
}

cleanup_test_backup_artifacts() {
  if [[ ! -d "$TEST_ROOT" ]]; then
    log "skip backup artifact cleanup (test root missing)"
    return 0
  fi

  log "removing backup artifacts from ${TEST_ROOT}"
  find "$TEST_ROOT" -type f -name '*.BAK-*' -delete
}

sync_test_public_html_index() {
  local source_hub_html="${REPO_ROOT}/web-asset/admin/portal-hub.html"
  local target_public_root="/home/test.eagles.edu.vn/public_html"
  local target_index_path="${target_public_root}/index.html"
  local target_owner
  local target_group
  local install_prefix=()

  target_owner="$(id -un)"
  target_group="$(id -gn)"

  if [[ ! -f "$source_hub_html" ]]; then
    log "skip public_html index sync (portal hub source missing)"
    return 0
  fi

  if [[ ! -d "$target_public_root" || ! -w "$target_public_root" ]]; then
    install_prefix=(sudo)
  fi

  "${install_prefix[@]}" install -d -o "$target_owner" -g "$target_group" "$target_public_root"
  log "syncing portal hub into ${target_index_path}"
  "${install_prefix[@]}" install -o "$target_owner" -g "$target_group" -m 644 "$source_hub_html" "$target_index_path"

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
  local target_public_root="/home/test.eagles.edu.vn/public_html"
  local target_web_asset_root="${target_public_root}/web-asset"
  local target_owner
  local target_group
  local install_prefix=()

  target_owner="$(id -un)"
  target_group="$(id -gn)"

  if [[ ! -d "$target_public_root" || ! -w "$target_public_root" ]]; then
    install_prefix=(sudo)
  fi

  "${install_prefix[@]}" install -d -o "$target_owner" -g "$target_group" \
    "$target_web_asset_root" \
    "${target_web_asset_root}/shared" \
    "${target_web_asset_root}/images" \
    "${target_web_asset_root}/admin" \
    "${target_web_asset_root}/admin/portal-backgrounds"

  log "syncing public web assets into ${target_web_asset_root}"
  "${install_prefix[@]}" rsync -a --delete "${REPO_ROOT}/web-asset/shared/" "${target_web_asset_root}/shared/"
  "${install_prefix[@]}" rsync -a --delete "${REPO_ROOT}/web-asset/images/" "${target_web_asset_root}/images/"
  "${install_prefix[@]}" rsync -a --delete "${REPO_ROOT}/web-asset/admin/portal-backgrounds/" "${target_web_asset_root}/admin/portal-backgrounds/"
}

sync_test_icons_assets() {
  local target_runtime_root="${TEST_ROOT}"
  local target_icons_root="${target_runtime_root}/web-asset/icons"

  if [[ ! -d "${REPO_ROOT}/web-asset/icons" ]]; then
    log "skip icons sync (source icons missing)"
    return 0
  fi

  mkdir -p "${target_icons_root}"
  log "syncing icon web component assets into ${target_icons_root}"
  rsync -a --delete "${REPO_ROOT}/web-asset/icons/" "${target_icons_root}/"
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
    "${target_public_root}/web-asset/shared/portal-theme.css"
    "${target_public_root}/web-asset/images/logo.svg"
    "${target_public_root}/web-asset/admin/portal-backgrounds/hub-mesh-05.svg"
  )

  local asset_path=""
  for asset_path in "${required_assets[@]}"; do
    if [[ ! -f "$asset_path" ]]; then
      echo "test public asset missing: $asset_path" >&2
      return 1
    fi
  done
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

  log "refreshing test Prisma client in ${TEST_ROOT}"
  (cd "$TEST_ROOT" && env PATH="$(dirname "$TEST_NODE_BIN"):$PATH" "${TEST_VERBOSE_ENV[@]}" npm run db:generate)

  log "running Prisma migrations against test database"
  (cd "$TEST_ROOT" && env PATH="$(dirname "$TEST_NODE_BIN"):$PATH" "${TEST_VERBOSE_ENV[@]}" npm run db:migrate:deploy)
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
  log "file mirror only; git commit matching is not part of the test sync contract"
  run_sync
  sync_test_src_tree
  cleanup_test_backup_artifacts
  if [[ "$MODE" != "boot-prep" ]]; then
    sync_test_public_html_index
    sync_test_public_assets
  else
    log "skip public_html sync for mode=boot-prep"
    log "skip public web asset sync for mode=boot-prep"
  fi
  sync_test_icons_assets
  align_test_env_from_dev_source
  ensure_test_runtime_env_contract
  ensure_test_redis_env
  if should_refresh_prisma; then
    refresh_test_prisma
  else
    log "skip Prisma refresh for mode=${MODE}"
  fi
  if should_restart_runtime; then
    restart_test_runtime
    verify_test_public_html_index
    verify_test_public_assets
    verify_test_runtime_routes "$TEST_ROUTE_MATRIX"
  else
    log "skip runtime restart and route probes for mode=${MODE}"
  fi
  log "completed mode=${MODE}"
}

main "$@"
