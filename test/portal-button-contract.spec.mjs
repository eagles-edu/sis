import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

function readPortal(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8")
}

test("student and parent portals use the shared semantic button contract", () => {
  const studentHtml = readPortal("web-asset/student/student-portal.html")
  const parentHtml = readPortal("web-asset/parent/parent-portal.html")
  const sharedTheme = readPortal("web-asset/shared/portal-theme.min.css")

  for (const html of [studentHtml, parentHtml]) {
    assert.doesNotMatch(html, /class="primary"/)
    assert.doesNotMatch(html, /class="alt"/)
    assert.doesNotMatch(html, /\bbtn-refresh\b/)
    assert.doesNotMatch(html, /portal-button-neutral-action/)
    assert.doesNotMatch(html, /portal-button-blue-action/)
    assert.doesNotMatch(html, /portal-button-red-action/)
    assert.doesNotMatch(html, /portal-button-green-action/)
    assert.doesNotMatch(html, /portal-button-purple-action/)
    assert.doesNotMatch(html, /\bportal-button-refresh\b/)
    assert.doesNotMatch(html, /\bportal-action-btn--utility\b/)
    assert.doesNotMatch(html, /portal-button-amber-info/)
    assert.match(html, /portal-button-immutable-chrome/)
    assert.match(html, /portal-button-teal-refresh/)
    assert.match(html, /portal-button-info portal-button-open-week-set/)
  }

  assert.match(studentHtml, /id="loginBtn" class="portal-button portal-button-primary"/)
  assert.match(studentHtml, /id="loginClearBtn" class="portal-button portal-button-warning"/)
  assert.match(studentHtml, /id="menuBtn" class="floating-menu-btn portal-button portal-button-immutable-chrome"/)
  assert.match(studentHtml, /class="portal-theme-toggle portal-button portal-button-immutable-chrome" id="studentThemeToggle"/)
  assert.match(studentHtml, /id="studentTextZoomResetBtn" type="button" class="portal-button portal-button-warning"/)
  assert.match(studentHtml, /id="newsQueueRefreshBtn" type="button" class="portal-button portal-button-teal-refresh"/)
  assert.match(studentHtml, /id="logoutBtn" type="button" class="portal-button portal-button-danger"/)
  assert.match(studentHtml, /class="header-action-btn portal-button portal-button-immutable-chrome plus"/)

  assert.match(parentHtml, /id="parentNavLogoutBtn" type="button" class="portal-button portal-button-danger"/)
  assert.match(parentHtml, /id="parentMenuBtn" class="floating-menu-btn portal-button portal-button-immutable-chrome"/)
  assert.match(parentHtml, /class="portal-theme-toggle portal-button portal-button-immutable-chrome" id="parentThemeToggle"/)
  assert.match(parentHtml, /id="parentTextZoomResetBtn" type="button" class="portal-button portal-button-warning"/)
  assert.match(parentHtml, /id="saveDraftBtn" type="button" class="portal-button portal-button-affirm"/)
  assert.match(parentHtml, /id="submitReviewBtn" type="button" class="portal-button portal-button-primary"/)
  assert.match(parentHtml, /id="openChildPageBtn" type="button" class="portal-button portal-button-primary"/)
  assert.match(parentHtml, /id="logoutBtn" type="button" class="portal-button portal-button-danger"/)
  assert.match(parentHtml, /class="header-action-btn portal-button portal-button-immutable-chrome plus"/)

  for (const semanticClass of [
    "portal-button-primary",
    "portal-button-danger",
    "portal-button-warning",
    "portal-button-affirm",
    "portal-button-alt",
    "portal-button-refresh",
    "portal-button-teal-refresh",
    "portal-button-info",
    "portal-button-immutable-chrome",
  ]) {
    assert.match(sharedTheme, new RegExp(`\\.${semanticClass}`))
  }

  assert.doesNotMatch(sharedTheme, /body\.student-portal-page button\.primary/)
  assert.doesNotMatch(sharedTheme, /body\.parent-portal-page button\.primary/)
  assert.doesNotMatch(sharedTheme, /body\.student-portal-page button\.alt/)
  assert.doesNotMatch(sharedTheme, /body\.parent-portal-page button\.alt/)
  assert.doesNotMatch(sharedTheme, /body\.student-portal-page button\.btn-refresh/)
  assert.doesNotMatch(sharedTheme, /body\.parent-portal-page button\.btn-refresh/)
  assert.doesNotMatch(sharedTheme, /body\.student-portal-page button\.portal-button-refresh/)
  assert.doesNotMatch(sharedTheme, /body\.parent-portal-page button\.portal-button-refresh/)
})

