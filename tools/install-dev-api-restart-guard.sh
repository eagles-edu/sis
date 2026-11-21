#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${ROOT}/ops/systemd/user/sis-dev-api.service"
UNIT_NAME="sis-dev-api.service"
USER_UNIT_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
DESTINATION="${USER_UNIT_DIR}/${UNIT_NAME}"
BACKUP_DIR="${SIS_DEV_RESTART_GUARD_BACKUP_DIR:-/home/eagles/dockerz/backups/manual-edits/$(date +%Y%m%dT%H%M%S)-dev-api-restart-guard}"
NODE_BINARY="$(command -v node)"

fail() {
  printf '[dev-restart-guard] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "${EUID}" -ne 0 ]] || fail "run this installer as the eagles user, not root"
[[ "${HOME}" == "/home/eagles" ]] || fail "unexpected user home; expected /home/eagles"
[[ -f "${SOURCE}" ]] || fail "dev API unit source is missing"
[[ -x "${NODE_BINARY}" ]] || fail "Node.js executable is unavailable"
[[ "${NODE_BINARY}" == "/home/eagles/.nvm/versions/node/v22.22.1/bin/node" ]] || fail "Node.js version/path does not match the SIS runtime"
[[ -f "${ROOT}/.env.dev" ]] || fail "dev-owned .env.dev is missing"
grep -Fq "WorkingDirectory=${ROOT}" "${SOURCE}" || fail "unit is not bound to the dev workspace"
grep -Fq 'Environment=NODE_ENV=development' "${SOURCE}" || fail "unit does not set the dev Node environment"
grep -Fq 'Environment=SIS_ENV_FILE=.env.dev' "${SOURCE}" || fail "unit does not select the dev-owned environment file"
grep -Fq 'Environment=DOTENV_CONFIG_PATH=.env.dev' "${SOURCE}" || fail "unit does not select the dev-owned dotenv file"
grep -Fq "ExecStart=${NODE_BINARY} server/exercise-mailer.mjs" "${SOURCE}" || fail "unit executable does not match the pinned Node runtime"
if grep -Eq '/home/admin\.eagles\.edu\.vn|EnvironmentFile=.*\.env($|[[:space:]])|npm|npx|prisma|db:migrate|sync-and-restart|restart-dev-runtime' "${SOURCE}"; then
  fail "automatic dev API start contains a live/admin path or deployment/database command"
fi

install -d -m 0755 "${USER_UNIT_DIR}"
if [[ -e "${DESTINATION}" ]]; then
  [[ -f "${DESTINATION}" && ! -L "${DESTINATION}" ]] || fail "existing user unit is not a regular file"
  if ! cmp -s "${SOURCE}" "${DESTINATION}"; then
    install -d -m 0700 "${BACKUP_DIR}"
    install -m 0600 "${DESTINATION}" "${BACKUP_DIR}/${UNIT_NAME}.before"
  fi
fi
install -m 0644 "${SOURCE}" "${DESTINATION}"
systemctl --user daemon-reload
systemctl --user enable "${UNIT_NAME}"

properties="$(systemctl --user show "${UNIT_NAME}" \
  --property=Id \
  --property=FragmentPath \
  --property=WorkingDirectory \
  --property=ExecStart \
  --property=Restart \
  --property=RestartUSec \
  --property=StartLimitBurst \
  --property=StartLimitIntervalUSec)"
grep -Fq "Id=${UNIT_NAME}" <<<"${properties}" || fail "user unit identity mismatch"
grep -Fq "WorkingDirectory=${ROOT}" <<<"${properties}" || fail "loaded unit is not bound to the dev workspace"
grep -Fq 'Restart=on-failure' <<<"${properties}" || fail "bounded process restart policy did not load"
grep -Fq 'RestartUSec=30s' <<<"${properties}" || fail "restart cooldown did not load"
grep -Fq 'StartLimitBurst=4' <<<"${properties}" || fail "restart start limit did not load"
grep -Fq 'StartLimitIntervalUSec=15min' <<<"${properties}" || fail "restart window did not load"
if grep -Eq '/home/admin\.eagles\.edu\.vn|npm|npx|prisma|db:migrate|sync-and-restart|restart-dev-runtime' <<<"${properties}"; then
  fail "loaded automatic start path contains a live/admin path or deployment/database command"
fi

printf '[dev-restart-guard] installed and enabled %s with four starts per 15 minutes and a 30-second restart delay; active API was not restarted; backup=%s\n' \
  "${UNIT_NAME}" "${BACKUP_DIR}"
