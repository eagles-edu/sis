import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"

const { initAttendanceGradeControlsIsland } = await import(
  "../web-asset/admin/attendance-grade-controls-island.mjs"
)

test("attendance and grade controls island wires table and chart controls", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <html>
        <body>
          <select id="attendanceLevelStyleLevel"><option value="L1">L1</option></select>
          <button id="attendanceSaveBtn" type="button"></button>
          <button id="attendanceLandingSaveAllBtn" type="button"></button>
          <button id="attendanceLandingReloadBtn" type="button"></button>
          <button id="attendanceLevelApplyBtn" type="button"></button>
          <button id="attendanceLevelClearImageBtn" type="button"></button>
          <button id="attendanceLevelResetBtn" type="button"></button>
          <input id="attendanceLevelImage" type="file">
          <input id="a_date" type="date" value="2026-04-15">
          <button id="attendanceClearBtn" type="button"></button>
          <select id="attendanceSortField"><option value="attendanceDate">Attendance date</option></select>
          <button id="attendanceSortDirBtn" type="button"></button>
          <input id="attendanceDataSearch" type="search">
          <button id="attendanceArchiveToggleBtn" type="button"></button>
          <button id="attendanceExportXlsxBtn" type="button"></button>
          <button id="attendancePrintPdfBtn" type="button"></button>

          <select id="performanceSortField"><option value="generatedAt">Generated</option></select>
          <button id="performanceSortDirBtn" type="button"></button>
          <input id="performanceDataSearch" type="search">
          <button id="performanceArchiveToggleBtn" type="button"></button>
          <button id="performanceExportXlsxBtn" type="button"></button>
          <button id="performancePrintPdfBtn" type="button"></button>

          <button id="gradeSaveBtn" type="button"></button>
          <button id="gradeClearBtn" type="button"></button>
          <select id="gradeSortField"><option value="dueAt">Due</option></select>
          <button id="gradeSortDirBtn" type="button"></button>
          <input id="gradeDataSearch" type="search">
          <button id="gradeArchiveToggleBtn" type="button"></button>
          <button id="gradeExportXlsxBtn" type="button"></button>
          <button id="gradePrintPdfBtn" type="button"></button>

          <button id="openTabulatorGradesBtn" type="button"></button>
          <div id="gradeChartLanes">
            <button type="button" data-grade-chart-open="lane-a"></button>
          </div>
          <button id="gradeChartModalCloseBtn" type="button"></button>
          <div id="gradeChartModal" class="hidden"></div>
          <div id="gradeChartPeriods">
            <button type="button" data-grade-chart-period="q2"></button>
          </div>
          <select id="gradeChartGroupBy"><option value="teacher">Teacher</option></select>
          <select id="gradeChartQuarter"><option value="q3">Q3</option></select>
          <select id="gradeChartSchoolYear"><option value="2025-2026">2025-2026</option></select>
          <input id="gradeChartCustomFrom" value="2026-04-20">
          <input id="gradeChartCustomTo" value="2026-04-15">
        </body>
      </html>`,
    { pretendToBeVisual: true, url: "http://127.0.0.1/" },
  )

  const events = []
  const modal = dom.window.document.getElementById("gradeChartModal")

  initAttendanceGradeControlsIsland({
    document: dom.window.document,
    onAttendanceLevelStyleLevelChange(value) {
      events.push(["attendance-style", value])
    },
    onAttendanceSave() {
      events.push("attendance-save")
    },
    onAttendanceLandingSaveAll() {
      events.push("attendance-save-all")
    },
    onAttendanceLandingReload() {
      events.push("attendance-reload")
    },
    onAttendanceLevelApply() {
      events.push("attendance-apply")
    },
    onAttendanceLevelClearImage() {
      events.push("attendance-clear-image")
    },
    onAttendanceLevelReset() {
      events.push("attendance-reset")
    },
    onAttendanceLevelImageChange() {
      events.push("attendance-image")
    },
    onAttendanceDateChange() {
      events.push("attendance-date")
    },
    onAttendanceClear() {
      events.push("attendance-clear")
    },
    onAttendanceSortFieldChange(value) {
      events.push(["attendance-sort-field", value])
    },
    onAttendanceSortDirToggle() {
      events.push("attendance-sort-dir")
    },
    onAttendanceDataSearchInput(value) {
      events.push(["attendance-search", value])
    },
    onAttendanceArchiveToggle() {
      events.push("attendance-archive")
    },
    onAttendanceExportXlsx() {
      events.push("attendance-export")
    },
    onAttendancePrintPdf() {
      events.push("attendance-print")
    },
    onPerformanceSortFieldChange(value) {
      events.push(["performance-sort-field", value])
    },
    onPerformanceSortDirToggle() {
      events.push("performance-sort-dir")
    },
    onPerformanceDataSearchInput(value) {
      events.push(["performance-search", value])
    },
    onPerformanceArchiveToggle() {
      events.push("performance-archive")
    },
    onPerformanceExportXlsx() {
      events.push("performance-export")
    },
    onPerformancePrintPdf() {
      events.push("performance-print")
    },
    onGradeSave() {
      events.push("grade-save")
    },
    onGradeClear() {
      events.push("grade-clear")
    },
    onGradeSortFieldChange(value) {
      events.push(["grade-sort-field", value])
    },
    onGradeSortDirToggle() {
      events.push("grade-sort-dir")
    },
    onGradeDataSearchInput(value) {
      events.push(["grade-search", value])
    },
    onGradeArchiveToggle() {
      events.push("grade-archive")
    },
    onGradeExportXlsx() {
      events.push("grade-export")
    },
    onGradePrintPdf() {
      events.push("grade-print")
    },
    onOpenTabulatorGrades() {
      events.push("open-tabulator")
    },
    onGradeChartLaneOpen(laneKey) {
      events.push(["lane", laneKey])
      modal.classList.remove("hidden")
    },
    onGradeChartModalClose() {
      events.push("chart-close")
      modal.classList.add("hidden")
    },
    onGradeChartModalBackdropClick(event) {
      events.push("chart-backdrop")
      if (event.target === event.currentTarget) modal.classList.add("hidden")
    },
    onGradeChartPeriodChange(period) {
      events.push(["period", period])
    },
    onGradeChartGroupByChange(value) {
      events.push(["group", value])
    },
    onGradeChartQuarterChange(value) {
      events.push(["quarter", value])
    },
    onGradeChartSchoolYearChange(value) {
      events.push(["school-year", value])
    },
    onGradeChartCustomRangeChange(fromIso, toIso) {
      events.push(["range", fromIso, toIso])
    },
  })

  const document = dom.window.document
  document.getElementById("attendanceLevelStyleLevel").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("attendanceSaveBtn").click()
  document.getElementById("attendanceLandingSaveAllBtn").click()
  document.getElementById("attendanceLandingReloadBtn").click()
  document.getElementById("attendanceLevelApplyBtn").click()
  document.getElementById("attendanceLevelClearImageBtn").click()
  document.getElementById("attendanceLevelResetBtn").click()
  document.getElementById("attendanceLevelImage").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("a_date").dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  document.getElementById("attendanceClearBtn").click()
  document.getElementById("attendanceSortField").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("attendanceSortDirBtn").click()
  document.getElementById("attendanceDataSearch").value = "late"
  document.getElementById("attendanceDataSearch").dispatchEvent(
    new dom.window.Event("input", { bubbles: true }),
  )
  document.getElementById("attendanceArchiveToggleBtn").click()
  document.getElementById("attendanceExportXlsxBtn").click()
  document.getElementById("attendancePrintPdfBtn").click()

  document.getElementById("performanceSortField").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("performanceSortDirBtn").click()
  document.getElementById("performanceDataSearch").value = "queued"
  document.getElementById("performanceDataSearch").dispatchEvent(
    new dom.window.Event("input", { bubbles: true }),
  )
  document.getElementById("performanceArchiveToggleBtn").click()
  document.getElementById("performanceExportXlsxBtn").click()
  document.getElementById("performancePrintPdfBtn").click()

  document.getElementById("gradeSaveBtn").click()
  document.getElementById("gradeClearBtn").click()
  document.getElementById("gradeSortField").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("gradeSortDirBtn").click()
  document.getElementById("gradeDataSearch").value = "math"
  document.getElementById("gradeDataSearch").dispatchEvent(
    new dom.window.Event("input", { bubbles: true }),
  )
  document.getElementById("gradeArchiveToggleBtn").click()
  document.getElementById("gradeExportXlsxBtn").click()
  document.getElementById("gradePrintPdfBtn").click()

  document.getElementById("openTabulatorGradesBtn").click()
  document.querySelector('button[data-grade-chart-open="lane-a"]').click()
  document.querySelector('button[data-grade-chart-period="q2"]').click()
  document.getElementById("gradeChartGroupBy").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("gradeChartQuarter").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("gradeChartSchoolYear").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  document.getElementById("gradeChartCustomFrom").dispatchEvent(
    new dom.window.Event("change", { bubbles: true }),
  )
  modal.classList.remove("hidden")
  modal.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  modal.classList.remove("hidden")
  document.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
  )

  assert.deepEqual(events, [
    ["attendance-style", "L1"],
    "attendance-save",
    "attendance-save-all",
    "attendance-reload",
    "attendance-apply",
    "attendance-clear-image",
    "attendance-reset",
    "attendance-image",
    "attendance-date",
    "attendance-clear",
    ["attendance-sort-field", "attendanceDate"],
    "attendance-sort-dir",
    ["attendance-search", "late"],
    "attendance-archive",
    "attendance-export",
    "attendance-print",
    ["performance-sort-field", "generatedAt"],
    "performance-sort-dir",
    ["performance-search", "queued"],
    "performance-archive",
    "performance-export",
    "performance-print",
    "grade-save",
    "grade-clear",
    ["grade-sort-field", "dueAt"],
    "grade-sort-dir",
    ["grade-search", "math"],
    "grade-archive",
    "grade-export",
    "grade-print",
    "open-tabulator",
    ["lane", "lane-a"],
    ["period", "q2"],
    ["group", "teacher"],
    ["quarter", "q3"],
    ["school-year", "2025-2026"],
    ["range", "2026-04-15", "2026-04-20"],
    "chart-backdrop",
    "chart-close",
  ])

  dom.window.close()
})
