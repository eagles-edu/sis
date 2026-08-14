import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), "utf8")

test("B612 Mono is self-hosted with all four deferred admin faces", () => {
  const stylesheet = read("web-asset/fonts/B612Mono/stylesheet.css")
  assert.equal((stylesheet.match(/@font-face/g) || []).length, 4)
  assert.equal((stylesheet.match(/font-family: "B612 Mono"/g) || []).length, 4)
  assert.equal((stylesheet.match(/font-display: swap/g) || []).length, 4)
  assert.equal((stylesheet.match(/format\("woff2"\)/g) || []).length, 4)
  assert.doesNotMatch(stylesheet, /fonts\.googleapis\.com|fonts\.gstatic\.com/u)
})

test("admin B612 loader waits for boot and loads at idle priority", () => {
  const loader = read("web-asset/admin/admin-b612-mono-loader.js")
  assert.match(loader, /admin-auth-booting/u)
  assert.match(loader, /requestIdleCallback/u)
  assert.match(loader, /adminDeferredAsset/u)
  assert.match(loader, /stylesheet\.css/u)
  assert.match(loader, /document\.fonts\.load/u)
  assert.match(loader, /admin-b612-mono-loaded/u)
  assert.doesNotMatch(loader, /rel\s*=\s*["']preload["']/iu)
})

test("only admin portal pages include the deferred B612 loader", () => {
  const adminPages = [
    "web-asset/admin/student-admin.html",
    "web-asset/admin/grades-tabulator.html",
    "web-asset/admin/library-admin.html",
    "web-asset/admin/report-card.html",
    "web-asset/admin/student-enrollment.html",
    "web-asset/admin/student-enrollment-IDK.html",
    "web-asset/admin/student-points.html",
  ]
  adminPages.forEach((relativePath) => {
    assert.match(read(relativePath), /admin-b612-mono-loader\.js[^>]*defer/u, relativePath)
  })

  const nonAdminPages = [
    "web-asset/admin/portal-hub.html",
    "web-asset/student/student-portal.html",
    "web-asset/student/library.html",
    "web-asset/parent/parent-portal.html",
  ]
  nonAdminPages.forEach((relativePath) => {
    assert.doesNotMatch(read(relativePath), /admin-b612-mono-loader/u, relativePath)
  })
})

test("every admin HTML entry point has an explicit B612 configuration", () => {
  const adminDir = path.join(rootDir, "web-asset/admin")
  const adminHtmlPages = fs.readdirSync(adminDir)
    .filter((entry) => entry.endsWith(".html"))
    .sort()

  adminHtmlPages.forEach((entry) => {
    const relativePath = path.join("web-asset/admin", entry)
    const source = read(relativePath)
    if (entry === "portal-hub.html") {
      assert.match(source, /data-admin-font-scope="excluded-multi-audience"/u, relativePath)
      assert.doesNotMatch(source, /admin-b612-mono-loader/u, relativePath)
      return
    }
    assert.match(source, /admin-b612-mono-loader\.js[^>]*defer/u, relativePath)
  })
})

test("application monospace declarations use B612 Mono", () => {
  const sourceFiles = [
    "web-asset/shared/portal-theme.css",
    "web-asset/admin/student-admin.css",
    "web-asset/student/student-portal.css",
    "tools/build-mapping-stack.mjs",
  ]
  sourceFiles.forEach((relativePath) => {
    const source = read(relativePath)
    assert.doesNotMatch(source, /ui-monospace|SFMono|SF Mono|Consolas|Courier|Menlo|JetBrains Mono|Roboto Mono|Monaspace/u, relativePath)
    assert.match(source, /B612 Mono/u, relativePath)
  })
})

test("definition display and editing controls use B612 Mono", () => {
  const sharedTheme = read("web-asset/shared/portal-theme.css")
  const adminTheme = read("web-asset/admin/admin-portal-theme.css")
  const adminStudentTheme = read("web-asset/admin/student-admin.css")
  assert.match(sharedTheme, /\.new-word-entry-head\s*\{[^}]*font-family:\s*"B612 Mono", monospace;[^}]*letter-spacing:\s*normal;[^}]*line-height:\s*normal;/su)
  assert.match(sharedTheme, /\.new-word-entry-definition\s*\{[^}]*font-family:\s*"B612 Mono", monospace;[^}]*letter-spacing:\s*normal;/su)
  assert.match(sharedTheme, /news-vocabulary-definition-row textarea\s*\{[^}]*font-family:\s*"B612 Mono", monospace;[^}]*letter-spacing:\s*normal;/su)
  assert.match(sharedTheme, /#libraryAdminResults[\s\S]*#libraryQueueRows[\s\S]*font-family:\s*"B612 Mono", monospace;/u)
  assert.match(adminTheme, /library-admin-definition\s*\{[^}]*font-family:\s*"B612 Mono", monospace;[^}]*letter-spacing:\s*normal;/su)
  assert.match(adminStudentTheme, /\.news-review-vocabulary-definition\s*\{[^}]*font-family:\s*"B612 Mono", monospace;[^}]*letter-spacing:\s*normal;[^}]*line-height:\s*normal;/su)
})
