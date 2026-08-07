import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const read = (file) => fs.readFileSync(path.resolve(rootDir, file), "utf8")

test("logout always restores the closed navigation state before returning to a portal login page", () => {
  const student = read("web-asset/student/student-portal.js")
  const parent = read("web-asset/parent/parent-portal.js")
  const admin = read("web-asset/admin/student-admin.js")

  assert.match(student, /function setAuthenticatedView\(authenticated\)[\s\S]*?if \(!authenticated\) \{\s*setMenuOpen\(false\)/)
  assert.match(student, /async function logout\(\) \{\s*setMenuOpen\(false\)/)
  assert.match(parent, /async function logout\(\) \{\s*setSideNavOpen\(false\)/)
  assert.match(admin, /function showLogin\(\) \{[\s\S]*?document\.body\.classList\.remove\("menu-open"\)/)
})

test("portal login states hide navigation controls and leave the page stable behind an open drawer", () => {
  const theme = read("web-asset/shared/portal-theme.css")

  assert.match(theme, /data-student-auth-state="unauthenticated"[\s\S]*?\.floating-menu-btn/)
  assert.match(theme, /data-parent-auth-state="unauthenticated"[\s\S]*?\.floating-menu-btn/)
  assert.match(theme, /data-admin-auth-state="unauthenticated"[\s\S]*?\.floating-menu-btn/)
  assert.match(theme, /\.nav-scrim,[\s\S]*?\.nav-overlay \{[\s\S]*?backdrop-filter: none;[\s\S]*?background: transparent;[\s\S]*?transition: none;/)
  assert.match(theme, /\.nav-scrim:hover,[\s\S]*?\.nav-overlay:active \{[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/)
  assert.match(theme, /body\.admin-portal-page \.menu-backdrop \{[\s\S]*?background: transparent;[\s\S]*?transition: none;/)
})
