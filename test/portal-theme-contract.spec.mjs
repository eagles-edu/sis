import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const sharedThemePath = path.resolve(rootDir, "web-asset/shared/portal-theme.css")
const adminThemePath = path.resolve(rootDir, "web-asset/admin/student-admin.css")
const adminPortalPath = path.resolve(rootDir, "web-asset/admin/student-admin.html")
const parentPortalPath = path.resolve(rootDir, "web-asset/parent/parent-portal.html")
const studentPortalPath = path.resolve(rootDir, "web-asset/student/student-portal.html")
const portalPaths = [
  ["admin hub", "web-asset/admin/portal-hub.html"],
  ["parent portal", "web-asset/parent/parent-portal.html"],
  ["student portal", "web-asset/student/student-portal.html"],
]

const sharedTheme = fs.readFileSync(sharedThemePath, "utf8")
const adminTheme = fs.readFileSync(adminThemePath, "utf8")
const adminPortal = fs.readFileSync(adminPortalPath, "utf8")
const parentPortal = fs.readFileSync(parentPortalPath, "utf8")
const studentPortal = fs.readFileSync(studentPortalPath, "utf8")

test("portal pages load the shared portal theme stylesheet", () => {
  for (const [label, relPath] of portalPaths) {
    const html = fs.readFileSync(path.resolve(rootDir, relPath), "utf8")
    assert.match(
      html,
      /<link rel="stylesheet" href="\/web-asset\/shared\/portal-theme\.css">/,
      `${label} should link the shared portal theme`,
    )
  }
})

test("shared portal theme defines the common shell, header, and card system", () => {
  assert.match(sharedTheme, /\.portal-layout,\s*\.portal-shell/)
  assert.match(sharedTheme, /\.card,\s*\.panel/)
  assert.match(sharedTheme, /\.hero,\s*\.topbar/)
  assert.match(sharedTheme, /\.side-nav/)
  assert.match(sharedTheme, /\.floating-menu-btn/)
  assert.match(sharedTheme, /\.brand-logo-wrap--sm/)
  assert.match(sharedTheme, /\.brand-logo-wrap--lg/)
  assert.match(sharedTheme, /\.portal-card,\s*\.resource-card/)
})

