#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROUTE_SOURCE="${ROOT}/config/nginx/test-moodle-provisioning.location.conf"
VHOST="/etc/nginx/sites-available/test.eagles.edu.vn.conf"
ENABLED="/etc/nginx/sites-enabled/test.eagles.edu.vn.conf"
BACKUP_ROOT="/home/eagles/dockerz/backups/manual-edits/test-moodle-provisioning-proxy"
MODE="${1:-}"

fail() {
  printf '[test-moodle-proxy] ERROR: %s\n' "$*" >&2
  exit 1
}

verify_test_api_route() {
  local response_file nonce status response_kind
  response_file="$(mktemp /tmp/test-moodle-proxy-probe.XXXXXX)"
  nonce="$(openssl rand -hex 18)"
  status="$(curl --noproxy '*' --ipv4 --silent --show-error --max-time 12 \
    --resolve test.eagles.edu.vn:443:127.0.0.1 \
    --output "${response_file}" --write-out '%{http_code}' \
    --request POST 'https://test.eagles.edu.vn/api/moodle/provisioning/poll' \
    --header 'Content-Type: application/json' \
    --header 'User-Agent: Mozilla/5.0 Moodle provisioning route probe' \
    --header 'X-SIS-Source: moodle' \
    --header "X-SIS-Timestamp: $(date +%s)" \
    --header "X-SIS-Nonce: ${nonce}" \
    --header "X-SIS-Signature: $(printf '%064d' 0)" \
    --data '{"limit":1}' || true)"
  if [[ ("${status}" != "401" && "${status}" != "503") ]] || \
     ! grep -Eq '"errorCode":"request_rejected"|"error":"Moodle provisioning is not configured"' "${response_file}"; then
    if grep -qi '<!doctype html>' "${response_file}"; then
      response_kind="html_fallback"
    elif grep -q '"errorCode"' "${response_file}"; then
      response_kind="json_error"
    else
      response_kind="unexpected_response"
    fi
    printf '[test-moodle-proxy] probe diagnostic: http=%s response=%s\n' "${status:-empty}" "${response_kind}" >&2
    rm -f -- "${response_file}"
    return 1
  fi
  rm -f -- "${response_file}"
  printf '%s' "${status}"
}

[[ "${EUID}" -eq 0 ]] || fail "run through sudo"
[[ "${MODE}" == "--dry-run" || "${MODE}" == "--apply" ]] || fail "use --dry-run or --apply"
[[ -r "${ROUTE_SOURCE}" ]] || fail "tracked test route source is unavailable"
[[ -f "${VHOST}" && -e "${ENABLED}" ]] || fail "test-mirror Nginx vhost is unavailable"
[[ "$(readlink -f "${ENABLED}")" == "${VHOST}" ]] || fail "enabled test-mirror vhost does not resolve to the expected file"
grep -Fq 'server 127.0.0.1:8786;' "${VHOST}" || fail "test-mirror API upstream is not bound to 127.0.0.1:8786"
grep -Fq 'server_name test.eagles.edu.vn' "${VHOST}" || fail "vhost is not the test mirror"
grep -Fq 'location ^~ /api/moodle/provisioning/' "${ROUTE_SOURCE}" || fail "route source does not declare the SIS provisioning prefix"
grep -Fq 'proxy_pass http://sis_test_api_upstream;' "${ROUTE_SOURCE}" || fail "route source does not target the test SIS API"
grep -Fq 'include /etc/nginx/snippets/sis-api-proxy-common.conf;' "${ROUTE_SOURCE}" || fail "route source omits the common API proxy headers"

MODE_BITS="$(stat -c '%a' "${VHOST}")"
OWNER="$(stat -c '%U:%G' "${VHOST}")"
ROUTE_COUNT="$(grep -Fc 'location ^~ /api/moodle/provisioning/' "${VHOST}" || true)"
if [[ "${ROUTE_COUNT}" -gt 1 ]]; then
  fail "the active test vhost has duplicate Moodle provisioning locations"
fi

