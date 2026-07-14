#!/usr/bin/env bash
set -o pipefail

RUNTIME_ROOT="${1:?runtime root is required}"
ENV_FILE="${2:?env file is required}"
NODE_BIN="${3:?node binary is required}"
CRON_LOG="${4:?log path is required}"
MAX_LOG_BYTES=10485760

mkdir -p "$(dirname "${CRON_LOG}")"
if [[ -f "${CRON_LOG}" ]] && (( $(stat -c '%s' "${CRON_LOG}") >= MAX_LOG_BYTES )); then
  rm -f "${CRON_LOG}".[0-9]*
  mv "${CRON_LOG}" "${CRON_LOG}.1"
fi

cd "${RUNTIME_ROOT}"
{
  DOTENV_CONFIG_PATH="${ENV_FILE}" "${NODE_BIN}" -r dotenv/config tools/sis-config-repair.mjs 2>&1
  status=${PIPESTATUS[0]}
  exit "${status}"
} | while IFS= read -r line || [[ -n "${line}" ]]; do
  printf '[%s] %s\n' "$(date --iso-8601=seconds)" "${line}"
done >> "${CRON_LOG}"

exit "${PIPESTATUS[0]}"
