import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import postcss from "postcss"

const rootDir = process.cwd()
const buildAdminAssetsPath = path.resolve(rootDir, "tools/build-admin-assets.mjs")
const sharedThemePath = path.resolve(rootDir, "web-asset/shared/portal-theme.min.css")
const sharedThemeSourcePath = path.resolve(rootDir, "web-asset/shared/portal-theme.css")
const adminThemePath = path.resolve(rootDir, "web-asset/admin/student-admin.css")
const adminPortalPath = path.resolve(rootDir, "web-asset/admin/student-admin.html")
const parentPortalPath = path.resolve(rootDir, "web-asset/parent/parent-portal.html")
const studentPortalPath = path.resolve(rootDir, "web-asset/student/student-portal.html")
const buildAdminAssets = fs.readFileSync(buildAdminAssetsPath, "utf8")
const portalPaths = [
  ["admin hub", "web-asset/admin/portal-hub.html"],
  ["parent portal", "web-asset/parent/parent-portal.html"],
  ["student portal", "web-asset/student/student-portal.html"],
]

const sharedTheme = fs.readFileSync(sharedThemePath, "utf8")
const sharedThemeSource = fs.readFileSync(sharedThemeSourcePath, "utf8")
const adminTheme = fs.readFileSync(adminThemePath, "utf8")
const adminPortal = fs.readFileSync(adminPortalPath, "utf8")
const parentPortal = fs.readFileSync(parentPortalPath, "utf8")
const studentPortal = fs.readFileSync(studentPortalPath, "utf8")
const hubPortal = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/portal-hub.html"), "utf8")
const gradesTabulatorPortal = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/grades-tabulator.html"), "utf8")
const studentPointsPortal = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/student-points.html"), "utf8")
const denyLocalThemePropertyPattern = /\b(?:background(?:-color)?|border(?:-color)?|box-shadow|fill|stroke|color)\s*:/u
const colorLiteralPattern = /#(?:[0-9a-fA-F]{3,8})\b|\b(?:rgba?|hsla?|color-mix)\([^)]*\)/g
const styleBlockPattern = /<style[^>]*>([\s\S]*?)<\/style>/gi

function stripAllowedThemeSnippets(html, allowlist) {
  const styleBlocks = Array.from(html.matchAll(styleBlockPattern), (match) => match[1] || "")
  return styleBlocks
    .map((block) => allowlist.reduce((result, pattern) => result.replace(pattern, ""), block))
    .join("\n")
}

function collectColorLiteralHits(cssText, filePath) {
  const hits = []
  const root = postcss.parse(cssText, { from: filePath })
  root.walkDecls((decl) => {
    const matches = decl.value.match(colorLiteralPattern)
    if (matches) {
      hits.push(`${decl.prop}: ${decl.value}`)
    }
  })
  return hits
}

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

test("portal home links use canonical runtime routes", () => {
  assert.match(
    parentPortal,
    /<a class="brand-logo-wrap brand-logo-wrap--sm" href="\/parent" aria-label="Go to parent home">/,
    "parent portal should link its logo to /parent",
  )
  assert.match(
    studentPortal,
    /<a class="brand-logo-wrap brand-logo-wrap--sm" href="\/student" aria-label="Go to student home">/,
    "student portal should link its logo to /student",
  )
})

test("shared portal theme minified asset is generated from portal-theme.css by the build script", () => {
  assert.match(
    buildAdminAssets,
    /source:\s*path\.join\(REPO_ROOT,\s*"web-asset\/shared\/portal-theme\.css"\),\s*output:\s*path\.join\(REPO_ROOT,\s*"web-asset\/shared\/portal-theme\.min\.css"\)/s,
    "build-admin-assets.mjs should define portal-theme.css as the only shared theme source for portal-theme.min.css",
  )
  assert.match(
    buildAdminAssets,
    /task\.kind === "css" \? await buildAdminCss\(task\.source\) : await buildAdminJs\(task\.source\)/,
    "build-admin-assets.mjs should rebuild minified assets from source files",
  )
})

test("shared dark neutral ladder values stay pinned to the documented palette", () => {
  assert.match(
    sharedThemeSource,
    /--portal-neutral-content-dark:\s*#2d2d2d;/,
    "portal-theme.css should define the shared dark content token as #2d2d2d",
  )
  assert.match(
    sharedThemeSource,
    /--portal-neutral-panel-dark:\s*#3b3c3e;/,
    "portal-theme.css should define the shared dark panel token as #3b3c3e",
  )
  assert.match(
    sharedTheme,
    /--portal-neutral-content-dark:#2d2d2d;/,
    "portal-theme.min.css should carry the shared dark content token",
  )
  assert.match(
    sharedTheme,
    /--portal-neutral-panel-dark:#3b3c3e;/,
    "portal-theme.min.css should carry the shared dark panel token",
  )
})

