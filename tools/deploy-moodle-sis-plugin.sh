#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${SOURCE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MOODLE_ROOT="${MOODLE_ROOT:-/home/moodle.eagles.edu.vn/app}"
PLUGIN_SOURCE="${SOURCE_ROOT}/integrations/moodle/enrol/sis"
PLUGIN_TARGET="${MOODLE_ROOT}/enrol/sis"
PHP_BIN="${PHP_BIN:-/usr/local/lsws/lsphp82/bin/php8.2}"
BACKUP_FILE="${MOODLE_DB_BACKUP_FILE:-}"

fail() {
  printf '[error] %s\n' "$1" >&2
  exit 1
}

[[ -f "${MOODLE_ROOT}/config.php" ]] || fail "Moodle root is invalid: ${MOODLE_ROOT}"
[[ -f "${PLUGIN_SOURCE}/version.php" ]] || fail "SIS Moodle plugin source is missing"
grep -Fq "\$plugin->component = 'enrol_sis';" "${PLUGIN_SOURCE}/version.php" || fail "Plugin source component is not enrol_sis"
[[ "${BACKUP_FILE}" == /home/eagles/dockerz/backups/moodle/* ]] || fail "Set MOODLE_DB_BACKUP_FILE to a verified Moodle backup under /home/eagles/dockerz/backups/moodle"
sudo test -s "${BACKUP_FILE}" || fail "Moodle database backup is missing or empty"
sudo gzip -t "${BACKUP_FILE}" || fail "Moodle database backup archive verification failed"
command -v rsync >/dev/null 2>&1 || fail "rsync is required"
[[ -x "${PHP_BIN}" ]] || fail "Moodle PHP CLI is unavailable: ${PHP_BIN}"

if [[ -e "${PLUGIN_TARGET}" ]]; then
  [[ -f "${PLUGIN_TARGET}/version.php" ]] || fail "Refusing to replace an unrecognized enrol/sis target"
  grep -Fq "\$plugin->component = 'enrol_sis';" "${PLUGIN_TARGET}/version.php" || fail "Refusing to replace a different Moodle component"
fi

target_owner_group="$(stat -c '%U:%G' "$(dirname "${PLUGIN_TARGET}")")"
sudo mkdir -p "${PLUGIN_TARGET}"
sudo rsync -a --delete "${PLUGIN_SOURCE}/" "${PLUGIN_TARGET}/"
sudo chown -R "${target_owner_group}" "${PLUGIN_TARGET}"

cd "${MOODLE_ROOT}"
sudo -u www-data "${PHP_BIN}" admin/cli/upgrade.php --non-interactive
sudo -u www-data "${PHP_BIN}" admin/cli/purge_caches.php
printf '[ok] installed and upgraded enrol_sis from %s\n' "${PLUGIN_SOURCE}"
