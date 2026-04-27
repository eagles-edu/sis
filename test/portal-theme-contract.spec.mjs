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
  assert.match(sharedTheme, /html\[data-theme="dark"\] body\.portal-hub-page \.theme-toggle\s*\{[\s\S]*color:\s*#ffd76a;/)
  assert.match(sharedTheme, /html\[data-theme="dark"\] body\.portal-hub-page \.theme-toggle__icon\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.12\);/)
  assert.match(sharedTheme, /html\[data-theme="dark"\] body\.portal-hub-page \.theme-toggle__icon\s*\{[\s\S]*color:\s*#ffd76a;/)
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
    /html\[data-theme="dark"\] body\.admin-portal-page \.portal-theme-toggle__icon\s*\{[\s\S]*background:\s*var\(--portal-theme-toggle-icon-dark-bg,\s*rgba\(255,\s*255,\s*255,\s*0\.12\)\);/i,
  ]

  const sources = [
    ["admin hub", fs.readFileSync(path.resolve(rootDir, "web-asset/admin/portal-hub.html"), "utf8"), hubToggleRules],
    ["parent portal", parentPortal, portalToggleMarkupRules],
    ["student portal", studentPortal, portalToggleMarkupRules],
    ["admin theme css", adminTheme, [/--portal-theme-toggle-icon-dark-bg:\s*rgba\(255,\s*255,\s*255,\s*0\.08\);/]],
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
  assert.match(
    sharedTheme,
    /body\.student-portal-page,\s*body\.parent-portal-page\s*\{\s*background:\s*linear-gradient\(180deg,\s*var\(--bg-0\),\s*var\(--bg-1\)\);\s*\}/s,
    "shared theme should keep the student and parent light canvas",
  )
  assert.match(
    sharedTheme,
    /html\[data-theme="dark"\] body\.admin-portal-page::before,\s*html\[data-theme="dark"\] body\.student-portal-page::before,\s*html\[data-theme="dark"\] body\.parent-portal-page::before/s,
    "shared theme should keep the dark login canvas wash for admin, student, and parent",
  )
  assert.match(
    studentPortal,
    /html\s*\{\s*background:\s*linear-gradient\(180deg,\s*#f9faff,\s*#ebedf7\);\s*\}/s,
    "student portal should stamp the light canvas before shared CSS loads",
  )
  assert.match(
    studentPortal,
    /body\.student-portal-page\s*\{\s*background:\s*linear-gradient\(180deg,\s*#f9faff,\s*#ebedf7\);\s*color:\s*#212121;\s*\}/s,
    "student portal should keep the light login shell canvas",
  )
  assert.match(
    studentPortal,
    /html\[data-theme="dark"\]\s*\{\s*background:\s*linear-gradient\(180deg,\s*#111215,\s*#171b22\);\s*\}/s,
    "student portal should stamp the dark canvas before shared CSS loads",
  )
  assert.match(
    studentPortal,
    /html\[data-theme="dark"\]\s*body\.student-portal-page\s*\{\s*background:\s*linear-gradient\(180deg,\s*#111215,\s*#171b22\);\s*color:\s*#f2f4f7;\s*\}/s,
    "student portal should keep the dark login shell canvas",
  )
  assert.match(
    parentPortal,
    /html\s*\{\s*background:\s*linear-gradient\(180deg,\s*#f9faff,\s*#ebedf7\);\s*\}/s,
    "parent portal should stamp the light canvas before shared CSS loads",
  )
  assert.match(
    parentPortal,
    /body\.parent-portal-page\s*\{\s*background:\s*linear-gradient\(180deg,\s*#f9faff,\s*#ebedf7\);\s*color:\s*#212121;\s*\}/s,
    "parent portal should keep the light login shell canvas",
  )
  assert.match(
    parentPortal,
    /html\[data-theme="dark"\]\s*\{\s*background:\s*linear-gradient\(180deg,\s*#111215,\s*#171b22\);\s*\}/s,
    "parent portal should stamp the dark canvas before shared CSS loads",
  )
  assert.match(
    parentPortal,
    /html\[data-theme="dark"\]\s*body\.parent-portal-page\s*\{\s*background:\s*linear-gradient\(180deg,\s*#111215,\s*#171b22\);\s*color:\s*#f2f4f7;\s*\}/s,
    "parent portal should keep the dark login shell canvas",
  )
  assert.match(
    adminPortal,
    /body\s*\{\s*margin:\s*0;\s*font-family:\s*var\(--font-base\);\s*background:\s*linear-gradient\(45deg,\s*var\(--background-color\)\s*0%,\s*#8a94a8\s*100%\);\s*color:\s*#212121;\s*\}/s,
    "admin portal should keep the restored light canvas",
  )
  assert.match(
    adminPortal,
    /html\[data-theme="dark"\]\s*body\.admin-portal-page\s*\{\s*background:\s*linear-gradient\(180deg,\s*#111215\s*0%,\s*#171b22\s*100%\);\s*color:\s*#f2f4f7;\s*\}/s,
    "admin portal should keep the dark login canvas",
  )
})

test("shared portal theme keeps student and parent calendars readable in dark mode", () => {
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
  assert.match(
    adminTheme,
    /html\[data-theme="dark"\] body\.admin-portal-page :where\(input, select, textarea\)\s*\{\s*background:\s*#3a3d44;/s,
    "admin dark inputs should use the dark surface",
  )
  assert.match(
    adminTheme,
    /html\[data-theme="dark"\] body\.admin-portal-page \.grade-chart-empty\s*\{\s*background:\s*linear-gradient\(180deg,\s*var\(--portal-dark-card-soft\),\s*var\(--portal-dark-card\)\);/s,
    "admin dark empty chart state should use the dark card surface",
  )
})
