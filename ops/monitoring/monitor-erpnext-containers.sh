#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
metrics_directory="$repository_root/runtime-data/prometheus"
metrics_file="$metrics_directory/erpnext-container-health.prom"
temporary_file=""
check_success=1

cleanup() {
  if [[ -n "$temporary_file" ]]; then
    rm -f -- "$temporary_file"
  fi
}

trap cleanup EXIT
umask 0022
mkdir -p "$metrics_directory"
temporary_file="$(mktemp "$metrics_directory/.erpnext-container-health.XXXXXX")"

{
  printf '# HELP erpnext_container_running Whether the expected LTD ERPNext container is running.\n'
  printf '# TYPE erpnext_container_running gauge\n'
  printf '# HELP erpnext_container_health Docker health state: 1 healthy, 0 unhealthy or starting, -1 no healthcheck.\n'
  printf '# TYPE erpnext_container_health gauge\n'

  while IFS=' ' read -r container component; do
    state=""
    health=""
    if details="$(docker inspect --format '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null)"; then
      IFS='|' read -r state health <<< "$details"
    else
      check_success=0
    fi

    if [[ "$state" == true ]]; then
      running=1
    else
      running=0
    fi

    case "$health" in
      healthy) container_health=1 ;;
      none) container_health=-1 ;;
      unhealthy|starting) container_health=0 ;;
      *)
        container_health=0
        check_success=0
        ;;
    esac

    printf 'erpnext_container_running{domain="ltd.eagles.vn",component="%s"} %s\n' "$component" "$running"
    printf 'erpnext_container_health{domain="ltd.eagles.vn",component="%s"} %s\n' "$component" "$container_health"
  done <<'CONTAINERS'
erpnext-db-1 database
erpnext-backend-1 backend
erpnext-frontend-1 frontend
erpnext-websocket-1 websocket
erpnext-queue-short-1 queue_short
erpnext-queue-long-1 queue_long
erpnext-scheduler-1 scheduler
redis-stack redis
CONTAINERS

  printf '# HELP erpnext_container_monitor_last_check_success Whether all expected LTD ERPNext containers could be inspected.\n'
  printf '# TYPE erpnext_container_monitor_last_check_success gauge\n'
  printf 'erpnext_container_monitor_last_check_success %s\n' "$check_success"
  printf '# HELP erpnext_container_monitor_last_check_timestamp_seconds Unix time of the latest LTD ERPNext container inspection.\n'
  printf '# TYPE erpnext_container_monitor_last_check_timestamp_seconds gauge\n'
  printf 'erpnext_container_monitor_last_check_timestamp_seconds %s\n' "$(date +%s)"
} > "$temporary_file"

chmod 0644 "$temporary_file"
mv -f -- "$temporary_file" "$metrics_file"
temporary_file=""
