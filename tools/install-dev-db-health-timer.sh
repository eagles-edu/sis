#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${ROOT}/ops/systemd/user"
USER_UNIT_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
SERVICE_NAME="sis-db-health-dev.service"
TIMER_NAME="sis-db-health-dev.timer"
NODE_BINARY="$(command -v node)"
BACKUP_DIR="${SIS_DEV_DB_HEALTH_BACKUP_DIR:-/home/eagles/dockerz/backups/manual-edits/$(date +%Y%m%dT%H%M%S)-dev-db-health-timer}"

fail() {
  printf '[dev-db-health-timer] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "${EUID}" -ne 0 ]] || fail "run this installer as the eagles user, not root"
[[ "${HOME}" == "/home/eagles" ]] || fail "unexpected user home; expected /home/eagles"
[[ "${ROOT}" == "/home/eagles/dockerz/sis" ]] || fail "unexpected SIS workspace; dev timer is fixed to /home/eagles/dockerz/sis"
[[ -f "${ROOT}/.env.dev" ]] || fail "dev-owned .env.dev is missing"
[[ -x "${NODE_BINARY}" && "${NODE_BINARY}" == "/home/eagles/.nvm/versions/node/v22.22.1/bin/node" ]] || fail "Node.js version/path does not match the SIS runtime"

for name in "${SERVICE_NAME}" "${TIMER_NAME}"; do
  source="${SOURCE_DIR}/${name}"
  [[ -f "${source}" && ! -L "${source}" ]] || fail "unit source ${name} is missing or not a regular file"
  if grep -Eq '/home/admin\.eagles\.edu\.vn|/home/test\.eagles\.edu\.vn|EnvironmentFile=.*\.env($|[[:space:]])|systemctl (restart|start) exercise-mailer|prisma|migration|sync-and-restart' "${source}"; then
    fail "${name} contains a mirror path or mutating deployment/database action"
  fi
done

SERVICE_SOURCE="${SOURCE_DIR}/${SERVICE_NAME}"
TIMER_SOURCE="${SOURCE_DIR}/${TIMER_NAME}"
grep -Fq "WorkingDirectory=${ROOT}" "${SERVICE_SOURCE}" || fail "service is not bound to the dev workspace"
grep -Fq 'Environment=NODE_ENV=development' "${SERVICE_SOURCE}" || fail "service does not select development mode"
grep -Fq 'Environment=SIS_ENV_FILE=.env.dev' "${SERVICE_SOURCE}" || fail "service does not select .env.dev"
grep -Fq 'Environment=DOTENV_CONFIG_PATH=.env.dev' "${SERVICE_SOURCE}" || fail "service does not select matching dotenv config"
grep -Fq 'node --import dotenv/config tools/db-health-check.mjs --expected-database sis_dev' "${SERVICE_SOURCE}" || fail "service does not load and verify the dev database"
grep -Fq '/home/eagles/dockerz/backups/postgres-dev/latest.json' "${SERVICE_SOURCE}" || fail "service does not use isolated dev backup metadata"
grep -Fq 'runtime-data/prometheus/db-health-dev.prom --metrics-environment dev' "${SERVICE_SOURCE}" || fail "service does not write dev-labeled metrics"
grep -Fq "Unit=${SERVICE_NAME}" "${TIMER_SOURCE}" || fail "timer does not invoke the dev health service"

install -d -m 0755 "${USER_UNIT_DIR}"
for name in "${SERVICE_NAME}" "${TIMER_NAME}"; do
  destination="${USER_UNIT_DIR}/${name}"
  source="${SOURCE_DIR}/${name}"
  if [[ -e "${destination}" ]]; then
    [[ -f "${destination}" && ! -L "${destination}" ]] || fail "installed ${name} is not a regular file"
    if ! cmp -s "${source}" "${destination}"; then
      install -d -m 0700 "${BACKUP_DIR}"
      install -m 0600 "${destination}" "${BACKUP_DIR}/${name}.before"
    fi
  fi
  install -m 0644 "${source}" "${destination}"
done

systemctl --user daemon-reload
systemctl --user enable --now "${TIMER_NAME}"

service_properties="$(systemctl --user show "${SERVICE_NAME}" --property=Id --property=FragmentPath --property=WorkingDirectory --property=ExecStart --property=Type --property=TimeoutStartUSec)"
timer_properties="$(systemctl --user show "${TIMER_NAME}" --property=Id --property=FragmentPath --property=Unit --property=ActiveState --property=TimersCalendar)"
grep -Fq "Id=${SERVICE_NAME}" <<<"${service_properties}" || fail "loaded service identity mismatch"
grep -Fq "WorkingDirectory=${ROOT}" <<<"${service_properties}" || fail "loaded service is not bound to the dev workspace"
grep -Fq 'Type=oneshot' <<<"${service_properties}" || fail "loaded service is not oneshot"
grep -Fq 'sis-db-health-dev.service' <<<"${service_properties}" || fail "loaded service does not run the expected health check"
grep -Fq "Id=${TIMER_NAME}" <<<"${timer_properties}" || fail "loaded timer identity mismatch"
grep -Fq 'Unit=sis-db-health-dev.service' <<<"${timer_properties}" || fail "timer does not invoke the dev health service"
grep -Fq 'ActiveState=active' <<<"${timer_properties}" || fail "dev health timer is not active"
if grep -Eq '/home/admin\.eagles\.edu\.vn|/home/test\.eagles\.edu\.vn|EnvironmentFile=.*\.env($|[[:space:]])|prisma|migration|sync-and-restart' <<<"${service_properties} ${timer_properties}"; then
  fail "loaded dev units contain a mirror path or mutating deployment/database action"
fi

printf '[dev-db-health-timer] installed and enabled a 15-minute dev-only snapshot timer; it does not run the health service during installation; backup=%s\n' "${BACKUP_DIR}"
