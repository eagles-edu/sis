#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="/home/eagles/dockerz/sis"
RUNTIME_ROOT="/home/admin.eagles.edu.vn/sis"
OUTPUT_ROOT="/home/eagles/dockerz/sis/backups/full-system"
LABEL=""
INCLUDE_NODE_MODULES=0
ARCHIVE=1

usage() {
  cat <<'USAGE'
Usage: sis-full-backup-snapshot.sh [options]

Creates a restorable full-system snapshot:
1) runtime app files (server/prisma/schemas/web assets/config)
2) PostgreSQL dump + checksum/metadata
3) manifest with restore guidance
4) optional .tar.gz archive

Options:
  --source-root PATH         Source repository root.
  --runtime-root PATH        Runtime root to snapshot.
  --output-root PATH         Snapshot output root.
  --label TEXT               Optional label suffix for snapshot folder.
  --include-node-modules     Include runtime node_modules (large).
  --no-archive               Skip tar.gz archive creation.
  -h, --help                 Show help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-root)
      SOURCE_ROOT="$2"
      shift 2
      ;;
    --runtime-root)
      RUNTIME_ROOT="$2"
      shift 2
      ;;
    --output-root)
      OUTPUT_ROOT="$2"
      shift 2
      ;;
    --label)
      LABEL="$2"
      shift 2
      ;;
    --include-node-modules)
      INCLUDE_NODE_MODULES=1
      shift
      ;;
    --no-archive)
      ARCHIVE=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "${SOURCE_ROOT}" ]]; then
  echo "Source root not found: ${SOURCE_ROOT}" >&2
  exit 1
fi

if [[ ! -d "${RUNTIME_ROOT}" ]]; then
  echo "Runtime root not found: ${RUNTIME_ROOT}" >&2
  exit 1
fi

if [[ ! -f "${RUNTIME_ROOT}/.env" ]]; then
  echo "Runtime .env missing: ${RUNTIME_ROOT}/.env" >&2
  exit 1
fi

if [[ ! -x "${SOURCE_ROOT}/tools/db-backup-smart.sh" ]]; then
  echo "Missing DB backup tool: ${SOURCE_ROOT}/tools/db-backup-smart.sh" >&2
  exit 1
fi

label_slug="$(echo "${LABEL}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9._-')"
timestamp="$(date +%Y%m%d-%H%M%S)"
snapshot_name="sis-full-snapshot-${timestamp}"
if [[ -n "${label_slug}" ]]; then
  snapshot_name="${snapshot_name}-${label_slug}"
fi

snapshot_dir="${OUTPUT_ROOT}/${snapshot_name}"
app_dir="${snapshot_dir}/app"
db_dir="${snapshot_dir}/db"
meta_dir="${snapshot_dir}/meta"
archive_path="${OUTPUT_ROOT}/${snapshot_name}.tar.gz"

mkdir -p "${OUTPUT_ROOT}" "${app_dir}" "${db_dir}" "${meta_dir}"

read_env_value() {
  local env_path="$1"
  local key="$2"
  ENV_PATH="${env_path}" KEY_NAME="${key}" node --input-type=module <<'EOF'
import fs from "node:fs"
const envPath = process.env.ENV_PATH
const keyName = process.env.KEY_NAME
const raw = fs.readFileSync(envPath, "utf8")
let value = ""
for (const rawLine of raw.split(/\r?\n/u)) {
  const line = rawLine.trim()
  if (!line || line.startsWith("#")) continue
  const idx = line.indexOf("=")
  if (idx < 0) continue
  const key = line.slice(0, idx).trim()
  if (key !== keyName) continue
  value = line.slice(idx + 1).trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  break
}
process.stdout.write(value)
EOF
}

database_url="$(read_env_value "${RUNTIME_ROOT}/.env" "DATABASE_URL")"
if [[ -z "${database_url}" ]]; then
  echo "DATABASE_URL missing in ${RUNTIME_ROOT}/.env" >&2
  exit 1
fi

redact_url() {
  local raw="$1"
  echo "${raw}" | sed -E 's#(postgres(ql)?://)[^/@]+@#\1****@#'
}

