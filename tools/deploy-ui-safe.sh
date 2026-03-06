#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="/home/eagles/dockerz/sis"
RUNTIME_ROOT="/home/admin.eagles.edu.vn/sis"
SERVICE_NAME="exercise-mailer.service"
MAILER_PORT="${MAILER_PORT:-8787}"
MODE="sync-on-mismatch"
RESTART=1
HEALTH_CHECK=1

usage() {
  cat <<'USAGE'
Usage: deploy-ui-safe.sh [options]

Deploys admin UI HTML only (no DB writes, no migrations).

Options:
  --check-only         Report drift and exit without syncing.
  --force-sync         Always sync (skip drift gate).
  --no-restart         Skip service restart.
  --skip-health-check  Skip /healthz and /api/admin/auth/me checks.
  -h, --help           Show help.

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

RESYNC_SCRIPT="${SOURCE_ROOT}/tools/sis-runtime-resync.sh"
if [[ ! -x "${RESYNC_SCRIPT}" ]]; then
  echo "Missing executable resync script: ${RESYNC_SCRIPT}" >&2
  exit 1
fi

if [[ ! -f "${SOURCE_ROOT}/web-asset/admin/student-admin.html" ]]; then
  echo "Missing source UI file: ${SOURCE_ROOT}/web-asset/admin/student-admin.html" >&2
  exit 1
fi

if [[ ! -f "${RUNTIME_ROOT}/web-asset/admin/student-admin.html" ]]; then
  echo "Missing runtime UI file: ${RUNTIME_ROOT}/web-asset/admin/student-admin.html" >&2
  exit 1
fi

cmd=(
  "${RESYNC_SCRIPT}"
  "--runtime-root" "${RUNTIME_ROOT}"
  "--service" "${SERVICE_NAME}"
  "--mailer-port" "${MAILER_PORT}"
  "--scope" "html"
)

case "${MODE}" in
  check-only)
    cmd+=("--check-only")
    ;;
  sync-on-mismatch)
    cmd+=("--sync-on-mismatch")
    ;;
  force-sync)
    ;;
esac

if [[ "${RESTART}" -ne 1 ]]; then
  cmd+=("--no-restart")
fi

if [[ "${HEALTH_CHECK}" -ne 1 ]]; then
  cmd+=("--skip-health-check")
fi

echo "[deploy-ui-safe] source=${SOURCE_ROOT}"
echo "[deploy-ui-safe] runtime=${RUNTIME_ROOT}"
echo "[deploy-ui-safe] mode=${MODE} restart=${RESTART} health_check=${HEALTH_CHECK}"

cd "${SOURCE_ROOT}"
"${cmd[@]}"
