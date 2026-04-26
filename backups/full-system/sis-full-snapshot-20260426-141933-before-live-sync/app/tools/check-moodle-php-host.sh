#!/usr/bin/env bash
set -euo pipefail

MOODLE_ROOT="${MOODLE_ROOT:-/home/moodle.eagles.edu.vn/app}"
EXPECTED_PHP_BIN="${EXPECTED_PHP_BIN:-/usr/local/lsws/lsphp82/bin/php8.2}"
CRON_WRAPPER="${CRON_WRAPPER:-/home/moodle.eagles.edu.vn/bin/cron-with-lock.sh}"
UPDATE_SCRIPT="${UPDATE_SCRIPT:-/home/moodle.eagles.edu.vn/bin/update-moodle.sh}"
CHECK_MODE="${CHECK_MODE:-moodle-local}"
PHP_CMD="${PHP_CMD:-$(command -v php || true)}"
PHP82_CMD="${PHP82_CMD:-$(command -v php8.2 || true)}"
MOODLE_CLI_PATH="${MOODLE_CLI_PATH:-}"

resolve_path() {
  local target="$1"
  if [[ -z "${target}" ]]; then
    return 1
  fi
  if command -v realpath >/dev/null 2>&1; then
    realpath -e "${target}"
    return
  fi
  readlink -f "${target}"
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

print_fix() {
  local label="$1"
  local command_text="$2"
  echo "fix ${label}:"
  echo "  ${command_text}"
}

read_moodle_cfg() {
  if [[ "$(id -un)" == "www-data" ]]; then
    "${EXPECTED_REAL}" "${MOODLE_ROOT}/admin/cli/cfg.php" --name=pathtophp --no-eol
    return
  fi
  if sudo -n -u www-data true >/dev/null 2>&1; then
    sudo -u www-data "${EXPECTED_REAL}" "${MOODLE_ROOT}/admin/cli/cfg.php" --name=pathtophp --no-eol
    return
  fi
  "${EXPECTED_REAL}" "${MOODLE_ROOT}/admin/cli/cfg.php" --name=pathtophp --no-eol
}

extract_php_bin_default() {
  local file_path="$1"
  local raw=""

  raw="$(sed -n 's/^PHP_BIN=//p' "${file_path}" | head -n 1)"
  raw="${raw#\"}"
  raw="${raw%\"}"

  case "${raw}" in
    "\${PHP_BIN:-"*"}")
      raw="${raw#\$\{PHP_BIN:-}"
      raw="${raw%\}}"
      ;;
  esac

  printf '%s\n' "${raw}"
}

[[ -x "${EXPECTED_PHP_BIN}" ]] || fail "Expected PHP binary is not executable: ${EXPECTED_PHP_BIN}"
EXPECTED_REAL="$(resolve_path "${EXPECTED_PHP_BIN}")"

[[ -f "${MOODLE_ROOT}/admin/cli/cfg.php" ]] || fail "Moodle CLI config script not found at ${MOODLE_ROOT}/admin/cli/cfg.php"
[[ -r "${MOODLE_ROOT}/admin/cli/cfg.php" ]] || fail "Moodle CLI config script is not readable at ${MOODLE_ROOT}/admin/cli/cfg.php"

if [[ -z "${MOODLE_CLI_PATH}" ]]; then
  MOODLE_CLI_PATH="$(read_moodle_cfg)"
fi

[[ -n "${MOODLE_CLI_PATH}" ]] || fail "Moodle pathtophp is empty"
[[ -x "${MOODLE_CLI_PATH}" ]] || fail "Moodle pathtophp is not executable: ${MOODLE_CLI_PATH}"
MOODLE_REAL="$(resolve_path "${MOODLE_CLI_PATH}")"

echo "expected php: ${EXPECTED_PHP_BIN} -> ${EXPECTED_REAL}"
echo "moodle pathtophp: ${MOODLE_CLI_PATH} -> ${MOODLE_REAL}"

status=0

if [[ "${MOODLE_REAL}" != "${EXPECTED_REAL}" ]]; then
  echo "moodle pathtophp mismatch: ${MOODLE_REAL} != ${EXPECTED_REAL}" >&2
  print_fix "moodle pathtophp" "${EXPECTED_REAL} ${MOODLE_ROOT}/admin/cli/cfg.php --name=pathtophp --set=${EXPECTED_REAL}"
  status=1
