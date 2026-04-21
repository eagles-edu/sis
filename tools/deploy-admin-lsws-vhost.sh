#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_CONF="${REPO_ROOT}/deploy/litespeed/admin.eagles.edu.vn.vhost.conf"
TARGET_CONF="/usr/local/lsws/conf/vhosts/admin.eagles.edu.vn/vhost.conf"
BACKUP_DIR="/usr/local/lsws/conf/vhosts/admin.eagles.edu.vn/backups"

if [[ ! -f "${SOURCE_CONF}" ]]; then
  echo "Missing source config: ${SOURCE_CONF}" >&2
  exit 1
fi

timestamp="$(date +%Y%m%d-%H%M%S)"

sudo mkdir -p "${BACKUP_DIR}"
if [[ -f "${TARGET_CONF}" ]]; then
  sudo cp "${TARGET_CONF}" "${BACKUP_DIR}/vhost.conf.${timestamp}.bak"
fi

sudo cp "${SOURCE_CONF}" "${TARGET_CONF}"
sudo /usr/local/lsws/bin/lswsctrl reload

echo "[ok] deployed ${SOURCE_CONF} -> ${TARGET_CONF}"
