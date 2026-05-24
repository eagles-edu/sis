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
DEV_ROOT="${SIS_DEV_ROOT:-$REPO_ROOT}"
LIVE_ROOT="${SIS_LIVE_ROOT:-/home/admin.eagles.edu.vn/sis}"
LIVE_PORT="${SIS_LIVE_PORT:-8787}"
DEV_PORT="${SIS_DEV_PORT:-8788}"
DEV_PID_FILE="${SIS_DEV_PID_FILE:-$DEV_ROOT/runtime-data/dev-runtime.pid}"
DEV_LOG_FILE="${SIS_DEV_LOG_FILE:-$DEV_ROOT/runtime-data/dev-runtime.log}"
SIS_CONFIG_FILE_NAME="SIS_CONFIG.json"
SIS_CONFIG_SOURCE_PATH="${REPO_ROOT}/${SIS_CONFIG_FILE_NAME}"
SIS_CONFIG_SOURCE_BACKUP=""

log() {
  printf '[sync-restart] %s\n' "$*"
}

stash_local_sis_config() {
  if [[ ! -f "$SIS_CONFIG_SOURCE_PATH" ]]; then
    return 0
  fi
  SIS_CONFIG_SOURCE_BACKUP="${SIS_CONFIG_SOURCE_PATH}.sync-backup-$$-$RANDOM"
  mv "$SIS_CONFIG_SOURCE_PATH" "$SIS_CONFIG_SOURCE_BACKUP"
}

restore_local_sis_config() {
  if [[ -n "$SIS_CONFIG_SOURCE_BACKUP" && -f "$SIS_CONFIG_SOURCE_BACKUP" ]]; then
    mv "$SIS_CONFIG_SOURCE_BACKUP" "$SIS_CONFIG_SOURCE_PATH"
    SIS_CONFIG_SOURCE_BACKUP=""
  fi
}

port_listener_pids() {
  local port="$1"
  ss -lntp "( sport = :${port} )" 2>/dev/null \
    | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' \
    | sort -u
}

wait_for_port_release() {
  local port="$1"
  local retries="${2:-10}"
  local delay="${3:-1}"
  local i
  for i in $(seq 1 "$retries"); do
    if ! ss -lnt "( sport = :${port} )" 2>/dev/null | grep -q LISTEN; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
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
      log "running ffs-sis-root --batch"
      stash_local_sis_config
      trap restore_local_sis_config EXIT
      (cd "$REPO_ROOT" && run_ffs "ffs-sis-root" ffs-sis-root --batch)
      restore_local_sis_config
      trap - EXIT
      ;;
    public)
      log "running ffs-sis-public-root --batch"
      stash_local_sis_config
      trap restore_local_sis_config EXIT
      (cd "$REPO_ROOT" && run_ffs "ffs-sis-public-root" ffs-sis-public-root --batch)
      restore_local_sis_config
      trap - EXIT
      ;;
    restart-only)
      log "skip sync (restart-only mode)"
      ;;
  esac
}

build_admin_assets() {
  case "$MODE" in
    full|public)
      log "building admin minified assets from source"
      (cd "$REPO_ROOT" && npm run build:admin-assets)
      ;;
    restart-only)
      log "skip admin asset build (restart-only mode)"
      ;;
  esac
}

sync_live_prisma_files() {
  if [[ ! -d "${LIVE_ROOT}" ]]; then
    log "skip Prisma file sync (live root missing): ${LIVE_ROOT}"
    return 0
  fi
  if [[ ! -d "${REPO_ROOT}/prisma" ]]; then
    log "skip Prisma file sync (source prisma missing): ${REPO_ROOT}/prisma"
    return 0
  fi

  mkdir -p "${LIVE_ROOT}/prisma"
  log "syncing Prisma schema and config into ${LIVE_ROOT}"
  rsync -a --delete "${REPO_ROOT}/prisma/" "${LIVE_ROOT}/prisma/"
  if [[ -f "${REPO_ROOT}/prisma.config.ts" ]]; then
    rsync -a --delete "${REPO_ROOT}/prisma.config.ts" "${LIVE_ROOT}/"
  fi
}

refresh_live_prisma_client() {
  if [[ ! -d "$LIVE_ROOT" ]]; then
    log "skip Prisma generate (live root missing): ${LIVE_ROOT}"
    return 0
  fi
  if [[ ! -f "$LIVE_ROOT/package.json" ]]; then
    log "skip Prisma generate (package.json missing): ${LIVE_ROOT}"
    return 0
  fi
  log "refreshing live Prisma client and applying migrations in ${LIVE_ROOT}"
  (
    cd "$LIVE_ROOT" &&
      npm run db:generate &&
      npm run db:migrate:deploy
  )
}

