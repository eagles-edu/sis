import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const hubHtmlPath = path.resolve(rootDir, "web-asset/admin/portal-hub.html")
const hubHtml = fs.readFileSync(hubHtmlPath, "utf8")
const portalThemeCssPath = path.resolve(rootDir, "web-asset/shared/portal-theme.css")
const portalThemeCss = fs.readFileSync(portalThemeCssPath, "utf8")
const sharedThemeMinPath = path.resolve(rootDir, "web-asset/shared/portal-theme.min.css")
const sharedThemeMin = fs.readFileSync(sharedThemeMinPath, "utf8")

test("portal hub falls back to the dev apiOrigin when runtime paths are unavailable", () => {
  assert.match(hubHtml, /const currentOrigin = window\.location\.origin/)
  assert.match(hubHtml, /const query = new URLSearchParams\(window\.location\.search \|\| ""\)/)
  assert.match(hubHtml, /const portalFiles = \{\s*admin: "\/admin"/s)
  assert.match(hubHtml, /parent: "\/parent"/)
  assert.match(hubHtml, /student: "\/student"/)
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

test("portal hub panels stay on the shared portal surface tokens", () => {
  assert.match(hubHtml, /body\.portal-hub-page \.portal-hub-bg \{\s*display: block;/s)
  assert.doesNotMatch(hubHtml, /body\.portal-hub-page \.hub-banner \{/s)
  assert.doesNotMatch(hubHtml, /body\.portal-hub-page \.hero \{\s*background:/s)
  assert.doesNotMatch(hubHtml, /body\.portal-hub-page \.hero::before \{/s)
  assert.doesNotMatch(hubHtml, /body\.portal-hub-page \.section-card \{\s*background:/s)
  assert.doesNotMatch(hubHtml, /body\.portal-hub-page \.section-card::before \{/s)
  assert.match(hubHtml, /<section class="card hub-prefooter" aria-label="Support links" data-surface-role="content">/)
  assert.match(hubHtml, /<a class="portal-card portal-card--admin" href="\/admin" data-portal-target="admin" data-surface-role="card">/)
  assert.match(hubHtml, /<a class="portal-card portal-card--parent" href="\/parent" data-portal-target="parent" data-surface-role="card">/)
  assert.match(hubHtml, /<a class="portal-card portal-card--student" href="\/student" data-portal-target="student" data-surface-role="card">/)
  assert.match(hubHtml, /<a class="brand-logo-wrap brand-logo-wrap--lg" href="\/" aria-label="Eagles portal home">/)
  assert.match(portalThemeCss, /body\.portal-hub-page \.hub-banner \{\s*align-items: center;\s*background: var\(--hub-banner-bg, var\(--primary-color\)\);\s*border: 1px solid var\(--hub-banner-border, rgba\(255, 255, 255, 0\.18\)\);\s*border-radius: clamp\(4\.5px, 0\.9cqi, 12px\);\s*color: var\(--hub-banner-text, var\(--secondary-color\)\);/s)
  assert.match(portalThemeCss, /body\.portal-hub-page \.hub-prefooter \{\s*align-items: center;\s*background: var\(--hub-surface-content\);\s*border-color: var\(--hub-surface-border\);\s*box-shadow: var\(--hub-surface-shadow\);\s*display: flex;\s*justify-content: space-between;/s)
  assert.match(portalThemeCss, /body\.portal-hub-page \.hub-prefooter__links \{\s*align-items: center;\s*display: flex;\s*gap: 8px 10px;\s*justify-content: flex-end;/s)
  assert.match(portalThemeCss, /body\.portal-hub-page \.hub-prefooter__link \{\s*text-decoration: none;/s)
})
