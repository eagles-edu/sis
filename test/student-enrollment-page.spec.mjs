import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const rootDir = process.cwd()

test("student enrollment page ships as a standalone portal surface", () => {
  const html = fs.readFileSync(
    path.resolve(rootDir, "web-asset/admin/student-enrollment.html"),
    "utf8",
  )

  assert.match(html, /portal-theme\.min\.css/)
  assert.match(html, /class="header-bar"/)
  assert.match(html, /id="appSchoolName"/)
  assert.match(html, /id="adminThemeToggle"/)
  assert.match(html, /id="globalTextZoomControls"/)
  assert.match(html, /class="hub-footer"/)
  assert.match(html, /id="floatingMenuBtn"/)
  assert.match(html, /id="appSidebarNav"/)
  assert.match(html, /id="includeUnenrolled"/)
  assert.match(html, /id="enrollmentRows"/)
  assert.match(html, /id="sessionRequiredPanel"/)
  assert.match(html, /id="enrollmentHistoryModal"/)
  assert.match(html, /data-history-toggle/)
  assert.match(html, /data-history-open/)
  assert.match(html, /⋮/)
  assert.doesNotMatch(html, /Notes|1 note|HX notes/)
  assert.doesNotMatch(html, /th scope="col">Same-year history<\/th>/)
  assert.doesNotMatch(html, /id="loginBtn"/)
  assert.match(html, /\/api\/admin\/students\/\$\{encodeURIComponent\(row\.id\)\}\/enrollment/)
})
