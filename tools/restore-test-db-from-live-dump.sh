#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="${SIS_TEST_ROOT:-/home/test.eagles.edu.vn/sis}"
TEST_SERVICE="${SIS_TEST_SERVICE:-exercise-mailer-test.service}"
HEALTH_URL="${SIS_TEST_HEALTH_URL:-http://127.0.0.1:8786/healthz}"
DUMP_PATH="${SIS_TEST_DUMP_PATH:-$REPO_ROOT/.sto/sis-live.dump}"
DATABASE_URL="${SIS_TEST_DATABASE_URL:-}"
VERIFY_ONLY=0
YES=0
RUN_PRISMA=1
RESTART_RUNTIME=1
MIGRATION_PHASE="all"
STAGE1_MIGRATION_NAME="20260815090000_library_canonical_uniqueness_and_lifecycle"
STAGE1_MIGRATION_SQL="$REPO_ROOT/prisma/migrations/${STAGE1_MIGRATION_NAME}/migration.sql"

usage() {
  cat <<'USAGE'
Usage: restore-test-db-from-live-dump.sh [options]

Options:
  --dump <path>          Dump file path (default: .sto/sis-live.dump under repo root)
  --test-root <path>     Test runtime root (default: /home/test.eagles.edu.vn/sis)
  --database-url <url>   Test DATABASE_URL (default: read from <test-root>/.env.test)
  --service <name>       Systemd service to restart (default: exercise-mailer-test.service)
  --health-url <url>     Health probe URL (default: http://127.0.0.1:8786/healthz)
  --verify-only          Verify dump only; do not restore
  --skip-prisma          Skip npm run db:generate + db:migrate:deploy
  --skip-restart         Skip systemd restart and health checks
  --legacy-pre-cutover   Restore live data and apply only the stage-1 Library migration
  --legacy-post-cutover  Apply pending migrations after test cutover; do not restore a dump
  --yes                  Required for real restore
  -h, --help             Show this help

Examples:
  tools/restore-test-db-from-live-dump.sh --verify-only
  tools/restore-test-db-from-live-dump.sh --yes
USAGE
}

log() {
  printf '[restore-test-db] %s\n' "$*"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump)
      DUMP_PATH="$2"
      shift 2
      ;;
    --test-root)
      TEST_ROOT="$2"
      shift 2
      ;;
    --database-url)
      DATABASE_URL="$2"
      shift 2
      ;;
    --service)
      TEST_SERVICE="$2"
      shift 2
      ;;
    --health-url)
      HEALTH_URL="$2"
      shift 2
      ;;
    --verify-only)
      VERIFY_ONLY=1
      shift
      ;;
    --skip-prisma)
      RUN_PRISMA=0
      shift
      ;;
    --skip-restart)
      RESTART_RUNTIME=0
      shift
      ;;
    --legacy-pre-cutover)
      MIGRATION_PHASE="pre-cutover"
      shift
      ;;
    --legacy-post-cutover)
      MIGRATION_PHASE="post-cutover"
      shift
      ;;
    --yes)
      YES=1
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

if [[ "$MIGRATION_PHASE" == "post-cutover" ]]; then
  if [[ "$VERIFY_ONLY" -eq 1 ]]; then
    echo "--verify-only cannot be combined with --legacy-post-cutover" >&2
    exit 1
  fi
