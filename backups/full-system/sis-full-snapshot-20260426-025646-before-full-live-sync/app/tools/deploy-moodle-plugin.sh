#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${SOURCE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MOODLE_ROOT="${MOODLE_ROOT:-/home/moodle.eagles.edu.vn/app}"
PLUGIN_SOURCE="${PLUGIN_SOURCE:-${SOURCE_ROOT}/integrations/moodle/local/sisquizsync/}"
PLUGIN_TARGET="${PLUGIN_TARGET:-${MOODLE_ROOT}/local/sisquizsync/}"
PHP_BIN="${PHP_BIN:-/usr/local/lsws/lsphp82/bin/php8.2}"
PLUGIN_PARENT="$(dirname "${PLUGIN_TARGET%/}")"
TARGET_OWNER_GROUP=""

if [[ -d "${PLUGIN_PARENT}" ]]; then
  TARGET_OWNER_GROUP="$(stat -c '%U:%G' "${PLUGIN_PARENT}")"
fi

if [[ ! -d "${PLUGIN_SOURCE}" ]]; then
  echo "Plugin source not found: ${PLUGIN_SOURCE}" >&2
  exit 1
fi

sudo mkdir -p "${PLUGIN_TARGET}"
sudo rsync -a --delete "${PLUGIN_SOURCE}" "${PLUGIN_TARGET}"

if [[ -n "${TARGET_OWNER_GROUP}" ]]; then
  sudo chown -R "${TARGET_OWNER_GROUP}" "${PLUGIN_TARGET}"
fi

cd "${MOODLE_ROOT}"
sudo -u www-data "${PHP_BIN}" admin/cli/upgrade.php --non-interactive
sudo -u www-data "${PHP_BIN}" admin/cli/purge_caches.php
