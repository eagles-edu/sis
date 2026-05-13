#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_PORT="${SIS_DEV_PORT:-8788}"
DEV_PID_FILE="${SIS_DEV_PID_FILE:-${REPO_ROOT}/runtime-data/dev-runtime.pid}"
DEV_LOG_FILE="${SIS_DEV_LOG_FILE:-${REPO_ROOT}/runtime-data/dev-runtime.log}"

log() {
  printf '[restart-dev] %s\n' "$*"
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

build_admin_assets() {
  log "building admin minified assets from source"
  (cd "$REPO_ROOT" && npm run build:admin-assets)
}

refresh_runtime_prisma_client() {
  if [[ ! -f "$REPO_ROOT/package.json" ]]; then
    log "skip Prisma refresh (package.json missing)"
    return 0
  fi

  log "refreshing dev Prisma client and applying migrations"
  (
    cd "$REPO_ROOT" &&
      env SIS_ENV_FILE=.env.dev DOTENV_CONFIG_PATH=.env.dev NODE_ENV=development npm run db:generate &&
      env SIS_ENV_FILE=.env.dev DOTENV_CONFIG_PATH=.env.dev NODE_ENV=development npm run db:migrate:deploy
  )
}

stop_runtime() {
  mkdir -p "$(dirname "$DEV_PID_FILE")"

  if [[ -f "$DEV_PID_FILE" ]]; then
    local pid
    pid="$(tr -dc '0-9' < "$DEV_PID_FILE")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      log "stopping pid=$pid"
      kill "$pid" 2>/dev/null || true
      wait_for_port_release "$DEV_PORT" 10 1 || true
      if kill -0 "$pid" 2>/dev/null; then
        log "forcing stop pid=$pid"
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
  fi

  local pids
  pids="$(port_listener_pids "$DEV_PORT")"
  if [[ -n "$pids" ]]; then
    log "stopping listeners on :${DEV_PORT} -> ${pids//$'\n'/ }"
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

start_runtime() {
  mkdir -p "$(dirname "$DEV_LOG_FILE")"
  : > "$DEV_LOG_FILE"

  log "starting dev runtime from current workspace on :${DEV_PORT}"
  __SIS_DEV_ROOT="$REPO_ROOT" \
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
  stop_runtime
  refresh_runtime_prisma_client
  start_runtime
}

main "$@"
