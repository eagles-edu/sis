#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  printf 'Run this installer with sudo.\n' >&2
  exit 2
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/ops/monitoring/systemd"
TARGET_DIR="/etc/systemd/system"
BACKUP_DIR="/home/eagles/dockerz/backups/manual-edits/$(date +%Y%m%d)-ka181-nightly-no-send-systemd"
SERVICE_NAME="sis-keepalive-nightly-smoke-test.service"
TIMER_NAME="sis-keepalive-nightly-smoke-test.timer"
EAGLES_UID="$(id -u eagles)"
EAGLES_RUNTIME_DIR="/run/user/$EAGLES_UID"

grep -Fxq 'Environment=SIS_ENV_FILE=.env.test' "$SOURCE_DIR/$SERVICE_NAME"
grep -Fxq 'Environment=DOTENV_CONFIG_PATH=.env.test' "$SOURCE_DIR/$SERVICE_NAME"
grep -Fxq 'Environment=NODE_ENV=test' "$SOURCE_DIR/$SERVICE_NAME"
grep -Fxq 'Environment=SIS_KEEPALIVE_NO_EXTERNAL_MESSAGES=1' "$SOURCE_DIR/$SERVICE_NAME"
grep -Fxq 'Environment=PATH=/home/eagles/.nvm/versions/node/v22.22.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' "$SOURCE_DIR/$SERVICE_NAME"
grep -Fxq 'Unit=sis-keepalive-nightly-smoke-test.service' "$SOURCE_DIR/$TIMER_NAME"

if [[ -S "$EAGLES_RUNTIME_DIR/bus" ]] && runuser -u eagles -- env \
  XDG_RUNTIME_DIR="$EAGLES_RUNTIME_DIR" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=$EAGLES_RUNTIME_DIR/bus" \
  systemctl --user is-enabled --quiet "$TIMER_NAME"; then
  runuser -u eagles -- env \
    XDG_RUNTIME_DIR="$EAGLES_RUNTIME_DIR" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=$EAGLES_RUNTIME_DIR/bus" \
    systemctl --user disable --now "$TIMER_NAME"
fi

mkdir -p "$BACKUP_DIR/installed-units"
for unit_name in "$SERVICE_NAME" "$TIMER_NAME"; do
  if [[ -f "$TARGET_DIR/$unit_name" ]] && ! cmp -s "$SOURCE_DIR/$unit_name" "$TARGET_DIR/$unit_name"; then
    cp -a "$TARGET_DIR/$unit_name" "$BACKUP_DIR/installed-units/$unit_name"
  fi
  install -D -o root -g root -m 0644 "$SOURCE_DIR/$unit_name" "$TARGET_DIR/$unit_name"
done

systemd-analyze verify "$TARGET_DIR/$SERVICE_NAME" "$TARGET_DIR/$TIMER_NAME"
systemctl daemon-reload
systemctl enable --now "$TIMER_NAME"
systemctl is-enabled --quiet "$TIMER_NAME"
systemctl is-active --quiet "$TIMER_NAME"
printf '%s is installed and active. Unit backup directory: %s\n' "$TIMER_NAME" "$BACKUP_DIR"