refresh_dev_prisma_client() {
  if [[ ! -d "$DEV_ROOT" ]]; then
    log "skip Prisma refresh (dev root missing): ${DEV_ROOT}"
    return 0
  fi
  if [[ ! -f "$DEV_ROOT/package.json" ]]; then
    log "skip Prisma refresh (package.json missing): ${DEV_ROOT}"
    return 0
  fi

  log "refreshing dev Prisma client and applying migrations in ${DEV_ROOT}"
  (
    cd "$DEV_ROOT" &&
      env SIS_ENV_FILE=.env.dev DOTENV_CONFIG_PATH=.env.dev NODE_ENV=development npm run db:generate &&
      env SIS_ENV_FILE=.env.dev DOTENV_CONFIG_PATH=.env.dev NODE_ENV=development npm run db:migrate:deploy
  )
}

restart_live_runtime() {
  log "restarting live systemd service"
  sudo systemctl restart exercise-mailer.service
  sudo systemctl is-active --quiet exercise-mailer.service
  local i
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${LIVE_PORT}/healthz" >/dev/null 2>&1; then
      log "live health ok on :${LIVE_PORT}"
      return 0
    fi
    sleep 1
  done
  log "live runtime health check failed"
  sudo systemctl status exercise-mailer.service --no-pager -l | sed -n '1,80p' || true
  return 1
}

stop_dev_runtime() {
  mkdir -p "$(dirname "$DEV_PID_FILE")"
  if [[ -f "$DEV_PID_FILE" ]]; then
    local pid
    pid="$(tr -dc '0-9' < "$DEV_PID_FILE")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      log "stopping dev runtime pid=$pid"
      kill "$pid" 2>/dev/null || true
      wait_for_port_release "$DEV_PORT" 10 1 || true
      if kill -0 "$pid" 2>/dev/null; then
        log "forcing dev runtime stop pid=$pid"
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
  fi

  local pids
  pids="$(port_listener_pids "$DEV_PORT")"
  if [[ -n "$pids" ]]; then
    log "stopping lingering listeners on :${DEV_PORT} -> ${pids//$'\n'/ }"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    wait_for_port_release "$DEV_PORT" 10 1 || true
    pids="$(port_listener_pids "$DEV_PORT")"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

start_dev_runtime() {
  mkdir -p "$(dirname "$DEV_LOG_FILE")"
  : > "$DEV_LOG_FILE"
  log "starting dev runtime on :${DEV_PORT}"
  __SIS_DEV_ROOT="$DEV_ROOT" \
  __SIS_DEV_LOG_FILE="$DEV_LOG_FILE" \
  __SIS_DEV_PID_FILE="$DEV_PID_FILE" \
  node --input-type=module - <<'NODE'
import fs from "node:fs"
import { spawn } from "node:child_process"

const devRoot = process.env.__SIS_DEV_ROOT
const logFile = process.env.__SIS_DEV_LOG_FILE
const pidFile = process.env.__SIS_DEV_PID_FILE

if (!devRoot || !logFile || !pidFile) {
  console.error("missing dev runtime launch env")
  process.exit(1)
}

const logFd = fs.openSync(logFile, "a")
const child = spawn(process.execPath, ["server/exercise-mailer.mjs"], {
  cwd: devRoot,
  env: {
    ...process.env,
    NODE_ENV: "development",
    SIS_ENV_FILE: ".env.dev",
  },
  detached: true,
  stdio: ["ignore", logFd, logFd],
})
fs.closeSync(logFd)
if (!child.pid) {
  console.error("unable to start dev runtime process")
  process.exit(1)
}
fs.writeFileSync(pidFile, `${child.pid}\n`, "utf8")
child.unref()
NODE

  local pid
  pid="$(tr -dc '0-9' < "$DEV_PID_FILE")"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    log "dev runtime failed to start (pid unavailable)"
    tail -n 80 "$DEV_LOG_FILE" || true
    return 1
  fi

  local i
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${DEV_PORT}/healthz" >/dev/null 2>&1; then
      log "dev health ok on :${DEV_PORT} (pid=${pid})"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  log "dev runtime health check failed"
  tail -n 80 "$DEV_LOG_FILE" || true
  return 1
}

main() {
  build_admin_assets
  run_sync
  sync_live_prisma_files
  log "note=live DB unchanged (no live migrate, no restore); dev DB is refreshed locally"
  refresh_live_prisma_client
  restart_live_runtime
  stop_dev_runtime
  refresh_dev_prisma_client
  start_dev_runtime
  log "completed mode=${MODE}"
}

main "$@"
