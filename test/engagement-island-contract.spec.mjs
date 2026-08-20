import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const read = (file) => fs.readFileSync(file, "utf8")
const html = read("web-asset/admin/student-admin.html")
const libraryHtml = read("web-asset/admin/library-admin.html")
const adminCss = read("web-asset/admin/student-admin.css")

test("engagement pages remain wired to the shared matrix and their own data endpoints", () => {
  const assignment = read("web-asset/admin/assignment-engagement-island.mjs")
  const performance = read("web-asset/admin/performance-engagement-island.mjs")
  const profile = read("web-asset/admin/profile-engagement-island.mjs")

  for (const [name, source] of [["assignment", assignment], ["performance", performance], ["profile", profile]]) {
    assert.match(source, /from ["']\/web-asset\/admin\/engagement-matrix\.mjs(?:\?v=20260801-sivb)?["']/u, `${name} must use the shared matrix renderer`)
    assert.match(source, /renderEngagementMatrix\(/u, `${name} must render through the shared matrix`)
  }
  assert.match(assignment, /formatEngagementGroupKey\(/u)
  assert.match(assignment, /assignment-created/u)
  assert.match(performance, /formatEngagementGroupKey\(/u)
  assert.match(performance, /performance-report-created/u)
  assert.match(assignment, /\/api\/admin\/assignment-reminder-engagement\?take=1000/u)
  assert.match(performance, /\/api\/admin\/performance-engagement/u)
  assert.match(profile, /\/api\/admin\/profile-engagement\?take=2000/u)
  assert.match(assignment, /assignmentEngagementDayToggleBtn/u)
  assert.match(performance, /performanceEngagementDayToggleBtn/u)
  assert.match(profile, /groupKey: `\$\{parentsId \|\| "Unassigned"\}: \$\{familyId \|\| "Unassigned"\} - \$\{eaglesIds\}`/u)
  assert.match(profile, /emailQueuedAt: event\("queuedAt"\) \|\| row\.invitationQueuedAt/u)
  assert.match(profile, /emailSent: event\("sentAt"\) \|\| row\.invitationSentAt/u)
  assert.match(profile, /\[row\.parentsId, row\.familyId, row\.eaglesIds, row\.learners, row\.parentName, row\.parentEmail\]/u)
  assert.match(read("server/student-admin-routes.mjs"), /invitationQueuedAt: row\.invitation\?\.queuedAt/u)
  assert.match(html, /id="profileEngagementReloadBtn"[^>]*class="portal-button portal-button-btn-refresh"/u)
  assert.match(html, /id="assignmentEngagementReloadBtn"[^>]*class="portal-button portal-button-btn-refresh"/u)
  assert.match(html, /id="assignmentEngagementDayToggleBtn"[^>]*class="portal-button portal-button-primary"/u)
  assert.match(html, /id="performanceEngagementReloadBtn"[^>]*class="portal-button portal-button-btn-refresh"/u)
  assert.match(html, /id="performanceEngagementDayToggleBtn"[^>]*class="portal-button portal-button-primary"/u)
  assert.match(libraryHtml, /id="libraryEngagementReloadBtn"[^>]*class="portal-button portal-button-btn-refresh"/u)
  assert.match(read("web-asset/shared/portal-theme.css"), /body\.admin-portal-page \.table-scroll-wrap \{[\s\S]*?overflow-x: auto;/u)
})

test("profile engagement stays under Students and exposes the matrix host", () => {
  assert.match(html, /data-menu-group="students"[\s\S]*?data-page-link="profile-engagement"/u)
  assert.match(html, /data-page="profile-engagement"[\s\S]*?id="profileEngagementRows"/u)
  assert.match(html, /data-page="assignment-engagement"[\s\S]*?id="assignmentEngagementRows"/u)
  assert.match(html, /data-page="performance-engagement"[\s\S]*?id="performanceEngagementRows"/u)
})

test("all engagement matrix group identifiers stay visible in normal table flow", () => {
  assert.match(adminCss, /\.engagement-matrix-table-host \.tabulator-group \{/u)
  assert.doesNotMatch(adminCss, /\.engagement-matrix-table-host \.tabulator-group \{[\s\S]*?position: sticky/u)
  assert.match(adminCss, /\.engagement-matrix-table-host\.tabulator \{/u)
  assert.doesNotMatch(adminCss, /\.performance-engagement-detail \.tabulator\s*\{/u)
  assert.doesNotMatch(adminCss, /\.engagement-matrix-profile \.tabulator-group \{[\s\S]*?position: sticky/u)
})

test("all engagement matrices keep their ID column visible while horizontally scrolled", () => {
  const matrix = read("web-asset/admin/engagement-matrix.mjs")
  assert.match(matrix, /ENGAGEMENT_IDENTITY_BLOCK_CONTRACT = "SIVB"/u)
  assert.match(matrix, /Sticky ID Viewport Beacon/u)
  assert.match(matrix, /field: "englishName", width: 180/u)
  assert.match(matrix, /field: "reviewed", width: 90/u)
  assert.match(matrix, /field: "id", width: 125, hozAlign: "center", headerHozAlign: "center"/u)
  assert.match(matrix, /field: "id", width: 105, hozAlign: "center", headerHozAlign: "center"/u)
  assert.match(adminCss, /data-engagement-identity-block="SIVB"/u)
  assert.match(adminCss, /SIVB: the ID text is a viewport-centred beacon/u)
  assert.match(adminCss, /\.engagement-matrix-table-host \{[\s\S]*?min-width: 0;[\s\S]*?width: 100%;/u)
  assert.match(adminCss, /tabulator-row\.tabulator-row-even/u)
  assert.match(adminCss, /--engagement-matrix-row-even-bg: var\(--portal-dark-surface-support\)/u)
  assert.match(adminCss, /Immutable LM\/DM table-chip palette: AAA against --secondary-color/u)
  assert.match(adminCss, /\.engagement-matrix-mark\.is-set\s*\{\s*color: var\(--secondary-color\) !important;\s*\}/u)
  assert.match(adminCss, /\.engagement-matrix-completion\.is-yes\s*\{\s*background: var\(--engagement-chip-positive-bg\);\s*color: var\(--secondary-color\) !important;\s*\}/u)
})
