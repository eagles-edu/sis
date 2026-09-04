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
    "portal-button-btn-refresh",
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
    const sourceWithoutSharedRefreshClass = source.replaceAll("portal-button-btn-refresh", "")
    assert.doesNotMatch(source, /\bportal-action-btn--utility\b/)
    assert.doesNotMatch(source, /portal-button-neutral-action/)
    assert.doesNotMatch(source, /portal-button-blue-action/)
    assert.doesNotMatch(source, /portal-button-red-action/)
    assert.doesNotMatch(source, /portal-button-green-action/)
    assert.doesNotMatch(source, /portal-button-purple-action/)
    assert.doesNotMatch(source, /portal-button-refresh/)
    assert.doesNotMatch(source, /portal-button-amber-info/)
    assert.doesNotMatch(sourceWithoutSharedRefreshClass, /\bbtn-refresh\b/)
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

test("short portal button labels retain their full tooltip and accessible explanation", () => {
  const contracts = [
    ["web-asset/admin/student-admin.html", "levelReminderSendAllBtn", "Send All", "Send to All Listed"],
    ["web-asset/admin/student-admin.html", "overviewNewsQueueShowAllBtn", "Show Pending", "Show All Pending"],
    ["web-asset/admin/student-admin.html", "overviewNewsQueueOpenBtn", "News Reports", "Open News Reports Page"],
    ["web-asset/admin/student-admin.html", "overviewNewsQueueQueueHubBtn", "Queue Hub", "Open Queue Hub"],
    ["web-asset/admin/student-admin.html", "profileBackToInfoBtn", "Back", "Back to Info"],
    ["web-asset/admin/student-admin.html", "saveBtn", "Save", "Save / Update"],
    ["web-asset/admin/student-admin.html", "assignmentSortDirBtn", "Newest First", "Newest Due First"],
    ["web-asset/admin/student-admin.html", "pt_actionInsertBtn", "Insert", "Insert to Focused Field"],
    ["web-asset/admin/student-admin.html", "pt_saveBtn", "Save Report", "Save Performance Report"],
    ["web-asset/admin/student-admin.html", "openTabulatorGradesBtn", "Grades Admin", "Open Tabulator Grades Admin"],
    ["web-asset/admin/student-admin.html", "gradeSortDirBtn", "Latest First", "Latest Due First"],
    ["web-asset/admin/student-admin.html", "reportGenerateBtn", "Generate Report", "Generate from Grade Records"],
    ["web-asset/admin/student-admin.html", "reportCardBtn", "Download PDF", "Download PDF Report Card"],
    ["web-asset/admin/student-admin.html", "reportClearBtn", "Clear", "Clear Report Form"],
    ["web-asset/admin/student-admin.html", "schoolSetupSaveBtn", "Save Setup", "Save School Setup"],
    ["web-asset/admin/student-admin.html", "schoolSetupResetBtn", "Reload Setup", "Reload Saved Setup"],
    ["web-asset/admin/student-admin.html", "profileFieldLayoutApplyBtn", "Apply Layout", "Apply Layout Changes"],
    ["web-asset/admin/student-admin.html", "profileFieldLayoutResetBtn", "Reset Layout", "Reset Layout to Default"],
    ["web-asset/admin/student-admin.html", "attendanceLevelApplyBtn", "Apply Style", "Apply Global Style"],
    ["web-asset/admin/student-admin.html", "attendanceLevelResetBtn", "Reset Style", "Reset Level Style"],
    ["web-asset/admin/grades-tabulator.html", "tableModalBtn", "Table", "Open the full grade table in a separate view"],
    ["web-asset/admin/grades-tabulator.html", "toggleCompactBtn", "Dense: Off", "Switch between comfortable and dense table rows"],
    ["web-asset/parent/parent-portal.html", "openChildPageBtn", "Hồ sơ", "Mở hồ sơ học sinh để xem và cập nhật thông tin"],
    ["web-asset/parent/parent-portal.html", "openPastDueHomeworkModalBtn", "Quá hạn", "Xem danh sách bài tập về nhà quá hạn"],
    ["web-asset/parent/parent-portal.html", "openNewsQueueDetailBtn", "Chi tiết", "Mở chi tiết các báo cáo tin tức đang chờ xem"],
    ["web-asset/parent/parent-portal.html", "reportPastDueHomeworkPreviewBtn", "Xem quá hạn", "Xem danh sách bài tập về nhà quá hạn"],
    ["web-asset/student/student-portal.html", "newWordsAddOneBtn", "Add Word", "Thêm một mục từ vựng vào danh sách học tập"],
    ["web-asset/student/student-portal.html", "newWordsAddFiveBtn", "Add Words", "Thêm năm mục từ vựng vào danh sách học tập"],
    ["web-asset/student/student-portal.html", "newNewsFormBtn", "Mẫu mới", "Bắt đầu một biểu mẫu báo cáo tin tức mới"],
  ]

  for (const [file, id, shortLabel, fullLabel] of contracts) {
    const html = readPortal(file)
    const match = html.match(new RegExp(`<button\\b(?=[^>]*\\bid="${id}")[^>]*>([\\s\\S]*?)</button>`))
    assert.ok(match, `${file} missing ${id}`)
    const attrs = html.slice(match.index, match.index + match[0].indexOf(">") + 1)
    const visibleLabel = match[1].replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim()
    assert.equal(visibleLabel, shortLabel, `${id} visible label`)
    assert.match(attrs, new RegExp(`\\btitle="${fullLabel}"`), `${id} tooltip`)
    assert.match(attrs, new RegExp(`\\baria-label="${fullLabel}"`), `${id} aria-label`)
  }
})

test("shared buttons prohibit overflow-based label handling", () => {
  const sharedTheme = readPortal("web-asset/shared/portal-theme.css")
  const baseButton = sharedTheme.match(/\.portal-button\s*\{([\s\S]*?)\n\}/)?.[1] || ""
  assert.doesNotMatch(baseButton, /text-overflow\s*:/)
  assert.doesNotMatch(baseButton, /overflow\s*:\s*(hidden|auto|scroll)/)
  assert.match(readPortal("AGENTS.md"), /Overflow handling is a worst practice and is prohibited/)
  assert.match(readPortal("docs/CORE-DESIGN-PARAMETERS.md"), /Overflow handling is prohibited as a label strategy/)
})
