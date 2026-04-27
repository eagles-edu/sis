#!/usr/bin/env bash

set -euo pipefail

DEV_ROOT="${DEV_ROOT:-/home/eagles/dockerz/sis}"
LIVE_ROOT="${LIVE_ROOT:-/home/admin.eagles.edu.vn/sis}"
PUBLIC_ROOT="${PUBLIC_ROOT:-/home/admin.eagles.edu.vn/public_html}"
MODE="check-only"
DIRECTION="dev-to-live"

LIVE_WRITE_PREFIX=()
DEV_WRITE_PREFIX=()
PUBLIC_WRITE_PREFIX=()
PUBLIC_OWNERSHIP_SENTINEL_NAME=".ownership-normalized-eagles-v1"

usage() {
  cat <<'USAGE'
Usage: sync-portal-bidirectional.sh [options]

Compares or syncs portal HTML files across:
  - dev source root
  - live runtime root
  - live public mirror root

Default mode is check-only.

Options:
  --check-only      Print parity status and exit (default).
  --apply           Apply sync in selected direction.
  --dev-to-live     Sync from dev -> live runtime + public mirror.
  --live-to-dev     Sync from live runtime -> dev source + public mirror.
  --dev-root PATH   Dev root (default: /home/eagles/dockerz/sis)
  --live-root PATH  Live runtime root (default: /home/admin.eagles.edu.vn/sis)
  --public-root PATH Public mirror root (default: /home/admin.eagles.edu.vn/public_html)
  -h, --help        Show this help.

Tracked files:
  - web-asset/admin/student-admin.html
  - web-asset/admin/student-admin.css
  - web-asset/admin/student-admin.js
  - web-asset/shared/portal-theme.css
  - web-asset/parent/parent-portal.html
  - web-asset/student/student-portal.html
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only)
      MODE="check-only"
      shift
      ;;
    --apply)
      MODE="apply"
      shift
      ;;
    --dev-to-live)
      DIRECTION="dev-to-live"
      shift
      ;;
    --live-to-dev)
      DIRECTION="live-to-dev"
      shift
      ;;
    --dev-root)
      DEV_ROOT="$2"
      shift 2
      ;;
    --live-root)
      LIVE_ROOT="$2"
      shift 2
      ;;
    --public-root)
      PUBLIC_ROOT="$2"
      shift 2
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

for required_root in "${DEV_ROOT}" "${LIVE_ROOT}" "${PUBLIC_ROOT}"; do
  if [[ ! -d "${required_root}" ]]; then
    echo "Root not found: ${required_root}" >&2
    exit 1
  fi
done

normalize_public_ownership_once() {
  local sentinel_path="${PUBLIC_ROOT}/${PUBLIC_OWNERSHIP_SENTINEL_NAME}"
  if [[ -f "${sentinel_path}" ]]; then
    echo "[sync] public ownership cleanup already applied (${sentinel_path})"
    return
  fi

  echo "[sync] one-time public ownership cleanup: ${PUBLIC_ROOT}"
  sudo -n chown -R eagles:eagles "${PUBLIC_ROOT}"
  : > "${sentinel_path}"
  chmod 0644 "${sentinel_path}"
}

normalize_public_ownership_once

if [[ ! -w "${PUBLIC_ROOT}" ]]; then
  echo "Public root is not writable after normalization: ${PUBLIC_ROOT}" >&2
  exit 1
fi

if [[ ! -w "${LIVE_ROOT}" ]]; then
  echo "Live root is not writable: ${LIVE_ROOT}" >&2
  exit 1
fi
if [[ ! -w "${DEV_ROOT}" ]]; then
  echo "Dev root is not writable: ${DEV_ROOT}" >&2
  exit 1
fi

declare -A DEV_REL=()
declare -A LIVE_REL=()
declare -A PUBLIC_REL=()
PORTAL_KEYS=(admin_html admin_css admin_js shared_css parent_html student_html)

DEV_REL[admin_html]="web-asset/admin/student-admin.html"
DEV_REL[admin_css]="web-asset/admin/student-admin.css"
DEV_REL[admin_js]="web-asset/admin/student-admin.js"
DEV_REL[shared_css]="web-asset/shared/portal-theme.css"
DEV_REL[parent_html]="web-asset/parent/parent-portal.html"
DEV_REL[student_html]="web-asset/student/student-portal.html"

LIVE_REL[admin_html]="web-asset/admin/student-admin.html"
LIVE_REL[admin_css]="web-asset/admin/student-admin.css"
LIVE_REL[admin_js]="web-asset/admin/student-admin.js"
LIVE_REL[shared_css]="web-asset/shared/portal-theme.css"
LIVE_REL[parent_html]="web-asset/parent/parent-portal.html"
LIVE_REL[student_html]="web-asset/student/student-portal.html"

PUBLIC_REL[admin_html]="sis-admin/student-admin.html"
PUBLIC_REL[admin_css]="web-asset/admin/student-admin.css"
PUBLIC_REL[admin_js]="web-asset/admin/student-admin.js"
PUBLIC_REL[shared_css]="web-asset/shared/portal-theme.css"
PUBLIC_REL[parent_html]="sis-parent/parent-portal.html"
PUBLIC_REL[student_html]="sis-student/student-portal.html"

