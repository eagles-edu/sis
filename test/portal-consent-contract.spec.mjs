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
  assert.match(source, /__SIS_CONSENT_VERSION__.*\|\| "2"/)
  assert.match(source, /supportChat/)
  assert.match(source, /analytics/)
  assert.match(source, /analytics_storage: "denied"/)
  assert.match(source, /ad_user_data: "denied"/)
  assert.match(source, /ad_personalization: "denied"/)
  assert.match(source, /showPrivacyConsent/)
  assert.match(source, /defaultMemberPreferences/)
  assert.match(source, /noticeAcknowledgedAt/)
  assert.match(source, /data-sis-consent-action="acknowledge"/)
  assert.doesNotMatch(source, /data-sis-consent-action="reject-all"/)
  assert.match(source, /portal-button-privacy-shaded/)
  assert.match(source, /if \(!preferences\?\.noticeAcknowledgedAt && !document\.getElementById\("sisConsentPanel"\)\)/)
  assert.match(source, /panel\.hidden = !open/)
})

test("consent version is runtime-configurable from admin SIS settings", () => {
  const adminHtml = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/student-admin.html"), "utf8")
  const adminJs = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/student-admin.js"), "utf8")
  const configStore = fs.readFileSync(path.resolve(rootDir, "src/modules/admin/sis-config-store.mjs"), "utf8")
  const routes = fs.readFileSync(path.resolve(rootDir, "server/student-admin-routes.mjs"), "utf8")
  assert.match(adminHtml, /id="settingConsentVersion"/)
  assert.match(adminJs, /consentVersion: document\.getElementById\("settingConsentVersion"\)\?\.value/)
  assert.match(configStore, /candidate\.consentVersion.*DEFAULT_CONSENT_VERSION/)
  assert.match(routes, /__SIS_CONSENT_VERSION=/)
})

test("server preference hydration never hides an unacknowledged consent panel", () => {
  const preferencesSource = fs.readFileSync(path.resolve(rootDir, "web-asset/shared/portal-preferences.js"), "utf8")
  assert.match(preferencesSource, /if \(saved\.noticeAcknowledgedAt\) \{[\s\S]*?panel\?\.remove\(\)[\s\S]*?\} else if \(panel\) \{[\s\S]*?panel\.hidden = false/)
})

test("shared chat accessibility normalizes dynamically inserted message fields", () => {
  const source = fs.readFileSync(path.resolve(rootDir, "web-asset/shared/portal-theme-state.js"), "utf8")
  assert.match(source, /textarea\.js-chat-textarea/)
  assert.match(source, /if \(!field\.id\) field\.id = `brevoConversationMessage/)
  assert.match(source, /if \(!field\.name\) field\.name = "message"/)
  assert.match(source, /childList: true/)
})

test("admin overview exposes a private alert surface for member analytics opt-outs", () => {
  const html = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/student-admin.html"), "utf8")
  const dashboard = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/overview-dashboard-island.mjs"), "utf8")
  const routes = fs.readFileSync(path.resolve(rootDir, "server/student-admin-routes.mjs"), "utf8")

  assert.match(html, /overviewAnalyticsOptOutAlertsSection/)
  assert.match(dashboard, /analyticsOptOutAlerts/)
  assert.match(routes, /recordAnalyticsOptOutAlert/)
  assert.match(routes, /alertPrincipalId: parentContext\.parentsId/)
  assert.match(routes, /alertPrincipalId: normalizeText\(session\?\.eaglesId \|\| session\?\.username\)/)
})

test("portal runtime config exposes only the optional public GA4 measurement ID", () => {
  assert.match(serverSource, /__SIS_GA4_MEASUREMENT_ID/)
  assert.match(serverSource, /process\.env\.GA4_MEASUREMENT_ID/)
  assert.doesNotMatch(serverSource, /GA4_API_KEY|GA4_SECRET|GOOGLE_ANALYTICS_PRIVATE/)
})
