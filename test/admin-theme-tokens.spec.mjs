import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const ROOT_DIR = process.cwd()

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8")
}

function sliceBetween(source, startPattern, endPattern, label) {
  const start = source.indexOf(startPattern)
  assert.ok(start >= 0, `${label}: missing start marker`)
  const end = source.indexOf(endPattern, start)
  assert.ok(end >= 0, `${label}: missing end marker`)
  return source.slice(start, end)
}

function assertIncludesAll(source, tokens, label) {
  for (const token of tokens) {
    assert.ok(source.includes(token), `${label}: missing ${token}`)
  }
}

function assertExcludesAll(source, tokens, label) {
  for (const token of tokens) {
    assert.ok(!source.includes(token), `${label}: still contains ${token}`)
  }
}

test("student-admin uses shared theme tokens for chart and support surfaces", () => {
  const source = readFile("web-asset/admin/student-admin.css")
  assertIncludesAll(
    source,
    [
      "var(--portal-data-label)",
      "var(--portal-support-message)",
      "var(--portal-chart-axis-label)",
      "var(--portal-chart-surface)",
      "var(--portal-chart-surface-soft)",
    ],
    "student-admin.css",
  )
})

test("shared theme light text defaults to black", () => {
  const source = readFile("web-asset/shared/portal-theme.css")
  assert.match(source, /--hub-theme-text:\s*#000000;/, "portal-theme.css should keep hub text black")
  assert.match(source, /--ink:\s*#000000;/, "portal-theme.css should keep ink black")
  assert.match(source, /--portal-text:\s*#000000;/, "portal-theme.css should keep portal text black")
})

test("student-admin school title stays dark text", () => {
  const source = readFile("web-asset/admin/student-admin.css")
  const titleBlock = sliceBetween(
    source,
    ".app-school-name {",
    "      .text-zoom-controls {",
    "student-admin.css app-school-name",
  )
  assertIncludesAll(titleBlock, ["color: var(--portal-text)"], "student-admin.css app-school-name")
  assertExcludesAll(titleBlock, ["color: #fff"], "student-admin.css app-school-name")
})

test("student-admin school title stays readable in dark mode", () => {
  const source = readFile("web-asset/admin/student-admin.css")
  const darkTitleBlock = sliceBetween(
    source,
    "html[data-theme=\"dark\"] body.admin-portal-page .app-school-name {",
    "      html[data-theme=\"dark\"] body.admin-portal-page .chart-svg {",
    "student-admin.css dark app-school-name",
  )
  assertIncludesAll(
    darkTitleBlock,
    ["color: var(--portal-dark-text)"],
    "student-admin.css dark app-school-name",
  )
  assertExcludesAll(darkTitleBlock, ["color: #212121"], "student-admin.css dark app-school-name")
})

test("student-points chart render uses shared portal tokens", () => {
  const source = readFile("web-asset/admin/student-points.html")
  assert.ok(
    source.includes('<link rel="stylesheet" href="/web-asset/shared/portal-theme.min.css">'),
    "student-points.html should load portal-theme.min.css",
  )
  const chartBlock = sliceBetween(
    source,
    "function renderChart(summary = {}) {",
    "function renderStudents(rows = []) {",
    "student-points.html renderChart",
  )
  assertIncludesAll(
    chartBlock,
    [
      "var(--portal-chart-axis-label)",
      "var(--portal-border)",
      "var(--tertiary-color)",
    ],
    "student-points.html renderChart",
  )
  assertExcludesAll(
    chartBlock,
    [
      "#5f7088",
      "#e1ebf8",
      "#cfe0f3",
      "#0d66c2",
    ],
    "student-points.html renderChart",
  )
})

test("grades-tabulator chart render uses shared portal tokens", () => {
  const source = readFile("web-asset/admin/grades-tabulator.html")
  assert.ok(
    source.includes('<link rel="stylesheet" href="/web-asset/shared/portal-theme.min.css">'),
    "grades-tabulator.html should load portal-theme.min.css",
  )
  const sparklineBlock = sliceBetween(
    source,
    "function buildDistributionSparklineSvg(entries = []) {",
    "function distributionModalElements() {",
    "grades-tabulator.html buildDistributionSparklineSvg",
  )
  assertIncludesAll(
    sparklineBlock,
    ["var(--portal-status-info-border)", "var(--portal-border)"],
    "grades-tabulator.html buildDistributionSparklineSvg",
  )
  assertExcludesAll(
    sparklineBlock,
    [
      "#1d5ea0",
      "#2f75bc",
      "#d7e3f6",
    ],
    "grades-tabulator.html buildDistributionSparklineSvg",
  )
})

test("grades-tabulator table chrome stays on the shared table shell", () => {
  const source = readFile("web-asset/admin/grades-tabulator.html")
  assert.match(
    source,
    /id="gradeGrid" class="portal-theme-table-shell"/,
    "grades-tabulator.html should use the shared portal table shell class",
  )

  const shellBlock = sliceBetween(source, "#gradeGrid {", ".grid-head {", "grades-tabulator table shell")
  assertExcludesAll(
    shellBlock,
    ["background:", "border:", "box-shadow:", "color:"],
    "grades-tabulator table shell",
  )

  assertExcludesAll(
    source,
    [
      "html[data-theme=\"dark\"] .tabulator {",
      "html[data-theme=\"dark\"] .tabulator .tabulator-header,",
      "html[data-theme=\"dark\"] .tabulator .tabulator-cell,",
      ".tabulator .tabulator-row:hover {",
    ],
    "grades-tabulator table chrome",
  )
})

test("grades-tabulator reuses the shared admin chrome skeleton", () => {
  const source = readFile("web-asset/admin/grades-tabulator.html")
  for (const token of [
    '<div class="header-bar" data-surface-role="content">',
    '<div class="wrap">',
    '<main class="section-stack" id="appMain" data-surface-role="content">',
    '<div class="content app-page-header" id="appPageHeader" data-surface-role="content">',
    '<div class="content" data-surface-role="content">',
    '<section class="control-card portal-theme-panel">',
    '<section class="metrics" aria-label="Grade data snapshot">',
    '<section id="gradeGridCard" class="grid-card portal-theme-card">',
    '<div class="app-brand-strip">',
    '<h2 id="appSchoolName" class="app-school-name">THE EAGLES CLUB</h2>',
    '<button id="menuToggleBtn" type="button" class="menu-toggle-btn app-header-menu-toggle portal-button portal-button-immutable-chrome">',
    '<button class="portal-theme-toggle portal-button portal-button-immutable-chrome" id="adminThemeToggle"',
    '<div class="text-zoom-controls" id="globalTextZoomControls" role="toolbar" aria-label="Global text size controls">',
    '<button id="globalTextZoomResetBtn" type="button" class="portal-button portal-button-warning" data-text-zoom-action="reset" aria-label="Reset global text size">',
    '<footer class="hub-footer" aria-label="Site footer">',
  ]) {
    assert.ok(source.includes(token), `grades-tabulator.html should include ${token}`)
  }

  assert.match(
    source,
    /width:\s*min\(100%, 1440px\);/,
    "grades-tabulator.html should keep the fixed report-shell width contract",
  )
})

test("grades-tabulator inherits shared dark text instead of redefining it locally", () => {
  const source = readFile("web-asset/admin/grades-tabulator.html")
  assertExcludesAll(
    source,
    [
      "html[data-theme=\"dark\"] .field label",
      "html[data-theme=\"dark\"] .section-note",
      "html[data-theme=\"dark\"] .assignment-title-text",
      "html[data-theme=\"dark\"] .grid-title",
      "html[data-theme=\"dark\"] .assignment-col.elective-col .assignment-title-text",
      "html[data-theme=\"dark\"] .assignment-sub",
      "html[data-theme=\"dark\"] .distribution-mini-meta",
      "html[data-theme=\"dark\"] .distribution-dialog-head h2",
      "html[data-theme=\"dark\"] .distribution-dialog-meta",
      "html[data-theme=\"dark\"] .dim",
    ],
    "grades-tabulator.html dark text overrides",
  )
})
