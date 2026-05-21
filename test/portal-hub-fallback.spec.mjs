import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const hubHtmlPath = path.resolve(rootDir, "web-asset/admin/portal-hub.html")
const hubHtml = fs.readFileSync(hubHtmlPath, "utf8")
const portalThemeCssPath = path.resolve(rootDir, "web-asset/shared/portal-theme.css")
const portalThemeCss = fs.readFileSync(portalThemeCssPath, "utf8")

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

test("portal hub panels stay on the shared portal surface tokens", () => {
  assert.match(hubHtml, /--hub-panel-bg:\s*var\(--portal-surface-card\);/)
  assert.match(hubHtml, /--hub-panel-bg-footer:\s*var\(--portal-surface-support\);/)
  assert.match(hubHtml, /--hub-panel-bg-hero:\s*var\(--portal-surface-card\);/)
  assert.match(hubHtml, /--hub-panel-bg-section:\s*var\(--portal-surface-panel\);/)
  assert.match(hubHtml, /--hub-panel-bg-support:\s*var\(--portal-surface-support\);/)
  assert.match(hubHtml, /body\.portal-hub-page \.hub-banner \{\s*align-items: center;\s*border-radius: clamp\(4\.5px, 0\.9cqi, 12px\);\s*background: var\(--primary-color\);\s*border: 1px solid var\(--hub-banner-border\);\s*color: var\(--secondary-color\);\s*display: flex;\s*font-size: calc\(0\.72rem \* var\(--hub-phi\)\);\s*font-weight: 700;\s*justify-content: flex-end;\s*letter-spacing: 0\.08em;\s*line-height: 1;\s*margin: 0;\s*min-block-size: 18px;\s*padding-block: 6px;\s*padding-inline: calc\(var\(--hub-space-2\) \* 1\.9\);\s*inline-size: 100%;/s)
  assert.match(hubHtml, /body\.portal-hub-page \.hub-banner a \{\s*color: inherit;\s*text-decoration: none;\s*}/s)
  assert.doesNotMatch(hubHtml, /hub-banner__dot/)
  assert.doesNotMatch(hubHtml, />Hub<\/span>/)
  assert.match(hubHtml, /body\.portal-hub-page \.hero \{\s*background: var\(--hub-panel-bg-hero\);/s)
  assert.match(hubHtml, /body\.portal-hub-page \.portal-hub-bg \{\s*display: block;/s)
  assert.match(hubHtml, /body\.portal-hub-page \.hero::before \{\s*background: none;\s*opacity: 0;/s)
  assert.match(hubHtml, /body\.portal-hub-page \.hub-banner[^]*href="https:\/\/eagles\.edu\.vn"/s)
  assert.match(hubHtml, /body\.portal-hub-page \.section-card \{\s*background: var\(--hub-panel-bg-section\);/s)
  assert.match(hubHtml, /body\.portal-hub-page \.section-card::before \{\s*background: none;\s*opacity: 0;/s)
  assert.match(hubHtml, /body\.portal-hub-page \.hub-prefooter \{\s*align-items: center;\s*background: var\(--hub-panel-bg-support\);/s)
  assert.match(portalThemeCss, /\.hub-footer \{\s*align-items: center;\s*background: var\(--hub-footer-bg, var\(--tertiary-color\)\);\s*border: 1px solid var\(--hub-panel-border, var\(--paper-border\)\);\s*border-radius: clamp\(4\.5px, 0\.9cqi, 12px\);\s*color: var\(--hub-footer-text, var\(--secondary-color\)\);/s)
  assert.match(portalThemeCss, /\.hub-footer a,\s*\.hub-footer a:visited,\s*\.hub-footer a:hover,\s*\.hub-footer a:focus,\s*\.hub-footer a:active \{\s*color: inherit;\s*font-weight: 700;\s*text-decoration: none;\s*}/s)
  assert.match(hubHtml, /body\.portal-hub-page \.portal-card--admin,\s*body\.portal-hub-page \.portal-card--parent,\s*body\.portal-hub-page \.portal-card--student \{\s*background: var\(--hub-panel-bg\);/s)
  assert.match(hubHtml, /panelBg:\s*"var\(--portal-surface-card\)"/)
})
