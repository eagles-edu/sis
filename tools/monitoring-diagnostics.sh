#!/usr/bin/env bash
set -euo pipefail

component="${1:-}"
action="${2:-}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
targets_dir="${repo_root}/runtime-data/prometheus/diagnostic-targets"

if [[ ! "$component" =~ ^(process|redis|litespeed)$ ]] || [[ ! "$action" =~ ^(on|off)$ ]]; then
  echo "Usage: $(basename "$0") {process|redis|litespeed} {on|off}" >&2
  exit 2
fi

mkdir -p "$targets_dir"
target_file="$targets_dir/${component}.json"

write_targets() {
  local payload="$1"
  local temporary_file
  temporary_file="$(mktemp "${target_file}.XXXXXX")"
  printf '%s\n' "$payload" >"$temporary_file"
  mv "$temporary_file" "$target_file"
}

if [[ "$action" == "off" ]]; then
  write_targets '[]'
  if [[ "$component" == "process" || "$component" == "redis" ]]; then
    docker compose -f "$repo_root/ops/monitoring/docker-compose.yml" --profile diagnostics stop "${component}-exporter" || true
  fi
else
  case "$component" in
    process)
      docker compose -f "$repo_root/ops/monitoring/docker-compose.yml" --profile diagnostics up -d process-exporter
      write_targets '[{"targets":["process-exporter:9256"]}]'
      ;;
    redis)
      docker compose -f "$repo_root/ops/monitoring/docker-compose.yml" --profile diagnostics up -d redis-exporter
      write_targets '[{"targets":["host.docker.internal:9121"]}]'
      ;;
    litespeed)
      if ! curl -fsS http://127.0.0.1:9936/metrics >/dev/null; then
        echo "LiteSpeed exporter is not listening on 127.0.0.1:9936; install and start it first." >&2
        exit 1
      fi
      write_targets '[{"targets":["host.docker.internal:9936"]}]'
      ;;
  esac
fi

curl -fsS -X POST http://127.0.0.1:9090/-/reload >/dev/null
echo "${component} diagnostics ${action}"
