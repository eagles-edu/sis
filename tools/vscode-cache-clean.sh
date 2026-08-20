#!/usr/bin/env bash

# Run it first without changes:
# bash vscode-cache-clean.sh
# After reviewing the prescan:
# bash vscode-cache-clean.sh --execute
# The cached OpenAI VSIX package will be listed, but this does not remove the installed 26.818.21641 extension.
# After closing VS Code, run:
# /home/eagles/dockerz/sis/tools/vscode-cache-clean.sh
# That performs the prescan only. To approve moving the exact listed cache directories to Trash:
# /home/eagles/dockerz/sis/tools/vscode-cache-clean.sh --execute

set -euo pipefail

targets=(
  "/home/eagles/.config/Code/WebStorage"
  "/home/eagles/.config/Code/CachedExtensionVSIXs"
)

if pgrep -x code >/dev/null 2>&1 || pgrep -x code-insiders >/dev/null 2>&1; then
  echo "ERROR: VS Code is still running. Close it completely and retry."
  exit 1
fi

echo "VS Code is closed."
echo
echo "Prescan: targets and content affected"
echo "======================================"

total_bytes=0

for target in "${targets[@]}"; do
  if [[ ! -e "$target" ]]; then
    echo
    echo "MISSING: $target"
    continue
  fi

  bytes=$(du -sb "$target" | awk '{print $1}')
  human=$(du -sh "$target" | awk '{print $1}')
  files=$(find "$target" -type f -printf '.' 2>/dev/null | wc -c)
  total_bytes=$((total_bytes + bytes))

  echo
  echo "TARGET: $target"
  echo "SIZE:   $human"
  echo "FILES:  $files"

  if [[ "$target" == */CachedExtensionVSIXs ]]; then
    echo "CONTENT: downloaded VSIX installer/cache packages; installed extensions are not removed."
  else
    echo "CONTENT: VS Code web storage, browser cache, extension state, and embedded webview cache."
  fi

  echo "LARGEST CONTENT:"
  find "$target" -type f -printf '%s\t%p\n' 2>/dev/null |
    sort -nr |
    sed -n '1,15p' |
    numfmt --field=1 --to=iec
done

echo
echo "TOTAL POTENTIAL SPACE: $(numfmt --to=iec "$total_bytes")"
echo
echo "No files have been changed."

if [[ "${1:-}" != "--execute" ]]; then
  echo
  echo "Dry run only. To move these exact targets to Trash, run:"
  echo
  echo "  $0 --execute"
  exit 0
fi

echo
read -r -p "Move the listed cache directories to Trash? [y/N] " answer

if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Canceled. No files were changed."
  exit 0
fi

for target in "${targets[@]}"; do
  if [[ -e "$target" ]]; then
    gio trash -- "$target"
    echo "Moved to Trash: $target"
  fi
done

echo
echo "Cache directories moved to Trash."
echo "Disk space is reclaimed only after the Trash is emptied."
