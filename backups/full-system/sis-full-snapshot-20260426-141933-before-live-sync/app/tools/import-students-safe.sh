#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="/home/eagles/dockerz/sis"
RUNTIME_ROOT="/home/admin.eagles.edu.vn/sis"
RUNTIME_ENV_PATH="${RUNTIME_ROOT}/.env"
IMPORT_FILE="/home/eagles/dockerz/sis/docs/students/eaglesclub-students-import-ready.xlsx"
API_BASE="http://127.0.0.1:8787"
API_PREFIX="/api/admin"
ADMIN_USER=""
ADMIN_PASSWORD=""
CHECK_ONLY=0
CONFIRM=0
SKIP_BACKUP=0

usage() {
  cat <<'USAGE'
Usage: import-students-safe.sh [options]

Strict import workflow:
1) preflight only (no writes) against live DB identity rules
2) if preflight is clean and --yes is provided:
   - create DB backup
   - login to admin API
   - perform a single import write

Options:
  --file PATH          Spreadsheet file to import.
  --runtime-env PATH   Runtime .env path (default: /home/admin.eagles.edu.vn/sis/.env)
  --api-base URL       API base URL (default: http://127.0.0.1:8787)
  --api-prefix PATH    API prefix (default: /api/admin)
  --username USER      Admin username (default: STUDENT_ADMIN_USER from runtime .env, else admin)
  --password PASS      Admin password (if omitted, prompt on write mode)
  --check-only         Run preflight only; never writes.
  --yes                Required for backup + import write.
  --skip-backup        Skip backup before write (not recommended).
  -h, --help           Show help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)
      IMPORT_FILE="$2"
      shift 2
      ;;
    --runtime-env)
      RUNTIME_ENV_PATH="$2"
      shift 2
      ;;
    --api-base)
      API_BASE="$2"
      shift 2
      ;;
    --api-prefix)
      API_PREFIX="$2"
      shift 2
      ;;
    --username)
      ADMIN_USER="$2"
      shift 2
      ;;
    --password)
      ADMIN_PASSWORD="$2"
      shift 2
      ;;
    --check-only)
      CHECK_ONLY=1
      shift
      ;;
    --yes)
      CONFIRM=1
      shift
      ;;
    --skip-backup)
      SKIP_BACKUP=1
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

if [[ ! -f "${RUNTIME_ENV_PATH}" ]]; then
  echo "Runtime env file not found: ${RUNTIME_ENV_PATH}" >&2
  exit 1
fi

if [[ ! -f "${IMPORT_FILE}" ]]; then
  echo "Import file not found: ${IMPORT_FILE}" >&2
  exit 1
fi

if [[ ! -x "${SOURCE_ROOT}/tools/db-backup-smart.sh" ]]; then
  echo "Missing backup tool: ${SOURCE_ROOT}/tools/db-backup-smart.sh" >&2
  exit 1
fi

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

DATABASE_URL="$(read_env_value "${RUNTIME_ENV_PATH}" "DATABASE_URL")"
if [[ -z "${DATABASE_URL}" ]]; then
  echo "DATABASE_URL missing in ${RUNTIME_ENV_PATH}" >&2
  exit 1
fi

if [[ -z "${ADMIN_USER}" ]]; then
  ADMIN_USER="$(read_env_value "${RUNTIME_ENV_PATH}" "STUDENT_ADMIN_USER")"
fi
if [[ -z "${ADMIN_USER}" ]]; then
  ADMIN_USER="admin"
fi

redact_url() {
  local raw="$1"
  echo "${raw}" | sed -E 's#(postgres(ql)?://)[^/@]+@#\1****@#'
}

timestamp="$(date +%Y%m%d-%H%M%S)"
preflight_out="/tmp/sis-import-preflight-${timestamp}.json"
login_out="/tmp/sis-import-login-${timestamp}.json"
payload_json="/tmp/sis-import-payload-${timestamp}.json"
result_out="/tmp/sis-import-result-${timestamp}.json"
cookie_jar="/tmp/sis-import-cookie-${timestamp}.txt"

echo "[import-students-safe] runtime_env=${RUNTIME_ENV_PATH}"
echo "[import-students-safe] import_file=${IMPORT_FILE}"
echo "[import-students-safe] api=${API_BASE}${API_PREFIX}"
echo "[import-students-safe] database=$(redact_url "${DATABASE_URL}")"
echo "[import-students-safe] preflight_output=${preflight_out}"

