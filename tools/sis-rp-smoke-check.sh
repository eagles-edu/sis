#!/usr/bin/env bash

set -euo pipefail

DOMAIN="${1:-admin.eagles.edu.vn}"
MAILER_PORT="${MAILER_PORT:-8787}"
USER_AGENT="${USER_AGENT:-Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36}"

echo "[check] local upstream"
for url in \
  "http://127.0.0.1:${MAILER_PORT}/healthz" \
  "http://127.0.0.1:${MAILER_PORT}/api/admin/auth/me" \
  "http://127.0.0.1:${MAILER_PORT}/api/admin/auth/login"
do
  code="$(curl -sS -o /tmp/sis-rp-local.out -w '%{http_code}' "${url}")"
  echo "  ${code} ${url}"
done

echo "[check] external reverse-proxy"
for url in \
  "https://${DOMAIN}/sis-admin/student-admin.html" \
  "https://${DOMAIN}/api/sis-admin/auth/me" \
  "https://${DOMAIN}/api/admin/auth/me"
do
  code="$(curl -A "${USER_AGENT}" -ksS -o /tmp/sis-rp-ext.out -w '%{http_code}' "${url}")"
  echo "  ${code} ${url}"
done

echo "[check] selected public ports"
for port in 80 443 8088 6379 5540; do
  if nc -zvw2 "${DOMAIN}" "${port}" >/tmp/sis-rp-port.out 2>&1; then
    echo "  open ${DOMAIN}:${port}"
  else
    echo "  blocked ${DOMAIN}:${port}"
  fi
done
