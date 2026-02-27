#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SITE_CONF_SRC="${REPO_ROOT}/deploy/nginx/admin.eagles.edu.vn.conf"
SITE_CONF_DST="/etc/nginx/sites-available/admin.eagles.edu.vn.conf"
SNIPPET_CORS_SRC="${REPO_ROOT}/deploy/nginx/snippets/sis-api-cors.conf"
SNIPPET_PROXY_SRC="${REPO_ROOT}/deploy/nginx/snippets/sis-api-proxy-common.conf"
SNIPPET_CORS_DST="/etc/nginx/snippets/sis-api-cors.conf"
SNIPPET_PROXY_DST="/etc/nginx/snippets/sis-api-proxy-common.conf"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

echo "[nginx] backing up current site config"
sudo -n cp "${SITE_CONF_DST}" "${SITE_CONF_DST}.BAK-${TIMESTAMP}"

echo "[nginx] installing snippets"
sudo -n install -m 644 "${SNIPPET_CORS_SRC}" "${SNIPPET_CORS_DST}"
sudo -n install -m 644 "${SNIPPET_PROXY_SRC}" "${SNIPPET_PROXY_DST}"

echo "[nginx] installing site config"
sudo -n install -m 644 "${SITE_CONF_SRC}" "${SITE_CONF_DST}"

echo "[nginx] syntax test + reload"
sudo -n nginx -t
sudo -n systemctl reload nginx
systemctl is-active nginx >/dev/null

echo "[ok] nginx config deployed"
