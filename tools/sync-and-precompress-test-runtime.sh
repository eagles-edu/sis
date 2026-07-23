#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[sync-test] running full test runtime sync and restart"
"${REPO_ROOT}/tools/sync-and-restart-test-runtime.sh" full
"${REPO_ROOT}/tools/precompress-web-assets.sh" test
