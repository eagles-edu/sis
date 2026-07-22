import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

function readPortal(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8")
}

function readPortalAssets(htmlPath, jsPath) {
  return `${readPortal(htmlPath)}\n${readPortal(jsPath)}`
}

function assertButtonContract(html, { id, className, type }) {
  const typeAssertion = type ? `(?=[^>]*\\btype="${type}")` : ""
  const pattern = new RegExp(
    `<button\\b(?=[^>]*\\bid="${id}")(?=[^>]*\\bclass="${className}")${typeAssertion}[^>]*>`,
    "s",
  )
  assert.match(html, pattern)
}

test("student and parent portals use the shared semantic button contract", () => {
  const studentHtml = readPortalAssets("web-asset/student/student-portal.html", "web-asset/student/student-portal.js")
  const parentHtml = readPortalAssets("web-asset/parent/parent-portal.html", "web-asset/parent/parent-portal.js")
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
  assert.match(studentHtml, /id="closePastDueHomeworkModalBtn" class="portal-modal-close portal-button portal-button-warning"/)
  assert.match(studentHtml, /id="closeNewsComplianceModalBtn" class="portal-modal-close portal-button portal-button-warning"/)
  assert.match(studentHtml, /id="newsComplianceModalCloseActionBtn" type="button" class="portal-button portal-button-warning"/)
  assert.match(studentHtml, /id="closeReportAccessErrorModalBtn" class="portal-modal-close portal-button portal-button-warning"/)
  assert.match(studentHtml, /id="closeSubmitSuccessModalBtn" class="portal-modal-close portal-button portal-button-warning"/)
  assert.match(studentHtml, /id="closeNewsWeekSetModalBtn" class="portal-modal-close portal-button portal-button-warning hidden"/)
  assert.match(studentHtml, /id="newsWeekSetModalCloseActionBtn" type="button" class="portal-button portal-button-warning"/)
  assert.match(studentHtml, /class="header-action-btn portal-button portal-button-alt" type="button" data-header-action="hide"/)

  assertButtonContract(parentHtml, { id: "parentNavLogoutBtn", className: "portal-button portal-button-danger", type: "button" })
  assertButtonContract(parentHtml, { id: "parentMenuBtn", className: "floating-menu-btn portal-button portal-button-immutable-chrome" })
  assertButtonContract(parentHtml, { id: "studentThemeToggle", className: "portal-theme-toggle portal-button portal-button-immutable-chrome" })
  assertButtonContract(parentHtml, { id: "studentTextZoomResetBtn", className: "portal-button portal-button-warning", type: "button" })
  assertButtonContract(parentHtml, { id: "saveDraftBtn", className: "portal-button portal-button-affirm", type: "button" })
  assertButtonContract(parentHtml, { id: "submitReviewBtn", className: "portal-button portal-button-primary", type: "button" })
  assertButtonContract(parentHtml, { id: "openChildPageBtn", className: "portal-button portal-button-primary", type: "button" })
  assert.match(
    parentHtml,
    /id="openChildPageBtn"[\s\S]*?title="Mở hồ sơ học sinh để xem và cập nhật thông tin"[\s\S]*?aria-label="Mở hồ sơ học sinh để xem và cập nhật thông tin"/,
  )
  assert.match(
    parentHtml,
    /id="reloadBtn"[\s\S]*?title="Tải lại thông tin học sinh và số liệu mới nhất"[\s\S]*?aria-label="Tải lại thông tin học sinh và số liệu mới nhất"/,
  )
  assert.match(
    parentHtml,
    /id="logoutBtn"[\s\S]*?title="Đăng xuất khỏi cổng phụ huynh"[\s\S]*?aria-label="Đăng xuất khỏi cổng phụ huynh"/,
  )
  assertButtonContract(parentHtml, { id: "closePastDueHomeworkModalBtn", className: "portal-modal-close portal-button portal-button-warning" })
  assertButtonContract(parentHtml, { id: "closeNewsWeekSetModalBtn", className: "portal-modal-close portal-button portal-button-warning" })
  assertButtonContract(parentHtml, { id: "newsWeekSetModalCloseActionBtn", className: "portal-button portal-button-warning", type: "button" })
  assertButtonContract(parentHtml, { id: "closePerformanceReportModalBtn", className: "portal-modal-close portal-button portal-button-warning" })
  assertButtonContract(parentHtml, { id: "closeReportAccessErrorModalBtn", className: "portal-modal-close portal-button portal-button-warning" })
  assertButtonContract(parentHtml, { id: "logoutBtn", className: "portal-button portal-button-danger", type: "button" })
  assert.match(parentHtml, /class="header-action-btn portal-button portal-button-alt" type="button" data-header-action="hide"/)

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
  const adminHubHtml = readPortal("web-asset/admin/portal-hub.html")
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

  assertButtonContract(adminHtml, { id: "loginBtn", className: "portal-button portal-button-primary", type: "submit" })
  assertButtonContract(adminHtml, { id: "loginClearBtn", className: "portal-button portal-button-warning", type: "button" })
  assertButtonContract(adminHtml, { id: "floatingMenuBtn", className: "floating-menu-btn portal-button portal-button-immutable-chrome", type: "button" })
  assertButtonContract(adminHtml, { id: "menuToggleBtn", className: "menu-toggle-btn app-header-menu-toggle portal-button portal-button-immutable-chrome", type: "button" })
  assertButtonContract(adminHtml, { id: "studentThemeToggle", className: "portal-theme-toggle portal-button portal-button-immutable-chrome" })
  assertButtonContract(adminHtml, { id: "studentTextZoomResetBtn", className: "portal-button portal-button-warning", type: "button" })
  assertButtonContract(adminHtml, { id: "queueHubSaveOrderBtn", className: "portal-button portal-button-affirm", type: "button" })
  assertButtonContract(adminHtml, { id: "parentQueueCloseBtn", className: "portal-button portal-button-warning", type: "button" })
  assertButtonContract(adminHtml, { id: "newsReviewViewerCloseBtn", className: "portal-button portal-button-warning", type: "button" })
  assertButtonContract(adminHtml, { id: "gradeChartModalCloseBtn", className: "portal-button portal-button-warning", type: "button" })
  assert.match(adminHtml, /class="portal-button portal-button-info pt-score-legend-btn"/)
  assert.match(adminHubHtml, /hub-prefooter__link portal-button portal-button-alt/)
  assert.match(adminHubHtml, /href="mailto:admin@eagles.edu.vn"/)
  assert.match(adminHubHtml, /href="\/admin"/)

  assert.match(adminJs, /className = "portal-button portal-button-primary system-health-action-btn"/)
  assert.match(adminJs, /class="queue-row-btn portal-button portal-button-info portal-button-open-week-set"/)
  assert.match(adminJs, /class="portal-button portal-button-affirm" data-user-edit=/)
  assert.match(adminJs, /class="portal-button portal-button-info top-search-open-btn"/)

  assert.match(adminRoutes, /class="portal-button portal-button-primary" href=/)
})
