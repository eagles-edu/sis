import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const sharedThemePath = path.resolve(rootDir, "web-asset/shared/portal-theme.min.css")
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
const hubPortal = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/portal-hub.html"), "utf8")

test("portal pages load the shared portal theme stylesheet", () => {
  for (const [label, relPath] of portalPaths) {
    const html = fs.readFileSync(path.resolve(rootDir, relPath), "utf8")
    assert.match(
      html,
      /<link rel="stylesheet" href="\/web-asset\/shared\/portal-theme\.min\.css">/,
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

test("shared portal theme keeps the overview grids at 3x3, not wider", () => {
  assert.ok(
    sharedTheme.includes(
      "@media (min-width:720px){\n  body.parent-portal-page .identity-list,body.student-portal-page .identity-list{grid-template-columns:repeat(4,minmax(0,1fr))}body.parent-portal-page .metrics,body.parent-portal-page .report-metrics,body.student-portal-page .detail-metrics,body.student-portal-page .metrics{grid-template-columns:repeat(3,minmax(0,1fr))}",
    ),
    "overview metrics should resolve to a 3-column shared grid on wider screens",
  )
  assert.doesNotMatch(
    sharedTheme,
    /body\.(?:student|parent)-portal-page \.metrics[\s\S]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\);/s,
    "overview metrics should not use a 6-column grid",
  )
})

test("shared portal theme standardizes the light canvas around the #577284 base", () => {
  assert.match(
    sharedTheme,
    /--portal-page-bg-base:\s*#577284;/,
    "shared theme should expose the canonical light canvas base",
  )
  assert.ok(
    sharedTheme.includes("--portal-page-bg:linear-gradient(180deg,#577284,#7c909d 18%,#dbe3ea 62%,#edf1f6);"),
    "shared theme should keep the light page background gradient based on #577284",
  )
  assert.ok(
    sharedTheme.includes(
      "--portal-page-bg-wash:radial-gradient(920px 420px at -15% -20%,rgba(87,114,132,.24) 0%,transparent 62%),radial-gradient(980px 520px at 110% -25%,rgba(87,114,132,.14) 0%,transparent 55%),linear-gradient(180deg,rgba(249,250,255,.42),rgba(235,237,247,.88));",
    ),
    "shared theme should keep the light wash derived from the same base color",
  )
  assert.match(
    parentPortal,
    /<div class="portal-layout portal-shell">/,
    "parent portal should expose the same shell class hook as the student portal",
  )
})

test("shared portal theme keeps the admin-style header chrome", () => {
  assert.ok(
    sharedTheme.includes("body.parent-portal-page .hero") &&
      sharedTheme.includes("body.parent-portal-page .topbar") &&
      sharedTheme.includes("body.student-portal-page .hero") &&
      sharedTheme.includes("body.student-portal-page .topbar") &&
      sharedTheme.includes("background:linear-gradient(180deg,#f4f8ff,#eef3fb);border-color:#98adca;color:#102f5f}"),
    "portal headers should copy the admin app-page-header chrome",
  )
})

test("shared portal theme keeps the admin-style blue footer chrome", () => {
  assert.match(
    sharedTheme,
    /--footer-background:\s*#366db1;/,
    "shared theme should define the blue footer background token",
  )
  assert.ok(sharedTheme.includes(".footer{background:var(--footer-background);"), "shared footer chrome should resolve from the shared footer token")
})

test("parent identity panel keeps the chooser at the top of the same panel", () => {
  assert.match(
    parentPortal,
    /<section class="panel" id="identityPanel">[\s\S]*<div id="quickLinksPanel" class="portal-action-strip"[\s\S]*<p id="studentIdentity" class="hint">/s,
    "the chooser should sit inside the identity panel before the identity rows",
  )
})

test("parent identity panel reuses the student identity field ids", () => {
  assert.match(parentPortal, /id="studentIdentity"/)
  assert.match(parentPortal, /id="studentEaglesIdValue"/)
  assert.match(parentPortal, /id="studentNumberValue"/)
  assert.match(parentPortal, /id="studentNameValue"/)
  assert.match(parentPortal, /id="studentGradeValue"/)
  assert.doesNotMatch(parentPortal, /id="parentIdentity"/)
  assert.doesNotMatch(parentPortal, /id="immutableEaglesId"/)
  assert.doesNotMatch(parentPortal, /id="immutableStudentNumber"/)
  assert.doesNotMatch(parentPortal, /id="immutableFullName"/)
})

test("student report copy remains wired to the required archive and grades labels", () => {
  assert.match(studentPortal, /Performance Reports SYTD Archive/)
  assert.match(
    studentPortal,
    /Performance reports SYTD: \$\{reportCount\}\. Archive access for prior school years is available through report exports\./,
  )
  assert.match(studentPortal, /Grades YTD/)
  assert.match(studentPortal, /Grade average YTD is not available yet\./)
})

test("hub keeps its own theme toggle chrome and shared theme stays scoped off it", () => {
  assert.match(hubPortal, /body\.portal-hub-page \.theme-toggle\s*\{/)
  assert.match(hubPortal, /body\.portal-hub-page \.theme-toggle__icon\s*\{/)
  assert.match(hubPortal, /html\[data-theme="dark"\] body\.portal-hub-page \.theme-toggle\s*\{[\s\S]*color:\s*var\(--portal-theme-toggle-ink-dark\);/)
  assert.match(hubPortal, /html\[data-theme="dark"\] body\.portal-hub-page \.theme-toggle__icon\s*\{[\s\S]*background:\s*var\(--portal-theme-toggle-icon-bg-dark\);/)
  assert.match(hubPortal, /html\[data-theme="dark"\] body\.portal-hub-page \.theme-toggle__icon\s*\{[\s\S]*color:\s*var\(--portal-theme-toggle-ink-dark\);/)
  assert.match(hubPortal, /wash:\s*"var\(--hub-theme-wash\)"/, "hub theme should use the shared hub wash token")
  assert.match(hubPortal, /--hub-text:\s*var\(--hub-theme-text\);/, "hub body copy should follow the shared dark text token")
  assert.match(hubPortal, /--hub-text-soft:\s*var\(--hub-theme-text-soft\);/, "hub supporting copy should follow the shared dark soft text token")
  assert.doesNotMatch(sharedTheme, /body\.portal-hub-page \.theme-toggle\s*\{/)
  assert.doesNotMatch(sharedTheme, /body\.portal-hub-page \.theme-toggle__icon\s*\{/)
  assert.doesNotMatch(sharedTheme, /(^|\n)\s*\.theme-toggle\s*\{/m)
  assert.doesNotMatch(sharedTheme, /(^|\n)\s*\.theme-toggle__icon\s*\{/m)
  assert.doesNotMatch(sharedTheme, /theme-toggle::after/i)
})

test("parent, student, and admin theme toggles keep the shared portal visual contract", () => {
  const hubToggleRules = [
    "class=\"theme-toggle\"",
    "data-theme-toggle",
    "aria-pressed=\"false\"",
    "aria-label=\"Chuyển sang giao diện tối\"",
    "data-theme-toggle-icon",
    "size=\"110%\"",
  ]

  const portalToggleMarkupRules = [
    "class=\"portal-theme-toggle\"",
    "aria-pressed=\"false\"",
    "size=\"110%\"",
    "portal-theme-toggle__icon",
  ]

  const portalToggleRules = [
    "body.student-portal-page .topbar .header-actions .portal-theme-toggle",
    "body.parent-portal-page .hero .hero-actions .portal-theme-toggle",
    "body.admin-portal-page .app-page-header .app-header-actions .portal-theme-toggle",
    "body.student-portal-page .topbar .header-actions .portal-theme-toggle__icon",
    "body.parent-portal-page .hero .hero-actions .portal-theme-toggle__icon",
    "body.admin-portal-page .app-page-header .app-header-actions .portal-theme-toggle__icon",
  ]

  const sources = [
    ["admin hub", fs.readFileSync(path.resolve(rootDir, "web-asset/admin/portal-hub.html"), "utf8"), hubToggleRules],
    ["parent portal", parentPortal, portalToggleMarkupRules],
    ["student portal", studentPortal, portalToggleMarkupRules],
  ]

  for (const [label, source, rules] of sources) {
    for (const pattern of rules) {
      assert.ok(source.includes(pattern), `${label} should keep the shared portal theme toggle contract`)
    }
    if (label !== "admin theme css") {
      assert.ok(!source.includes("data-tooltip="), `${label} should not emit a tooltip attribute`)
      assert.ok(!/title="[^"]*theme/i.test(source), `${label} should not emit a native tooltip title`)
    }
  }

  for (const pattern of portalToggleRules) {
    assert.ok(sharedTheme.includes(pattern), `shared theme CSS should own the portal toggle contract`)
  }
})

test("portal login shells codify the first-paint canvas backgrounds", () => {
  assert.ok(
    sharedTheme.includes("background:var(--portal-page-bg);color:var(--portal-text);min-height:100vh;padding-block:24px}"),
    "shared theme should keep the light portal canvas token",
  )
  assert.ok(
    sharedTheme.includes(
      "body::before{background:transparent;background-repeat:no-repeat,no-repeat,no-repeat;background-size:1080px 500px,800px 420px,100% 100%;content:\"\";inset:0;pointer-events:none;position:fixed;z-index:-1}",
    ),
    "shared theme should keep the global wash layer transparent so login pages render on one continuous page backdrop",
  )
  assert.ok(
    sharedTheme.includes("html[data-admin-auth-state=\"unauthenticated\"] body.admin-portal-page .wrap"),
    "admin unauthenticated wrap selector should exist",
  )
  assert.ok(
    sharedTheme.includes("background:transparent!important;background-image:none!important"),
    "admin auth booting wrap should stay transparent so the login page background does not split",
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
    sharedTheme.includes(
      "--fc-event-bg-color:#edf4ff;--fc-event-border-color:#83a8de;--fc-event-text-color:#173b78;",
    ),
    "shared theme should keep the default student and parent calendar events readable in light mode",
  )
  assert.ok(
    sharedTheme.includes(
      "html[data-theme=\"dark\"] body.parent-portal-page .calendar-shell,html[data-theme=\"dark\"] body.student-portal-page .calendar-shell{--fc-border-color:hsla(0,0%,100%,.16);--fc-event-bg-color:var(--portal-dark-surface-support);--fc-event-border-color:var(--portal-dark-border-strong);--fc-event-text-color:var(--portal-dark-text);",
    ),
    "shared theme should keep the default student and parent calendar events readable in dark mode",
  )
  assert.ok(
    sharedTheme.includes(
      "html[data-theme=\"dark\"] body.parent-portal-page .calendar-shell .fc-col-header-cell-cushion,html[data-theme=\"dark\"] body.parent-portal-page .calendar-shell .fc-daygrid-day-number,html[data-theme=\"dark\"] body.parent-portal-page .calendar-shell .fc-toolbar-title,html[data-theme=\"dark\"] body.student-portal-page .calendar-shell .fc-col-header-cell-cushion,html[data-theme=\"dark\"] body.student-portal-page .calendar-shell .fc-daygrid-day-number,html[data-theme=\"dark\"] body.student-portal-page .calendar-shell .fc-toolbar-title{color:var(--portal-dark-text)}",
    ),
    "shared theme should keep day numbers and headers legible in dark mode",
  )
  assert.ok(
    sharedTheme.includes("html[data-theme=\"dark\"] body.parent-portal-page .calendar-empty") &&
      sharedTheme.includes("html[data-theme=\"dark\"] body.parent-portal-page .detail-empty") &&
      sharedTheme.includes("html[data-theme=\"dark\"] body.student-portal-page .calendar-empty") &&
      sharedTheme.includes("html[data-theme=\"dark\"] body.student-portal-page .detail-empty") &&
      sharedTheme.includes("background:var(--portal-dark-surface-support);border-color:var(--portal-dark-border-strong);color:var(--portal-dark-text-soft)}"),
    "shared theme should keep empty-state boxes dark in calendar views",
  )
  assert.ok(
    sharedTheme.includes(
      "html[data-theme=\"dark\"] body.parent-portal-page :where(.homework-square, .attendance-square),html[data-theme=\"dark\"] body.student-portal-page :where(.homework-square, .attendance-square){background:var(--portal-dark-surface-support);border-color:var(--portal-dark-border-strong);color:var(--portal-dark-text)}",
    ),
    "shared theme should keep the student and parent summary cards dark",
  )
  assert.ok(
    sharedTheme.includes("html[data-theme=\"dark\"] body.parent-portal-page .attendance-square.is-good") &&
      sharedTheme.includes("html[data-theme=\"dark\"] body.parent-portal-page .homework-square.is-complete") &&
      sharedTheme.includes("html[data-theme=\"dark\"] body.student-portal-page .homework-square.is-complete") &&
      sharedTheme.includes("background:var(--portal-status-good-bg);border-color:var(--portal-status-good-border);color:var(--portal-status-good-text)}") &&
      sharedTheme.includes("html[data-theme=\"dark\"] body.parent-portal-page .attendance-square.is-risk") &&
      sharedTheme.includes("html[data-theme=\"dark\"] body.parent-portal-page .homework-square.is-arrears") &&
      sharedTheme.includes("html[data-theme=\"dark\"] body.student-portal-page .homework-square.is-arrears") &&
      sharedTheme.includes("background:var(--portal-status-bad-bg);border-color:var(--portal-status-bad-border);color:var(--portal-status-bad-text)}"),
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
    /html\[data-theme="dark"\] body\.admin-portal-page \.tabulator-entry-callout\s*\{\s*background:\s*var\(--portal-chart-surface\);/s,
    "admin dark empty chart state should use the shared chart surface",
  )
})
