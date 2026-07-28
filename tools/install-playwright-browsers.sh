#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s [install|update]\n' "$0" >&2
  exit 2
}

mode="${1:-install}"
case "$mode" in
  install|update) ;;
  *) usage ;;
esac

if ! command -v npx >/dev/null 2>&1; then
  printf 'npx is required to install Playwright browsers.\n' >&2
  exit 1
fi

if [[ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]]; then
  user_home="$(getent passwd "$(id -u)" | cut -d: -f6)"
  if [[ -z "$user_home" ]]; then
    printf 'Unable to determine the current user home directory.\n' >&2
    exit 1
  fi
  export PLAYWRIGHT_BROWSERS_PATH="${XDG_CACHE_HOME:-$user_home/.cache}/ms-playwright"
fi

mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
printf 'Playwright browser cache: %s\n' "$PLAYWRIGHT_BROWSERS_PATH"

if [[ "$mode" == "update" ]]; then
  npx --no-install playwright install --force chromium
else
  npx --no-install playwright install chromium
fi

if ! npx --no-install playwright install --dry-run chromium >/dev/null 2>&1; then
  printf 'Playwright Chromium installation could not be verified.\n' >&2
  exit 1
fi

printf 'Playwright Chromium is installed and available for updates.\n'
