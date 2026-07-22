import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const ROOT_DIR = process.cwd()

const gradesTabulatorAssets = [
  "web-asset/admin/grades-tabulator.html",
  "web-asset/admin/grades-tabulator.css",
  "web-asset/admin/grades-tabulator.js",
].map((file) => fs.readFileSync(path.join(ROOT_DIR, file), "utf8")).join("\n")

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

test("shared header and footer chrome use the shared radius ladder", () => {
  const source = readFile("web-asset/shared/portal-theme.css")
  assertIncludesAll(
    source,
    [
      "border-radius: var(--radius-2);",
      "body.portal-hub-page .hub-banner {",
      ".hub-footer {",
      "body.portal-hub-page .header-bar,",
      "body.admin-portal-page .header-bar,",
      "body.parent-portal-page .header-bar,",
      "body.student-portal-page .header-bar {",
    ],
    "portal-theme.css shared chrome radius",
  )
  assertExcludesAll(
    source,
    ["border-radius: clamp(4.5px, 0.9cqi, 12px);", "border-radius: clamp(4px, 0.9cqi, 8px);"],
    "portal-theme.css shared chrome radius",
  )
})

test("student-admin school title stays dark text", () => {
  const source = readFile("web-asset/shared/portal-theme.css")
  const adminBodyBlock = sliceBetween(
    source,
    "body.admin-portal-page {",
    "body.parent-portal-page,",
    "portal-theme.css admin body",
  )
  assertIncludesAll(adminBodyBlock, ["color: var(--portal-text)"], "portal-theme.css admin body")
  assertExcludesAll(adminBodyBlock, ["color: #fff"], "portal-theme.css admin body")
})

test("student-admin school title stays readable in dark mode", () => {
  const source = readFile("web-asset/shared/portal-theme.css")
  const darkTitleBlock = sliceBetween(
    source,
    "html[data-theme=\"dark\"] .app-school-name,",
    "html[data-theme=\"dark\"] .metric-table th,",
    "portal-theme.css dark app-school-name",
  )
  assertIncludesAll(
    darkTitleBlock,
    ["color: var(--portal-role-text) !important"],
    "portal-theme.css dark app-school-name",
  )
  assertExcludesAll(darkTitleBlock, ["color: #212121"], "portal-theme.css dark app-school-name")
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

test("student-points container chrome uses the shared radius ladder", () => {
  const source = readFile("web-asset/admin/student-points.html")
  const cardBlock = sliceBetween(source, ".card {", "#loginPanel {", "student-points.html card chrome")
  const surfaceBlock = sliceBetween(source, ".chart-wrap {", ".hidden {", "student-points.html surface chrome")
  const tableBlock = sliceBetween(source, ".table-wrap {", ".hidden {", "student-points.html table chrome")

  assertIncludesAll(cardBlock, ["border-radius: var(--radius-3);"], "student-points.html card chrome")
  assertIncludesAll(surfaceBlock, ["border-radius: var(--radius-2);"], "student-points.html chart chrome")
  assertIncludesAll(tableBlock, ["border-radius: var(--radius-2);"], "student-points.html table chrome")
  assertExcludesAll(cardBlock, ["14px"], "student-points.html card chrome")
  assertExcludesAll(surfaceBlock, ["12px"], "student-points.html chart chrome")
  assertExcludesAll(tableBlock, ["12px"], "student-points.html table chrome")
})

test("grades-tabulator chart render uses shared portal tokens", () => {
  const source = gradesTabulatorAssets
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
    ["distribution-mini-trendline-baseline", "distribution-mini-trendline", "distribution-mini-trendpoint"],
    "grades-tabulator.html buildDistributionSparklineSvg",
  )
  assertIncludesAll(
    source,
    [
      ".distribution-modal-chart .dist-grid {\n      stroke: var(--portal-border);",
      ".distribution-modal-chart .dist-line {\n      fill: none;\n      stroke: var(--portal-status-info-border);",
    ],
    "grades-tabulator.html distribution chart token styles",
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

test("grades-tabulator container chrome uses the shared radius ladder", () => {
  const source = gradesTabulatorAssets
  const cardBlock = sliceBetween(
    source,
    ".hero,\n    .control-card,\n    .grid-card {",
    ".hero.portal-theme-panel,",
    "grades-tabulator card chrome",
  )
  const metricBlock = sliceBetween(source, ".metric-card {", "#gradeGrid {", "grades-tabulator metric chrome")

  assertIncludesAll(cardBlock, ["border-radius: var(--radius-3);"], "grades-tabulator card chrome")
  assertIncludesAll(metricBlock, ["border-radius: var(--radius-2);"], "grades-tabulator metric chrome")
  assertExcludesAll(cardBlock, ["14px"], "grades-tabulator card chrome")
  assertExcludesAll(metricBlock, ["12px"], "grades-tabulator metric chrome")
})

test("grades-tabulator table chrome stays on the shared table shell", () => {
  const source = gradesTabulatorAssets
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

test("student-admin score popovers use the shared radius ladder", () => {
  const source = readFile("web-asset/admin/student-admin.css")
  const popoverBlock = sliceBetween(
    source,
    ".pt-score-legend-popover {",
    ".pt-score-legend-title {",
    "student-admin.css score legend popover",
  )
  const optionBlock = sliceBetween(
    source,
    ".pt-score-radio-option {",
    ".pt-score-radio-option input[type=\"radio\"] {",
    "student-admin.css score radio option",
  )

  assertIncludesAll(popoverBlock, ["border-radius: var(--radius-2);"], "student-admin.css score legend popover")
  assertIncludesAll(optionBlock, ["border-radius: var(--radius-2);"], "student-admin.css score radio option")
  assert.ok(
    !/border-radius:\s*8px;/.test(popoverBlock),
    "student-admin.css score legend popover should not keep a literal radius",
  )
  assert.ok(
    !/border-radius:\s*6px;/.test(optionBlock),
    "student-admin.css score radio option should not keep a literal radius",
  )
})

test("grades-tabulator reuses the shared admin chrome skeleton", () => {
  const source = gradesTabulatorAssets
  for (const token of [
    '<div class="header-bar portal-login-header" data-surface-role="content">',
    '<div class="wrap">',
    '<main class="section-stack" id="appMain" data-surface-role="content">',
    '<section class="content topbar" data-surface-role="content">',
    '<div class="content" data-surface-role="content">',
    '<section class="control-card portal-theme-panel">',
    '<section class="metrics" aria-label="Grade data snapshot">',
    '<section id="gradeGridCard" class="grid-card portal-theme-card">',
    '<div class="brand-head">',
    '<h1>THE EAGLES CLUB</h1>',
    '<button class="portal-theme-toggle portal-button portal-button-immutable-chrome" id="studentThemeToggle"',
    '<div class="text-zoom-controls" role="toolbar" aria-label="Global text size controls">',
    '<button id="studentTextZoomResetBtn" type="button" class="portal-button portal-button-warning"',
    '<footer class="hub-footer" aria-label="Site footer">',
  ]) {
    assert.ok(source.includes(token), `grades-tabulator.html should include ${token}`)
  }

  assert.match(source, /<button\s+class="portal-theme-toggle portal-button portal-button-immutable-chrome"\s+id="studentThemeToggle"/, "grades-tabulator.html should include the shared theme toggle button")

  assert.match(
    source,
    /width:\s*min\(100%, 1440px\);/,
    "grades-tabulator.html should keep the fixed report-shell width contract",
  )
})

test("grades-tabulator inherits shared dark text instead of redefining it locally", () => {
  const source = gradesTabulatorAssets
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