test("shared portal theme keeps the hub theme toggle scoped and legible in dark mode", () => {
  assert.match(sharedTheme, /body\.portal-hub-page \.theme-toggle\s*\{/)
  assert.match(sharedTheme, /body\.portal-hub-page \.theme-toggle__icon\s*\{/)
  assert.match(sharedTheme, /html\[data-theme="dark"\] body\.portal-hub-page \.theme-toggle\s*\{[\s\S]*color:\s*var\(--portal-theme-toggle-ink-dark\);/)
  assert.match(sharedTheme, /html\[data-theme="dark"\] body\.portal-hub-page \.theme-toggle__icon\s*\{[\s\S]*background:\s*var\(--portal-theme-toggle-icon-bg-dark\);/)
  assert.match(sharedTheme, /html\[data-theme="dark"\] body\.portal-hub-page \.theme-toggle__icon\s*\{[\s\S]*color:\s*var\(--portal-theme-toggle-ink-dark\);/)
  assert.doesNotMatch(sharedTheme, /(^|\n)\s*\.theme-toggle\s*\{/m)
  assert.doesNotMatch(sharedTheme, /(^|\n)\s*\.theme-toggle__icon\s*\{/m)
  assert.doesNotMatch(sharedTheme, /theme-toggle::after/i)
})

test("parent, student, and admin theme toggles keep the shared portal visual contract", () => {
  const hubToggleRules = [
    /class="theme-toggle"/i,
    /data-theme-toggle/i,
    /aria-pressed="false"/i,
    /aria-label="Chuyển sang giao diện tối"/i,
    /data-theme-toggle-icon/i,
    /size="110%"/i,
  ]

  const portalToggleMarkupRules = [
    /class="portal-theme-toggle"/i,
    /aria-pressed="false"/i,
    /size="110%"/i,
    /portal-theme-toggle__icon/i,
  ]

  const portalToggleRules = [
    /body\.student-portal-page \.portal-theme-toggle,/,
    /body\.parent-portal-page \.portal-theme-toggle,/,
    /body\.admin-portal-page \.portal-theme-toggle\s*\{/,
    /body\.student-portal-page \.portal-theme-toggle__icon,/,
    /body\.parent-portal-page \.portal-theme-toggle__icon,/,
    /body\.admin-portal-page \.portal-theme-toggle__icon\s*\{/,
    /html\[data-theme="dark"\] body\.student-portal-page \.portal-theme-toggle,/,
    /html\[data-theme="dark"\] body\.parent-portal-page \.portal-theme-toggle,/,
    /html\[data-theme="dark"\] body\.admin-portal-page \.portal-theme-toggle\s*\{/,
    /html\[data-theme="dark"\] body\.student-portal-page \.portal-theme-toggle__icon,/,
    /html\[data-theme="dark"\] body\.parent-portal-page \.portal-theme-toggle__icon,/,
    /html\[data-theme="dark"\] body\.admin-portal-page \.portal-theme-toggle__icon\s*\{/,
    /html\[data-theme="dark"\] body\.admin-portal-page \.portal-theme-toggle__icon\s*\{[\s\S]*background:\s*var\(--portal-theme-toggle-icon-bg-dark\);/i,
  ]

  const sources = [
    ["admin hub", fs.readFileSync(path.resolve(rootDir, "web-asset/admin/portal-hub.html"), "utf8"), hubToggleRules],
    ["parent portal", parentPortal, portalToggleMarkupRules],
    ["student portal", studentPortal, portalToggleMarkupRules],
  ]

  for (const [label, source, rules] of sources) {
    for (const pattern of rules) {
      assert.match(source, pattern, `${label} should keep the shared portal theme toggle contract`)
    }
    if (label !== "admin theme css") {
      assert.doesNotMatch(source, /data-tooltip=/i, `${label} should not emit a tooltip attribute`)
      assert.doesNotMatch(source, /title="[^"]*theme/i, `${label} should not emit a native tooltip title`)
    }
  }

  for (const pattern of portalToggleRules) {
    assert.match(sharedTheme, pattern, `shared theme CSS should own the portal toggle contract`)
  }
})

test("portal login shells codify the first-paint canvas backgrounds", () => {
  assert.ok(
    sharedTheme.includes("body.student-portal-page,\nbody.parent-portal-page {") &&
      sharedTheme.includes("background: var(--portal-page-bg);"),
    "shared theme should keep the student and parent light canvas",
  )
  assert.match(
    sharedTheme,
    /html\[data-theme="dark"\] body\.admin-portal-page::before,\s*html\[data-theme="dark"\] body\.student-portal-page::before,\s*html\[data-theme="dark"\] body\.parent-portal-page::before/s,
    "shared theme should keep the dark login canvas wash for admin, student, and parent",
  )
  assert.match(
    studentPortal,
    /html\s*\{\s*background:\s*var\(--portal-page-bg\);\s*\}/s,
    "student portal should stamp the shared light canvas token before shared CSS loads",
  )
  assert.match(
    studentPortal,
    /body\.student-portal-page\s*\{\s*background:\s*var\(--portal-page-bg\);\s*color:\s*var\(--portal-text\);\s*\}/s,
    "student portal should keep the shared light login shell canvas",
  )
  assert.match(
    parentPortal,
    /html\s*\{\s*background:\s*var\(--portal-page-bg\);\s*\}/s,
    "parent portal should stamp the shared light canvas token before shared CSS loads",
  )
  assert.match(
    parentPortal,
    /body\.parent-portal-page\s*\{\s*background:\s*var\(--portal-page-bg\);\s*color:\s*var\(--portal-text\);\s*\}/s,
    "parent portal should keep the shared light login shell canvas",
  )
  assert.match(
    adminPortal,
    /body\s*\{\s*margin:\s*0;\s*min-height:\s*100vh;\s*font-family:\s*var\(--font-base\);\s*background:\s*var\(--portal-page-bg\);\s*color:\s*var\(--portal-text\);\s*\}/s,
    "admin portal should keep the shared light canvas token",
  )
})

test("shared portal theme keeps student and parent calendars readable in dark mode", () => {
  assert.ok(
    sharedTheme.includes("--fc-event-bg-color: #edf4ff;") &&
      sharedTheme.includes("--fc-event-border-color: #83a8de;") &&
      sharedTheme.includes("--fc-event-text-color: #173b78;"),
    "shared theme should keep the default student and parent calendar events readable in light mode",
  )
  assert.ok(
    sharedTheme.includes("--fc-event-bg-color: var(--portal-dark-surface-support);") &&
      sharedTheme.includes("--fc-event-border-color: var(--portal-dark-border-strong);") &&
      sharedTheme.includes("--fc-event-text-color: var(--portal-dark-text);"),
    "shared theme should keep the default student and parent calendar events readable in dark mode",
  )
  assert.ok(
    sharedTheme.includes("html[data-theme=\"dark\"] body.student-portal-page .fc .fc-event.fc-event-attendance-present") &&
      sharedTheme.includes("--fc-event-text-color: #dff7e9;") &&
      sharedTheme.includes("--fc-event-text-color: #ffe3e6;") &&
      sharedTheme.includes("--fc-event-text-color: #fff1d0;") &&
      sharedTheme.includes("--fc-event-text-color: #eaf2ff;"),
    "shared theme should keep student and parent attendance events readable in dark mode",
  )
  assert.match(
    sharedTheme,
    /html\[data-theme="dark"\] body\.student-portal-page \.calendar-shell,[\s\S]*html\[data-theme="dark"\] body\.parent-portal-page \.calendar-shell/s,
    "shared theme should own the dark calendar shell hierarchy for student and parent",
  )
  assert.match(
    sharedTheme,
    /html\[data-theme="dark"\] body\.student-portal-page \.calendar-shell \.fc-daygrid-day-number,[\s\S]*html\[data-theme="dark"\] body\.parent-portal-page \.calendar-shell \.fc-col-header-cell-cushion/s,
    "shared theme should keep day numbers and headers legible in dark mode",
  )
  assert.match(
    sharedTheme,
    /html\[data-theme="dark"\] body\.student-portal-page \.detail-empty,[\s\S]*html\[data-theme="dark"\] body\.parent-portal-page \.calendar-empty/s,
    "shared theme should keep empty-state boxes dark in calendar views",
  )
  assert.match(
    sharedTheme,
    /html\[data-theme="dark"\] body\.student-portal-page :where\(\.homework-square, \.attendance-square\),[\s\S]*html\[data-theme="dark"\] body\.parent-portal-page :where\(\.homework-square, \.attendance-square, \.dashboard-surface-shell\)/s,
    "shared theme should keep the student and parent summary cards dark",
  )
  assert.match(
    sharedTheme,
    /html\[data-theme="dark"\] body\.student-portal-page \.homework-square\.is-complete,[\s\S]*html\[data-theme="dark"\] body\.parent-portal-page \.attendance-square\.is-risk/s,
    "shared theme should keep the summary state chips legible in dark mode",
  )
})

test("admin dark surfaces keep form controls and chart empty states readable", () => {
  assert.ok(
    adminTheme.includes("background: var(--portal-dark-field-bg);"),
    "admin dark inputs should use the dark surface",
  )
  assert.match(
    adminTheme,
    /html\[data-theme="dark"\] body\.admin-portal-page \.tabulator-entry-callout\s*\{\s*background:\s*linear-gradient\(180deg,\s*var\(--portal-dark-card-soft\),\s*var\(--portal-dark-card\)\);/s,
    "admin dark empty chart state should use the dark card surface",
  )
})
