#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/eagles/dockerz/sis
SOURCE_APP=/home/moodle.eagles.edu.vn/app
SOURCE_DATA=/home/moodle.eagles.edu.vn/moodledata
STAGE_HOME=/home/staged.eagles.edu.vn
STAGE_APP=${STAGE_HOME}/app
STAGE_DATA=${STAGE_HOME}/moodledata
BACKUP_ROOT=/home/eagles/dockerz/backups/moodle-staging
PHP=/usr/bin/php8.3
TASK='\enrol_sis\task\sync'
STAGING_TEMP_DIR=

fail() {
  printf '[moodle-stage] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  sudo tools/moodle-staging-workflow.sh status
  sudo tools/moodle-staging-workflow.sh refresh-data --dry-run
  sudo tools/moodle-staging-workflow.sh refresh-data --apply
  sudo tools/moodle-staging-workflow.sh promote --dry-run
  sudo tools/moodle-staging-workflow.sh promote --apply
  sudo tools/moodle-staging-workflow.sh rollback-production SNAPSHOT --dry-run
  sudo tools/moodle-staging-workflow.sh rollback-production SNAPSHOT --apply
  sudo tools/moodle-staging-workflow.sh restore SNAPSHOT --dry-run
  sudo tools/moodle-staging-workflow.sh restore SNAPSHOT --apply

Refresh copies production database and file data into staging while preserving
staging code and config.php. Promotion copies staged code into production while
preserving production config.php, database, and moodledata. Every apply saves a
private snapshot before changing its target; promotion enables maintenance mode.
EOF
}

need_root() {
  [[ ${EUID} -eq 0 ]] || fail "run through sudo"
}

need_commands() {
  local command_name
  for command_name in "$PHP" mariadb mariadb-dump rsync gzip nginx tar curl stat; do
    command -v "$command_name" >/dev/null 2>&1 || fail "required command is missing: ${command_name}"
  done
  [[ -x "$PHP" ]] || fail "PHP 8.3 CLI is unavailable at ${PHP}"
  systemctl is-active --quiet php8.3-fpm.service || fail "PHP 8.3 FPM is not active"
  grep -Fq '/run/php/php8.3-fpm.sock' /etc/nginx/sites-available/moodle.eagles.edu.vn.conf || fail "live Moodle vhost is not on PHP 8.3"
  grep -Fq '/run/php/php8.3-fpm.sock' /etc/nginx/sites-available/staged.eagles.edu.vn.conf || fail "staging Moodle vhost is not on PHP 8.3"
}

read_site_config() {
  "$PHP" -r '
    define("CLI_SCRIPT", true);
    require $argv[1];
    echo $CFG->wwwroot, "\n", $CFG->dbname, "\n", $CFG->dirroot, "\n", $CFG->dataroot, "\n", (int)(bool)($CFG->noemailever ?? false), "\n";
  ' "$1"
}

write_db_options() {
  "$PHP" -r '
    define("CLI_SCRIPT", true);
    require $argv[1];
    $quote = static function ($value): string {
      $value = str_replace(["\\", "\"", "\n", "\r"], ["\\\\", "\\\"", "\\n", "\\r"], (string)$value);
      return "\"" . $value . "\"";
    };
    $options = "[client]\n";
    $options .= "host=" . $quote($CFG->dbhost ?? "127.0.0.1") . "\n";
    $options .= "user=" . $quote($CFG->dbuser) . "\n";
    $options .= "password=" . $quote($CFG->dbpass) . "\n";
    $options .= "port=" . (int)($CFG->dboptions["dbport"] ?? 3306) . "\n";
    if (!empty($CFG->dboptions["dbsocket"])) {
      $options .= "socket=" . $quote($CFG->dboptions["dbsocket"]) . "\n";
    }
    if (file_put_contents($argv[2], $options, LOCK_EX) === false || !chmod($argv[2], 0600)) {
      fwrite(STDERR, "Could not write private database client options.\n");
      exit(1);
    }
  ' "$1" "$2"
}

database_size() {
  "$PHP" -r '
    define("CLI_SCRIPT", true);
    require $argv[1];
    global $DB;
    echo (int)$DB->get_field_sql("SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema = DATABASE()"), "\n";
  ' "$1"
}

moodle_version() {
  sed -nE 's/^\$version[[:space:]]*=[[:space:]]*([0-9]+)(\.[0-9]+)?;.*/\1/p' "$1"
}

