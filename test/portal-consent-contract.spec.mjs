import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const studentHtml = fs.readFileSync(path.resolve(rootDir, "web-asset/student/student-portal.html"), "utf8")
const parentHtml = fs.readFileSync(path.resolve(rootDir, "web-asset/parent/parent-portal.html"), "utf8")
const serverSource = fs.readFileSync(path.resolve(rootDir, "server/student-admin-routes.mjs"), "utf8")

for (const [label, html, portal] of [["student", studentHtml, "student"], ["parent", parentHtml, "parent"]]) {
  test(`${label} portal gates third-party integrations behind shared consent`, () => {
    assert.match(html, new RegExp(`initPrivacyConsent\\?\\.\\(\\{ locale: ["']vi["'], portal: ["']${portal}["'], waitForAuthentication: true \\}\\)`))
    assert.doesNotMatch(html, /conversations-widget\.brevo\.com\/brevo-conversations\.js/)
  })
}

test("shared consent state exposes both integrations and versioned persistence", () => {
  const source = fs.readFileSync(path.resolve(rootDir, "web-asset/shared/portal-theme-state.js"), "utf8")
  assert.match(source, /sis-consent-preferences/)
  assert.match(source, /CONSENT_VERSION = 1/)
  assert.match(source, /supportChat/)
  assert.match(source, /analytics/)
  assert.match(source, /analytics_storage: "denied"/)
  assert.match(source, /ad_user_data: "denied"/)
  assert.match(source, /ad_personalization: "denied"/)
  assert.match(source, /showPrivacyConsent/)
  assert.match(source, /portal-button-privacy-shaded/)
})

test("portal runtime config exposes only the optional public GA4 measurement ID", () => {
  assert.match(serverSource, /__SIS_GA4_MEASUREMENT_ID/)
  assert.match(serverSource, /process\.env\.GA4_MEASUREMENT_ID/)
  assert.doesNotMatch(serverSource, /GA4_API_KEY|GA4_SECRET|GOOGLE_ANALYTICS_PRIVATE/)
})
