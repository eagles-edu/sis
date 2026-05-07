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

  assertIncludesAll(
    source,
    [
      "background: var(--portal-surface-card);",
      "background: var(--portal-surface-support);",
      "color: var(--portal-text-soft);",
      "border-bottom: 1px solid var(--line);",
    ],
    "student-portal.html",
  )

  const structuralBlocks = [
    sliceBetween(source, ".queue-table-wrap {", ".queue-table-wrap table {", "student-portal queue-table-wrap"),
    sliceBetween(source, ".identity-item {", ".metric {", "student-portal identity-item"),
    sliceBetween(source, ".homework-square {", ".homework-square.is-complete {", "student-portal homework-square"),
    sliceBetween(source, ".homework-modal-table th,", ".homework-modal-table td:first-child,", "student-portal homework modal"),
    sliceBetween(source, ".quick-link {", "button.quick-link:hover:not(:disabled) {", "student-portal quick-link"),
    sliceBetween(source, ".detail-item {", ".detail-item.warn {", "student-portal detail-item"),
  ].join("\n")

  assertExcludesAll(
    structuralBlocks,
    ["#fff", "#f6f9ff", "#edf4ff", "#f8fbff", "#f1f3f6"],
    "student-portal structural blocks",
  )
})

test("parent portal surfaces follow the shared portal theme tokens", () => {
  const source = readFile("web-asset/parent/parent-portal.html")

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
    sliceBetween(source, ".profile-group {", ".profile-group h4 {", "parent-portal profile-group"),
    sliceBetween(source, ".field-row {", ".field-row:first-of-type {", "parent-portal field-row"),
    sliceBetween(source, ".choice-group {", ".choice-group:disabled {", "parent-portal choice-group"),
    sliceBetween(source, ".draft-actions {", "@media (max-width: 430px) {", "parent-portal draft-actions"),
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
    sliceBetween(source, "body.portal-hub-page .hero {", "body.portal-hub-page .hero::before {", "hub hero"),
    sliceBetween(source, "body.portal-hub-page .section-card {", "body.portal-hub-page .section-card::before {", "hub section-card"),
    sliceBetween(source, "body.portal-hub-page .portal-card--admin,", "body.portal-hub-page .hub-prefooter {", "hub portal cards"),
    sliceBetween(source, "body.portal-hub-page .hub-prefooter {", "body.portal-hub-page .hub-prefooter__links {", "hub prefooter"),
    sliceBetween(source, "body.portal-hub-page .hub-footer {", "@media (min-width: 940px) {", "hub footer"),
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
  assertIncludesAll(
    studentPortal,
    [
      "var(--portal-status-good-bg)",
      "var(--portal-status-info-bg)",
      "var(--portal-status-bad-bg)",
      "var(--portal-status-neutral-bg)",
    ],
    "student portal status palette",
  )
  assertExcludesAll(
    studentPortal,
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
  assertExcludesAll(
    studentAdmin,
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
