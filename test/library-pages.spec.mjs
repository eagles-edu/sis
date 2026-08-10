import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const student = fs.readFileSync(new URL("../web-asset/student/library.html", import.meta.url), "utf8")
const admin = fs.readFileSync(new URL("../web-asset/admin/library-admin.html", import.meta.url), "utf8")
const studentPortal = fs.readFileSync(new URL("../web-asset/student/student-portal.html", import.meta.url), "utf8")
const adminPortal = fs.readFileSync(new URL("../web-asset/admin/student-admin.html", import.meta.url), "utf8")
const routes = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")

test("student Library is a protected physical page with shared chrome and student chat", () => {
  assert.match(student, /body class="student-portal-page"/)
  assert.match(student, /portal-theme\.min\.css/)
  assert.match(student, /student-portal\.min\.css/)
  assert.match(student, /import svgIcon from "\/web-asset\/icons\/web-component\/svg-icon\.js"/)
  assert.match(student, /<svg-icon name="theme-moon"[^>]*id="studentThemeToggleIcon"/)
  assert.match(student, /themeIcon\.setAttribute\("name", isDark \? "theme-sun" : "theme-moon"\)/)
  assert.match(student, /class="content topbar"/)
  assert.match(student, /<footer class="hub-footer portal-login-footer"/)
  assert.match(student, /initPrivacyConsent\?\.\(\{ locale: "vi", portal: "student" \}\)/)
  assert.match(studentPortal, /href="\/student\/library\.html"[^>]*>Library/)
  assert.match(routes, /const STUDENT_LIBRARY_PAGE_PATH = `\$\{STUDENT_PORTAL_PAGE_PATH\}\/library\.html`/)
})

test("admin Library is a protected physical page under Administration without chat", () => {
  assert.match(admin, /body class="admin-portal-page page"/)
  assert.match(admin, /admin-portal-theme\.min\.css/)
  assert.match(admin, /import svgIcon from "\/web-asset\/icons\/web-component\/svg-icon\.js"/)
  assert.match(admin, /<svg-icon name="theme-moon"[^>]*id="adminThemeToggleIcon"/)
  assert.match(admin, /themeIcon\.setAttribute\("name", isDark \? "theme-sun" : "theme-moon"\)/)
  assert.match(admin, /class="content topbar"/)
  assert.match(admin, /<footer class="hub-footer"/)
  assert.doesNotMatch(admin, /initPrivacyConsent|Brevo|conversation-widget/i)
  assert.match(adminPortal, /href="\/admin\/library-admin\.html"[^>]*>\s*Library/)
  assert.match(routes, /const ADMIN_LIBRARY_PAGE_PATH = `\$\{ADMIN_PAGE_PATH\}\/library-admin\.html`/)
})