sha256_or_missing() {
  local file_path="$1"
  if [[ ! -f "${file_path}" ]]; then
    echo "missing"
    return
  fi
  sha256sum "${file_path}" | awk '{print $1}'
}

print_and_collect_drift() {
  local status=0
  for key in "${PORTAL_KEYS[@]}"; do
    local dev_path="${DEV_ROOT}/${DEV_REL[$key]}"
    local live_path="${LIVE_ROOT}/${LIVE_REL[$key]}"
    local public_path="${PUBLIC_ROOT}/${PUBLIC_REL[$key]}"

    local dev_hash="$(sha256_or_missing "${dev_path}")"
    local live_hash="$(sha256_or_missing "${live_path}")"
    local public_hash="$(sha256_or_missing "${public_path}")"

    echo "[parity] ${key} dev=${dev_hash} live=${live_hash} public=${public_hash}"

    if [[ "${dev_hash}" != "${live_hash}" || "${dev_hash}" != "${public_hash}" ]]; then
      status=1
    fi
  done

  return "${status}"
}

copy_with_backup() {
  local source_path="$1"
  local dest_path="$2"
  local prefix_name="$3"
  local timestamp="$4"

  local -a prefix=()
  case "${prefix_name}" in
    dev)
      prefix=("${DEV_WRITE_PREFIX[@]}")
      ;;
    live)
      prefix=("${LIVE_WRITE_PREFIX[@]}")
      ;;
    public)
      prefix=("${PUBLIC_WRITE_PREFIX[@]}")
      ;;
    *)
      echo "Invalid prefix selector: ${prefix_name}" >&2
      exit 1
      ;;
  esac

  if [[ ! -f "${source_path}" ]]; then
    echo "Missing source file: ${source_path}" >&2
    exit 1
  fi

  "${prefix[@]}" mkdir -p "$(dirname "${dest_path}")"
  if "${prefix[@]}" test -f "${dest_path}"; then
    "${prefix[@]}" cp -a "${dest_path}" "${dest_path}.BAK-${timestamp}"
  fi
  "${prefix[@]}" rsync -a --checksum "${source_path}" "${dest_path}"
}

normalize_public_ownership_once() {
  local sentinel_path="${PUBLIC_ROOT}/${PUBLIC_OWNERSHIP_SENTINEL_NAME}"
  if [[ -f "${sentinel_path}" ]]; then
    echo "[sync] public ownership cleanup already applied (${sentinel_path})"
    return
  fi

  local -a targets=(
    "${PUBLIC_ROOT}/sis-admin"
    "${PUBLIC_ROOT}/web-asset/admin"
    "${PUBLIC_ROOT}/web-asset/shared"
    "${PUBLIC_ROOT}/sis-parent"
    "${PUBLIC_ROOT}/sis-student"
  )

  local -a existing_targets=()
  for target in "${targets[@]}"; do
    if [[ -e "${target}" ]]; then
      existing_targets+=("${target}")
    fi
  done

  if [[ "${#existing_targets[@]}" -eq 0 ]]; then
    echo "[sync] public ownership cleanup skipped (no public targets exist yet)"
    mkdir -p "${PUBLIC_ROOT}"
    : > "${sentinel_path}"
    chmod 0644 "${sentinel_path}"
    return
  fi

  echo "[sync] one-time public ownership cleanup: ${#existing_targets[@]} target(s)"
  sudo -n chown -R eagles:eagles "${existing_targets[@]}"
  : > "${sentinel_path}"
  chmod 0644 "${sentinel_path}"
}

apply_sync() {
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"

  echo "[sync] mode=apply direction=${DIRECTION} timestamp=${timestamp}"
  normalize_public_ownership_once

  for key in "${PORTAL_KEYS[@]}"; do
    local dev_path="${DEV_ROOT}/${DEV_REL[$key]}"
    local live_path="${LIVE_ROOT}/${LIVE_REL[$key]}"
    local public_path="${PUBLIC_ROOT}/${PUBLIC_REL[$key]}"

    if [[ "${DIRECTION}" == "dev-to-live" ]]; then
      copy_with_backup "${dev_path}" "${live_path}" "live" "${timestamp}"
      copy_with_backup "${dev_path}" "${public_path}" "public" "${timestamp}"
      echo "[sync] ${key}: dev -> live,public"
    else
      copy_with_backup "${live_path}" "${dev_path}" "dev" "${timestamp}"
      copy_with_backup "${live_path}" "${public_path}" "public" "${timestamp}"
      echo "[sync] ${key}: live -> dev,public"
    fi
  done
}

echo "[portal-sync] dev_root=${DEV_ROOT}"
echo "[portal-sync] live_root=${LIVE_ROOT}"
echo "[portal-sync] public_root=${PUBLIC_ROOT}"
echo "[portal-sync] mode=${MODE} direction=${DIRECTION}"

if [[ "${MODE}" == "apply" ]]; then
  apply_sync
fi

if print_and_collect_drift; then
  echo "[ok] portal parity is aligned across dev/live/public"
  exit 0
fi

echo "[drift] portal parity mismatch detected" >&2
if [[ "${MODE}" == "check-only" ]]; then
  exit 2
fi
exit 1
