import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const sharedThemePath = path.resolve(rootDir, "web-asset/shared/portal-theme.css")
const adminThemePath = path.resolve(rootDir, "web-asset/admin/student-admin.css")
const parentPortalPath = path.resolve(rootDir, "web-asset/parent/parent-portal.html")
const studentPortalPath = path.resolve(rootDir, "web-asset/student/student-portal.html")
const portalPaths = [
  ["admin hub", "web-asset/admin/portal-hub.html"],
  ["parent portal", "web-asset/parent/parent-portal.html"],
  ["student portal", "web-asset/student/student-portal.html"],
]

const sharedTheme = fs.readFileSync(sharedThemePath, "utf8")
const adminTheme = fs.readFileSync(adminThemePath, "utf8")
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

test("parent, student, and admin theme toggles keep the same hub visual contract", () => {
  const hubToggleRules = [
    /class="theme-toggle"/i,
    /data-theme-toggle/i,
    /aria-pressed="false"/i,
    /aria-label="Chuyển sang giao diện tối"/i,
    /data-theme-toggle-icon/i,
    /size="110%"/i,
  ]

  const portalToggleRules = [
    /border:\s*1px solid transparent;/,
    /justify-self:\s*end;/,
    /inline-size:\s*auto;/,
    /min-height:\s*44px;/,
    /padding:\s*7px;/,
    /transition:\s*[\s\S]*background-color 180ms ease,[\s\S]*border-color 180ms ease,[\s\S]*box-shadow 180ms ease,[\s\S]*color 180ms ease,[\s\S]*transform 180ms ease;/,
    /:hover\s*\{[\s\S]*border-color:\s*rgba\(15,\s*22,\s*41,\s*1\);[\s\S]*transform:\s*translateY\(-1px\);/i,
    /:focus-visible\s*\{[\s\S]*box-shadow:\s*0 0 0 3px rgba\(47,\s*91,\s*227,\s*0\.2\);[\s\S]*outline:\s*none;/i,
    /\.portal-theme-toggle__icon\s*\{[\s\S]*height:\s*36px;[\s\S]*width:\s*36px;/i,
    /html\[data-theme="dark"\][\s\S]*color:\s*#ffd76a;/i,
    /html\[data-theme="dark"\][\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.12\);/i,
    /html\[data-theme="dark"\][\s\S]*border-color:\s*rgba\(255,\s*215,\s*106,\s*0\.42\);/i,
  ]

  const sources = [
    ["admin hub", fs.readFileSync(path.resolve(rootDir, "web-asset/admin/portal-hub.html"), "utf8"), /body\.portal-hub-page \.theme-toggle\s*\{/, null, /size="110%"/, hubToggleRules],
    ["parent portal", parentPortal, /body\.parent-portal-page \.portal-theme-toggle\s*\{/, null, /size="110%"/],
    ["student portal", studentPortal, /body\.student-portal-page \.portal-theme-toggle\s*\{/, null, /size="110%"/],
    ["admin theme css", adminTheme, /body\.admin-portal-page \.portal-theme-toggle\s*\{/, null, null, portalToggleRules],
  ]

  for (const [label, source, baseSelector, tooltipPattern, sizePattern, rules = portalToggleRules] of sources) {
    assert.match(source, baseSelector, `${label} should scope the theme toggle to its page`)
    if (tooltipPattern) {
      assert.match(source, tooltipPattern, `${label} should render the tooltip contract`)
    }
    if (sizePattern) {
      assert.match(source, sizePattern, `${label} should render the hub-sized icon contract`)
    }
    for (const pattern of rules) {
      assert.match(source, pattern, `${label} should keep the shared hub toggle contract`)
    }
    assert.doesNotMatch(source, /data-tooltip=/i, `${label} should not emit a tooltip attribute`)
    assert.doesNotMatch(source, /title="[^"]*theme/i, `${label} should not emit a native tooltip title`)
  }
})
