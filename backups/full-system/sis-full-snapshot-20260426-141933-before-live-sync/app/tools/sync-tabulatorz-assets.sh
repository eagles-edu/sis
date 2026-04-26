#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIST_DIR="${ROOT_DIR}/dev/tabulatorz/dist"
TARGET_DIR="${ROOT_DIR}/web-asset/vendor/tabulatorz"

SOURCE_JS="${SOURCE_DIST_DIR}/js/tabulator.min.js"
SOURCE_JS_MAP="${SOURCE_DIST_DIR}/js/tabulator.min.js.map"
SOURCE_CSS="${SOURCE_DIST_DIR}/css/tabulator.min.css"
SOURCE_CSS_MAP="${SOURCE_DIST_DIR}/css/tabulator.min.css.map"
SOURCE_LICENSE="${ROOT_DIR}/dev/tabulatorz/LICENSE"

if [[ ! -f "${SOURCE_JS}" || ! -f "${SOURCE_CSS}" ]]; then
  echo "Missing Tabulator dist assets in dev/tabulatorz/dist."
  echo "Run: git clone https://github.com/eagles-edu/tabulatorz.git dev/tabulatorz"
  echo "If dist is missing, run: cd dev/tabulatorz && npm install && npm run build"
  exit 1
fi

mkdir -p "${TARGET_DIR}"
cp "${SOURCE_JS}" "${TARGET_DIR}/tabulator.min.js"
cp "${SOURCE_CSS}" "${TARGET_DIR}/tabulator.min.css"

if [[ -f "${SOURCE_JS_MAP}" ]]; then
  cp "${SOURCE_JS_MAP}" "${TARGET_DIR}/tabulator.min.js.map"
fi
if [[ -f "${SOURCE_CSS_MAP}" ]]; then
  cp "${SOURCE_CSS_MAP}" "${TARGET_DIR}/tabulator.min.css.map"
fi
if [[ -f "${SOURCE_LICENSE}" ]]; then
  cp "${SOURCE_LICENSE}" "${TARGET_DIR}/LICENSE.tabulatorz.txt"
fi

echo "Synced Tabulator assets to ${TARGET_DIR}"