test("shared portal theme centralizes the admin users table frame and row separator", () => {
  assert.match(
    sharedThemeSource,
    /body\.admin-portal-page \.user-admin-table \{\s*border:\s*1px solid var\(--border-strong\);\s*border-radius:\s*var\(--radius-2\);\s*overflow:\s*hidden;\s*\}/s,
    "portal-theme.css should own the admin users table frame",
  )
  assert.match(
    sharedThemeSource,
    /body\.admin-portal-page \.user-admin-table tbody td \{\s*border-bottom:\s*1px solid var\(--border-strong\) !important;\s*\}/s,
    "portal-theme.css should own the admin users row separator",
  )
  assert.match(
    sharedThemeSource,
    /html\[data-theme="dark"\] body\.admin-portal-page \.user-admin-table tbody td \{\s*border-bottom-color:\s*var\(--portal-dark-border-strong\) !important;\s*\}/s,
    "portal-theme.css should own the dark users row separator",
  )
  assert.match(
    sharedTheme,
    /body\.admin-portal-page \.user-admin-table\{border:1px solid var\(--border-strong\);border-radius:var\(--radius-2\);overflow:hidden\}/,
    "portal-theme.min.css should carry the admin users table frame",
  )
  assert.match(
    sharedTheme,
    /body\.admin-portal-page \.user-admin-table tbody td\{border-bottom:1px solid var\(--border-strong\)!important\}/,
    "portal-theme.min.css should carry the admin users row separator",
  )
  assert.match(
    sharedTheme,
    /html\[data-theme="dark"\] body\.admin-portal-page \.user-admin-table tbody td\{border-bottom-color:var\(--portal-dark-border-strong\)!important\}/,
    "portal-theme.min.css should carry the dark admin users row separator",
  )
})

