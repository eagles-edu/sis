#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-full}"

case "$MODE" in
  full|public|restart-only) ;;
  *)
    echo "Usage: $(basename "$0") [full|public|restart-only]" >&2
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
if [[ -n "${SIS_TEST_VERBOSE_ENV:-}" ]]; then
  # shellcheck disable=SC2206
  TEST_VERBOSE_ENV=(${SIS_TEST_VERBOSE_ENV})
else
  TEST_VERBOSE_ENV=("SIS_ENV_FILE=.env.test" "DOTENV_CONFIG_PATH=.env.test" "NODE_ENV=test")
fi

log() {
  printf '[sync-test] %s\n' "$*"
}

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
  ENV_FILE="$env_file" ENV_KEY="$key" ENV_VALUE="$value" node --input-type=module <<'EOF'
import fs from "node:fs"

const envFile = process.env.ENV_FILE
const envKey = process.env.ENV_KEY
const envValue = process.env.ENV_VALUE ?? ""
const raw = fs.readFileSync(envFile, "utf8")
const lines = raw.split(/\r?\n/u)
const trailingNewline = raw.endsWith("\n")
let replaced = false

for (let i = 0; i < lines.length; i += 1) {
  if (lines[i].startsWith(`${envKey}=`)) {
    lines[i] = `${envKey}=${envValue}`
    replaced = true
    break
  }
}

if (!replaced) {
  lines.push(`${envKey}=${envValue}`)
}

let next = lines.join("\n")
if (trailingNewline && !next.endsWith("\n")) {
  next += "\n"
}
fs.writeFileSync(envFile, next)
EOF
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

run_sync() {
  case "$MODE" in
    full)
      log "running ffs-sis-root-test --batch"
      (cd "$REPO_ROOT" && ffs-sis-root-test --batch)
      log "running ffs-sis-public-root-test --batch"
      (cd "$REPO_ROOT" && ffs-sis-public-root-test --batch)
      ;;
    public)
      log "running ffs-sis-public-root-test --batch"
      (cd "$REPO_ROOT" && ffs-sis-public-root-test --batch)
      ;;
    restart-only)
      log "skip sync (restart-only mode)"
      ;;
  esac
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

  log "refreshing test Prisma client in ${TEST_ROOT}"
  (cd "$TEST_ROOT" && env "${TEST_VERBOSE_ENV[@]}" npm run db:generate)

  log "running Prisma migrations against test database"
  (cd "$TEST_ROOT" && env "${TEST_VERBOSE_ENV[@]}" npm run db:migrate:deploy)
}

should_refresh_prisma() {
  [[ "$MODE" == "full" || "$MODE" == "restart-only" ]]
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
  run_sync
  ensure_test_redis_env
  if should_refresh_prisma; then
    refresh_test_prisma
  else
    log "skip Prisma refresh for mode=${MODE}"
  fi
  restart_test_runtime
  log "completed mode=${MODE}"
}

main "$@"