test("admin portal sources use the shared semantic button contract", () => {
  const adminHtml = readPortal("web-asset/admin/student-admin.html")
  const adminJs = readPortal("web-asset/admin/student-admin.js")
  const adminRoutes = readPortal("server/student-admin-routes.mjs")

  for (const source of [adminHtml, adminJs, adminRoutes]) {
    assert.doesNotMatch(source, /\bportal-action-btn--utility\b/)
    assert.doesNotMatch(source, /portal-button-neutral-action/)
    assert.doesNotMatch(source, /portal-button-blue-action/)
    assert.doesNotMatch(source, /portal-button-red-action/)
    assert.doesNotMatch(source, /portal-button-green-action/)
    assert.doesNotMatch(source, /portal-button-purple-action/)
    assert.doesNotMatch(source, /portal-button-refresh/)
    assert.doesNotMatch(source, /portal-button-amber-info/)
    assert.doesNotMatch(source, /\bbtn-refresh\b/)
    assert.doesNotMatch(source, /\bbtn-edit\b/)
    assert.doesNotMatch(source, /\bbtn-delete\b/)
  }

  assert.match(adminHtml, /id="loginBtn" type="submit" class="portal-button portal-button-primary"/)
  assert.match(adminHtml, /id="loginClearBtn" type="button" class="portal-button portal-button-warning"/)
  assert.match(adminHtml, /id="floatingMenuBtn" type="button" class="floating-menu-btn portal-button portal-button-immutable-chrome"/)
  assert.match(adminHtml, /id="menuToggleBtn" type="button" class="menu-toggle-btn app-header-menu-toggle portal-button portal-button-immutable-chrome"/)
  assert.match(adminHtml, /class="portal-theme-toggle portal-button portal-button-immutable-chrome" id="adminThemeToggle"/)
  assert.match(adminHtml, /id="globalTextZoomResetBtn" type="button" class="portal-button portal-button-warning"/)
  assert.match(adminHtml, /id="queueHubSaveOrderBtn" type="button" class="portal-button portal-button-primary"/)
  assert.match(adminHtml, /id="parentQueueCloseBtn" type="button" class="portal-button portal-button-warning"/)
  assert.match(adminHtml, /id="newsReviewViewerCloseBtn" type="button" class="portal-button portal-button-warning"/)
  assert.match(adminHtml, /id="gradeChartModalCloseBtn" type="button" class="portal-button portal-button-warning"/)
  assert.match(adminHtml, /class="portal-button portal-button-info pt-score-legend-btn"/)
  assert.match(adminHtml, /hub-prefooter__link portal-button portal-button-alt/)
  assert.match(adminHtml, /href="mailto:admin@eagles.edu.vn"/)
  assert.match(adminHtml, /href="\/admin"/)

  assert.match(adminJs, /className = "portal-button portal-button-primary system-health-action-btn"/)
  assert.match(adminJs, /class="queue-row-btn portal-button portal-button-info portal-button-open-week-set"/)
  assert.match(adminJs, /class="portal-button portal-button-affirm" data-user-edit=/)
  assert.match(adminJs, /class="portal-button portal-button-info top-search-open-btn"/)

  assert.match(adminRoutes, /class="portal-button portal-button-primary" href=/)
})