test("repo app pages do not define raw theme colors in inline style or script blocks", () => {
  const appHtmlPaths = [
    "web-asset/admin/grades-tabulator-dev.html",
    "web-asset/admin/grades-tabulator.html",
    "web-asset/admin/portal-hub.html",
    "web-asset/admin/student-admin.html",
    "web-asset/admin/student-points.html",
    "web-asset/parent/parent-portal.html",
    "web-asset/student/fi.html",
    "web-asset/student/student-portal.html",
  ]
  const styleBlockPattern = /<style>([\s\S]*?)<\/style>/gi
  const scriptBlockPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi
  const styleColorPattern = /(?:^|[;{])\s*--?[\w-]+\s*:\s*[^;{}]*(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|color-mix\()/u
  const scriptColorPattern = /(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|color-mix\()/u
  const styleAllowlists = new Map([
    [
      path.resolve(rootDir, "web-asset/student/student-portal.html"),
      [
        /\.submit-success-confetti-piece\s*\{[\s\S]*?\}\s*/gs,
        /\.submit-success-mark\s*\{[\s\S]*?\}\s*/gs,
      ],
    ],
    [
      path.resolve(rootDir, "web-asset/admin/student-admin.html"),
      [
        /html\[data-theme="dark"\]\s+body\.admin-portal-page\.page\s*\{[\s\S]*?background-attachment:\s*fixed;\s*\}/gs,
        /body\.admin-portal-page\.page\s*\{[\s\S]*?background-attachment:\s*fixed;\s*\}/gs,
      ],
    ],
    [
      path.resolve(rootDir, "web-asset/admin/grades-tabulator.html"),
      [
        /body\.admin-portal-page \.period-btn\.is-active,\s*body\.admin-portal-page \.period-btn\[aria-pressed="true"\]\s*\{[\s\S]*?\}\s*/gs,
        /body\.admin-portal-page \.period-btn\.is-active:hover,\s*body\.admin-portal-page \.period-btn\.is-active:focus-visible,\s*body\.admin-portal-page \.period-btn\[aria-pressed="true"\]:hover,\s*body\.admin-portal-page \.period-btn\[aria-pressed="true"\]:focus-visible\s*\{[\s\S]*?\}\s*/gs,
        /body\.admin-portal-page \.period-btn\.is-active:active,\s*body\.admin-portal-page \.period-btn\[aria-pressed="true"\]:active\s*\{[\s\S]*?\}\s*/gs,
        /html\[data-theme="dark"\] body\.admin-portal-page \.period-btn\.is-active,\s*html\[data-theme="dark"\] body\.admin-portal-page \.period-btn\[aria-pressed="true"\]\s*\{[\s\S]*?\}\s*/gs,
        /\.distribution-mini-button\s*\{[\s\S]*?\}\s*/gs,
        /html\[data-theme="dark"\] body\.grades-tabulator-page \.distribution-mini-button\s*\{[\s\S]*?\}\s*/gs,
      ],
    ],
  ])
  const scriptAllowlists = new Map([
    [
      path.resolve(rootDir, "web-asset/student/student-portal.html"),
      [
        /const palette = \[\s*"#ffd54f",\s*"#2f5be3",\s*"#39b86f",\s*"#ff7a59",\s*"#8e61ff",\s*"#1ecad3",\s*\];/s,
      ],
    ],
    [
      path.resolve(rootDir, "web-asset/admin/grades-tabulator.html"),
      [
        /button\.style\.background = "linear-gradient\(180deg, #007b97 0%, #00647c 100%\)"\s*button\.style\.border = "2px solid #006f94"\s*button\.style\.color = "#fbffff"\s*button\.style\.boxShadow =\s*"inset 0 0 0 1px rgba\(255, 255, 255, 0\.24\), 0 0 0 1px rgba\(6, 72, 111, 0\.28\), 0 10px 18px rgba\(8, 22, 40, 0\.14\)"/s,
      ],
    ],
  ])

  for (const relPath of appHtmlPaths) {
    const html = fs.readFileSync(path.resolve(rootDir, relPath), "utf8")
    const styleBlocks = Array.from(html.matchAll(styleBlockPattern), (match) => match[1] || "")
    const scriptBlocks = Array.from(html.matchAll(scriptBlockPattern), (match) => match[1] || "")
    const styleAllowlist = styleAllowlists.get(path.resolve(rootDir, relPath)) || []
    const strippedStyleBlocks = styleBlocks
      .map((block) => styleAllowlist.reduce((result, pattern) => result.replace(pattern, ""), block))
    const scriptAllowlist = scriptAllowlists.get(path.resolve(rootDir, relPath)) || []
    const strippedScriptBlocks = scriptBlocks
      .map((block) => scriptAllowlist.reduce((result, pattern) => result.replace(pattern, ""), block))
    assert.ok(
      strippedStyleBlocks.every((block) => !styleColorPattern.test(block)),
      `${relPath} should keep inline style colors in the shared theme token contract`,
    )
    assert.ok(
      strippedScriptBlocks.every((block) => !scriptColorPattern.test(block)),
      `${relPath} should not hardcode theme colors in inline scripts`,
    )
  }
})

test("portal-facing pages route every raw color literal through the shared theme registry", () => {
  const filePaths = [
    "web-asset/admin/student-admin.html",
    "web-asset/admin/portal-hub.html",
    "web-asset/admin/student-points.html",
    "web-asset/parent/parent-portal.html",
    "web-asset/student/student-portal.html",
    "web-asset/student/fi.html",
    "web-asset/Untitled-1.html",
  ]
  const styleBlockPattern = /<style>([\s\S]*?)<\/style>/gi
  const styleAllowlists = new Map([
    [
      path.resolve(rootDir, "web-asset/student/student-portal.html"),
      [
        /\.submit-success-confetti-piece\s*\{[\s\S]*?\}\s*/gs,
        /\.submit-success-mark\s*\{[\s\S]*?\}\s*/gs,
      ],
    ],
    [
      path.resolve(rootDir, "web-asset/admin/student-admin.html"),
      [
        /html\[data-theme="dark"\]\s+body\.admin-portal-page\.page\s*\{[\s\S]*?background-attachment:\s*fixed;\s*\}/gs,
        /body\.admin-portal-page\.page\s*\{[\s\S]*?background-attachment:\s*fixed;\s*\}/gs,
      ],
    ],
  ])

  for (const relPath of filePaths) {
    const filePath = path.resolve(rootDir, relPath)
    const text = fs.readFileSync(filePath, "utf8")
    const cssChunks = filePath.endsWith(".css")
      ? [text]
      : Array.from(text.matchAll(styleBlockPattern), (match) => match[1] || "")
    const styleAllowlist = styleAllowlists.get(filePath) || []
    const strippedCssChunks = cssChunks
      .map((chunk) => styleAllowlist.reduce((result, pattern) => result.replace(pattern, ""), chunk))

    const hits = strippedCssChunks.flatMap((chunk) => collectColorLiteralHits(chunk, filePath))
    assert.equal(
      hits.length,
      0,
      `${relPath} should not contain raw color literals outside the shared theme registry`,
    )
  }
})

test("security badges use the white secure-network asset in dark mode", () => {
  assert.match(
    parentPortal,
    /security-badge__icon security-badge__icon--dark" src="\/web-asset\/shared\/secure-network-white\.svg"/,
    "parent portal should reference the white security icon variant",
  )
  assert.match(
    studentPortal,
    /security-badge__icon security-badge__icon--dark" src="\/web-asset\/shared\/secure-network-white\.svg"/,
    "student portal should reference the white security icon variant",
  )
  assert.match(
    sharedThemeSource,
    /html\[data-theme="dark"\]\s+body\.(?:student|parent)-portal-page\s+\.security-badge__icon--dark/,
    "shared portal theme should show the white icon in dark mode",
  )
  assert.match(
    sharedThemeSource,
    /html\[data-theme="dark"\]\s+body\.(?:student|parent)-portal-page\s+\.security-badge__icon--light/,
    "shared portal theme should hide the default icon in dark mode",
  )
})

test("portal pages fail closed on local theme ownership outside the explicit structural allowlist", () => {
  const allowlists = new Map([
    [studentPortalPath, [
      /html\s*\{\s*background:\s*var\(--portal-page-bg\);\s*\}/gs,
      /body\.student-portal-page\s*\{\s*background:\s*var\(--portal-page-bg\);\s*color:\s*var\(--portal-text\);\s*\}/gs,
      /\/\*\s*portal-critical-theme:start\s*\*\/[\s\S]*?\/\*\s*portal-critical-theme:end\s*\*\//gs,
      /\.queue-table-wrap\s*\{[\s\S]*?background:\s*var\(--portal-surface-card\);\s*\}/gs,
      /\.queue-table-wrap table\.news-queue-table tbody tr\s*\{[\s\S]*?background:\s*var\(--portal-surface-support\);\s*padding:\s*8px;\s*\}/gs,
      /\.homework-modal-table th\s*\{[\s\S]*?color:\s*var\(--portal-text-soft\);[\s\S]*?\}/gs,
      /\.detail-item-title a\s*\{[\s\S]*?color:\s*inherit;[\s\S]*?\}/gs,
      /@keyframes dayAlertPulse\s*\{[\s\S]*?box-shadow:\s*inset 0 0 0 3px var\(--portal-status-bad-text\);\s*\}\s*\}/gs,
    ]],
    [parentPortalPath, [
      /html\s*\{\s*background:\s*var\(--portal-page-bg\);\s*\}/gs,
      /body\.parent-portal-page\s*\{\s*background:\s*var\(--portal-page-bg\);\s*color:\s*var\(--portal-text\);\s*\}/gs,
      /\/\*\s*portal-critical-theme:start\s*\*\/[\s\S]*?\/\*\s*portal-critical-theme:end\s*\*\//gs,
    ]],
    [adminPortalPath, [
      /html\s*\{\s*background:\s*var\(--portal-page-bg\);\s*\}/gs,
      /body\s*\{\s*margin:\s*0;\s*min-height:\s*100vh;\s*font-family:\s*var\(--font-base,\s*system-ui,\s*-apple-system,\s*sans-serif\);\s*background:\s*var\(--portal-page-bg\);\s*color:\s*var\(--portal-text\);\s*\}/gs,
      /:root\s*\{\s*--font-base:[\s\S]*?\}/gs,
      /html\[data-theme="dark"\]\s+body\.admin-portal-page\.page\s*\{[\s\S]*?background-attachment:\s*fixed;\s*\}/gs,
      /body\.admin-portal-page\.page\s*\{[\s\S]*?background-attachment:\s*fixed;\s*\}/gs,
      /body\.admin-auth-booting\s*#authBootPanel\s*\{\s*display:\s*grid;\s*\}/gs,
      /body\.admin-auth-booting\s*#authPanel,\s*body\.admin-auth-booting\s*#app\s*\{\s*display:\s*none\s*!important;\s*\}/gs,
      /html\[data-admin-auth-state\]\s*body\.admin-portal-page\.admin-auth-booting\s*#authBootPanel\s*\{\s*display:\s*none\s*!important;\s*\}/gs,
      /html\[data-admin-auth-state="authenticated"\]\s*body\.admin-portal-page\.admin-auth-booting\s*#authPanel\s*\{\s*display:\s*none\s*!important;\s*\}/gs,
      /html\[data-admin-auth-state="authenticated"\]\s*body\.admin-portal-page\.admin-auth-booting\s*#app\s*\{\s*display:\s*block\s*!important;\s*\}/gs,
      /html\[data-admin-auth-state="unauthenticated"\]\s*body\.admin-portal-page\.admin-auth-booting\s*#authPanel\s*\{\s*display:\s*block\s*!important;\s*\}/gs,
      /\.school-setup-warning\s*\{\s*background:\s*var\(--portal-status-warn-bg\);\s*border:\s*1px solid var\(--portal-status-warn-border\);\s*border-radius:\s*var\(--radius-2\);\s*color:\s*var\(--portal-status-warn-text\);\s*font-size:\s*12px;\s*line-height:\s*1\.45;\s*margin-top:\s*10px;\s*padding:\s*10px 12px;\s*\}/gs,
      /\.school-setup-warning a\s*\{\s*color:\s*inherit;\s*font-weight:\s*700;\s*\}/gs,
      /\.profile-info-toolbar-note\s*\{\s*color:\s*var\(--portal-text-soft\);\s*font-size:\s*12px;\s*grid-area:\s*note;\s*line-height:\s*1\.35;\s*margin:\s*0;\s*width:\s*100%;\s*\}/gs,
      /\.system-health-loading-pulse\s*\{\s*height:\s*105\.6px;\s*position:\s*relative;\s*width:\s*105\.6px;\s*\}/gs,
    ]],
    [path.resolve(rootDir, "web-asset/admin/student-points.html"), []],
  ])

  for (const [filePath, allowlist] of allowlists.entries()) {
    const stripped = stripAllowedThemeSnippets(fs.readFileSync(filePath, "utf8"), allowlist)
    assert.doesNotMatch(
      stripped,
      denyLocalThemePropertyPattern,
      `${path.relative(rootDir, filePath)} should keep local CSS structural-only outside the explicit theme allowlist`,
    )
  }
})

test("student and parent portals keep critical grade and quarter overrides local after vendor css", () => {
  assert.match(studentPortal, /\/\*\s*portal-critical-theme:start\s*\*\//)
  assert.match(parentPortal, /\/\*\s*portal-critical-theme:start\s*\*\//)
  assert.match(studentPortal, /\.grade-quarter-picker-btn\s*\{/)
  assert.match(parentPortal, /\.grade-quarter-picker-btn\s*\{/)
  assert.match(studentPortal, /\.grade-tabulator-shell \.tabulator \.tabulator-row\.is-open\s*\{/)
  assert.match(parentPortal, /\.grade-tabulator-shell \.tabulator \.tabulator-row\.is-open\s*\{/)
  assert.match(studentPortal, /\.quarter-board-card\s*\{/)
  assert.match(parentPortal, /\.quarter-board-card\s*\{/)
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

test("shared portal theme owns reusable surface roles for columns, panels, cards, tables, charts, and dialogs", () => {
  for (const token of [
    ".portal-center-column",
    ".portal-theme-panel",
    ".portal-theme-card",
    ".portal-theme-soft-card",
    ".portal-theme-table-shell",
    ".portal-theme-chart-shell",
    ".portal-theme-dialog",
    ".portal-theme-tooltip",
    ".portal-theme-overlay",
    ".portal-theme-overlay-strong",
  ]) {
    assert.ok(sharedTheme.includes(token), `shared theme should define ${token}`)
  }

  assert.match(studentPointsPortal, /class="app content portal-center-column"/)
  assert.match(studentPointsPortal, /class="card portal-theme-card"/)
  assert.match(studentPointsPortal, /class="chart-wrap panel"/)
  assert.match(studentPointsPortal, /class="table-wrap panel"/)
  assert.doesNotMatch(studentPointsPortal, /\.card\s*\{[^}]*(background|border:\s*1px|box-shadow:)/)
  assert.doesNotMatch(studentPointsPortal, /\.chart-wrap\s*\{[^}]*(background|border:\s*1px)/)
  assert.doesNotMatch(studentPointsPortal, /\.table-wrap\s*\{[^}]*border:\s*1px/)

  assert.match(gradesTabulatorPortal, /class="content" data-surface-role="content"/)
  assert.match(gradesTabulatorPortal, /class="control-card portal-theme-panel"/)
  assert.match(gradesTabulatorPortal, /class="metric-card portal-theme-card"/)
  assert.match(gradesTabulatorPortal, /class="grid-card portal-theme-card"/)
  assert.match(gradesTabulatorPortal, /id="gradeGrid" class="portal-theme-table-shell"/)
  assert.match(gradesTabulatorPortal, /class="table-modal-backdrop portal-theme-overlay-strong"/)
  assert.match(gradesTabulatorPortal, /class="distribution-modal-backdrop portal-theme-overlay"/)
  assert.match(gradesTabulatorPortal, /class="distribution-dialog portal-theme-dialog"/)
  assert.match(gradesTabulatorPortal, /class="distribution-chart-shell portal-theme-soft-card"/)
  assert.match(gradesTabulatorPortal, /class="distribution-hover portal-theme-tooltip"/)
  assert.match(
    gradesTabulatorPortal,
    /button\.className\s*=\s*"distribution-mini-button portal-button portal-button-immutable-chrome"/,
  )
  for (const selector of [
    /\.hero,\s*\.control-card,\s*\.grid-card\s*\{[^}]*(background|border:\s*1px|box-shadow:)/,
    /\.metric-card\s*\{[^}]*(background|border:\s*1px)/,
    /#gradeGrid\s*\{[^}]*(background|border:\s*1px)/,
    /\.table-modal-backdrop\s*\{[^}]*background:/,
    /\.distribution-modal-backdrop\s*\{[^}]*background:/,
    /\.distribution-dialog\s*\{[^}]*(background|border:\s*1px|box-shadow:)/,
    /\.distribution-chart-shell\s*\{[^}]*(background|border:\s*1px)/,
    /\.distribution-hover\s*\{[^}]*(background|border:\s*1px|box-shadow:|color:)/,
  ]) {
    assert.doesNotMatch(gradesTabulatorPortal, selector)
  }
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

test("shared portal theme standardizes the light canvas tokens", () => {
  assert.match(
    sharedTheme,
    /--portal-page-bg-base:\s*#e8eef4;/,
    "shared theme should expose the canonical light canvas base",
  )
  assert.ok(
    sharedTheme.includes("--portal-page-bg:#e8eef4;"),
    "shared theme should keep the light page background fill",
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
    sharedTheme.includes(".topbar{align-items:center;background:var(--portal-role-content-bg);border-color:var(--portal-role-border);color:var(--portal-role-text);") &&
      sharedTheme.includes("body.admin-portal-page .app-page-header") &&
      sharedTheme.includes("body.parent-portal-page .hero"),
    "portal headers should use the shared hero/topbar chrome",
  )
})

test("shared portal theme keeps the admin-style blue footer chrome", () => {
  assert.match(
    sharedTheme,
    /--footer-background:\s*var\(--theme-footer-bg\);/,
    "shared theme should define the shared footer background token",
  )
  assert.ok(sharedTheme.includes(".footer{background:var(--footer-background);"), "shared footer chrome should resolve from the shared footer token")
})

test("shared portal theme keeps admin today snapshot cards LM=DM for the stat-card subset", () => {
  assert.doesNotMatch(
    sharedTheme,
    /html\[data-theme="dark"\] body\.admin-portal-page \.stat-card/,
    "Today Snapshot stat cards should not carry any dark-mode-specific override",
  )
})

test("shared portal theme keeps unauthenticated header bars aligned to the login panel width", () => {
  assert.ok(
    sharedTheme.includes('html[data-parent-auth-state="unauthenticated"] body.parent-portal-page div.header-bar') &&
      sharedTheme.includes('html[data-student-auth-state="unauthenticated"] body.student-portal-page div.header-bar') &&
      sharedTheme.includes('body.parent-portal-page .hub-footer') &&
      sharedTheme.includes('box-sizing:border-box') &&
      sharedTheme.includes('max-inline-size:var(--portal-login-panel-max-width)') &&
      sharedTheme.includes('width:min(100%,var(--portal-login-panel-max-width))'),
    "unauthenticated login shells should use the login panel as the bounding container",
  )
})

test("parent identity panel keeps the chooser at the top of the same panel", () => {
  assert.match(
    parentPortal,
    /<section class="panel" id="identityPanel"[^>]*>[\s\S]*?<div id="quickLinksPanel" class="portal-action-strip"[\s\S]*?<p id="studentIdentity" class="hint">/s,
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
  assert.match(sharedTheme, /body\.portal-hub-page \.theme-toggle\s*\{/)
  assert.match(sharedTheme, /body\.portal-hub-page \.theme-toggle__icon\s*\{/)
  assert.ok(
    sharedTheme.includes(
      "html[data-theme=\"dark\"] body.portal-hub-page .theme-toggle{background:transparent;border-color:transparent;color:var(--portal-theme-toggle-ink-dark)}",
    ),
  )
  assert.ok(
    sharedTheme.includes(
      "html[data-theme=\"dark\"] body.portal-hub-page .theme-toggle__icon{background:var(--portal-theme-toggle-icon-bg-dark);color:var(--portal-theme-toggle-ink-dark)}",
    ),
  )
  assert.doesNotMatch(hubPortal, /body\.portal-hub-page \.theme-toggle\s*\{/)
  assert.doesNotMatch(hubPortal, /body\.portal-hub-page \.theme-toggle__icon\s*\{/)
  assert.match(hubPortal, /background:\s*var\(--hub-theme-page-bg-body\);/, "hub page should use the shared hub page background token")
  assert.match(hubPortal, /<span class="portal-hub-bg__wash"><\/span>/, "hub page should keep the dedicated wash layer element")
  assert.match(
    sharedTheme,
    /body\.portal-hub-page \.portal-hub-bg__wash\{background:var\(--hub-wash\);mix-blend-mode:screen;opacity:\.82\}/,
    "shared theme should own the hub wash layer styling",
  )
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
    "class=\"portal-theme-toggle portal-button portal-button-immutable-chrome\"",
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
    sharedTheme.includes("body.page{background:var(--portal-page-bg);color:var(--portal-text);min-height:100vh}"),
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
  assert.doesNotMatch(
    studentPortal,
    /body\.student-portal-page\s*\{[\s\S]*?background:\s*var\(--portal-page-bg\);[\s\S]*?\}/s,
    "student portal should not restamp the shared light canvas token locally",
  )
  assert.doesNotMatch(
    studentPortal,
    /html\s*\{\s*background:\s*var\(--portal-page-bg\);\s*\}/s,
    "student portal should not restamp the shared light canvas token locally",
  )
  assert.doesNotMatch(
    parentPortal,
    /body\.parent-portal-page\s*\{[\s\S]*?background:\s*var\(--portal-page-bg\);[\s\S]*?\}/s,
    "parent portal should not restamp the shared light canvas token locally",
  )
  assert.doesNotMatch(
    parentPortal,
    /html\s*\{\s*background:\s*var\(--portal-page-bg\);\s*\}/s,
    "parent portal should not restamp the shared light canvas token locally",
  )
  assert.match(
    adminPortal,
    /body\s*\{\s*margin:\s*0;\s*min-height:\s*100vh;\s*font-family:\s*var\(--font-base,\s*system-ui,\s*-apple-system,\s*sans-serif\);\s*background:\s*var\(--portal-page-bg\);\s*color:\s*var\(--portal-text\);\s*\}/s,
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
    /html\[data-theme="dark"\] body\.parent-portal-page \.calendar-shell,html\[data-theme="dark"\] body\.student-portal-page \.calendar-shell\{--fc-border-color:hsla\(0,0%,100%,\.16\);--fc-event-bg-color:var\(--portal-dark-surface-support\);--fc-event-border-color:var\(--portal-dark-border-strong\);--fc-event-text-color:var\(--portal-dark-text\);/s.test(
      sharedTheme,
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
    sharedTheme.includes("--portal-role-card-bg:var(--portal-dark-surface-card);") &&
      sharedTheme.includes("--portal-role-panel-bg:var(--portal-dark-surface-panel);") &&
      sharedTheme.includes("--portal-role-content-bg:var(--portal-neutral-content-dark);"),
    "shared theme should switch the portal role surfaces to the dark tokens",
  )
  assert.ok(
    /body\.parent-portal-page :is\(\.homework-square, \.attendance-square\),body\.student-portal-page :is\(\.homework-square, \.attendance-square\)\{align-content:center;background:linear-gradient\(/s.test(
      sharedTheme,
    ) &&
      sharedTheme.includes("color:var(--square-text,var(--portal-role-text));"),
    "shared theme should keep the student and parent summary squares tied to the shared surface contract",
  )
  assert.ok(
    /body\.(?:parent|student)-portal-page \.fc \.fc-event\.fc-event-news-status-revise \.fc-event-main,[^}]*color:#422b7a!important/.test(
      sharedTheme,
    ),
    "shared theme should force revise event text to the purple brand color",
  )
  assert.ok(
    /body\.(?:parent|student)-portal-page \.fc \.fc-event\.fc-event-news-status-amber \.fc-event-main,[^}]*color:#5b3b00!important/.test(
      sharedTheme,
    ),
    "shared theme should force amber event text to the amber brand color",
  )
  assert.ok(
    /body\.parent-portal-page \.attendance-square\.is-good,\s*body\.parent-portal-page \.homework-square\.is-complete,\s*body\.student-portal-page \.attendance-square\.is-good,body\.student-portal-page \.homework-square\.is-complete\{[^}]*--square-bg-start:color-mix\(in srgb,var\(--portal-role-card-bg\) 86%,#349f61 14%\);/s.test(
      sharedTheme,
    ) &&
      /body\.parent-portal-page \.attendance-square\.is-risk,\s*body\.parent-portal-page \.homework-square\.is-arrears,\s*body\.student-portal-page \.attendance-square\.is-risk,body\.student-portal-page \.homework-square\.is-arrears\{[^}]*--square-bg-start:color-mix\(in srgb,var\(--portal-role-card-bg\) 86%,#cc4452 14%\);/s.test(
        sharedTheme,
      ),
    "shared theme should keep the summary state chips legible in dark mode",
  )
  assert.ok(
    sharedTheme.includes(
      "html[data-theme=\"dark\"] body.parent-portal-page .draft-actions{background:var(--portal-dark-surface-panel)!important;border-color:var(--portal-dark-border)!important;color:var(--portal-dark-text)!important}",
    ),
    "shared theme should keep the parent draft action bar on the dark card surface",
  )
})

test("shared portal theme keeps dark form fields readable", () => {
  assert.match(sharedTheme, /--portal-dark-field-bg:#272c2f/)
  assert.match(sharedTheme, /--portal-dark-field-active-bg:#4b5157/)
  assert.match(sharedTheme, /--portal-dark-field-active-border:#c8d0da/)
  assert.match(sharedTheme, /--portal-dark-field-placeholder:#58657a/)
  assert.match(
    sharedTheme,
    /html\[data-theme="dark"\]\s*body\.student-portal-page\s+input,/,
  )
  assert.match(
    sharedTheme,
    /html\[data-theme="dark"\]\s*body\.parent-portal-page\s+textarea,/,
  )
  assert.match(
    sharedTheme,
    /html\[data-theme="dark"\]\s*body\.admin-portal-page\s+select:focus-visible/,
  )
  assert.match(
    sharedTheme,
    /html\[data-theme="dark"\]\s*body\.student-portal-page\s+input::placeholder/,
  )
  assert.match(
    sharedTheme,
    /html\[data-theme="dark"\]\s*body\.parent-portal-page\s+textarea::placeholder/,
  )
  assert.match(
    sharedTheme,
    /html\[data-theme="dark"\]\s*body\.admin-portal-page\s+select::placeholder/,
  )
  assert.doesNotMatch(sharedTheme, /body\.student-points-page\s*:is\(input,\s*select,\s*textarea,\s*button\)/)
  assert.doesNotMatch(sharedTheme, /body\.student-points-page\s*:where\(input,\s*select,\s*textarea\)::placeholder/)
})

test("portal sources avoid dark-only recolors for buttons, chips, pills, and washes", () => {
  for (const html of [studentPortal, parentPortal]) {
    for (const pattern of [
      /html\[data-theme="dark"\]\s+\.grade-quarter-pill/,
      /html\[data-theme="dark"\]\s+\.quarter-board-meta-chip/,
      /html\[data-theme="dark"\]\s+\.quarter-board-current-pill/,
      /html\[data-theme="dark"\]\s+\.grade-quarter-picker-btn/,
      /html\[data-theme="dark"\]\s+\.header-action-btn\.(?:plus|minus)/,
      /html\[data-theme="dark"\]\s+\.grade-status-pill\./,
    ]) {
      assert.doesNotMatch(html, pattern)
    }
  }

  for (const pattern of [
    /html\[data-theme="dark"\] body\.student-portal-page \.grade-quarter-pill/,
    /html\[data-theme="dark"\] body\.parent-portal-page \.grade-quarter-pill/,
    /html\[data-theme="dark"\] body\.student-portal-page \.quarter-board-meta-chip/,
    /html\[data-theme="dark"\] body\.parent-portal-page \.quarter-board-meta-chip/,
    /html\[data-theme="dark"\] body\.student-portal-page \.quarter-board-current-pill/,
    /html\[data-theme="dark"\] body\.parent-portal-page \.quarter-board-current-pill/,
    /html\[data-theme="dark"\] body\.student-portal-page \.grade-quarter-picker-btn/,
    /html\[data-theme="dark"\] body\.parent-portal-page \.grade-quarter-picker-btn/,
    /html\[data-theme="dark"\] body\.student-portal-page \.header-action-btn\.(?:plus|minus)/,
    /html\[data-theme="dark"\] body\.parent-portal-page \.header-action-btn\.(?:plus|minus)/,
    /html\[data-theme="dark"\] body\.student-points-page button:not\(\.primary\)/,
    /html\[data-theme="dark"\] body\.admin-portal-page #authPanel button\.primary/,
  ]) {
    assert.doesNotMatch(sharedTheme, pattern)
  }
})

test("shared portal theme expands mobile choice hit areas for radios and checkboxes", () => {
  assert.match(sharedTheme, /@media\s*\(max-width:520px\)\{/)
  assert.ok(
    sharedTheme.includes("body.parent-portal-page .choice-option,body.student-portal-page .choice-option") ||
      sharedTheme.includes("body.student-portal-page .choice-option,body.parent-portal-page .choice-option"),
    "mobile choice controls should expand the parent/student option hit area",
  )
  assert.ok(
    sharedTheme.includes("min-height:44px") && sharedTheme.includes("touch-action:manipulation"),
    "mobile choice controls should expose a larger hit area",
  )
  assert.ok(
    sharedTheme.includes('input[type="checkbox"]') &&
      sharedTheme.includes('input[type="radio"]') &&
      sharedTheme.includes("height:22px") &&
      sharedTheme.includes("width:22px"),
    "mobile choice controls should expose a larger affordance size",
  )
})

test("shared portal theme enlarges mobile select targets for parent and student forms", () => {
  assert.match(sharedTheme, /@media\s*\(max-width:520px\)\{/)
  assert.ok(
    sharedTheme.includes("body.student-portal-page select,body.parent-portal-page select") ||
      sharedTheme.includes("body.parent-portal-page select,body.student-portal-page select"),
    "mobile selects should be explicitly widened in the shared theme",
  )
  assert.ok(
    sharedTheme.includes("min-height:48px") &&
      sharedTheme.includes("padding-block:12px") &&
      sharedTheme.includes("touch-action:manipulation"),
    "mobile selects should expose a larger tap target",
  )
})

test("shared portal theme widens the parent dashboard quick-link dropdown target", () => {
  assert.match(sharedTheme, /@media\s*\(max-width:520px\)\{/)
  assert.ok(
    sharedTheme.includes("body.parent-portal-page .quick-link-select,body.student-portal-page .quick-link-select") &&
      sharedTheme.includes("min-height:52px") &&
      sharedTheme.includes("padding:12px 14px"),
    "parent quick-link dropdown wrapper should be easier to hit on mobile",
  )
  assert.ok(
    sharedTheme.includes("body.parent-portal-page .quick-link-select select,body.student-portal-page .quick-link-select select") &&
      sharedTheme.includes("min-height:44px"),
    "parent quick-link select itself should remain easy to tap",
  )
})

test("admin dark surfaces keep form controls and chart empty states readable", () => {
  assert.ok(
    adminTheme.includes("background: var(--portal-dark-field-bg);"),
    "admin dark inputs should use the dark surface",
  )
  assert.match(
    adminTheme,
    /html\[data-theme="dark"\] body\.admin-portal-page \.tabulator-entry-callout\s*\{\s*background:\s*var\(--portal-surface-support\);\s*border-color:\s*var\(--portal-border\);\s*color:\s*var\(--portal-dark-text\);\s*\}/s,
    "admin dark empty chart state should use the shared support surface",
  )
})
