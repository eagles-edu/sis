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

test("student portal surfaces follow the shared portal theme tokens", () => {
  const source = readFile("web-asset/student/student-portal.html")
  const shared = readFile("web-asset/shared/portal-theme.css")

  assertIncludesAll(
    shared,
    [
      "background: var(--portal-surface-card);",
      "background: var(--portal-surface-support);",
      "color: var(--portal-text-soft);",
      "border-bottom: 1px solid var(--line);",
    ],
    "student shared theme",
  )

  const structuralBlocks = [
    sliceBetween(source, ".queue-table-wrap {", ".queue-table-wrap table {", "student-portal queue-table-wrap"),
    sliceBetween(source, ".homework-modal-table th,", ".homework-modal-table td:first-child,", "student-portal homework modal"),
    sliceBetween(shared, "body.student-portal-page .identity-item,\nbody.parent-portal-page .identity-item {\n  align-content: start;", "body.student-portal-page .detail-list,", "student shared identity-item"),
    sliceBetween(shared, "body.student-portal-page .homework-square.is-complete,", "body.student-portal-page .homework-square.is-clear,", "student shared homework-square"),
    sliceBetween(shared, "body.student-portal-page .quick-link,", "body.student-portal-page .quick-link:hover,", "student shared quick-link"),
    sliceBetween(shared, "body.student-portal-page .detail-item,\nbody.parent-portal-page .detail-item {\n  background: var(--portal-surface-card) !important;", "body.student-portal-page .detail-copy,", "student shared detail-item"),
  ].join("\n")

  assertExcludesAll(
    structuralBlocks,
    ["#fff", "#f6f9ff", "#edf4ff", "#f8fbff", "#f1f3f6"],
    "student-portal structural blocks",
  )
})

test("parent portal surfaces follow the shared portal theme tokens", () => {
  const source = readFile("web-asset/parent/parent-portal.html")
  const shared = readFile("web-asset/shared/portal-theme.css")

  assertIncludesAll(
    source,
    [
      "background: var(--portal-surface-card);",
      "background: var(--portal-surface-support);",
      "color: var(--portal-text-soft);",
      "border-top: 1px solid var(--line);",
    ],
    "parent-portal.html",
  )

  const structuralBlocks = [
    sliceBetween(shared, "body.parent-portal-page .profile-group {", "body.parent-portal-page .profile-group p {", "parent shared profile-group"),
    sliceBetween(shared, "body.parent-portal-page .field-row {", "body.parent-portal-page .field-row:first-of-type {", "parent shared field-row"),
    sliceBetween(shared, "body.parent-portal-page .choice-group {", "body.parent-portal-page .choice-group:disabled {", "parent shared choice-group"),
    sliceBetween(shared, "body.parent-portal-page .draft-actions {", "body.parent-portal-page :where(.portal-modal, #newsWeekSetModal, #performanceReportModal) :where(input, textarea, select)::placeholder {", "parent shared draft-actions"),
  ].join("\n")

  assertExcludesAll(
    structuralBlocks,
    ["#fff", "#fff5f5", "#f5f9ff", "#f7fbff", "#f1f3f8"],
    "parent-portal structural blocks",
  )
})

test("hub surfaces follow the shared portal theme tokens", () => {
  const source = readFile("web-asset/admin/portal-hub.html")

  assertIncludesAll(
    source,
    [
      "--hub-panel-bg: var(--portal-surface-card);",
      "--hub-panel-bg-support: var(--portal-surface-support);",
      "--hub-panel-bg-section: var(--portal-surface-panel);",
      "--hub-panel-border: var(--portal-border);",
      "background: var(--hub-theme-page-bg-body);",
    ],
    "portal-hub.html",
  )

  const structuralBlocks = [
    sliceBetween(source, "body.portal-hub-page {", "body.portal-hub-page .portal-hub-bg {", "hub body shell"),
    sliceBetween(source, "body.portal-hub-page .hero-line {", "body.portal-hub-page .hero-actions {", "hub hero line"),
    sliceBetween(source, "body.portal-hub-page .hero-actions {", "body.portal-hub-page .portal-grid {", "hub hero actions"),
    sliceBetween(source, "body.portal-hub-page .portal-grid {", "body.portal-hub-page .hero-brand {", "hub portal grid"),
    sliceBetween(source, "body.portal-hub-page .hero-brand {", "body.portal-hub-page .hero-copy {", "hub hero brand"),
    sliceBetween(source, "body.portal-hub-page .hero-copy {", "body.portal-hub-page .section-head {", "hub hero copy"),
    sliceBetween(source, "body.portal-hub-page .section-head {", "@media (min-width: 940px) {", "hub section head"),
  ].join("\n")

  assertExcludesAll(
    structuralBlocks,
    ["#fff", "#f7faff", "#edf3fa", "#d4dcec", "#bac5d8"],
    "hub structural blocks",
  )
})

