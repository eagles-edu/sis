import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const ROUTE = fs.readFileSync(new URL("../config/nginx/test-moodle-provisioning.location.conf", import.meta.url), "utf8")
const INSTALLER = fs.readFileSync(new URL("../tools/install-test-moodle-provisioning-proxy.sh", import.meta.url), "utf8")

test("staged Moodle provisioning is proxied only to the test SIS API", () => {
  assert.match(ROUTE, /location \^~ \/api\/moodle\/provisioning\//u)
  assert.match(ROUTE, /proxy_pass http:\/\/sis_test_api_upstream;/u)
  assert.match(ROUTE, /sis-api-proxy-common\.conf/u)
  assert.doesNotMatch(ROUTE, /admin\.eagles\.edu\.vn|127\.0\.0\.1:8787/u)
})

test("test-only route installer is idempotent, backed up, and fail-closed on proxy verification", () => {
  assert.match(INSTALLER, /\/etc\/nginx\/sites-available\/test\.eagles\.edu\.vn\.conf/u)
  assert.match(INSTALLER, /server 127\.0\.0\.1:8786;/u)
  assert.match(INSTALLER, /-gt 1/u)
  assert.match(INSTALLER, /differs from the tracked route source/u)
  assert.match(INSTALLER, /test\.eagles\.edu\.vn\.conf\.BAK-before/u)
  assert.match(INSTALLER, /nginx -t/u)
  assert.match(INSTALLER, /systemctl reload nginx/u)
  assert.match(INSTALLER, /curl --noproxy '\*' --ipv4/u)
  assert.match(INSTALLER, /signed-route probe did not reach the test SIS API; original vhost restored/u)
  assert.doesNotMatch(INSTALLER, /sites-available\/admin\.eagles\.edu\.vn|8787/u)
})
