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
    assert.match(html, new RegExp(`initPrivacyConsent\\?\\.\\(\\{ locale: ["']vi["'], portal: ["']${portal}["'], waitForAuthentication: true, deferIntegrations: true \\}\\)`))
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

test("student boot defers consent integrations until after the first authenticated shell paint", () => {
  const studentJs = fs.readFileSync(path.resolve(rootDir, "web-asset/student/student-portal.js"), "utf8")
  assert.match(studentHtml, /deferIntegrations: true/)
  assert.match(studentHtml, /<script defer src="\/web-asset\/shared\/portal-preferences\.js"><\/script>/)
  assert.doesNotMatch(studentHtml, /<script[^>]+src="\/web-asset\/shared\/vocabulary-esl-editor\.js"/)
  assert.match(studentHtml, /<script defer src="\/web-asset\/student\/student-portal\.min\.js"><\/script>/)
  assert.match(studentJs, /function scheduleStudentPrivacyConsent\(\)/)
  assert.match(studentJs, /requestAnimationFrame\(\(\) => window\.requestAnimationFrame\(show\)\)/)
  assert.match(studentJs, /function scheduleStudentPostPaintHydration\(\)/)
  assert.match(studentJs, /window\.setTimeout\(hydrate, 500\)/)
  assert.match(studentJs, /loadDashboard\(\)\s*\.then\(\(\) => loadCalendar\(\{ deferNewWords: true \}\)\)/)
  assert.doesNotMatch(studentJs, /scheduleStudentNonCriticalData/)
  assert.match(studentJs, /loadCalendar\(\{ deferNewWords: false \}\)/)
  assert.match(studentJs, /function loadVocabularyEslEditor\(\)/)
  assert.match(studentJs, /portalAssetUrls = \{[\s\S]*vocabularyEsl: "\/web-asset\/shared\/vocabulary-esl-editor\.js"/)
  assert.match(studentJs, /await loadVocabularyEslEditor\(\)/)
  assert.match(studentJs, /state\.calendarLoaded && options\?\.force !== true/)
  assert.match(studentJs, /loadCalendar\(\{\s*\.\.\.options,\s*force: true,\s*\}\)/)
  assert.match(studentJs, /let dashboardLoadPromise = null;/)
  assert.match(studentJs, /if \(dashboardLoadPromise\) return dashboardLoadPromise;/)
})

test("student News activation owns the vocabulary editor and New Words request", () => {
  const studentJs = fs.readFileSync(path.resolve(rootDir, "web-asset/student/student-portal.js"), "utf8")
  assert.match(studentJs, /if \(nextView === "news"\) \{[\s\S]*?loadVocabularyEslEditor\(\)\.then\(/)
  assert.match(studentJs, /if \(options\?\.deferNewWords !== true && !state\.newWordsLoaded\) await loadNewWords\(\)/)
  assert.match(studentJs, /const STUDENT_NEW_WORDS_PATH = .*\/api\/student\/new-words/)
})

test("student critical CSS keeps the home shell visible and all non-home surfaces deferred", () => {
  const studentJs = fs.readFileSync(path.resolve(rootDir, "web-asset/student/student-portal.js"), "utf8")
  assert.doesNotMatch(studentHtml, /studentBootOverlay/)
  assert.match(studentHtml, /body\.student-portal-page #appPanel \{\s*display: none !important;/)
  assert.match(studentHtml, /html\[data-student-auth-state="authenticated"\] body\.student-portal-page #appPanel \{\s*display: block !important;/)
  assert.match(studentHtml, /:not\(\[data-student-active-surface\]\)[\s\S]*?:is\(#studentDetailPageCard, #newsPageCard\)/)
  assert.match(studentHtml, /html\[data-student-auth-state="authenticated"\] body\.student-portal-page :is\(#pastDueHomeworkCard, #newsQueueCard\) \{\s*min-height: 470px;/)
  assert.match(studentHtml, /html\[data-student-auth-state="authenticated"\] body\.student-portal-page #metricsPanel \{\s*min-height: 308px;/)
  assert.match(studentHtml, /@media \(max-width: 719px\) \{[\s\S]*?body\.student-portal-page #studentOverviewSummary \{\s*min-height: 71px;/)
  assert.match(studentHtml, /@media \(max-width: 399px\) \{[\s\S]*?body\.student-portal-page #metricsPanel \{\s*min-height: 826px;/)
  assert.match(studentHtml, /data-copyright-year/)
  assert.match(studentHtml, /security-badge__icon--light[\s\S]*?width="56" height="56"/)
  assert.match(studentJs, /state\.activeView === "home" && state\.activePage !== "home"/)
  assert.match(studentJs, /options\?\.deferCalendar === true \? Promise\.resolve\(\) : loadCalendar\(\{\s*\.\.\.options,\s*force: true/)
  assert.doesNotMatch(studentJs, /scheduleStudentNonCriticalData\(\)/)
  assert.match(studentJs, /if \(state\.calendarLoaded\) renderNewsQueue\(\);/)
})

test("parent boot follows the student critical loading sequence", () => {
  const parentJs = fs.readFileSync(path.resolve(rootDir, "web-asset/parent/parent-portal.js"), "utf8")
  assert.match(parentHtml, /data-parent-auth-state="booting"/)
  assert.match(parentHtml, /deferIntegrations: true/)
  assert.match(parentJs, /function scheduleParentPrivacyConsent\(\)/)
  assert.match(parentJs, /requestAnimationFrame\(\(\) => window\.requestAnimationFrame\(show\)\)/)
  assert.match(parentJs, /const \[childrenPayload, dashboardPayload\] = await Promise\.all\(\[\s*api\(PARENT_CHILDREN_PATH\),\s*api\(PARENT_DASHBOARD_PATH\),\s*\]\)/)
  assert.match(parentJs, /await hydratePortal\(\{ initialUser: state\.me, revealAuthState: false \}\)/)
  assert.match(parentJs, /await hydratePortal\(\{\s*initialUser: state\.me,\s*revealAuthState: false,\s*\}\)/)
})

test("student home reserves hydrated queue and attendance geometry for CLS", () => {
  const studentCss = fs.readFileSync(path.resolve(rootDir, "web-asset/student/student-portal.css"), "utf8")
  assert.match(studentCss, /PERF-CONTRACT: STUDENT-HOME-CLS-RESERVATION/)
  assert.match(studentCss, /body\.student-portal-page \.queue-summary-chips\s*\{[\s\S]*?min-block-size:\s*66px;/)
  assert.match(studentCss, /body\.student-portal-page #newsQueueCard \.queue-table-wrap\s*\{[\s\S]*?min-height: 260px;/)
  assert.match(studentCss, /body\.student-portal-page #pastDueHomeworkCard,[\s\S]*?body\.student-portal-page #newsQueueCard\s*\{[\s\S]*?min-height: 470px;/)
  assert.match(studentCss, /body\.student-portal-page #metricsPanel\s*\{\s*min-height: 308px;/)
  assert.match(studentCss, /@media \(max-width: 719px\) \{[\s\S]*?body\.student-portal-page #studentOverviewSummary\s*\{\s*min-height: 71px;/)
  assert.match(studentCss, /@media \(max-width: 399px\) \{[\s\S]*?body\.student-portal-page #metricsPanel\s*\{\s*min-height: 826px;/)
  assert.match(studentCss, /body\.student-portal-page #attendanceCalendarMetrics\s*\{[\s\S]*?min-height: 189px;/)
})

test("parent home reserves hydrated queue geometry for CLS", () => {
  const parentCss = fs.readFileSync(path.resolve(rootDir, "web-asset/parent/parent-portal.css"), "utf8")
  assert.match(parentCss, /PERF-CONTRACT: PARENT-HOME-CLS-RESERVATION/)
  assert.match(parentCss, /body\.parent-portal-page \.queue-summary-chips\s*\{[\s\S]*?min-block-size:\s*66px;/)
  assert.match(parentCss, /body\.parent-portal-page #newsQueueCard \.queue-table-wrap\s*\{[\s\S]*?min-height: 260px;/)
  assert.match(parentCss, /body\.parent-portal-page #pastDueHomeworkCard,[\s\S]*?body\.parent-portal-page #newsQueueCard\s*\{[\s\S]*?min-height: 470px;/)
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

test("student optional integrations stay deferred through preference hydration until post-load release", () => {
  const source = fs.readFileSync(path.resolve(rootDir, "web-asset/shared/portal-theme-state.js"), "utf8")
  const studentJs = fs.readFileSync(path.resolve(rootDir, "web-asset/student/student-portal.js"), "utf8")
  assert.match(source, /function releaseDeferredIntegrations\(\)/)
  assert.match(source, /integrationsDeferred = globalThis\.__SIS_PRIVACY_CONSENT_INTEGRATIONS_DEFERRED__ === true && force !== true/)
  assert.match(source, /applyConsentPreferences\(preferences, \{ force: true \}\)/)
  assert.match(studentJs, /deferIntegrations: true/)
  assert.match(studentJs, /addEventListener\("load", scheduleRelease, \{ once: true \}\)/)
  assert.match(studentJs, /requestIdleCallback\(release, \{ timeout: 3000 \}\)/)
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
