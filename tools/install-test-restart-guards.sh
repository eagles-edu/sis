#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${ROOT}/ops/systemd/keepalive-test-restart-guard.conf"
BACKUP_DIR="${SIS_RESTART_GUARD_BACKUP_DIR:-/home/eagles/dockerz/backups/manual-edits/$(date +%Y%m%dT%H%M%S)-ka122-restart-guard}"
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

for unit in "${UNITS[@]}"; do
  dropin_dir="/etc/systemd/system/${unit}.d"
  destination="${dropin_dir}/20-keepalive-restart-guard.conf"
  install -d -m 0755 "${dropin_dir}"
  if [[ -f "${destination}" ]]; then
    install -D -m 0600 "${destination}" "${BACKUP_DIR}/${unit}.20-keepalive-restart-guard.conf.before"
  fi
  install -o root -g root -m 0644 "${SOURCE}" "${destination}"
done

systemctl daemon-reload

for unit in "${UNITS[@]}"; do
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

printf '[restart-guard] installed test-only policies; backup=%s; active processes were not restarted\n' "${BACKUP_DIR}"