echo "[step] preflight: parse + strict identity validation (no write)"
if ! (
  cd "${SOURCE_ROOT}" && \
    IMPORT_FILE="${IMPORT_FILE}" DATABASE_URL="${DATABASE_URL}" \
      node --input-type=module <<'EOF' | tee "${preflight_out}"
import fs from "node:fs"
import path from "node:path"
import { Client } from "pg"
import { parseSpreadsheetRowsFromUploadPayload } from "./server/student-admin-routes.mjs"
import { validateImportRowsForIdentity } from "./server/student-admin-store.mjs"

const importFile = process.env.IMPORT_FILE
const databaseUrl = process.env.DATABASE_URL
if (!importFile || !fs.existsSync(importFile)) {
  console.error(`Import file not found: ${importFile || "(missing)"}`)
  process.exit(2)
}
if (!databaseUrl) {
  console.error("DATABASE_URL is required for preflight")
  process.exit(2)
}

const rows = parseSpreadsheetRowsFromUploadPayload({
  fileName: path.basename(importFile),
  format: "xlsx",
  fileDataBase64: fs.readFileSync(importFile).toString("base64"),
})

const client = new Client({ connectionString: databaseUrl })
await client.connect()
const existing = await client.query('SELECT "eaglesId", "studentNumber" FROM "Student"')
await client.end()

const validation = validateImportRowsForIdentity(rows, {
  existingRows: existing.rows,
  requireExplicitIdentity: true,
})

const summary = {
  importFile,
  parsedRows: rows.length,
  existingStudents: existing.rows.length,
  strictIdentity: validation.requireExplicitIdentity,
  autoFilledEaglesIds: validation.autoFilledEaglesIds,
  autoFilledStudentNumbers: validation.autoFilledStudentNumbers,
  errors: validation.errors.length,
  errorPreview: validation.errors.slice(0, 25),
}

console.log(JSON.stringify(summary, null, 2))
if (validation.errors.length > 0) process.exit(3)
EOF
); then
  echo "[halt] preflight failed; no import write was attempted"
  exit 1
fi

if [[ "${CHECK_ONLY}" -eq 1 ]]; then
  echo "[ok] preflight-only complete (no writes performed)"
  exit 0
fi

if [[ "${CONFIRM}" -ne 1 ]]; then
  echo "Refusing to write: pass --yes after reviewing preflight output" >&2
  exit 1
fi

if [[ -z "${ADMIN_PASSWORD}" ]]; then
  read -rs -p "Admin password for ${ADMIN_USER}: " ADMIN_PASSWORD
  echo
fi

if [[ "${SKIP_BACKUP}" -ne 1 ]]; then
  echo "[step] backup: creating DB backup before import write"
  (
    cd "${SOURCE_ROOT}"
    tools/db-backup-smart.sh --database-url "${DATABASE_URL}"
  )
else
  echo "[warn] backup skipped (--skip-backup)"
fi

echo "[step] auth: login and session cookie"
login_payload="$(
  ADMIN_USER="${ADMIN_USER}" ADMIN_PASSWORD="${ADMIN_PASSWORD}" node --input-type=module <<'EOF'
console.log(JSON.stringify({ username: process.env.ADMIN_USER, password: process.env.ADMIN_PASSWORD }))
EOF
)"
login_code="$(
  curl -sS -o "${login_out}" -w '%{http_code}' \
    -c "${cookie_jar}" \
    -H 'Content-Type: application/json' \
    --data "${login_payload}" \
    "${API_BASE}${API_PREFIX}/auth/login"
)"
if [[ "${login_code}" != "200" ]]; then
  echo "Login failed: HTTP ${login_code}. Response: ${login_out}" >&2
  cat "${login_out}" >&2 || true
  exit 1
fi

echo "[step] import: uploading spreadsheet payload"
IMPORT_FILE="${IMPORT_FILE}" node --input-type=module <<'EOF' > "${payload_json}"
import fs from "node:fs"
import path from "node:path"
const importFile = process.env.IMPORT_FILE
const payload = {
  fileName: path.basename(importFile),
  format: "xlsx",
  fileDataBase64: fs.readFileSync(importFile).toString("base64"),
}
process.stdout.write(JSON.stringify(payload))
EOF

import_code="$(
  curl -sS -o "${result_out}" -w '%{http_code}' \
    -b "${cookie_jar}" \
    -H 'Content-Type: application/json' \
    --data-binary "@${payload_json}" \
    "${API_BASE}${API_PREFIX}/students/import"
)"

if [[ "${import_code}" != "200" ]]; then
  echo "Import request failed: HTTP ${import_code}. Response: ${result_out}" >&2
  cat "${result_out}" >&2 || true
  exit 1
fi

echo "[step] verify: committed result"
if ! RESULT_PATH="${result_out}" node --input-type=module <<'EOF'
import fs from "node:fs"
const resultPath = process.env.RESULT_PATH
const payload = JSON.parse(fs.readFileSync(resultPath, "utf8"))
const summary = {
  processed: Number(payload?.processed || 0),
  created: Number(payload?.created || 0),
  updated: Number(payload?.updated || 0),
  failed: Number(payload?.failed || 0),
  committed: Boolean(payload?.committed),
  strictIdentity: payload?.strictIdentity,
}
console.log(JSON.stringify(summary, null, 2))
if (!summary.committed || summary.failed > 0) process.exit(1)
EOF
then
  echo "[halt] import completed with failures or uncommitted transaction"
  echo "[info] result_file=${result_out}"
  exit 1
fi

echo "[ok] import write committed"
echo "[info] preflight_file=${preflight_out}"
echo "[info] result_file=${result_out}"
