import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const scriptPath = path.resolve(process.cwd(), "tools/check-moodle-php-host.sh")
const packagePath = path.resolve(process.cwd(), "package.json")

const script = fs.readFileSync(scriptPath, "utf8")
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"))

test("moodle php host check validates Moodle-local PHP selectors by default", () => {
  assert.match(script, /EXPECTED_PHP_BIN="\$\{EXPECTED_PHP_BIN:-\/usr\/local\/lsws\/lsphp82\/bin\/php8\.2\}"/)
  assert.match(script, /CHECK_MODE="\$\{CHECK_MODE:-moodle-local\}"/)
  assert.match(script, /CRON_WRAPPER="\$\{CRON_WRAPPER:-\/home\/moodle\.eagles\.edu\.vn\/bin\/cron-with-lock\.sh\}"/)
  assert.match(script, /UPDATE_SCRIPT="\$\{UPDATE_SCRIPT:-\/home\/moodle\.eagles\.edu\.vn\/bin\/update-moodle\.sh\}"/)
  assert.match(script, /extract_php_bin_default\(\)/)
  assert.match(script, /admin\/cli\/cfg\.php/)
  assert.match(script, /--name=pathtophp/)
  assert.match(script, /--no-eol/)
  assert.match(script, /EXPECTED_REAL="\$\(resolve_path "\$\{EXPECTED_PHP_BIN\}"\)"/)
  assert.match(script, /MOODLE_REAL="\$\(resolve_path "\$\{MOODLE_CLI_PATH\}"\)"/)
  assert.match(script, /cron wrapper php:/)
  assert.match(script, /update script php:/)
  assert.match(script, /admin\/cli\/cfg\.php --name=pathtophp --set=\$\{EXPECTED_REAL\}/)
  assert.match(script, /CHECK_MODE=strict-host/)
  assert.match(script, /sudo ln -sf \$\{EXPECTED_REAL\} \/usr\/local\/bin\/php8\.2/)
  assert.match(script, /sudo update-alternatives --set php \$\{EXPECTED_REAL\}/)
  assert.match(packageJson.scripts["ops:moodle:php:check"], /bash tools\/check-moodle-php-host\.sh/)
})
