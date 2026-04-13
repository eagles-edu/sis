import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const hubHtmlPath = path.resolve(rootDir, "web-asset/admin/portal-hub.html")
const hubHtml = fs.readFileSync(hubHtmlPath, "utf8")

test("portal hub falls back to the dev apiOrigin when runtime paths are unavailable", () => {
  assert.match(hubHtml, /const currentOrigin = window\.location\.origin/)
  assert.match(hubHtml, /const query = new URLSearchParams\(window\.location\.search \|\| ""\)/)
  assert.match(hubHtml, /const portalFiles = \{\s*admin: "\/web-asset\/admin\/student-admin\.html"/s)
  assert.match(hubHtml, /parent: "\/web-asset\/parent\/parent-portal\.html"/)
  assert.match(hubHtml, /student: "\/web-asset\/student\/student-portal\.html"/)
  assert.match(hubHtml, /return "http:\/\/127\.0\.0\.1:8788";/)
  assert.match(hubHtml, /function inferLoopbackPreviewApiOrigin\(\)/)
  assert.match(hubHtml, /function resolvePreviewApiOrigin\(\)/)
  assert.match(hubHtml, /link\.href = resolveFallbackHref\(target\)/)
})

test("portal hub still honors explicit apiOrigin when one is provided", () => {
  assert.match(hubHtml, /const rawApiOrigin = query\.get\("apiOrigin"\)/)
  assert.match(hubHtml, /if \(rawApiOrigin\)/)
  assert.match(hubHtml, /return parsed\.origin/)
})