test("map page uses the shared portal page background", () => {
  const source = readFile("map2026-v3.html")
  assertIncludesAll(
    source,
    [
      '<link rel="stylesheet" href="/web-asset/shared/portal-theme.min.css">',
      "background: var(--portal-page-bg);",
    ],
    "map2026-v3.html",
  )
})

test("semantic status palettes stay on shared portal tokens", () => {
  const shared = readFile("web-asset/shared/portal-theme.min.css")
  assertIncludesAll(
    shared,
    [
      "--portal-status-good-bg:",
      "--portal-status-good-border:",
      "--portal-status-good-text:",
      "--portal-status-warn-bg:",
      "--portal-status-warn-border:",
      "--portal-status-warn-text:",
      "--portal-status-bad-bg:",
      "--portal-status-bad-border:",
      "--portal-status-bad-text:",
      "--portal-status-info-bg:",
      "--portal-status-info-border:",
      "--portal-status-info-text:",
    ],
    "shared status palette",
  )

  const studentPortal = readFile("web-asset/student/student-portal.html")
  const portalTheme = readFile("web-asset/shared/portal-theme.css")
  assertIncludesAll(
    portalTheme,
    [
      "body.student-portal-page .homework-square.is-complete",
      "var(--portal-status-good-bg)",
      "body.student-portal-page .homework-square.is-pending",
      "var(--portal-status-info-bg)",
      "body.student-portal-page .homework-square.is-arrears",
      "var(--portal-status-bad-bg)",
      "body.student-portal-page .homework-square.is-clear",
      "var(--portal-status-neutral-bg)",
    ],
    "student portal status palette",
  )
  assertExcludesAll(
    portalTheme,
    ["#d7f2e1", "#d9eaff", "#ffd9de", "#fff0f0", "#fff6f7"],
    "student portal legacy status colors",
  )

  const gradesTabulator = readFile("web-asset/admin/grades-tabulator.html")
  assertIncludesAll(
    gradesTabulator,
    [
      "var(--portal-status-good-bg)",
      "var(--portal-status-warn-bg)",
      "var(--portal-status-bad-bg)",
      "var(--portal-status-warn-border)",
    ],
    "grades-tabulator status palette",
  )
  assertExcludesAll(
    gradesTabulator,
    ["#dcf6e7", "#fff3c9", "#fde4e2", "#e5cb66", "#b16d00"],
    "grades-tabulator legacy status colors",
  )

  const studentAdmin = readFile("web-asset/admin/student-admin.css")
  assertIncludesAll(
    studentAdmin,
    [
      "var(--portal-status-good-bg)",
      "var(--portal-status-warn-bg)",
      "var(--portal-status-bad-bg)",
      "var(--portal-status-info-bg)",
    ],
    "student-admin status palette",
  )
  const studentAdminStatusBlocks = [
    sliceBetween(studentAdmin, ".queue-hub-order-dirty {", ".stats-grid {", "student-admin queue hub status"),
    sliceBetween(studentAdmin, ".system-health-item {", ".system-health-mirror-card {", "student-admin system health status"),
    sliceBetween(studentAdmin, ".hub-pill {", ".hub-pill.connected {", "student-admin hub pill status"),
  ].join("\n")
  assertExcludesAll(
    studentAdminStatusBlocks,
    ["#d7f2e1", "#ffe9c7", "#ffd9de", "#dfeaff", "#70b68e"],
    "student-admin legacy status colors",
  )

  const studentAdminJs = readFile("web-asset/admin/student-admin.js")
  assertIncludesAll(
    studentAdminJs,
    ["bar-detail-action-btn", "level-theme-btn"],
    "student-admin bar-detail buttons",
  )

  assertIncludesAll(
    shared,
    [":not(.bar-detail-action-btn)"],
    "shared admin button exclusions",
  )
})