else
  if [[ "${DUMP_PATH}" != /* ]]; then
    DUMP_PATH="${REPO_ROOT}/${DUMP_PATH}"
  fi
  DUMP_PATH="$(realpath -m "$DUMP_PATH")"

  if [[ ! -f "$DUMP_PATH" ]]; then
    echo "Dump not found: $DUMP_PATH" >&2
    exit 1
  fi

  log "verifying dump archive"
  node "$REPO_ROOT/tools/db-restore-failsafe.mjs" --file "$DUMP_PATH" --verify-only

  if [[ "$VERIFY_ONLY" -eq 1 ]]; then
    log "verify-only completed"
    exit 0
  fi
fi

if [[ "$YES" -ne 1 ]]; then
  echo "Refusing restore without --yes" >&2
  exit 1
fi

if [[ "$MIGRATION_PHASE" != "all" && "$RUN_PRISMA" -eq 0 ]]; then
  echo "Legacy migration phases require Prisma handling; remove --skip-prisma" >&2
  exit 1
fi

resolve_database_url_from_env() {
  local env_path="$1"
  ENV_PATH="$env_path" node --input-type=module <<'EOF'
import fs from "node:fs"
const envPath = process.env.ENV_PATH
const raw = fs.readFileSync(envPath, "utf8")
let value = ""
for (const rawLine of raw.split(/\r?\n/u)) {
  const line = rawLine.trim()
  if (!line || line.startsWith("#")) continue
  const idx = line.indexOf("=")
  if (idx < 0) continue
  const key = line.slice(0, idx).trim()
  if (key !== "DATABASE_URL") continue
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

stop_test_runtime_for_restore() {
  if [[ "$MIGRATION_PHASE" != "pre-cutover" ]]; then
    return 0
  fi
  log "stopping test runtime before replacing sis-test"
  sudo systemctl stop "$TEST_SERVICE"
}

recreate_legacy_preview_database() {
  if [[ "$MIGRATION_PHASE" != "pre-cutover" ]]; then
    return 0
  fi
  log "recreating isolated sis-test database for an exact live-data restore"
  DATABASE_URL="$DATABASE_URL" node --input-type=module <<'EOF'
import pg from "pg"

const targetUrl = new URL(process.env.DATABASE_URL)
const dbName = (targetUrl.pathname || "").replace(/^\/+/, "")
if (dbName !== "sis-test") throw new Error(`Refusing to recreate non-test database: ${dbName}`)
const adminUrl = new URL(targetUrl.toString())
adminUrl.pathname = "/postgres"
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`
const client = new pg.Client({ connectionString: adminUrl.toString() })
await client.connect()
try {
  await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [dbName])
  await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(dbName)}`)
  await client.query(`CREATE DATABASE ${quoteIdentifier(dbName)}`)
} finally {
  await client.end()
}
EOF
}

if [[ -z "$DATABASE_URL" ]]; then
  TEST_ENV_PATH="${TEST_ROOT}/.env.test"
  if [[ ! -f "$TEST_ENV_PATH" ]]; then
    echo "Missing .env.test in test root: ${TEST_ENV_PATH}" >&2
    exit 1
  fi
  DATABASE_URL="$(resolve_database_url_from_env "$TEST_ENV_PATH")"
fi

if [[ -z "$DATABASE_URL" ]]; then
  echo "DATABASE_URL is empty; provide --database-url or set it in ${TEST_ROOT}/.env.test" >&2
  exit 1
fi

DATABASE_NAME="$(
  DATABASE_URL="$DATABASE_URL" node --input-type=module <<'EOF'
const dbUrl = new URL(process.env.DATABASE_URL)
process.stdout.write((dbUrl.pathname || "").replace(/^\/+/u, ""))
EOF
)"
if [[ "$DATABASE_NAME" != "sis-test" ]]; then
  log "warning: DATABASE_URL currently targets '${DATABASE_NAME}' (expected canonical test db: sis-test)"
fi

if [[ "$MIGRATION_PHASE" != "all" && "$DATABASE_NAME" != "sis-test" ]]; then
  echo "Refusing legacy migration phase against non-test database: ${DATABASE_NAME}" >&2
  exit 1
fi

log "checking target database exists"
DATABASE_URL="$DATABASE_URL" node --input-type=module <<'EOF'
import pg from "pg"
const restoreUrl = new URL(process.env.DATABASE_URL)
const dbName = (restoreUrl.pathname || "").replace(/^\/+/u, "")
const adminUrl = new URL(restoreUrl.toString())
adminUrl.pathname = "/postgres"
const client = new pg.Client({ connectionString: adminUrl.toString() })
await client.connect()
const res = await client.query("select 1 from pg_database where datname = $1", [dbName])
await client.end()
if (!res.rowCount) {
  console.error(`Target database does not exist: ${dbName}`)
  process.exit(1)
}
EOF

stop_test_runtime_for_restore
recreate_legacy_preview_database

if [[ "$MIGRATION_PHASE" != "post-cutover" ]]; then
  log "restoring dump into test database"
  restore_output=""
  if ! restore_output="$(
    node "$REPO_ROOT/tools/db-restore-failsafe.mjs" \
      --file "$DUMP_PATH" \
      --database-url "$DATABASE_URL" \
      --yes \
      --clean \
      --single-transaction 2>&1
  )"; then
    printf '%s\n' "$restore_output" >&2
    if grep -q "transaction_timeout" <<<"$restore_output"; then
      log "fallback restore: filtering unsupported transaction_timeout directive"
      if ! command -v psql >/dev/null 2>&1; then
        echo "psql is required for compatibility fallback restore." >&2
        exit 1
      fi
      pg_restore \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges \
        --exit-on-error \
        --single-transaction \
        --file - \
        "$DUMP_PATH" \
        | sed '/^SET transaction_timeout = 0;$/d' \
      | psql -v ON_ERROR_STOP=1 "$DATABASE_URL"
    else
      exit 1
    fi
  else
    printf '%s\n' "$restore_output"
  fi
fi

apply_stage1_migration() {
  if [[ ! -f "$STAGE1_MIGRATION_SQL" ]]; then
    echo "Stage-1 migration is missing: ${STAGE1_MIGRATION_SQL}" >&2
    exit 1
  fi
  if [[ ! -d "${TEST_ROOT}/prisma/migrations" ]]; then
    echo "Test migration directory is missing: ${TEST_ROOT}/prisma/migrations" >&2
    exit 1
  fi

  log "applying all pending migrations through stage 1, excluding stage 2"
  PENDING_MIGRATIONS="$({
    DATABASE_URL="$DATABASE_URL" MIGRATION_ROOT="${TEST_ROOT}/prisma/migrations" STAGE1_NAME="$STAGE1_MIGRATION_NAME" node --input-type=module <<'EOF'
import fs from "node:fs/promises"
import path from "node:path"
import pg from "pg"

const migrationRoot = process.env.MIGRATION_ROOT
const stage1Name = process.env.STAGE1_NAME
const entries = (await fs.readdir(migrationRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name <= stage1Name)
  .map((entry) => entry.name)
  .sort()
const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
try {
  const migrationTable = await client.query("SELECT to_regclass('public._prisma_migrations') AS name")
  if (!migrationTable.rows[0]?.name) throw new Error("Prisma migration table is missing")
  const appliedRows = await client.query('SELECT "migration_name" FROM "_prisma_migrations"')
  const applied = new Set(appliedRows.rows.map((row) => row.migration_name))
  const stage2 = await client.query('SELECT "migration_name" FROM "_prisma_migrations" WHERE "migration_name" = $1', ["20260815093000_enforce_library_canonical_uniqueness"])
  if (stage2.rowCount) throw new Error("Stage-2 uniqueness migration is already applied; legacy pre-cutover preview is unavailable")
  if (!applied.has(stage1Name)) {
    const existingSchema = await client.query(`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'library' AND table_name = 'LibraryContribution' AND column_name = 'dueAt') AS has_due_at,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'library' AND table_name = 'LibraryLegacySourceArchive') AS has_archive
    `)
    if (existingSchema.rows[0]?.has_due_at || existingSchema.rows[0]?.has_archive) {
      throw new Error("Stage-1 Library objects exist but the migration is not recorded; refusing to guess migration state")
    }
  }
  for (const migrationName of entries) {
    if (applied.has(migrationName)) continue
    const migrationSqlPath = path.join(migrationRoot, migrationName, "migration.sql")
    const migrationSql = await fs.readFile(migrationSqlPath, "utf8")
    await client.query("BEGIN")
    try {
      await client.query(migrationSql)
      await client.query("COMMIT")
      process.stdout.write(`${migrationName}\n`)
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {})
      throw error
    }
  }
} finally {
  await client.end()
}
EOF
} )"

  if [[ ! -f "${TEST_ROOT}/package.json" || ! -f "${TEST_ROOT}/.env.test" ]]; then
    echo "Cannot resolve stage-1 migrations; test root is incomplete: ${TEST_ROOT}" >&2
    exit 1
  fi
  while IFS= read -r migration_name; do
    [[ -z "$migration_name" ]] && continue
    log "recording migration as applied: ${migration_name}"
    (cd "$TEST_ROOT" && env SIS_ENV_FILE=.env.test DOTENV_CONFIG_PATH=.env.test NODE_ENV=test npx prisma migrate resolve --applied "$migration_name")
  done <<< "$PENDING_MIGRATIONS"
}

if [[ "$RUN_PRISMA" -eq 1 ]]; then
  if [[ ! -f "${TEST_ROOT}/package.json" ]]; then
    echo "Cannot run Prisma refresh; missing package.json in ${TEST_ROOT}" >&2
    exit 1
  fi
  if [[ ! -f "${TEST_ROOT}/.env.test" ]]; then
    echo "Cannot run Prisma refresh; missing .env.test in ${TEST_ROOT}" >&2
    exit 1
  fi
  log "refreshing Prisma client in test root"
  (cd "$TEST_ROOT" && env SIS_ENV_FILE=.env.test DOTENV_CONFIG_PATH=.env.test NODE_ENV=test npm run db:generate)
  if [[ "$MIGRATION_PHASE" == "pre-cutover" ]]; then
    apply_stage1_migration
  else
    log "deploying Prisma migrations in test root"
    (cd "$TEST_ROOT" && env SIS_ENV_FILE=.env.test DOTENV_CONFIG_PATH=.env.test NODE_ENV=test npm run db:migrate:deploy)
  fi
fi

if [[ "$RESTART_RUNTIME" -eq 1 ]]; then
  log "restarting test runtime service: ${TEST_SERVICE}"
  if [[ "$MIGRATION_PHASE" == "pre-cutover" ]]; then
    log "setting one-shot test boot flag to keep stage-2 migration unapplied"
    sudo systemctl set-environment SIS_LEGACY_PRE_CUTOVER=1
    cleanup_boot_flag() {
      sudo systemctl unset-environment SIS_LEGACY_PRE_CUTOVER
    }
    trap cleanup_boot_flag EXIT
  fi
  sudo systemctl restart "$TEST_SERVICE"
  sudo systemctl is-active --quiet "$TEST_SERVICE"
  for _ in $(seq 1 30); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      log "health check ok: ${HEALTH_URL}"
      if [[ "$MIGRATION_PHASE" == "pre-cutover" ]]; then
        cleanup_boot_flag
        trap - EXIT
      fi
      log "completed"
      exit 0
    fi
    sleep 1
  done
  log "health check failed: ${HEALTH_URL}"
  sudo systemctl status "$TEST_SERVICE" --no-pager -l | sed -n '1,120p' || true
  exit 1
fi

log "completed (restart skipped)"