if [[ "${ROUTE_COUNT}" -eq 1 ]]; then
  python3 - "${VHOST}" "${ROUTE_SOURCE}" <<'PY'
from pathlib import Path
import sys

vhost = Path(sys.argv[1]).read_text()
route = Path(sys.argv[2]).read_text().rstrip()
if vhost.count(route) != 1:
    raise SystemExit("active test route differs from the tracked route source")
PY
  PROBE_STATUS="$(verify_test_api_route)" || fail "installed route did not reach the test SIS API"
  printf '[test-moodle-proxy] tracked route is already installed in the test mirror\n'
  printf '[test-moodle-proxy] test API response=HTTP %s\n' "${PROBE_STATUS}"
  exit 0
fi

MARKER='    # Exercise Mailer API (exact endpoint)'
MARKER_COUNT="$(grep -Fc "${MARKER}" "${VHOST}" || true)"
[[ "${MARKER_COUNT}" -eq 1 ]] || fail "expected exactly one safe insertion point in the test vhost"

if [[ "${MODE}" == "--dry-run" ]]; then
  printf '[test-moodle-proxy] would add the HMAC-protected route to the test-only Nginx vhost\n'
  exit 0
fi

BACKUP_DIR="${BACKUP_ROOT}/test-route-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "${BACKUP_DIR}"
cp -a "${VHOST}" "${BACKUP_DIR}/test.eagles.edu.vn.conf.BAK-before"
chmod 0600 "${BACKUP_DIR}/test.eagles.edu.vn.conf.BAK-before"
sha256sum "${VHOST}" "${ROUTE_SOURCE}" > "${BACKUP_DIR}/SHA256SUMS"
printf 'owner=%s\nmode=%s\nsource=%s\n' "${OWNER}" "${MODE_BITS}" "${ROUTE_SOURCE}" > "${BACKUP_DIR}/manifest.txt"
chmod 0600 "${BACKUP_DIR}/SHA256SUMS" "${BACKUP_DIR}/manifest.txt"

TEMP_VHOST="$(mktemp "${VHOST}.tmp.XXXXXX")"
cleanup_temp() {
  rm -f -- "${TEMP_VHOST}"
}
trap cleanup_temp EXIT
python3 - "${VHOST}" "${ROUTE_SOURCE}" "${TEMP_VHOST}" <<'PY'
from pathlib import Path
import sys

vhost_path, route_path, temp_path = map(Path, sys.argv[1:])
vhost = vhost_path.read_text()
route = route_path.read_text().rstrip()
marker = "    # Exercise Mailer API (exact endpoint)"
if vhost.count(marker) != 1 or "location ^~ /api/moodle/provisioning/" in vhost:
    raise SystemExit("test vhost changed after preflight")
temp_path.write_text(vhost.replace(marker, route + "\n\n" + marker, 1))
PY
chown "${OWNER}" "${TEMP_VHOST}"
chmod "${MODE_BITS}" "${TEMP_VHOST}"
mv -- "${TEMP_VHOST}" "${VHOST}"

restore_vhost() {
  install -o "${OWNER%:*}" -g "${OWNER#*:}" -m "${MODE_BITS}" \
    "${BACKUP_DIR}/test.eagles.edu.vn.conf.BAK-before" "${VHOST}"
  nginx -t
  systemctl reload nginx
}

if ! nginx -t; then
  restore_vhost || fail "Nginx validation failed and automatic restore also failed"
  fail "Nginx validation rejected the test-only route; original vhost restored"
fi
if ! systemctl reload nginx; then
  restore_vhost || fail "Nginx reload failed and automatic restore also failed"
  fail "Nginx reload rejected the test-only route; original vhost restored"
fi

PROBE_STATUS="$(verify_test_api_route)" || {
  restore_vhost || fail "route probe failed and automatic restore also failed"
  fail "signed-route probe did not reach the test SIS API; original vhost restored"
}

printf '[test-moodle-proxy] test-only route installed and reached the SIS API (HTTP %s); backup=%s\n' \
  "${PROBE_STATUS}" "${BACKUP_DIR}"
