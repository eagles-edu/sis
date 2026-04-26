#!/usr/bin/env bash

set -euo pipefail

PUBLIC_BLOCK_PORTS=(8088 6379 5540)
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

echo "[fw] snapshotting current rules to /tmp"
sudo -n iptables-save >"/tmp/iptables-before-${TIMESTAMP}.rules"
sudo -n ip6tables-save >"/tmp/ip6tables-before-${TIMESTAMP}.rules"

echo "[fw] enforcing loopback-only access on INPUT for: ${PUBLIC_BLOCK_PORTS[*]}"
for port in "${PUBLIC_BLOCK_PORTS[@]}"; do
  sudo -n iptables -C INPUT -p tcp -s 127.0.0.1 --dport "${port}" -j ACCEPT 2>/dev/null ||
    sudo -n iptables -I INPUT 1 -p tcp -s 127.0.0.1 --dport "${port}" -j ACCEPT
  sudo -n iptables -C INPUT -p tcp ! -s 127.0.0.1 --dport "${port}" -j DROP 2>/dev/null ||
    sudo -n iptables -I INPUT 2 -p tcp ! -s 127.0.0.1 --dport "${port}" -j DROP

  sudo -n ip6tables -C INPUT -p tcp -s ::1 --dport "${port}" -j ACCEPT 2>/dev/null ||
    sudo -n ip6tables -I INPUT 1 -p tcp -s ::1 --dport "${port}" -j ACCEPT
  sudo -n ip6tables -C INPUT -p tcp ! -s ::1 --dport "${port}" -j DROP 2>/dev/null ||
    sudo -n ip6tables -I INPUT 2 -p tcp ! -s ::1 --dport "${port}" -j DROP
done

echo "[fw] enforcing docker forwarded drop on public iface for redis/redisinsight ports"
for port in 6379 5540; do
  sudo -n iptables -C DOCKER-USER -i eth0 -p tcp --dport "${port}" -j DROP 2>/dev/null ||
    sudo -n iptables -I DOCKER-USER 1 -i eth0 -p tcp --dport "${port}" -j DROP
  sudo -n ip6tables -C DOCKER-USER -i eth0 -p tcp --dport "${port}" -j DROP 2>/dev/null ||
    sudo -n ip6tables -I DOCKER-USER 1 -i eth0 -p tcp --dport "${port}" -j DROP
done

echo "[fw] persisting with netfilter-persistent"
sudo -n netfilter-persistent save >/tmp/netfilter-persistent-save.out 2>/tmp/netfilter-persistent-save.err || true

echo "[fw] active INPUT/DOCKER-USER entries (filtered)"
sudo -n iptables -S | grep -E 'DOCKER-USER|dport (8088|6379|5540)' || true
sudo -n ip6tables -S | grep -E 'DOCKER-USER|dport (8088|6379|5540)' || true

echo "[ok] firewall hardening applied"
echo "[note] verify from an off-host client because same-host public-IP probes can bypass external path assumptions."
