#!/usr/bin/env bash
set -euo pipefail

readonly output_dir="/home/eagles/dockerz/sis/runtime-data/prometheus"
readonly output_file="${output_dir}/security-overview.prom"
readonly crowdsec_metrics_url="http://127.0.0.1:6060/metrics"
readonly geoip_db="/var/lib/crowdsec/data/GeoLite2-City.mmdb"

test -d "$output_dir"
test -r "$geoip_db"

crowdsec_metrics="$(curl --fail --silent --show-error --max-time 5 "$crowdsec_metrics_url" 2>/dev/null)"
crowdsec_decisions="$(timeout 8s cscli decisions list -o json 2>/dev/null | python3 -c '
import ipaddress
import json
import sys

decisions = json.load(sys.stdin)
if not isinstance(decisions, list):
    raise SystemExit("unexpected CrowdSec decisions response")

for item in decisions:
    if not isinstance(item, dict) or str(item.get("type", "")).lower() != "ban":
        continue
    if item.get("simulated") is True:
        continue
    scope = str(item.get("scope", ""))
    address = str(item.get("value", ""))
    if scope == "Ip":
        ipaddress.ip_address(address)
    elif scope == "Range":
        ipaddress.ip_network(address, strict=False)
    else:
        continue
    print(f"{scope}\t{address}")
')"
crowdsec_decision_count=0
if [[ -n "$crowdsec_decisions" ]]; then
  crowdsec_decision_count="$(awk 'END { print NR + 0 }' <<<"$crowdsec_decisions")"
fi

jail_status="$(timeout 8s fail2ban-client status sshd 2>/dev/null)"

status_value() {
  local key="$1"
  local value
  value="$(awk -F: -v key="$key" 'index($1, key) > 0 { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; found = 1 } END { if (!found) exit 1 }' <<<"$jail_status")"
  [[ "$value" =~ ^[0-9]+$ ]]
  printf '%s' "$value"
}

readonly failed_current="$(status_value 'Currently failed')"
readonly failed_total="$(status_value 'Total failed')"
readonly banned_current="$(status_value 'Currently banned')"
readonly banned_total="$(status_value 'Total banned')"
readonly maxretry="$(timeout 8s fail2ban-client get sshd maxretry 2>/dev/null | awk 'NF { value = $NF } END { if (value !~ /^[0-9]+$/) exit 1; print value }')"
readonly findtime="$(timeout 8s fail2ban-client get sshd findtime 2>/dev/null | awk 'NF { value = $NF } END { if (value !~ /^[0-9]+$/) exit 1; print value }')"
readonly bantime="$(timeout 8s fail2ban-client get sshd bantime 2>/dev/null | awk 'NF { value = $NF } END { if (value !~ /^-?[0-9]+$/) exit 1; print value }')"

label_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

lookup_country() {
  local address="$1"
  local country
  country="$(mmdblookup --file "$geoip_db" --ip "$address" country names en 2>/dev/null | awk -F'"' '/<utf8_string>/ { print $2; exit }')"
  printf '%s' "${country:-Unknown}"
}

tmp_file="$(mktemp "${output_dir}/security-overview.XXXXXX")"
trap 'rm -f "$tmp_file"' EXIT
umask 022

{
  cat <<'METRICS'
# HELP eagles_security_metrics_generated_timestamp_seconds Unix timestamp when the host security metrics were collected.
# TYPE eagles_security_metrics_generated_timestamp_seconds gauge
# HELP eagles_crowdsec_active_decisions Current CrowdSec IP and range ban decisions.
# TYPE eagles_crowdsec_active_decisions gauge
# HELP eagles_fail2ban_failed_current Current SSH failures inside the configured Fail2ban window.
# TYPE eagles_fail2ban_failed_current gauge
# HELP eagles_fail2ban_failed_total SSH failures counted since Fail2ban started.
# TYPE eagles_fail2ban_failed_total counter
# HELP eagles_fail2ban_banned_current Currently banned SSH addresses.
# TYPE eagles_fail2ban_banned_current gauge
# HELP eagles_fail2ban_banned_total SSH bans counted since Fail2ban started.
# TYPE eagles_fail2ban_banned_total counter
# HELP eagles_fail2ban_maxretry SSH failures allowed before Fail2ban bans an address.
# TYPE eagles_fail2ban_maxretry gauge
# HELP eagles_fail2ban_findtime_seconds Fail2ban SSH failure window in seconds.
# TYPE eagles_fail2ban_findtime_seconds gauge
# HELP eagles_fail2ban_bantime_seconds Fail2ban SSH ban duration in seconds; -1 means permanent.
# TYPE eagles_fail2ban_bantime_seconds gauge
# HELP eagles_security_ban_info One currently active ban with local GeoLite2 country enrichment.
# TYPE eagles_security_ban_info gauge
METRICS
  printf 'eagles_security_metrics_generated_timestamp_seconds %s\n' "$(date +%s)"
  printf 'eagles_crowdsec_active_decisions %s\n' "$crowdsec_decision_count"
  printf 'eagles_fail2ban_failed_current{jail="sshd"} %s\n' "$failed_current"
  printf 'eagles_fail2ban_failed_total{jail="sshd"} %s\n' "$failed_total"
  printf 'eagles_fail2ban_banned_current{jail="sshd"} %s\n' "$banned_current"
  printf 'eagles_fail2ban_banned_total{jail="sshd"} %s\n' "$banned_total"
  printf 'eagles_fail2ban_maxretry{jail="sshd"} %s\n' "$maxretry"
  printf 'eagles_fail2ban_findtime_seconds{jail="sshd"} %s\n' "$findtime"
  printf 'eagles_fail2ban_bantime_seconds{jail="sshd"} %s\n' "$bantime"

  while IFS=$'\t' read -r scope address; do
    [[ -n "$scope" && -n "$address" ]] || continue
    country="Unknown"
    if [[ "$scope" == "Ip" ]]; then
      country="$(lookup_country "$address")"
    fi
    printf 'eagles_security_ban_info{source="crowdsec",scope="%s",address="%s",country="%s"} 1\n' \
      "$(label_escape "$scope")" "$(label_escape "$address")" "$(label_escape "$country")"
  done <<<"$crowdsec_decisions"

  banned_ips="$(awk -F'Banned IP list: ' 'index($0, "Banned IP list:") { print substr($0, index($0, "Banned IP list:") + length("Banned IP list:")); exit }' <<<"$jail_status")"
  for address in $banned_ips; do
    [[ "$address" == "-" ]] && continue
    country="$(lookup_country "$address")"
    printf 'eagles_security_ban_info{source="fail2ban",scope="Ip",address="%s",country="%s",jail="sshd"} 1\n' \
      "$(label_escape "$address")" "$(label_escape "$country")"
  done

  printf '%s\n' "$crowdsec_metrics" | awk '
    function wanted(name) {
      return name == "cs_bucket_instantiation_total" ||
        name == "cs_bucket_poured_total" ||
        name == "cs_bucket_underflowed_total" ||
        name == "cs_buckets" ||
        name == "cs_parser_hits_ko_total" ||
        name == "cs_parser_hits_ok_total" ||
        name == "cs_parser_hits_total" ||
        name == "cs_node_hits_ko_total" ||
        name == "cs_node_hits_ok_total" ||
        name == "cs_node_hits_total"
    }
    /^# (HELP|TYPE) / {
      if (wanted($3)) print
      next
    }
    !/^#/ {
      name = $1
      sub(/\{.*/, "", name)
      if (wanted(name)) print
    }
  '
} >"$tmp_file"

chmod 0644 "$tmp_file"
mv -f "$tmp_file" "$output_file"
