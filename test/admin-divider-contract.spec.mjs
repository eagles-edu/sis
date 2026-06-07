import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const ROOT_DIR = process.cwd()
const sharedThemeSource = fs.readFileSync(path.join(ROOT_DIR, "web-asset/shared/portal-theme.css"), "utf8")
const sharedThemeMin = fs.readFileSync(path.join(ROOT_DIR, "web-asset/shared/portal-theme.min.css"), "utf8")
const adminTheme = fs.readFileSync(path.join(ROOT_DIR, "web-asset/admin/student-admin.css"), "utf8")
const sop = fs.readFileSync(path.join(ROOT_DIR, "docs/sop.md"), "utf8")
const migration = fs.readFileSync(path.join(ROOT_DIR, "docs/# Hub-First Palette SSOT Migration.md"), "utf8")

test("divider lines for list and table items are centralized in the shared theme", () => {
  assert.match(
    sharedThemeSource,
    /body\.admin-portal-page \.user-admin-table \{\s*border:\s*1px solid var\(--border-strong\);\s*border-radius:\s*var\(--radius-2\);\s*overflow:\s*hidden;\s*\}/s,
  )
  assert.match(
    sharedThemeSource,
    /body\.admin-portal-page \.user-admin-table tbody td \{\s*border-bottom:\s*1px solid var\(--border-strong\) !important;\s*\}/s,
  )
  assert.match(
    sharedThemeSource,
    /html\[data-theme="dark"\] body\.admin-portal-page .user-admin-table tbody td \{\s*border-bottom-color:\s*var\(--portal-dark-border-strong\) !important;\s*\}/s,
  )
  assert.match(
    sharedThemeSource,
    /body\.admin-portal-page \.profile-layout-table-wrap\.data-surface \{\s*border:\s*1px solid var\(--border-strong\);\s*border-radius:\s*var\(--radius-2\);\s*overflow:\s*hidden;\s*\}/s,
  )
  assert.match(
    sharedThemeSource,
    /html\[data-theme="dark"\] body\.admin-portal-page \.profile-layout-table-wrap\.data-surface \{\s*border-color:\s*var\(--portal-dark-border-strong\);\s*\}/s,
  )
  assert.match(
    sharedThemeMin,
    /body\.admin-portal-page \.user-admin-table\{border:1px solid var\(--border-strong\);border-radius:var\(--radius-2\);overflow:hidden\}/,
  )
  assert.match(
    sharedThemeMin,
    /body\.admin-portal-page \.user-admin-table tbody td\{border-bottom:1px solid var\(--border-strong\)!important\}/,
  )
  assert.match(
    sharedThemeMin,
    /html\[data-theme="dark"\] body\.admin-portal-page \.user-admin-table tbody td\{border-bottom-color:var\(--portal-dark-border-strong\)!important\}/,
  )
  assert.ok(
    sharedThemeMin.includes(
      "body.admin-portal-page .profile-layout-table-wrap.data-surface{border:1px solid var(--border-strong);border-radius:var(--radius-2);overflow:hidden}",
    ),
  )
  assert.ok(
    sharedThemeMin.includes(
      'html[data-theme="dark"] body.admin-portal-page .profile-layout-table-wrap.data-surface{border-color:var(--portal-dark-border-strong)}',
    ),
  )
})

test("divider lines are not owned by page-local admin CSS", () => {
  assert.ok(
    !adminTheme.includes(".user-admin-table tbody td"),
    "student-admin.css should not own the users row separator",
  )
})

test("docs require shared divider normalization in both modes", () => {
  assert.match(
    sop,
    /Normalize divider lines for list and table items in both light mode and dark mode through the shared SSOT\./,
  )
  assert.match(
    migration,
    /Normalize divider lines for list and table items in both light mode and dark mode through the shared SSOT\./,
  )
})
