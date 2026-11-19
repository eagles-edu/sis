#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${ROOT}/ops/systemd/keepalive-test-restart-guard.conf"
WEB_SOURCE="${ROOT}/ops/systemd/keepalive-test-static-server.conf"
BACKUP_DIR="${SIS_RESTART_GUARD_BACKUP_DIR:-/home/eagles/dockerz/backups/manual-edits/$(date +%Y%m%dT%H%M%S)-test-restart-guard}"
LEGACY_BOOT_PREP_DROPIN="/etc/systemd/system/exercise-mailer-test.service.d/10-boot-prep.conf"
LEGACY_BOOT_PREP_BACKUP="${BACKUP_DIR}/exercise-mailer-test.service.10-boot-prep.conf.before"
UNITS=(
  exercise-mailer-test.service
  sis-web-test.service
  sis-async-side-effects-test.service
)

fail() {
  printf '[restart-guard] ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ "${EUID}" -ne 0 ]]; then
  fail "run this installer with sudo; it only changes the three allowlisted test-mirror units"
fi
[[ -f "${SOURCE}" ]] || fail "restart guard source is missing"
[[ -f "${WEB_SOURCE}" ]] || fail "test static-server command source is missing"

install -d -m 0700 "${BACKUP_DIR}"

validate_test_unit() {
  local unit="$1"
  properties="$(systemctl show "${unit}" \
    --property=Id \
    --property=FragmentPath \
    --property=WorkingDirectory \
    --property=ExecStart \
    --property=EnvironmentFiles)" || fail "systemd unit is not installed: ${unit}"
  grep -Fq "Id=${unit}" <<<"${properties}" || fail "unit identity mismatch: ${unit}"
  grep -Fq "/home/test.eagles.edu.vn/" <<<"${properties}" || fail "unit is not bound to the test-mirror tree: ${unit}"
  if grep -Fq "/home/admin.eagles.edu.vn/" <<<"${properties}"; then
    fail "refusing to modify a live/admin-mirror unit: ${unit}"
  fi

  if [[ "${unit}" != "sis-web-test.service" ]] && ! grep -Fq "/home/test.eagles.edu.vn/sis/.env.test" <<<"${properties}"; then
    fail "unit is missing its test-owned environment file: ${unit}"
  fi
}

for unit in "${UNITS[@]}"; do
  validate_test_unit "${unit}"
done

if [[ -e "${LEGACY_BOOT_PREP_DROPIN}" ]]; then
  [[ -f "${LEGACY_BOOT_PREP_DROPIN}" && ! -L "${LEGACY_BOOT_PREP_DROPIN}" ]] || fail "legacy boot-prep drop-in is not a regular file"
  grep -Fq 'tools/sync-and-restart-test-runtime.sh boot-prep' "${LEGACY_BOOT_PREP_DROPIN}" || fail "legacy boot-prep drop-in contents are unexpected"
  if grep -Fq "/home/admin.eagles.edu.vn/" "${LEGACY_BOOT_PREP_DROPIN}"; then
    fail "refusing to remove a drop-in that references the live/admin mirror"
  fi
  [[ ! -e "${LEGACY_BOOT_PREP_BACKUP}" ]] || fail "legacy drop-in backup already exists: ${LEGACY_BOOT_PREP_BACKUP}"
  install -D -m 0600 "${LEGACY_BOOT_PREP_DROPIN}" "${LEGACY_BOOT_PREP_BACKUP}"
  rm -- "${LEGACY_BOOT_PREP_DROPIN}"
fi

for unit in "${UNITS[@]}"; do
  dropin_dir="/etc/systemd/system/${unit}.d"
  destination="${dropin_dir}/20-keepalive-restart-guard.conf"
  install -d -m 0755 "${dropin_dir}"
  if [[ -f "${destination}" ]]; then
    install -D -m 0600 "${destination}" "${BACKUP_DIR}/${unit}.20-keepalive-restart-guard.conf.before"
  fi
  install -o root -g root -m 0644 "${SOURCE}" "${destination}"
done

web_dropin_dir="/etc/systemd/system/sis-web-test.service.d"
web_destination="${web_dropin_dir}/30-keepalive-static-server.conf"
web_backup="${BACKUP_DIR}/sis-web-test.service.30-keepalive-static-server.conf.before"
install -d -m 0755 "${web_dropin_dir}"
if [[ -e "${web_destination}" ]]; then
  [[ -f "${web_destination}" && ! -L "${web_destination}" ]] || fail "test static-server override is not a regular file"
  [[ ! -e "${web_backup}" ]] || fail "test static-server backup already exists: ${web_backup}"
  install -D -m 0600 "${web_destination}" "${web_backup}"
fi
install -o root -g root -m 0644 "${WEB_SOURCE}" "${web_destination}"

systemctl daemon-reload

for unit in "${UNITS[@]}"; do
  startup_commands="$(systemctl show "${unit}" --property=ExecStartPre --property=ExecStart)"
  if grep -Eiq 'boot-prep|sync-and-restart-test-runtime\.sh|(^|[[:space:]]|/)(npx|npm)([[:space:]]|;|$)|prisma|db:migrate' <<<"${startup_commands}"; then
    fail "automatic start path contains deployment or database work for ${unit}"
  fi

  effective="$(systemctl show "${unit}" \
    --property=Restart \
    --property=RestartUSec \
    --property=StartLimitBurst \
    --property=StartLimitIntervalUSec)"
  grep -Fq 'Restart=on-failure' <<<"${effective}" || fail "Restart policy did not load for ${unit}"
  grep -Fq 'RestartUSec=30s' <<<"${effective}" || fail "restart cooldown did not load for ${unit}"
  grep -Fq 'StartLimitBurst=4' <<<"${effective}" || fail "restart limit did not load for ${unit}"
  grep -Fq 'StartLimitIntervalUSec=15min' <<<"${effective}" || fail "restart window did not load for ${unit}"
  printf '[restart-guard] %s\n' "${unit} ${effective//$'\n'/ }"
done

printf '[restart-guard] installed test-only policies; automatic starts contain no sync, package-manager, or migration step; backup=%s; active processes were not restarted\n' "${BACKUP_DIR}"
