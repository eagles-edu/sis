#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NGINX_SRC="${REPO_ROOT}/deploy/nginx/languagetool.internal.conf"
NGINX_DST="/etc/nginx/sites-available/languagetool.internal.conf"
NGINX_LINK="/etc/nginx/sites-enabled/languagetool.internal.conf"
SYSTEMD_SRC="${REPO_ROOT}/ops/systemd/sis-languagetool.service"
SYSTEMD_DST="/etc/systemd/system/sis-languagetool.service"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ -e "${NGINX_DST}" ]]; then
  sudo -n cp "${NGINX_DST}" "${NGINX_DST}.BAK-${STAMP}"
fi
sudo -n install -m 0644 "${NGINX_SRC}" "${NGINX_DST}"
sudo -n ln -sfn "${NGINX_DST}" "${NGINX_LINK}"
sudo -n nginx -t
sudo -n systemctl reload nginx

sudo -n install -m 0644 "${SYSTEMD_SRC}" "${SYSTEMD_DST}"
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now sis-languagetool.service

printf '%s\n' "LanguageTool service installed and started."
printf '%s\n' "Proxy: http://127.0.0.1:8093/v2/check"