echo "[snapshot] source_root=${SOURCE_ROOT}"
echo "[snapshot] runtime_root=${RUNTIME_ROOT}"
echo "[snapshot] output_root=${OUTPUT_ROOT}"
echo "[snapshot] snapshot_dir=${snapshot_dir}"
echo "[snapshot] database=$(redact_url "${database_url}")"

echo "[step] copying runtime files"
rsync_excludes=(
  "--exclude=backups/"
  "--exclude=*.BAK-*"
  "--exclude=*~"
  "--exclude=.sync.ffs_db"
)
if [[ "${INCLUDE_NODE_MODULES}" -ne 1 ]]; then
  rsync_excludes+=("--exclude=node_modules/")
fi
rsync -a --delete "${rsync_excludes[@]}" "${RUNTIME_ROOT}/" "${app_dir}/"

echo "[step] database dump"
(
  cd "${SOURCE_ROOT}"
  tools/db-backup-smart.sh --database-url "${database_url}" --output-dir "${db_dir}" --no-prune
)

echo "[step] writing metadata"
host_name="$(hostname)"
node_version="$(node -v)"
npm_version="$(npm -v)"
git_commit="$(git -C "${SOURCE_ROOT}" rev-parse --short HEAD 2>/dev/null || true)"
git_branch="$(git -C "${SOURCE_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

SOURCE_ROOT="${SOURCE_ROOT}" \
RUNTIME_ROOT="${RUNTIME_ROOT}" \
SNAPSHOT_DIR="${snapshot_dir}" \
SNAPSHOT_NAME="${snapshot_name}" \
DATABASE_URL_REDACTED="$(redact_url "${database_url}")" \
HOST_NAME="${host_name}" \
NODE_VERSION="${node_version}" \
NPM_VERSION="${npm_version}" \
GIT_COMMIT="${git_commit}" \
GIT_BRANCH="${git_branch}" \
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
INCLUDE_NODE_MODULES="${INCLUDE_NODE_MODULES}" \
node --input-type=module <<'EOF' > "${meta_dir}/manifest.json"
const payload = {
  snapshotName: process.env.SNAPSHOT_NAME,
  createdAt: process.env.CREATED_AT,
  sourceRoot: process.env.SOURCE_ROOT,
  runtimeRoot: process.env.RUNTIME_ROOT,
  snapshotDir: process.env.SNAPSHOT_DIR,
  database: process.env.DATABASE_URL_REDACTED,
  host: process.env.HOST_NAME,
  nodeVersion: process.env.NODE_VERSION,
  npmVersion: process.env.NPM_VERSION,
  git: {
    branch: process.env.GIT_BRANCH || "",
    commit: process.env.GIT_COMMIT || "",
  },
  includes: {
    appDir: "app/",
    dbDir: "db/",
    includeNodeModules: process.env.INCLUDE_NODE_MODULES === "1",
  },
  restore: {
    script: "/home/eagles/dockerz/sis/tools/sis-full-restore-snapshot.sh",
    command: "tools/sis-full-restore-snapshot.sh --snapshot-dir <snapshot_dir> --yes",
  },
}
process.stdout.write(JSON.stringify(payload, null, 2))
EOF

cat <<EOF > "${meta_dir}/RESTORE.md"
# Restore Guide

Run from source root:

\`\`\`bash
cd ${SOURCE_ROOT}
tools/sis-full-restore-snapshot.sh --snapshot-dir "${snapshot_dir}" --yes
\`\`\`

Use \`--skip-files\` or \`--skip-db\` for partial restore.
EOF

if [[ "${ARCHIVE}" -eq 1 ]]; then
  echo "[step] creating archive ${archive_path}"
  tar -C "${OUTPUT_ROOT}" -czf "${archive_path}" "${snapshot_name}"
fi

echo "[ok] full snapshot complete"
echo "[info] snapshot_dir=${snapshot_dir}"
if [[ "${ARCHIVE}" -eq 1 ]]; then
  echo "[info] archive=${archive_path}"
fi
