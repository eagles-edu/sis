import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const rootDir = process.cwd()
const enrollmentJs = fs.readFileSync(
  path.resolve(rootDir, "web-asset/admin/student-enrollment.js"),
  "utf8",
)

test("student enrollment page ships as a standalone portal surface", () => {
  const htmlDocument = fs.readFileSync(
    path.resolve(rootDir, "web-asset/admin/student-enrollment.html"),
    "utf8",
  )
  const html = `${htmlDocument}\n${enrollmentJs}`

  assert.match(html, /portal-theme\.min\.css/)
  assert.match(html, /class="header-bar[^"]*"/)
  assert.match(html, /<h1>THE EAGLES CLUB<\/h1>/i)
  assert.match(html, /id="studentThemeToggle"/)
  assert.match(html, /<div class="text-zoom-controls"[^>]*role="toolbar"[^>]*aria-label="Global text size controls"/i)
  assert.match(html, /class="hub-footer"/)
  assert.match(html, /id="floatingMenuBtn"/)
  assert.match(html, /id="appSidebarNav"/)
  assert.match(html, /<main id="appMain" class="section-stack" aria-label="Enrollment workspace">/)
  assert.match(html, /<section class="content topbar" data-surface-role="content">/)
  assert.match(html, /<section class="content" aria-label="Enrollment summary" data-surface-role="content">[\s\S]*?<article class="portal-theme-card enrollment-summary-card panel" data-surface-role="panel">/)
  assert.match(html, /<section class="content" aria-label="Enrollment filters" data-surface-role="content">/)
  assert.match(html, /<section class="content" aria-label="Enrollment roster" data-surface-role="content">/)
  assert.match(html, /<div class="table-wrap data-surface" data-surface-role="data-surface">/)
  assert.match(html, /<section class="enrollment-history-modal__panel content" aria-label="History details" data-surface-role="content">/)
  assert.match(html, /<div id="enrollmentHistoryModalBody" class="enrollment-history-modal__list panel" data-surface-role="panel"><\/div>/)
  assert.match(html, /<article class="enrollment-history-period portal-theme-card card" data-surface-role="card">/)
  assert.match(html, /id="includeUnenrolled"/)
  assert.match(html, /id="enrollmentRows"/)
  assert.match(html, /id="sessionRequiredPanel"/)
  assert.match(html, /id="enrollmentHistoryModal"/)
  assert.match(html, /data-history-toggle/)
  assert.match(html, /data-history-open/)
  assert.match(html, /⋮/)
  assert.doesNotMatch(html, /1 note|HX notes/i)
  assert.doesNotMatch(html, /th scope="col">Same-year history<\/th>/)
  assert.doesNotMatch(html, /id="loginBtn"/)
  assert.match(`${html}\n${enrollmentJs}`, /\/api\/admin\/students\/\$\{encodeURIComponent\(row\.id\)\}\/enrollment/)
})
