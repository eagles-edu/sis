#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_SRC="${REPO_ROOT}/deploy/nginx/languagetool-standalone.conf"
UNIT_SRC="${REPO_ROOT}/ops/systemd/sis-languagetool-proxy.service"
UNIT_DST="/etc/systemd/system/sis-languagetool-proxy.service"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ -e "${UNIT_DST}" ]]; then
  sudo -n cp "${UNIT_DST}" "${UNIT_DST}.BAK-${STAMP}"
fi

sudo -n /usr/sbin/nginx -t -q -c "${CONFIG_SRC}"
sudo -n install -m 0644 "${UNIT_SRC}" "${UNIT_DST}"
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now sis-languagetool-proxy.service

printf '%s\n' "LanguageTool proxy installed and started."
printf '%s\n' "Proxy: http://127.0.0.1:8093/v2/check"
