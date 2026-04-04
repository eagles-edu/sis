#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="${SOURCE_ROOT:-/home/eagles/dockerz/sis}"
RUNTIME_ROOT="${RUNTIME_ROOT:-/home/admin.eagles.edu.vn/sis}"
PUBLIC_ROOT="${PUBLIC_ROOT:-/home/admin.eagles.edu.vn/public_html}"

usage() {
  cat <<'USAGE'
Usage: verify-portal-sync-proof.sh [options]

Verifies student/parent portal parity across source, runtime, and public mirror files.

Options:
  --source-root PATH   Source root (default: /home/eagles/dockerz/sis)
  --runtime-root PATH  Runtime root (default: /home/admin.eagles.edu.vn/sis)
  --public-root PATH   Public root (default: /home/admin.eagles.edu.vn/public_html)
  -h, --help           Show help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-root)
      SOURCE_ROOT="$2"
      shift 2
      ;;
    --runtime-root)
      RUNTIME_ROOT="$2"
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

if [[ ! -d "${SOURCE_ROOT}" ]]; then
  echo "Source root not found: ${SOURCE_ROOT}" >&2
  exit 1
fi
if [[ ! -d "${RUNTIME_ROOT}" ]]; then
  echo "Runtime root not found: ${RUNTIME_ROOT}" >&2
  exit 1
fi
if [[ ! -d "${PUBLIC_ROOT}" ]]; then
  echo "Public root not found: ${PUBLIC_ROOT}" >&2
  exit 1
fi

file_hash() {
  local target="$1"
  if [[ ! -f "${target}" ]]; then
    echo ""
    return 1
  fi
  sha256sum "${target}" | awk '{print $1}'
}

verify_target() {
  local label="$1"
  local source_rel="$2"
  local runtime_rel="$3"
  local public_rel="$4"

  local source_path="${SOURCE_ROOT}/${source_rel}"
  local runtime_path="${RUNTIME_ROOT}/${runtime_rel}"
  local public_path="${PUBLIC_ROOT}/${public_rel}"

  local source_hash=""
  local runtime_hash=""
  local public_hash=""

  source_hash="$(file_hash "${source_path}")" || {
    echo "[proof] ${label}: missing source file ${source_path}" >&2
    return 1
  }
  runtime_hash="$(file_hash "${runtime_path}")" || {
    echo "[proof] ${label}: missing runtime file ${runtime_path}" >&2
    return 1
  }
  public_hash="$(file_hash "${public_path}")" || {
    echo "[proof] ${label}: missing public file ${public_path}" >&2
    return 1
  }

  echo "[proof] ${label} source=${source_hash} runtime=${runtime_hash} public=${public_hash}"

  if [[ "${source_hash}" != "${runtime_hash}" || "${source_hash}" != "${public_hash}" ]]; then
    echo "[proof] ${label}: hash mismatch detected" >&2
    return 1
  fi

  return 0
}

status=0
verify_target "student-portal" "web-asset/student/student-portal.html" "web-asset/student/student-portal.html" "sis-student/student-portal.html" || status=1
verify_target "parent-portal" "web-asset/parent/parent-portal.html" "web-asset/parent/parent-portal.html" "sis-parent/parent-portal.html" || status=1

if [[ "${status}" -ne 0 ]]; then
  echo "[proof] portal sync proof failed" >&2
  exit 1
fi

echo "[ok] portal sync proof passed"
