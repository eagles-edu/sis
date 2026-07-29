#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="${REPO_ROOT}/infra/languagetool"

usage() {
  printf 'Usage: %s {build|start|stop|restart|status|logs|health|regression|failover-check}\n' "$0" >&2
  exit 2
}

cd "$SERVICE_DIR"
command="${1:-}"
case "$command" in
  build) docker compose build --pull ;;
  start) docker compose up -d ;;
  stop) docker compose stop ;;
  restart) docker compose up -d --force-recreate ;;
  status) docker compose ps ;;
  logs) docker compose logs --tail=100 ;;
  health)
    for port in 8091 8092 8093; do
      curl -fsS --max-time 10 --data-urlencode language=en-US \
        --data-urlencode text="LanguageTool health check." \
        "http://127.0.0.1:${port}/v2/check" >/dev/null
      printf 'healthy %s\n' "$port"
    done
    ;;
  regression)
    node "${REPO_ROOT}/tools/languagetool-regression.mjs"
    ;;
  failover-check)
    docker compose ps --status running
    curl -fsS --max-time 10 --data-urlencode language=en-US \
      --data-urlencode text="LanguageTool failover check." \
      http://127.0.0.1:8093/v2/check >/dev/null
    docker stop sis-languagetool-1 >/dev/null
    trap 'docker start sis-languagetool-1 >/dev/null' EXIT
    sleep 2
    curl -fsS --max-time 10 --data-urlencode language=en-US \
      --data-urlencode text="LanguageTool failover check." \
      http://127.0.0.1:8093/v2/check >/dev/null
    printf 'proxy failover healthy with instance 1 stopped\n'
    ;;
  *) usage ;;
esac
