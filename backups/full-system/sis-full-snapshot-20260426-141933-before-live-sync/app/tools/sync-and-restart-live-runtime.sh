#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-full}"

case "$MODE" in
  full|public|restart-only) ;;
  *)
    echo "Usage: $(basename "$0") [full|public|restart-only]" >&2
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/sync-and-restart-runtimes.sh" "$MODE"