validate_stage() {
  local source_lines stage_lines
  mapfile -t source_lines < <(read_site_config "${SOURCE_APP}/config.php")
  mapfile -t stage_lines < <(read_site_config "${STAGE_APP}/config.php")
  [[ ${#source_lines[@]} -ge 5 && ${#stage_lines[@]} -ge 5 ]] || fail "could not read Moodle site configuration"
  [[ ${source_lines[0]} == 'https://moodle.eagles.edu.vn' ]] || fail "unexpected live Moodle origin"
  [[ ${stage_lines[0]} == 'https://staged.eagles.edu.vn' ]] || fail "staging config does not use staged.eagles.edu.vn"
  [[ ${source_lines[1]} != "${stage_lines[1]}" ]] || fail "live and staging databases are not isolated"
  [[ ${source_lines[2]} != "${stage_lines[2]}" && ${source_lines[3]} != "${stage_lines[3]}" ]] || fail "live and staging app/data paths are not isolated"
  [[ ${stage_lines[4]} == 1 ]] || fail "staging config must keep noemailever enabled"
  getent passwd stage8567 >/dev/null || fail "staging Moodle account is missing"
  getent group stage8567www >/dev/null || fail "staging Moodle group is missing"
}

validate_paths() {
  [[ -d "$SOURCE_APP" && -f "${SOURCE_APP}/config.php" && -d "$SOURCE_DATA/filedir" ]] || fail "live Moodle app or file data is unavailable"
  [[ -d "$STAGE_APP" && -f "${STAGE_APP}/config.php" && -d "$STAGE_DATA/filedir" ]] || fail "staging Moodle app or file data is unavailable"
  [[ "$SOURCE_APP" != "$STAGE_APP" && "$SOURCE_DATA" != "$STAGE_DATA" ]] || fail "live and staging paths must differ"
}

make_private_dir() {
  local path
  for path in "$@"; do
    install -d -m 0700 "$path"
    chmod 0700 "$path"
  done
}

cleanup_temp_dir() {
  if [[ -n "$STAGING_TEMP_DIR" && -d "$STAGING_TEMP_DIR" ]]; then
    chmod -R u+rwX "$STAGING_TEMP_DIR" 2>/dev/null || true
    rm -rf -- "$STAGING_TEMP_DIR"
  fi
}

snapshot_current_stage() {
  local snapshot=$1 stage_db=$2 stage_cnf=$3
  make_private_dir "$snapshot/app" "$snapshot/moodledata"
  rsync -a --numeric-ids "${STAGE_APP}/" "$snapshot/app/"
  rsync -a --numeric-ids "${STAGE_DATA}/" "$snapshot/moodledata/"
  mariadb-dump --defaults-extra-file="$stage_cnf" --single-transaction --quick --hex-blob --add-drop-table "$stage_db" | gzip -1 > "$snapshot/database.sql.gz"
  gzip -t "$snapshot/database.sql.gz" || fail "staging database snapshot failed compression verification"
  chmod -R go-rwx "$snapshot"
  printf 'snapshot_time=%s\nstaging_origin=https://staged.eagles.edu.vn\nstaging_database=%s\nstaging_config=%s/config.php\n' \
    "$(date -Is)" "$stage_db" "$STAGE_APP" > "$snapshot/manifest.txt"
  chmod 0600 "$snapshot/manifest.txt" "$snapshot/database.sql.gz"
}

sanitize_staging() {
  "$PHP" "${STAGE_APP}/admin/cli/cfg.php" --component=enrol_sis --name=sisbaseurl --unset >/dev/null
  "$PHP" "${STAGE_APP}/admin/cli/cfg.php" --component=enrol_sis --name=provisioningsecret --unset >/dev/null
  "$PHP" "${STAGE_APP}/admin/cli/cfg.php" --component=enrol_sis --name=dryrun --set=1 >/dev/null
  "$PHP" "${STAGE_APP}/admin/cli/scheduled_task.php" --disable="$TASK" >/dev/null
  "$PHP" "${STAGE_APP}/admin/cli/purge_caches.php" >/dev/null
  local base_url secret dryrun
  base_url=$("$PHP" "${STAGE_APP}/admin/cli/cfg.php" --component=enrol_sis --name=sisbaseurl 2>/dev/null || true)
  secret=$("$PHP" "${STAGE_APP}/admin/cli/cfg.php" --component=enrol_sis --name=provisioningsecret 2>/dev/null || true)
  dryrun=$("$PHP" "${STAGE_APP}/admin/cli/cfg.php" --component=enrol_sis --name=dryrun 2>/dev/null || true)
  [[ -z "$base_url" && -z "$secret" && "$dryrun" == 1 ]] || fail "staging SIS settings did not end in a safe state"
}

preflight() {
  validate_paths
  validate_stage
  local stage_bytes source_bytes stage_db_bytes source_db_bytes free_bytes need_bytes
  stage_bytes=$(( $(du -sb "$STAGE_APP" "$STAGE_DATA" | awk '{sum += $1} END {print sum}') ))
  source_bytes=$(( $(du -sb "$SOURCE_APP" "$SOURCE_DATA" | awk '{sum += $1} END {print sum}') ))
  stage_db_bytes=$(database_size "${STAGE_APP}/config.php")
  source_db_bytes=$(database_size "${SOURCE_APP}/config.php")
  free_bytes=$(df -PB1 "$STAGE_HOME" | awk 'NR==2 {print $4}')
  need_bytes=$((stage_bytes + source_bytes + stage_db_bytes + source_db_bytes + 1073741824))
  printf 'status=ready\nphp=%s\nlive_database_bytes=%s\nstage_database_bytes=%s\nlive_app_data_bytes=%s\nstage_app_data_bytes=%s\nfree_bytes=%s\nrequired_free_bytes=%s\n' \
    "$("$PHP" -r 'echo PHP_VERSION;')" "$source_db_bytes" "$stage_db_bytes" "$source_bytes" "$stage_bytes" "$free_bytes" "$need_bytes"
  (( free_bytes >= need_bytes )) || fail "insufficient disk space for a rollback snapshot and refresh"
}

refresh() {
  local mode=$1 temp_dir snapshot source_config stage_config source_db stage_db source_cnf stage_cnf source_dump
  [[ "$mode" == --apply || "$mode" == --dry-run ]] || fail "refresh requires --dry-run or --apply"
  preflight
  [[ "$mode" == --apply ]] || return 0
  STAGING_TEMP_DIR=$(mktemp -d /tmp/moodle-stage-refresh.XXXXXX)
  temp_dir=$STAGING_TEMP_DIR
  chmod 0700 "$temp_dir"
  trap cleanup_temp_dir EXIT
  source_config=$(read_site_config "${SOURCE_APP}/config.php")
  stage_config=$(read_site_config "${STAGE_APP}/config.php")
  source_db=$(sed -n '2p' <<<"$source_config")
  stage_db=$(sed -n '2p' <<<"$stage_config")
  write_db_options "${SOURCE_APP}/config.php" "$temp_dir/source.cnf"
  write_db_options "${STAGE_APP}/config.php" "$temp_dir/stage.cnf"
  source_cnf="$temp_dir/source.cnf"
  stage_cnf="$temp_dir/stage.cnf"
  make_private_dir "$BACKUP_ROOT"
  snapshot="${BACKUP_ROOT}/stage-$(date -u +%Y%m%dT%H%M%SZ)"
  [[ ! -e "$snapshot" ]] || fail "snapshot path already exists"
  make_private_dir "$snapshot"
  snapshot_current_stage "$snapshot" "$stage_db" "$stage_cnf"
  source_dump="$temp_dir/source-database.sql.gz"
  mariadb-dump --defaults-extra-file="$source_cnf" --single-transaction --quick --hex-blob --add-drop-table "$source_db" | gzip -1 > "$source_dump"
  gzip -t "$source_dump" || fail "live database export failed verification"
  rsync -a --delete --delete-excluded --numeric-ids --chown=stage8567:stage8567www \
    --exclude='/sessions/***' --exclude='/cache/***' --exclude='/localcache/***' --exclude='/temp/***' --exclude='/muc/***' --exclude='/trashdir/***' \
    --exclude='/antivirus_quarantine/***' "${SOURCE_DATA}/" "${STAGE_DATA}/"
  gzip -dc "$source_dump" | mariadb --defaults-extra-file="$stage_cnf" "$stage_db"
  "$PHP" "${STAGE_APP}/admin/cli/upgrade.php" --non-interactive
  sanitize_staging
  chown -R stage8567:stage8567www "$STAGE_APP" "$STAGE_DATA"
  printf '[moodle-stage] refresh complete; backup=%s; SIS target is unset; Dry run=1; SIS scheduled task disabled\n' "$snapshot"
}

promote_preflight() {
  validate_paths
  validate_stage
  local stage_version production_version stage_bytes production_bytes production_db_bytes free_bytes needed_bytes
  stage_version=$(moodle_version "$STAGE_APP/version.php")
  production_version=$(moodle_version "$SOURCE_APP/version.php")
  [[ "$stage_version" =~ ^[0-9]+$ && "$production_version" =~ ^[0-9]+$ ]] || fail "could not read Moodle release versions"
  (( stage_version >= production_version )) || fail "staging Moodle core version is older than production"
  production_db_bytes=$(database_size "$SOURCE_APP/config.php")
  stage_bytes=$(du -sb "$STAGE_APP" | awk '{print $1}')
  production_bytes=$(du -sb "$SOURCE_APP" | awk '{print $1}')
  free_bytes=$(df -PB1 "$(dirname "$BACKUP_ROOT")" | awk 'NR==2 {print $4}')
  needed_bytes=$((production_bytes + stage_bytes + production_db_bytes + 1073741824))
  printf 'status=ready\nstaging_moodle_version=%s\nproduction_moodle_version=%s\nproduction_database_bytes=%s\nstaging_app_bytes=%s\nproduction_app_bytes=%s\nfree_bytes=%s\nrequired_free_bytes=%s\nproduction_target=https://moodle.eagles.edu.vn\n' \
    "$stage_version" "$production_version" "$production_db_bytes" "$stage_bytes" "$production_bytes" "$free_bytes" "$needed_bytes"
  (( free_bytes >= needed_bytes )) || fail "insufficient disk space for production code and database rollback snapshot"
}

promote() {
  local mode=$1 temp_dir production_config stage_config production_db production_cnf snapshot owner_group
  [[ "$mode" == --apply || "$mode" == --dry-run ]] || fail "promote requires --dry-run or --apply"
  promote_preflight
  [[ "$mode" == --apply ]] || return 0
  STAGING_TEMP_DIR=$(mktemp -d /tmp/moodle-stage-promote.XXXXXX)
  temp_dir=$STAGING_TEMP_DIR
  chmod 0700 "$temp_dir"
  trap cleanup_temp_dir EXIT
  production_config=$(read_site_config "$SOURCE_APP/config.php")
  stage_config=$(read_site_config "$STAGE_APP/config.php")
  production_db=$(sed -n '2p' <<<"$production_config")
  [[ "$production_db" != "$(sed -n '2p' <<<"$stage_config")" ]] || fail "production and staging databases are not isolated"
  write_db_options "$SOURCE_APP/config.php" "$temp_dir/production.cnf"
  production_cnf="$temp_dir/production.cnf"
  make_private_dir "$BACKUP_ROOT"
  snapshot="$BACKUP_ROOT/production-before-promote-$(date -u +%Y%m%dT%H%M%SZ)"
  [[ ! -e "$snapshot" ]] || fail "production snapshot path already exists"
  make_private_dir "$snapshot"
  tar -czf "$snapshot/application.tar.gz" -C "$SOURCE_APP" .
  mariadb-dump --defaults-extra-file="$production_cnf" --single-transaction --quick --hex-blob --add-drop-table "$production_db" | gzip -1 > "$snapshot/database.sql.gz"
  tar -tzf "$snapshot/application.tar.gz" >/dev/null || fail "production application snapshot failed verification"
  gzip -t "$snapshot/database.sql.gz" || fail "production database snapshot failed verification"
  printf 'snapshot_time=%s\nsource=https://staged.eagles.edu.vn\ntarget=https://moodle.eagles.edu.vn\nstaging_release=%s\nproduction_release=%s\nproduction_database=%s\nproduction_config=%s/config.php\n' \
    "$(date -Is)" "$(moodle_version "$STAGE_APP/version.php")" "$(moodle_version "$SOURCE_APP/version.php")" "$production_db" "$SOURCE_APP" > "$snapshot/manifest.txt"
  chmod 0600 "$snapshot/application.tar.gz" "$snapshot/database.sql.gz" "$snapshot/manifest.txt"
  owner_group=$(stat -c '%U:%G' "$SOURCE_APP")
  "$PHP" "$SOURCE_APP/admin/cli/maintenance.php" --enable
  rsync -a --delete --numeric-ids --chown="$owner_group" --exclude='/config.php' "$STAGE_APP/" "$SOURCE_APP/"
  "$PHP" "$SOURCE_APP/admin/cli/upgrade.php" --non-interactive
  "$PHP" "$SOURCE_APP/admin/cli/purge_caches.php"
  "$PHP" "$SOURCE_APP/admin/cli/maintenance.php" --disable
  curl --fail --silent --show-error --output /dev/null --write-out 'production_http=%{http_code}\n' https://moodle.eagles.edu.vn/
  printf '[moodle-stage] promotion complete; production database and moodledata were preserved; rollback snapshot=%s\n' "$snapshot"
}

rollback_production() {
  local snapshot=$1 mode=$2 resolved temp_dir config database cnf owner_group rollback_snapshot
  [[ "$mode" == --apply || "$mode" == --dry-run ]] || fail "rollback-production requires --dry-run or --apply"
  resolved=$(realpath -e "$snapshot") || fail "production snapshot path does not exist"
  [[ "$resolved" == "$BACKUP_ROOT"/production-before-promote-* ]] || fail "snapshot is not a production promotion snapshot"
  [[ -f "$resolved/manifest.txt" && -f "$resolved/application.tar.gz" && -f "$resolved/database.sql.gz" ]] || fail "production snapshot is incomplete"
  grep -Fxq 'target=https://moodle.eagles.edu.vn' "$resolved/manifest.txt" || fail "snapshot manifest does not identify production"
  tar -tzf "$resolved/application.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))' && fail "production application archive has unsafe paths"
  gzip -t "$resolved/database.sql.gz" || fail "production database archive failed verification"
  validate_paths
  config=$(read_site_config "$SOURCE_APP/config.php")
  database=$(sed -n '2p' <<<"$config")
  printf 'rollback_snapshot=%s\nrollback_target=https://moodle.eagles.edu.vn\nproduction_database=%s\n' "$resolved" "$database"
  [[ "$mode" == --apply ]] || return 0
  STAGING_TEMP_DIR=$(mktemp -d /tmp/moodle-production-rollback.XXXXXX)
  temp_dir=$STAGING_TEMP_DIR
  chmod 0700 "$temp_dir"
  trap cleanup_temp_dir EXIT
  write_db_options "$SOURCE_APP/config.php" "$temp_dir/production.cnf"
  cnf="$temp_dir/production.cnf"
  rollback_snapshot="$BACKUP_ROOT/production-before-rollback-$(date -u +%Y%m%dT%H%M%SZ)"
  make_private_dir "$rollback_snapshot"
  tar -czf "$rollback_snapshot/application.tar.gz" -C "$SOURCE_APP" .
  mariadb-dump --defaults-extra-file="$cnf" --single-transaction --quick --hex-blob --add-drop-table "$database" | gzip -1 > "$rollback_snapshot/database.sql.gz"
  tar -tzf "$rollback_snapshot/application.tar.gz" >/dev/null || fail "current production application snapshot failed verification"
  gzip -t "$rollback_snapshot/database.sql.gz" || fail "current production database snapshot failed verification"
  printf 'snapshot_time=%s\ntarget=https://moodle.eagles.edu.vn\nproduction_database=%s\n' "$(date -Is)" "$database" > "$rollback_snapshot/manifest.txt"
  chmod 0600 "$rollback_snapshot/application.tar.gz" "$rollback_snapshot/database.sql.gz" "$rollback_snapshot/manifest.txt"
  owner_group=$(stat -c '%U:%G' "$SOURCE_APP")
  mkdir "$temp_dir/restored-app"
  tar -xzf "$resolved/application.tar.gz" -C "$temp_dir/restored-app"
  "$PHP" "$SOURCE_APP/admin/cli/maintenance.php" --enable
  rsync -a --delete --numeric-ids --chown="$owner_group" "$temp_dir/restored-app/" "$SOURCE_APP/"
  gzip -dc "$resolved/database.sql.gz" | mariadb --defaults-extra-file="$cnf" "$database"
  "$PHP" "$SOURCE_APP/admin/cli/maintenance.php" --disable
  curl --fail --silent --show-error --output /dev/null --write-out 'production_http=%{http_code}\n' https://moodle.eagles.edu.vn/
  printf '[moodle-stage] production rollback complete; pre-rollback snapshot=%s\n' "$rollback_snapshot"
}

restore_snapshot() {
  local snapshot=$1 mode=$2 temp_dir current_snapshot stage_config stage_db stage_cnf
  [[ "$mode" == --apply || "$mode" == --dry-run ]] || fail "restore requires --dry-run or --apply"
  local resolved
  resolved=$(realpath -e "$snapshot") || fail "snapshot path does not exist"
  [[ "$resolved" == "$BACKUP_ROOT"/* ]] || fail "snapshot must be inside ${BACKUP_ROOT}"
  [[ -f "$resolved/manifest.txt" && -d "$resolved/app" && -d "$resolved/moodledata" && -f "$resolved/database.sql.gz" ]] || fail "snapshot is incomplete"
  validate_paths
  validate_stage
  printf 'restore_snapshot=%s\nrestore_target=https://staged.eagles.edu.vn\n' "$resolved"
  [[ "$mode" == --apply ]] || return 0
  STAGING_TEMP_DIR=$(mktemp -d /tmp/moodle-stage-restore.XXXXXX)
  temp_dir=$STAGING_TEMP_DIR
  chmod 0700 "$temp_dir"
  trap cleanup_temp_dir EXIT
  stage_config=$(read_site_config "${STAGE_APP}/config.php")
  stage_db=$(sed -n '2p' <<<"$stage_config")
  write_db_options "${STAGE_APP}/config.php" "$temp_dir/stage.cnf"
  stage_cnf="$temp_dir/stage.cnf"
  current_snapshot="${BACKUP_ROOT}/before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  make_private_dir "$current_snapshot"
  snapshot_current_stage "$current_snapshot" "$stage_db" "$stage_cnf"
  rsync -a --delete --numeric-ids --chown=stage8567:stage8567www "$resolved/app/" "${STAGE_APP}/"
  rsync -a --delete --numeric-ids --chown=stage8567:stage8567www "$resolved/moodledata/" "${STAGE_DATA}/"
  gzip -dc "$resolved/database.sql.gz" | mariadb --defaults-extra-file="$stage_cnf" "$stage_db"
  sanitize_staging
  chown -R stage8567:stage8567www "$STAGE_APP" "$STAGE_DATA"
  printf '[moodle-stage] restore complete; current pre-restore snapshot=%s; SIS target is unset; Dry run=1\n' "$current_snapshot"
}

status() {
  validate_paths
  validate_stage
  local base_url secret dryrun task_status
  base_url=$("$PHP" "${STAGE_APP}/admin/cli/cfg.php" --component=enrol_sis --name=sisbaseurl 2>/dev/null || true)
  secret=$("$PHP" "${STAGE_APP}/admin/cli/cfg.php" --component=enrol_sis --name=provisioningsecret 2>/dev/null || true)
  dryrun=$("$PHP" "${STAGE_APP}/admin/cli/cfg.php" --component=enrol_sis --name=dryrun 2>/dev/null || true)
  task_status=$("$PHP" "${STAGE_APP}/admin/cli/scheduled_task.php" --list 2>/dev/null | grep -F -- "$TASK" || true)
  [[ -n "$task_status" ]] || task_status=task_not_listed
  printf 'live_database=%s\nstage_database=%s\nstage_noemailever=1\nstage_php_version=8.3\nstage_sis_url_configured=%s\nstage_sis_secret_configured=%s\nstage_dryrun=%s\n' \
    "$(sed -n '2p' < <(read_site_config "${SOURCE_APP}/config.php"))" \
    "$(sed -n '2p' < <(read_site_config "${STAGE_APP}/config.php"))" \
    "$([[ -n "$base_url" ]] && echo yes || echo no)" "$([[ -n "$secret" ]] && echo yes || echo no)" "$dryrun"
  printf 'sis_task=%s\n' "$(sed -E 's/[[:space:]]+/ /g' <<<"$task_status")"
}

main() {
  [[ $# -ge 1 ]] || { usage; exit 2; }
  need_root
  need_commands
  case "$1" in
    status)
      [[ $# -eq 1 ]] || fail "status takes no extra arguments"
      status
      ;;
    refresh-data)
      [[ $# -eq 2 ]] || fail "refresh-data needs --dry-run or --apply"
      refresh "$2"
      ;;
    promote)
      [[ $# -eq 2 ]] || fail "promote needs --dry-run or --apply"
      promote "$2"
      ;;
    rollback-production)
      [[ $# -eq 3 ]] || fail "rollback-production needs a snapshot path and --dry-run or --apply"
      rollback_production "$2" "$3"
      ;;
    restore)
      [[ $# -eq 3 ]] || fail "restore needs a snapshot path and --dry-run or --apply"
      restore_snapshot "$2" "$3"
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      usage >&2
      fail "unknown command: $1"
      ;;
  esac
}

main "$@"