fi

if [[ -f "${CRON_WRAPPER}" ]]; then
  CRON_PHP_BIN="$(extract_php_bin_default "${CRON_WRAPPER}")"
  [[ -n "${CRON_PHP_BIN}" ]] || fail "Could not parse PHP_BIN from ${CRON_WRAPPER}"
  [[ -x "${CRON_PHP_BIN}" ]] || fail "Cron wrapper PHP_BIN is not executable: ${CRON_PHP_BIN}"
  CRON_REAL="$(resolve_path "${CRON_PHP_BIN}")"
  echo "cron wrapper php: ${CRON_PHP_BIN} -> ${CRON_REAL}"
  if [[ "${CRON_REAL}" != "${EXPECTED_REAL}" ]]; then
    echo "cron wrapper mismatch: ${CRON_REAL} != ${EXPECTED_REAL}" >&2
    print_fix "cron wrapper" "sudo sed -i 's|^PHP_BIN=.*|PHP_BIN=${EXPECTED_REAL}|' ${CRON_WRAPPER}"
    status=1
  fi
fi

if [[ -f "${UPDATE_SCRIPT}" ]]; then
  UPDATE_PHP_BIN="$(extract_php_bin_default "${UPDATE_SCRIPT}")"
  [[ -n "${UPDATE_PHP_BIN}" ]] || fail "Could not parse PHP_BIN from ${UPDATE_SCRIPT}"
  [[ -x "${UPDATE_PHP_BIN}" ]] || fail "Update script PHP_BIN is not executable: ${UPDATE_PHP_BIN}"
  UPDATE_REAL="$(resolve_path "${UPDATE_PHP_BIN}")"
  echo "update script php: ${UPDATE_PHP_BIN} -> ${UPDATE_REAL}"
  if [[ "${UPDATE_REAL}" != "${EXPECTED_REAL}" ]]; then
    echo "update script mismatch: ${UPDATE_REAL} != ${EXPECTED_REAL}" >&2
    print_fix "update script" "sudo sed -i 's|^PHP_BIN=.*|PHP_BIN=\"\${PHP_BIN:-${EXPECTED_REAL}}\"|' ${UPDATE_SCRIPT}"
    status=1
  fi
fi

if [[ "${CHECK_MODE}" == "strict-host" ]]; then
  if [[ -n "${PHP82_CMD}" ]]; then
    PHP82_REAL="$(resolve_path "${PHP82_CMD}")"
    echo "php8.2: ${PHP82_CMD} -> ${PHP82_REAL}"
    if [[ "${PHP82_REAL}" != "${EXPECTED_REAL}" ]]; then
      echo "php8.2 mismatch: ${PHP82_REAL} != ${EXPECTED_REAL}" >&2
      print_fix "php8.2" "sudo ln -sf ${EXPECTED_REAL} /usr/local/bin/php8.2"
      status=1
    fi
  else
    echo "php8.2 missing from PATH" >&2
    print_fix "php8.2" "sudo ln -sf ${EXPECTED_REAL} /usr/local/bin/php8.2"
    status=1
  fi

  if [[ -n "${PHP_CMD}" ]]; then
    PHP_REAL="$(resolve_path "${PHP_CMD}")"
    echo "php: ${PHP_CMD} -> ${PHP_REAL}"
    if [[ "${PHP_REAL}" != "${EXPECTED_REAL}" ]]; then
      echo "php mismatch: ${PHP_REAL} != ${EXPECTED_REAL}" >&2
      print_fix "php" "sudo update-alternatives --set php ${EXPECTED_REAL}"
      status=1
    fi
  else
    echo "php missing from PATH" >&2
    print_fix "php" "sudo update-alternatives --set php ${EXPECTED_REAL}"
    status=1
  fi
fi

if [[ "${status}" -eq 0 ]]; then
  echo "OK: Moodle-local PHP selectors resolve to ${EXPECTED_REAL}"
  exit 0
fi

if [[ "${CHECK_MODE}" != "strict-host" ]]; then
  echo "Host-wide php was not checked. Run with CHECK_MODE=strict-host to validate PATH selectors too." >&2
fi

exit 1
