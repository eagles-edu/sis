// test/student-admin.spec.mjs
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import * as XLSX from "xlsx"
import {
  buildChildDashboardSnapshot,
  buildStudentPortalCalendarTracks,
  buildFamilyOptionPayload,
  parseSpreadsheetRowsFromUploadPayload,
} from "../server/student-admin-routes.mjs"
import { buildStudentReportCardPayload, generateStudentReportCardPdf } from "../server/student-report-card-pdf.mjs"
import { LEVEL_DEFINITIONS, canonicalizeLevel } from "../src/modules/admin/level-catalog.mjs"
import { assertPortalPasswordPolicy } from "../src/modules/admin/users.mjs"

const TEST_ADMIN_UI_SETTINGS_FILE = `/tmp/sis-admin-ui-settings-${process.pid}.json`
const TEST_GENERATED_SIS_CONFIG_FILE = path.resolve(process.cwd(), "config/sis-config.test.json")
const ADMIN_HTML_SOURCE = fs.readFileSync(new URL("../web-asset/admin/student-admin.html", import.meta.url), "utf8")
const ADMIN_CSS_SOURCE = fs.readFileSync(new URL("../web-asset/admin/student-admin.css", import.meta.url), "utf8")
const ADMIN_JS_SOURCE = fs.readFileSync(new URL("../web-asset/admin/student-admin.js", import.meta.url), "utf8")
const SHARED_PORTAL_THEME_SOURCE = fs.readFileSync(new URL("../web-asset/shared/portal-theme.css", import.meta.url), "utf8")
const ENROLLMENT_JS_SOURCE = fs.readFileSync(new URL("../web-asset/admin/student-enrollment.js", import.meta.url), "utf8")
const REPORT_CARD_JS_SOURCE = fs.readFileSync(new URL("../web-asset/admin/report-card.js", import.meta.url), "utf8")
const GRADES_TABULATOR_JS_SOURCE = fs.readFileSync(new URL("../web-asset/admin/grades-tabulator.js", import.meta.url), "utf8")

test("class and level aliases resolve to one canonical catalog value", () => {
  assert.ok(LEVEL_DEFINITIONS.length > 0)
  for (const entry of LEVEL_DEFINITIONS) {
    for (const variant of [entry.canonical, ...(entry.aliases || [])]) {
      assert.equal(canonicalizeLevel(variant), entry.canonical, variant)
    }
  }
  assert.equal(canonicalizeLevel("  eggchicks  "), "Eggs & Chicks")
  assert.equal(canonicalizeLevel("grade 6"), "A2 Flyers")
  assert.equal(canonicalizeLevel("  custom   class  "), "custom class")
})

test("family profile options include every familyId and parentId pair", () => {
  const result = buildFamilyOptionPayload({
    profileRows: [
      { familyId: "fam-0002", parentsId: "parent-b", motherEmail: "b@example.com" },
      { familyId: "fam-0002", parentsId: "parent-a", motherEmail: "a@example.com" },
    ],
    generatedFamilies: [{ familyId: "fam-0001" }],
    activeParentAccounts: [{
      parentsId: "parent-c",
      email: "c@example.com",
      links: [{ student: { profile: { familyId: "fam-0002" } } }],
    }],
  })

  assert.deepEqual(result.familyIds, ["fam-0001", "fam-0002"])
  assert.deepEqual(result.familyOptions, [
    { familyId: "fam-0001", parentId: "Unassigned", label: "fam-0001 - Unassigned" },
    { familyId: "fam-0002", parentId: "parent-a", parentEmail: "a@example.com", label: "fam-0002 - parent-a" },
    { familyId: "fam-0002", parentId: "parent-b", parentEmail: "b@example.com", label: "fam-0002 - parent-b" },
    { familyId: "fam-0002", parentId: "parent-c", parentEmail: "c@example.com", label: "fam-0002 - parent-c" },
  ])
})

test("active parent account is authoritative when a profile reused its email across families", () => {
  const result = buildFamilyOptionPayload({
    profileRows: [
      { familyId: "fam-0149", parentsId: "cmamos001", motherEmail: "shared@example.com" },
      { familyId: "fam-0007", parentsId: "cmandy001", motherEmail: "shared@example.com" },
    ],
    activeParentAccounts: [{
      parentsId: "cmandy001",
      email: "shared@example.com",
      links: [{ student: { profile: { familyId: "fam-0007" } } }],
    }],
  })

  assert.equal(
    result.familyOptions.find((entry) => entry.parentId === "cmamos001")?.parentEmail,
    "",
  )
  assert.equal(
    result.familyOptions.find((entry) => entry.parentId === "cmandy001")?.parentEmail,
    "shared@example.com",
  )
})

test("student profile bootstrap hydrates family options before rendering the form", () => {
  assert.match(
    ADMIN_JS_SOURCE,
    /if \(slug === "profile"\) \{[\s\S]*?renderProfileInfoLayout\(state\.currentStudent\);[\s\S]*?loadFamilyIds\(\)\.catch\(handleError\);/u,
  )
})

test("family options carry parent email for profile assignment", () => {
  assert.match(ADMIN_JS_SOURCE, /option\.dataset\.parentEmail = parentEmail \|\| ""/u)
  assert.match(ADMIN_JS_SOURCE, /document\.getElementById\("f_motherEmail"\)/u)
  assert.match(ADMIN_JS_SOURCE, /parentEmail: normalizeLower\(entry\?\.parentEmail\)/u)
})

test("new student form requires a password, derives Parents ID, and blocks flagged email reuse", () => {
  assert.match(ADMIN_JS_SOURCE, /const PROFILE_NEW_REQUIRED_KEYS = new Set\(\[[\s\S]*?"password"/u)
  assert.match(ADMIN_JS_SOURCE, /const nextValue = eaglesId \? `cm\$\{eaglesId\}` : ""/u)
  assert.match(ADMIN_JS_SOURCE, /parentEmailInput\?\.addEventListener\("blur", \(\) => \{/u)
  assert.match(ADMIN_JS_SOURCE, /Verbally verify the familial relationship/u)
  assert.match(ADMIN_CSS_SOURCE, /input\.profile-family-email-conflict/u)
})

test("portal password policy requires 8 characters, letter case, a symbol, and safe characters", () => {
  assert.equal(assertPortalPasswordPolicy("Eagles!8"), "Eagles!8")
  for (const password of ["eagles!8", "EAGLES!8", "Eagles88", "Eag! 88", "Eag<88!x", "Eag\\88!x"]) {
    assert.throws(() => assertPortalPasswordPolicy(password), /password/i)
  }
})

function withAdminAssets(html = "") {
  return `${String(html || "")}\n${ADMIN_CSS_SOURCE}\n${ADMIN_JS_SOURCE}`
}

function renderedAdminPageSections(html = "") {
  return Array.from(
    String(html || "").matchAll(/<div[^>]*class="[^"]*\bpage-section\b[^"]*"[^>]*data-page="([a-z0-9-]+)"/gi)
  ).map((match) => match[1])
}

process.env.NODE_ENV = "test"
process.env.EXERCISE_MAILER_ORIGIN = "*"
process.env.EXERCISE_STORE_ENABLED = "false"
process.env.EXERCISE_STORE_REQUIRED = "false"
process.env.STUDENT_INTAKE_STORE_ENABLED = "false"
process.env.STUDENT_ADMIN_STORE_ENABLED = "false"
process.env.STUDENT_ADMIN_USER = "admin"
process.env.STUDENT_ADMIN_PASS = "admin-pass-123"
delete process.env.STUDENT_TEACHER_USER
delete process.env.STUDENT_TEACHER_USERS
delete process.env.STUDENT_TEACHER_PASS
delete process.env.STUDENT_TEACHER_PASSWORD_HASH
process.env.STUDENT_TEACHER_ACCOUNTS_JSON = JSON.stringify([
  { username: "teacher", role: "teacher", password: "teacher-pass-123" },
  { username: "carole01", role: "teacher", password: "carole-pass-123" },
])
process.env.STUDENT_PARENT_PORTAL_ACCOUNTS_JSON = JSON.stringify([
  { parentsId: "cmvi001", password: "family-pass-123", status: "active" },
])
process.env.STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON = JSON.stringify([
  { eaglesId: "flyers01", password: "student-pass-123", studentRefId: "student-ref-flyers01", status: "active" },
])
process.env.STUDENT_ADMIN_TOKEN_SECRET = "test-student-admin-token-secret"
process.env.MAILER_DEBUG = "false"
process.env.STUDENT_ADMIN_UI_SETTINGS_FILE = TEST_ADMIN_UI_SETTINGS_FILE
try {
  fs.rmSync(TEST_ADMIN_UI_SETTINGS_FILE, { force: true })
} catch (error) {
  void error
}

function makeMockTransport() {
  return {
    verify(cb) {
      setImmediate(() => cb(null, true))
    },
    async sendMail() {
      return { messageId: "mock-id" }
    },
  }
}

async function fetchLocal(requestPort, pathname, init = {}) {
  await ensureAdminTestServer({ unref: true })
  const effectivePort = Number.isInteger(requestPort) && requestPort > 0 ? requestPort : port
  return fetch(`http://127.0.0.1:${effectivePort}${pathname}`, init)
}

let server
let port
let serverStartPromise
let adminSessionCookie = ""
let teacherSessionCookie = ""
let parentSessionCookie = ""
let studentSessionCookie = ""
let assignmentAnnouncementPreviewPath = ""
let persistedUiSettingsPath = ""

async function ensureAdminTestServer({ unref = false } = {}) {
  if (server && Number.isInteger(port) && port > 0) return
  if (serverStartPromise) {
    await serverStartPromise
    return
  }
  serverStartPromise = (async () => {
    const { startExerciseMailer } = await import(process.cwd() + "/server/exercise-mailer.mjs")
    server = await startExerciseMailer({ transporter: makeMockTransport(), port: 0 })
    await new Promise((resolve) => server.once("listening", resolve))
    port = server.address().port
    assert.ok(Number.isInteger(port) && port > 0)
    if (unref) server.unref()
  })()
  try {
    await serverStartPromise
  } finally {
    serverStartPromise = null
  }
}

test("parseSpreadsheetRowsFromUploadPayload parses xlsx payload", () => {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ["eaglesId", "fullName", "motherEmergencyContact"],
    ["S001", "Jane Student", "0900111222"],
    ["S002", "John Student", "0900333444"],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, "Students")
  const xlsxBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })

  const rows = parseSpreadsheetRowsFromUploadPayload({
    fileName: "students.xlsx",
    format: "xlsx",
    fileDataBase64: xlsxBuffer.toString("base64"),
  })

  assert.equal(rows.length, 2)
  assert.equal(rows[0].eaglesId, "S001")
  assert.equal(rows[1].fullName, "John Student")
})

test("parseSpreadsheetRowsFromUploadPayload selects the most data-complete sheet by identity", () => {
  const workbook = XLSX.utils.book_new()
  const templateLike = XLSX.utils.aoa_to_sheet([
    ["studentNumber", "eaglesId", "fullName"],
    ["200", "", "Template Row 1"],
    ["201", "", "Template Row 2"],
    ["202", "", "Template Row 3"],
  ])
  const importReady = XLSX.utils.aoa_to_sheet([
    ["studentNumber", "eaglesId", "fullName", "city"],
    ["300", "S300", "Import Row 1"],
    ["301", "S301", "Import Row 2"],
    ["", "", "", "HCMC"],
  ])
  XLSX.utils.book_append_sheet(workbook, templateLike, "Students_Template")
  XLSX.utils.book_append_sheet(workbook, importReady, "Students_ImportReady")
  const xlsxBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })

  const rows = parseSpreadsheetRowsFromUploadPayload({
    fileName: "students.xlsx",
    format: "xlsx",
    fileDataBase64: xlsxBuffer.toString("base64"),
  })

  assert.equal(rows.length, 2)
  assert.equal(rows[0].studentNumber, "300")
  assert.equal(rows[0].eaglesId, "S300")
  assert.equal(rows[1].eaglesId, "S301")
})

test("parseSpreadsheetRowsFromUploadPayload parses UTF-8 CSV payload with Vietnamese text and BOM", () => {
  const csvText = "\ufeffeaglesId,fullNameStudent,newAddress\nvi001,Trần Nguyễn Thiên Ân,Phường Tân Sơn Nhì"
  const rows = parseSpreadsheetRowsFromUploadPayload({
    fileName: "students.csv",
    format: "csv",
    fileDataBase64: Buffer.from(csvText, "utf8").toString("base64"),
  })

  assert.equal(rows.length, 1)
  assert.equal(rows[0].eaglesId, "vi001")
  assert.equal(rows[0].fullNameStudent, "Trần Nguyễn Thiên Ân")
  assert.equal(rows[0].newAddress, "Phường Tân Sơn Nhì")
})

test("parseSpreadsheetRowsFromUploadPayload rejects non-UTF-8 CSV payload", () => {
  const invalidUtf8Bytes = Buffer.from([0x65, 0x61, 0x67, 0x6c, 0x65, 0x73, 0x49, 0x64, 0x0a, 0xc3, 0x28])
  assert.throws(
    () => parseSpreadsheetRowsFromUploadPayload({
      fileName: "students.csv",
      format: "csv",
      fileDataBase64: invalidUtf8Bytes.toString("base64"),
    }),
    /UTF-8 encoded/i
  )
})

test("buildStudentPortalCalendarTracks maps homework and review rows into week spans", () => {
  const tracks = buildStudentPortalCalendarTracks({
    now: "2026-03-13T09:00:00.000Z",
    gradeRows: [
      {
        id: "grade-overdue",
        assignmentName: "Essay Draft",
        className: "Writing",
        dueAt: "2026-03-11T09:00:00.000Z",
        submittedAt: "",
        homeworkCompleted: false,
      },
      {
        id: "grade-complete",
        assignmentName: "Reading Log",
        className: "Reading",
        dueAt: "2026-03-14T09:00:00.000Z",
        submittedAt: "2026-03-10T09:00:00.000Z",
        homeworkCompleted: true,
      },
    ],
    reportRows: [
      {
        id: "review-1",
        className: "Speaking",
        quarter: "q2",
        generatedAt: "2026-03-10T08:30:00.000Z",
      },
    ],
  })

  assert.equal(tracks.homework.length, 1)
  assert.equal(tracks.homework[0].title, "Essay Draft")
  assert.equal(tracks.homework[0].dueDate, "2026-03-11")
  assert.equal(tracks.homework[0].startDate, "2026-03-08")
  assert.equal(tracks.homework[0].endDate, "2026-03-15")
  assert.equal(tracks.homework[0].overdue, true)

  assert.equal(tracks.review.length, 1)
  assert.equal(tracks.review[0].title, "Speaking")
  assert.equal(tracks.review[0].quarter, "q2")
  assert.equal(tracks.review[0].generatedDate, "2026-03-10")
  assert.equal(tracks.review[0].startDate, "2026-03-08")
  assert.equal(tracks.review[0].endDate, "2026-03-15")
})

test("StudentPortalAccount model exists in Prisma schema contract", () => {
  const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
  assert.match(schema, /model\s+StudentPortalAccount\s*{/)
  assert.match(schema, /eaglesId\s+String\s+@unique/)
  assert.match(schema, /passwordHash\s+String/)
})

test("StudentNewsReport review fields exist in Prisma schema contract", () => {
  const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
  const modelStart = schema.indexOf("model StudentNewsReport {")
  assert.ok(modelStart >= 0, "StudentNewsReport model is present")
  const modelChunk = schema.slice(modelStart, modelStart + 1600)
  assert.match(modelChunk, /reviewStatus\s+String\s+@default\("submitted"\)/)
  assert.match(modelChunk, /reviewNote\s+String\?/)
  assert.match(modelChunk, /validationIssuesJson\s+Json\?/)
  assert.match(modelChunk, /reviewedAt\s+DateTime\?/)
  assert.match(modelChunk, /reviewedByUsername\s+String\?/)
})

test("AssignmentTemplate Prisma model and admin route surface exist in the contract", () => {
  const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
  assert.match(schema, /model\s+AssignmentTemplate\s*{/)
  assert.match(schema, /itemsJson\s+Json\?/)
  assert.match(schema, /completed\s+Boolean\s+@default\(false\)/)

  const routes = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")
  assert.match(routes, /ADMIN_ASSIGNMENT_TEMPLATES_PATH/)
  assert.match(routes, /ADMIN_ASSIGNMENT_TEMPLATES_IMPORT_PATH/)
  assert.match(routes, /ADMIN_ASSIGNMENT_TEMPLATE_PATH_RE/)
})

test("student news save/check flow lives in the submissions module with separate draft-check and submit paths", () => {
  const store = fs.readFileSync(new URL("../server/student-admin-store.mjs", import.meta.url), "utf8")
  const compliance = fs.readFileSync(new URL("../src/modules/admin/student-news-compliance.mjs", import.meta.url), "utf8")
  const submissions = fs.readFileSync(new URL("../src/modules/admin/student-news-submissions.mjs", import.meta.url), "utf8")
  const routes = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")

  assert.match(store, /from "\.\.\/src\/modules\/admin\/student-news-submissions\.mjs"/)
  assert.doesNotMatch(store, /student-news-compliance\.mjs/)
  assert.doesNotMatch(store, /export function buildStudentNewsComplianceBlock\(/)
  assert.doesNotMatch(store, /export async function evaluateStudentNewsCompliance\(/)
  assert.doesNotMatch(store, /export function normalizeValidationIssueMap\(/)
  assert.doesNotMatch(store, /export function updateStudentNewsValidationIssues\(/)
  assert.doesNotMatch(store, /function resolveStudentNewsSubmissionWindow\(/)
  assert.doesNotMatch(store, /function mapStudentNewsReportRow\(/)
  assert.doesNotMatch(store, /function buildStudentNewsCalendarRows\(/)
  assert.doesNotMatch(store, /async function listStudentNewsCalendar\(/)
  assert.doesNotMatch(store, /async function saveStudentNewsReport\(/)
  assert.doesNotMatch(store, /function normalizeStudentNewsReviewStatus\(/)
  assert.doesNotMatch(store, /function resolveStudentNewsStatusColor\(/)
  assert.match(submissions, /from "\.\/student-news-compliance\.mjs"/)
  assert.match(submissions, /from "\.\/student-news-fallback\.mjs"/)
  assert.match(submissions, /export function resolveStudentNewsSubmissionWindow\(/)
  assert.match(submissions, /export function buildStudentNewsCalendarRows\(/)
  assert.match(submissions, /export async function listStudentNewsCalendar\(/)
  assert.match(submissions, /export async function saveStudentNewsDraft\(/)
  assert.match(submissions, /export async function saveStudentNewsDraftCheck\(/)
  assert.match(submissions, /export async function saveStudentNewsReport\(/)
  assert.match(compliance, /export function buildStudentNewsComplianceBlock\(/)
  assert.match(compliance, /export function normalizeValidationIssueMap\(/)
  assert.match(compliance, /export async function evaluateStudentNewsCompliance\(/)
  assert.match(compliance, /export function updateStudentNewsValidationIssues\(/)
  assert.match(compliance, /FIXED PER COMPLIANCE RESOLUTION ON SAVE/)
  assert.doesNotMatch(store, /saved:\s*true/)
  assert.match(store, /saveStudentNewsDraftCheck/)
  assert.doesNotMatch(store, /persistStudentNewsReport/)
  assert.doesNotMatch(store, /dateSatisfiedAt/)
  assert.doesNotMatch(store, /firstSubmittedAt/)
  assert.doesNotMatch(store, /validationIssuesJson:\s*updatedIssues\.issues/)
  assert.match(submissions, /saved:\s*true/)
  assert.match(submissions, /complianceFailed:\s*!mmrPassed/)
  assert.match(submissions, /mmrPassedAt/)
  assert.match(submissions, /dateSatisfiedAt/)
  assert.match(submissions, /reportDateLockedAt/)
  assert.match(submissions, /firstSubmittedAt/)
  assert.match(submissions, /requiredTasks/)
  assert.match(submissions, /warningTasks/)
  assert.match(submissions, /STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED/)
  assert.match(submissions, /STUDENT_NEWS_REVIEW_STATUS_SUBMITTED/)
  assert.match(submissions, /Minimum requirements have not been met\. Run Check first\./)
  assert.match(submissions, /Today's report date is satisfied and locked/)
  assert.match(submissions, /validationIssuesJson:\s*updatedIssues\.issues/)

  assert.match(routes, /error\.payload/)
  assert.match(routes, /STUDENT_NEWS_REPORTS_CHECK_PATH/)
  assert.match(routes, /STUDENT_NEWS_REPORTS_PATH}\/draft/)
  assert.match(routes, /saveStudentNewsDraftCheck/)
  assert.match(routes, /column `\(not available\)` does not exist in the current database/)
  assert.match(routes, /Database schema mismatch detected/)
})

test("admin quarter controls share the attendance quarter safety default", () => {
  const source = fs.readFileSync(new URL("../web-asset/admin/student-admin.js", import.meta.url), "utf8")
  assert.match(source, /function normalizeQuarterDropdownDefaults\(/)
  assert.match(source, /\["a_quarter", "g_quarter", "r_quarter", "gradeChartQuarter"\]/)
  assert.match(source, /updateAttendanceQuarterWarning\(\)/)
})

test("admin systems health includes a non-secret Redis health card", () => {
  const source = fs.readFileSync(new URL("../web-asset/admin/student-admin.js", import.meta.url), "utf8")
  const css = fs.readFileSync(new URL("../web-asset/admin/student-admin.css", import.meta.url), "utf8")
  assert.match(source, /key: "redis"/)
  assert.match(source, /label: "Redis"/)
  assert.match(source, /source=\$\{redis\.source \|\| "environment"\}/)
  assert.match(source, /action: \{ label: "Ping Redis", action: "redis-ping" \}/)
  assert.match(source, /method: "POST"/)
  assert.match(source, /ADMIN_REDIS_PING_PATH/)
  assert.match(css, /\.system-health-redis-ping-btn[\s\S]*block-size: 48px[\s\S]*inline-size: 48px/)
  assert.doesNotMatch(source, /redis\.url/)
})

test("admin systems health probes every engagement API surface", () => {
  const source = fs.readFileSync(new URL("../web-asset/admin/student-admin.js", import.meta.url), "utf8")
  assert.match(source, /const ENGAGEMENT_API_HEALTH_CHECKS = \[/u)
  assert.match(source, /key: "profileEngagementApi"[\s\S]*?path: "\/api\/admin\/profile-engagement\?take=1"/u)
  assert.match(source, /key: "assignmentEngagementApi"[\s\S]*?path: "\/api\/admin\/assignment-reminder-engagement\?take=1"/u)
  assert.match(source, /key: "performanceEngagementApi"[\s\S]*?path: "\/api\/admin\/performance-engagement"/u)
  assert.match(source, /key: "libraryEngagementApi"[\s\S]*?path: "\/api\/admin\/library\/engagement"/u)
  assert.match(source, /credentials: "include"/u)
  assert.match(source, /label: "RC\/Performance"/u)
  assert.match(source, /API HTTP \$\{status\}/u)
})

test("admin attendance restores only the selected level and always derives the current date context", () => {
  const source = fs.readFileSync(new URL("../web-asset/admin/student-admin.js", import.meta.url), "utf8")
  assert.match(source, /const ATTENDANCE_FORM_STORAGE_KEY = "sis\.admin\.attendance\.form\.v1"/)
  assert.match(source, /function loadAttendanceFormContextFromStorage\(/)
  assert.match(source, /function persistAttendanceFormContext\(/)
  assert.match(source, /state\.attendanceLanding\.selectedLevel = resolveSystemLevelName\(/)
  assert.match(source, /if \(dateEl\) dateEl\.value = attendanceTodayIsoDate\(\)/)
  assert.match(source, /if \(yearEl\) yearEl\.value = defaultAttendanceSchoolYear\(classDate\)/)
  assert.match(source, /if \(quarterEl\) quarterEl\.value = quarterFromIsoDate\(classDate\)/)
  assert.doesNotMatch(source, /stored\.attendanceDate/)
  assert.doesNotMatch(source, /stored\.schoolYear/)
  assert.doesNotMatch(source, /stored\.quarter/)
})

test("admin attendance save feedback exposes progress, result state, and duplicate-save guard", () => {
  const source = fs.readFileSync(new URL("../web-asset/admin/student-admin.js", import.meta.url), "utf8")
  const html = fs.readFileSync(new URL("../web-asset/admin/student-admin.html", import.meta.url), "utf8")
  assert.match(html, /id="attendanceSaveResult"/)
  assert.match(html, /aria-live="polite"/)
  assert.match(source, /function setAttendanceSaveBusy\(/)
  assert.match(source, /Saving \$\{processed\}\/\$\{total\}/)
  assert.match(source, /if \(state\.attendanceLanding\.saveBusy\) return;/)
  assert.match(source, /No changes — all \$\{unchanged\} records already match/)
})

test("admin attendance loads saved records before deriving fresh-page radio selections", () => {
  const source = fs.readFileSync(new URL("../web-asset/admin/student-admin.js", import.meta.url), "utf8")
  const refreshStart = source.indexOf("async function refreshAttendanceLandingRows")
  assert.ok(refreshStart >= 0, "attendance row refresh is present")
  const refreshChunk = source.slice(refreshStart, refreshStart + 2600)
  const hydrateIndex = refreshChunk.indexOf("if (hydrate) await hydrateAttendanceLandingDetails(students);")
  const selectionIndex = refreshChunk.indexOf("students.forEach((student) => {")
  assert.ok(hydrateIndex >= 0, "fresh attendance rows hydrate saved details")
  assert.ok(selectionIndex >= 0, "attendance row selections are derived")
  assert.ok(hydrateIndex < selectionIndex, "saved details load before defaults are assigned")
})

test("student portal login resolver keeps DB-first auth with env fallback", () => {
  const routes = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")
  const verifyStart = routes.indexOf("async function verifyStudentPortalCredentials(")
  assert.ok(verifyStart >= 0, "verifyStudentPortalCredentials is present")
  const verifyChunk = routes.slice(verifyStart, verifyStart + 3600)

  const dbLookupPos = verifyChunk.indexOf("prisma.studentPortalAccount.findUnique")
  const envFallbackPos = verifyChunk.indexOf("configuredStudentPortalAccounts()")
  assert.ok(dbLookupPos >= 0, "DB lookup is present")
  assert.ok(envFallbackPos >= 0, "env fallback is present")
  assert.ok(dbLookupPos < envFallbackPos, "DB lookup executes before env fallback")
})

test("student portal session resolver prefers DB eaglesId mapping over stale session/env studentRefId", () => {
  const routes = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")
  const resolveStart = routes.indexOf("async function resolveStudentPortalSessionStudentRefId(")
  assert.ok(resolveStart >= 0, "resolveStudentPortalSessionStudentRefId is present")
  const resolveChunk = routes.slice(resolveStart, resolveStart + 2400)

  const dbMappedPos = resolveChunk.indexOf("findStudentByEaglesIdForParent(eaglesId)")
  const sessionFallbackPos = resolveChunk.indexOf("if (sessionStudentRefId) return sessionStudentRefId")
  const dbGuardPos = resolveChunk.indexOf("if (isStudentAdminStoreEnabled())")
  const emptyReturnPos = resolveChunk.indexOf('return ""')

  assert.ok(dbGuardPos >= 0, "DB-backed guard is present")
  assert.ok(dbMappedPos >= 0, "DB mapping by eaglesId is present")
  assert.ok(emptyReturnPos >= 0, "resolver returns empty when DB mapping fails")
  assert.ok(sessionFallbackPos < 0, "no early stale session studentRefId return")
})

test("student dashboard/news paths guard missing optional Prisma delegates", () => {
  const store = fs.readFileSync(new URL("../server/student-admin-store.mjs", import.meta.url), "utf8")
  const dashboardSummary = fs.readFileSync(new URL("../src/modules/admin/dashboard-summary.mjs", import.meta.url), "utf8")
  const studentAdminQueries = fs.readFileSync(
    new URL("../src/modules/admin/student-admin-queries.mjs", import.meta.url),
    "utf8"
  )
  const studentRoster = fs.readFileSync(new URL("../src/modules/admin/student-roster.mjs", import.meta.url), "utf8")
  const submissions = fs.readFileSync(new URL("../src/modules/admin/student-news-submissions.mjs", import.meta.url), "utf8")
  const parentReports = fs.readFileSync(new URL("../src/modules/admin/parent-reports.mjs", import.meta.url), "utf8")
  const points = fs.readFileSync(new URL("../src/modules/admin/points.mjs", import.meta.url), "utf8")
  const records = fs.readFileSync(new URL("../src/modules/admin/student-records.mjs", import.meta.url), "utf8")
  const review = fs.readFileSync(new URL("../src/modules/admin/student-news-review.mjs", import.meta.url), "utf8")
  const routes = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")

  assert.doesNotMatch(store, /export function selectAtRiskStudentsFromSignals\(/)
  assert.doesNotMatch(store, /export function selectAttendanceRiskStudentsFromSignals\(/)
  assert.doesNotMatch(store, /export function selectCurrentNotYetDueAssignmentsByLevel\(/)
  assert.doesNotMatch(store, /export function summarizeTodayAttendanceForDashboard\(/)
  assert.doesNotMatch(store, /export async function getAdminDashboardSummary\(/)
  assert.match(dashboardSummary, /export function selectAtRiskStudentsFromSignals\(/)
  assert.match(dashboardSummary, /export function selectAttendanceRiskStudentsFromSignals\(/)
  assert.match(dashboardSummary, /export function selectCurrentNotYetDueAssignmentsByLevel\(/)
  assert.match(dashboardSummary, /export function summarizeTodayAttendanceForDashboard\(/)
  assert.match(dashboardSummary, /export async function getAdminDashboardSummary\(/)
  assert.doesNotMatch(store, /export async function listStudents\(/)
  assert.doesNotMatch(store, /export async function getStudentById\(/)
  assert.doesNotMatch(store, /export async function getNextStudentNumber\(/)
  assert.doesNotMatch(store, /export async function listLevelAndSchoolFilters\(/)
  assert.doesNotMatch(store, /export async function listExerciseTitles\(/)
  assert.doesNotMatch(store, /export function getStudentAdminFilterCacheStatus\(/)
  assert.match(studentRoster, /export async function listStudents\(/)
  assert.match(studentRoster, /export async function getStudentById\(/)
  assert.match(studentRoster, /export async function getNextStudentNumber\(/)
  assert.match(studentAdminQueries, /export async function listLevelAndSchoolFilters\(/)
  assert.match(studentAdminQueries, /export async function listExerciseTitles\(/)
  assert.match(studentAdminQueries, /export function getStudentAdminFilterCacheStatus\(/)
  assert.match(routes, /student-admin-queries\.mjs/)
  assert.match(routes, /student-roster\.mjs/)
  assert.doesNotMatch(store, /hasPrismaDelegateMethod\(prisma, "studentNewsReport", "upsert"\)/)
  assert.doesNotMatch(store, /listStudentNewsReportsFromFallbackStore\(/)
  assert.doesNotMatch(store, /upsertStudentNewsReportInFallbackStore\(/)
  assert.doesNotMatch(store, /isStudentNewsReportSchemaUnavailableError\(/)
  assert.doesNotMatch(store, /isStudentNewsReviewSchemaUnavailableError\(/)
  assert.match(submissions, /hasPrismaDelegateMethod\(prisma, "studentNewsReport", "upsert"\)/)
  assert.match(submissions, /listStudentNewsReportsFromFallbackStore\(/)
  assert.match(submissions, /upsertStudentNewsReportInFallbackStore\(/)
  assert.match(submissions, /isStudentNewsReportSchemaUnavailableError\(/)
  assert.match(submissions, /isStudentNewsReviewSchemaUnavailableError\(/)
  assert.doesNotMatch(store, /export async function listStudentNewsReportsForReview\(/)
  assert.doesNotMatch(store, /export async function reviewStudentNewsReport\(/)
  assert.doesNotMatch(store, /STUDENT_NEWS_REVIEW_STATE_FILE_PATH/)
  assert.match(review, /export async function listStudentNewsReportsForReview\(/)
  assert.match(review, /export async function reviewStudentNewsReport\(/)
  assert.match(review, /function buildStudentNewsReviewSelect\(/)
  assert.match(review, /function resolveStudentNewsReviewActionStatus\(/)
  assert.match(parentReports, /export function mapParentClassReport\(/)
  assert.match(parentReports, /export function isLegacyParentReportApprovedAtSchemaError\(/)
  assert.match(parentReports, /export function isLegacyParentReportParticipationPointsSchemaError\(/)
  assert.match(parentReports, /export function normalizeReportParticipationPoints\(/)
  assert.match(points, /import \{ listStudents \} from "\.\/student-roster\.mjs"/)
  assert.match(points, /function hasPrismaDelegateMethod\(/)
  assert.match(points, /loadApprovedParentReportRowsForPoints\(prisma, idFilter\)/)
  assert.match(points, /isLegacyParentReportApprovedAtSchemaError/)
  assert.match(points, /isLegacyParentReportParticipationPointsSchemaError/)
  assert.match(points, /export async function listStudentPointsSnapshots\(/)
  assert.match(points, /export async function getSchoolPointsYtdSummary\(/)
  assert.match(points, /export async function createStudentPointsAdjustment\(/)
  assert.match(points, /findManyOrEmpty\(prisma, "studentPointsAdjustment"/)
  assert.match(points, /hasPrismaDelegateMethod\(prisma, "studentPointsAdjustment", "create"\)/)
  assert.doesNotMatch(points, /export \{\s*buildStudentPointsEvents,/)
  assert.doesNotMatch(store, /findManyOrEmpty\(prisma, "studentPointsAdjustment"/)
  assert.doesNotMatch(store, /hasPrismaDelegateMethod\(prisma, "studentPointsAdjustment", "create"\)/)
  assert.doesNotMatch(store, /buildStudentPointsEvents\(/)
  assert.doesNotMatch(store, /listStudentPointsSnapshots\(/)
  assert.doesNotMatch(store, /getSchoolPointsYtdSummary\(/)
  assert.doesNotMatch(store, /listStudentPointsLedger\(/)
  assert.doesNotMatch(store, /loadApprovedParentReportRowsForPoints\(/)
  assert.doesNotMatch(store, /isLegacyParentReportApprovedAtSchemaError/)
  assert.doesNotMatch(store, /isLegacyParentReportParticipationPointsSchemaError/)
  assert.doesNotMatch(store, /createStudentPointsAdjustment\(/)
  assert.doesNotMatch(store, /setStudentPointsTotal\(/)
  assert.match(routes, /from "\.\.\/src\/modules\/admin\/points\.mjs"/)
  assert.match(records, /export function mapGradeRecordForApi\(/)
  assert.match(records, /export \{ isCompletedGradeRecord, isOutstandingGradeRecord, isLateCompletedGradeRecord, isOnTimeCompletedGradeRecord, isAssignmentTrackingGradeRecord \}/)
  assert.match(records, /export async function findFamilyByEmergencyPhone\(/)
  assert.match(records, /export async function saveAttendanceRecord\(/)
  assert.match(records, /export async function deleteAttendanceRecord\(/)
  assert.match(records, /export async function saveGradeRecord\(/)
  assert.match(records, /export async function deleteGradeRecord\(/)
  assert.doesNotMatch(store, /function mapGradeRecordForApi\(/)
  assert.doesNotMatch(store, /const GRADE_RECORD_SOURCE_ASSIGNMENT = "assignment"/)
  assert.doesNotMatch(store, /const GRADE_RECORD_SOURCE_MANUAL = "manual"/)
  assert.doesNotMatch(store, /const GRADE_RECORD_SOURCE_AUTO_IMPORT = "auto-import"/)
  assert.doesNotMatch(store, /function inferGradeRecordSource\(/)
  assert.doesNotMatch(store, /function isCompletedGradeRecord\(/)
  assert.doesNotMatch(store, /function isOutstandingGradeRecord\(/)
  assert.doesNotMatch(store, /function isLateCompletedGradeRecord\(/)
  assert.doesNotMatch(store, /function isOnTimeCompletedGradeRecord\(/)
  assert.doesNotMatch(store, /function isAssignmentTrackingGradeRecord\(/)
  assert.doesNotMatch(store, /export async function findFamilyByEmergencyPhone\(/)
  assert.doesNotMatch(store, /export async function saveAttendanceRecord\(/)
  assert.doesNotMatch(store, /export async function deleteAttendanceRecord\(/)
  assert.doesNotMatch(store, /export async function saveGradeRecord\(/)
  assert.doesNotMatch(store, /export async function deleteGradeRecord\(/)
  assert.doesNotMatch(store, /export async function saveParentClassReport\(/)
  assert.doesNotMatch(store, /export async function deleteParentClassReport\(/)
  assert.doesNotMatch(store, /export async function generateParentClassReportFromGrades\(/)
  assert.doesNotMatch(store, /export async function approveParentClassReport\(/)

  assert.match(routes, /const newsCalendar = await listStudentNewsCalendar/)
  assert.match(routes, /statusSummary/)
  assert.match(routes, /function canTeacherWriteDataEntryPath\(/)
  assert.match(routes, /ADMIN_ATTENDANCE_PATH_RE\.test\(pathname\)/)
  assert.match(routes, /ADMIN_GRADES_PATH_RE\.test\(pathname\)/)
  assert.match(routes, /ADMIN_REPORTS_PATH_RE\.test\(pathname\)/)
  assert.match(routes, /from "\.\.\/src\/modules\/admin\/dashboard-summary\.mjs"/)
  assert.match(routes, /from "\.\.\/src\/modules\/admin\/student-news-review\.mjs"/)
  assert.match(routes, /from "\.\.\/src\/modules\/admin\/student-records\.mjs"/)
})

test("student week-set modal submit guard locks approved rows and honors editableUntil for revision returns", () => {
  const studentPortalHtml = fs.readFileSync(new URL("../web-asset/student/student-portal.html", import.meta.url), "utf8")
  assert.match(studentPortalHtml, /function canEditNewsWeekSetViewerItem\(item = \{\}\) \{/)
  assert.match(studentPortalHtml, /if \(status === "approved"\) return false;/)
  assert.match(studentPortalHtml, /const editableUntil = t\(item\?\.editableUntil\);/)
  assert.match(studentPortalHtml, /const editableUntilMs = editableUntil \? Date\.parse\(editableUntil\) : Number\.NaN;/)
  assert.match(studentPortalHtml, /if \(Number\.isFinite\(editableUntilMs\)\) return Date\.now\(\) < editableUntilMs;/)
  assert.match(studentPortalHtml, /const openReportDate = t\(state\.window\?\.reportDate\)\.slice\(0,\s*10\);/)
  assert.match(studentPortalHtml, /return Boolean\(openReportDate && t\(item\?\.reportDate\)\.slice\(0,\s*10\) === openReportDate\);/)
  assert.match(studentPortalHtml, /if \(!canEditNewsWeekSetViewerItem\(active\)\) throw new Error\("This report is locked\."\);/)
  assert.doesNotMatch(studentPortalHtml, /Approved news reports can only be edited on the current open date\./)
  assert.doesNotMatch(
    studentPortalHtml,
    /reviewStatus === "approved"[\s\S]*reportDate !== openReportDate/
  )
  assert.doesNotMatch(
    studentPortalHtml,
    /if \(reviewStatus === "approved"\)\s*\{\s*throw new Error\("Approved news reports cannot be edited"\);?\s*\}/
  )
})

test("queue hub source contract includes student-week news-set panel", () => {
  const routes = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")
  assert.match(routes, /"news-report-review"/)
  assert.match(routes, /News Week Sets/)
  assert.match(routes, /weekStart/)
  assert.match(routes, /weekEnd/)
  assert.match(routes, /reportCount/)
  assert.match(routes, /setStatus/)
  assert.match(routes, /setAction/)
  assert.match(routes, /setActionColor/)
  assert.match(routes, /"incomplete"/)
  assert.match(routes, /"waiting"/)
  assert.match(
    routes,
    /function resolveNewsSetUnapprovedCount\(\{[\s\S]*submittedCount = 0,[\s\S]*revisionRequestedCount = 0/
  )
  assert.match(routes, /return Math\.max\(0,\s*submitted \+ revisionRequested\)/)
})

test("news review status/action rules and revise chip label keep locked admin ui rules", () => {
  const adminUiSource = withAdminAssets(ADMIN_HTML_SOURCE)
  const runtimesScript = fs.readFileSync(path.resolve(process.cwd(), "tools/sync-and-restart-runtimes.sh"), "utf8")
  const gitignoreSource = fs.readFileSync(path.resolve(process.cwd(), ".gitignore"), "utf8")
  const statusStart = ADMIN_JS_SOURCE.indexOf("function newsReviewWeekSetStatusToken(")
  assert.ok(statusStart >= 0, "newsReviewWeekSetStatusToken is present")
  const statusChunk = ADMIN_JS_SOURCE.slice(statusStart, statusStart + 1800)
  assert.match(statusChunk, /if \(reportCount >= requiredReports && approved >= requiredReports\) return "approved";/)
  assert.match(statusChunk, /return "waiting";/)
  assert.match(statusChunk, /if \(submitted === 0 && revisionRequested === 0\) return "checked";/)
  assert.match(statusChunk, /if \(revisionRequested > 0 \|\| submitted > 0\) return "waiting";/)
  assert.match(ADMIN_JS_SOURCE, /if \(normalized === "revise" \|\| normalized === "revision-requested"\)/)
  const actionStart = ADMIN_JS_SOURCE.indexOf("function newsReviewWeekSetActionToken(")
  assert.ok(actionStart >= 0, "newsReviewWeekSetActionToken is present")
  const actionChunk = ADMIN_JS_SOURCE.slice(actionStart, actionStart + 1100)
  assert.match(actionChunk, /const pending = Math\.max\(0, submitted\);/)
  assert.doesNotMatch(actionChunk, /awaitingReReview/)
  assert.doesNotMatch(actionChunk, /submitted \+ revisionRequested/)
  assert.match(runtimesScript, /stash_local_sis_config/)
  assert.match(runtimesScript, /restore_local_sis_config/)
  assert.match(runtimesScript, /SIS_CONFIG_SOURCE_BACKUP_DIR/)
  assert.match(runtimesScript, /cp -a "\$SIS_CONFIG_SOURCE_PATH" "\$SIS_CONFIG_SOURCE_BACKUP"/)
  assert.match(runtimesScript, /cp -a "\$SIS_CONFIG_SOURCE_BACKUP" "\$SIS_CONFIG_SOURCE_PATH"/)
  assert.doesNotMatch(runtimesScript, /mv "\$SIS_CONFIG_SOURCE_PATH" "\$SIS_CONFIG_SOURCE_BACKUP"/)
  assert.match(gitignoreSource, /SIS_CONFIG\.json/)
  assert.match(
    adminUiSource,
    /data-sort-field="setAction"[\s\S]*Action[\s\S]*data-sort-field="setStatus"[\s\S]*Status/
  )
  assert.match(
    adminUiSource,
    /data-label="Action">[\s\S]*data-label="Status">/
  )
})

test("generateStudentReportCardPdf returns a PDF buffer", async () => {
  const student = {
    eaglesId: "S001",
    studentNumber: 1001,
    profile: {
      fullName: "Jane Student",
      englishName: "Jane",
      currentGrade: "Grade 5",
      schoolName: "Eagles School",
      motherName: "Mom Student",
      motherPhone: "0900111222",
      motherEmergencyContact: "0900111222",
      fatherName: "Dad Student",
      fatherPhone: "0900555666",
      fatherEmergencyContact: "0900555666",
      streetAddress: "123 Main St",
      wardDistrict: "District 1",
      city: "HCMC",
    },
    attendanceRecords: [
      {
        className: "English",
        schoolYear: "2026-2027",
        quarter: "q1",
        attendanceDate: "2026-04-01",
        status: "present",
      },
      {
        className: "English",
        schoolYear: "2026-2027",
        quarter: "q1",
        attendanceDate: "2026-04-02",
        status: "late",
      },
    ],
    gradeRecords: [
      {
        className: "English",
        schoolYear: "2026-2027",
        quarter: "q1",
        assignmentName: "Homework 1",
        dueAt: "2026-04-05",
        submittedAt: "2026-04-04",
        score: 8,
        maxScore: 10,
        homeworkCompleted: true,
        homeworkOnTime: true,
        behaviorScore: 9,
        participationScore: 8,
        inClassScore: 9,
      },
    ],
    parentReports: [
      {
        className: "English",
        schoolYear: "2026-2027",
        quarter: "q1",
        generatedAt: "2026-04-10",
        homeworkCompletionRate: 100,
        homeworkOnTimeRate: 100,
        behaviorScore: 9,
        participationScore: 8,
        inClassScore: 9,
        comments: "Excellent progress",
      },
    ],
  }

  const buffer = await generateStudentReportCardPdf(student, {
    className: "English",
    schoolYear: "2026-2027",
    quarter: "q1",
  })

  assert.ok(Buffer.isBuffer(buffer))
  assert.equal(buffer.subarray(0, 4).toString("utf8"), "%PDF")
  assert.ok(buffer.length > 500)
})

test("generateStudentReportCardPdf counts late attendance as present in the summary", async () => {
  const student = {
    eaglesId: "S001",
    studentNumber: 1001,
    profile: { fullName: "Jane Student" },
    attendanceRecords: [
      {
        attendanceDate: "2026-04-01",
        className: "English",
        schoolYear: "2026-2027",
        quarter: "q1",
        status: "present",
      },
      {
        attendanceDate: "2026-04-02",
        className: "English",
        schoolYear: "2026-2027",
        quarter: "q1",
        status: "late",
      },
      {
        attendanceDate: "2026-04-03",
        className: "English",
        schoolYear: "2026-2027",
        quarter: "q1",
        status: "absent",
      },
    ],
    gradeRecords: [],
    parentReports: [],
  }

  const buffer = await generateStudentReportCardPdf(student, {
    className: "English",
    schoolYear: "2026-2027",
    quarter: "q1",
  })

  const pdfPath = `/tmp/sis-report-card-${process.pid}.pdf`
  const txtPath = `${pdfPath}.txt`
  try {
    fs.writeFileSync(pdfPath, buffer)
    execFileSync("pdftotext", [pdfPath, txtPath])
    const text = fs.readFileSync(txtPath, "utf8")
    assert.match(text, /Present:\s*2,\s*Absent:\s*1,\s*Late:\s*1,\s*Excused:\s*0/i)
  } finally {
    fs.rmSync(pdfPath, { force: true })
    fs.rmSync(txtPath, { force: true })
  }
})

test("buildStudentReportCardPayload exposes attendance summary in both legacy and current shapes", () => {
  const payload = buildStudentReportCardPayload(
    {
      eaglesId: "S001",
      studentNumber: 1001,
      profile: { fullName: "Jane Student" },
      attendanceRecords: [
        { status: "present" },
        { status: "late" },
        { status: "absent" },
      ],
      gradeRecords: [],
      parentReports: [],
    },
    {
      className: "English",
      schoolYear: "2026-2027",
      quarter: "q1",
    },
  )

  assert.equal(payload.attendance.total, 3)
  assert.equal(payload.attendance.present, 2)
  assert.equal(payload.attendance.absences, 1)
  assert.equal(payload.attendance.tardy, 1)
  assert.equal(payload.attendance.rate, "66.67%")
  assert.equal(payload.attendance.percent, "66.67%")
  assert.equal(payload.attendance.attendanceRate, "66.67%")
  assert.equal(payload.attendance.attendancePercent, "66.67%")
  assert.equal(payload.attendance.absenceCount, 1)
  assert.equal(payload.attendance.tardyCount, 1)
})

test("buildChildDashboardSnapshot counts late attendance as present", () => {
  const snapshot = buildChildDashboardSnapshot({
    child: { eaglesId: "S001", fullName: "Jane Student" },
    attendanceRows: [
      { status: "present" },
      { status: "late" },
      { status: "absent" },
    ],
    gradeRows: [],
    reportRows: [],
  })

  assert.equal(snapshot.attendance.total, 3)
  assert.equal(snapshot.attendance.present, 2)
  assert.equal(snapshot.attendance.absent, 1)
  assert.equal(snapshot.attendance.late, 1)
  assert.equal(snapshot.attendance.excused, 0)
})

test("buildChildDashboardSnapshot preserves stored school setup quarters and fails closed when dates are blank", () => {
  const adminUiSettingsPath = process.env.STUDENT_ADMIN_UI_SETTINGS_FILE || path.resolve(process.cwd(), "runtime-data/admin-ui-settings.json")
  const sisConfigPath = `/tmp/sis-config-blank-${process.pid}.json`
  const priorAdminUiSettings = fs.existsSync(adminUiSettingsPath)
    ? fs.readFileSync(adminUiSettingsPath, "utf8")
    : null
  const priorSisConfigFile = process.env.SIS_CONFIG_FILE
  const priorSisConfig = fs.existsSync(sisConfigPath) ? fs.readFileSync(sisConfigPath, "utf8") : null

  try {
    process.env.SIS_CONFIG_FILE = sisConfigPath
    fs.mkdirSync(path.dirname(adminUiSettingsPath), { recursive: true })
    fs.writeFileSync(
      adminUiSettingsPath,
      JSON.stringify({
        uiSettings: {
          schoolSetup: {
            schoolYear: "2026-2027",
            startDate: "",
            endDate: "",
            quarters: [
              { quarter: "q1", startDate: "2026-02-21", endDate: "2026-05-15" },
              { quarter: "q2", startDate: "2026-05-16", endDate: "2026-08-07" },
              { quarter: "q3", startDate: "2026-08-08", endDate: "2026-10-31" },
              { quarter: "q4", startDate: "2026-11-01", endDate: "2027-01-24" },
            ],
          },
        },
      }),
      "utf8",
    )
    fs.writeFileSync(
      sisConfigPath,
      JSON.stringify({
        uiSettings: {
          schoolSetup: {
            schoolYear: "2026-2027",
            startDate: "",
            endDate: "",
            quarters: [
              { quarter: "q1", startDate: "2026-02-21", endDate: "2026-05-15" },
              { quarter: "q2", startDate: "2026-05-16", endDate: "2026-08-07" },
              { quarter: "q3", startDate: "2026-08-08", endDate: "2026-10-31" },
              { quarter: "q4", startDate: "2026-11-01", endDate: "2027-01-24" },
            ],
          },
        },
      }),
      "utf8",
    )

    const snapshot = buildChildDashboardSnapshot({
      child: { eaglesId: "S001", fullName: "Jane Student" },
      attendanceRows: [],
      gradeRows: [],
      reportRows: [],
    })

    assert.equal(snapshot.schoolSetup.schoolYear, "2026-2027")
    assert.equal(snapshot.schoolSetup.startDate, "")
    assert.equal(snapshot.schoolSetup.endDate, "")
    assert.equal(snapshot.schoolSetup.quarters.length, 4)
    assert.deepEqual(
      snapshot.schoolSetup.quarters.map((quarter) => quarter.quarter),
      ["q1", "q2", "q3", "q4"],
    )
    assert.equal(snapshot.schoolSetupState, "maintenance")
    assert.equal(snapshot.details.quarterBoardState, "maintenance")
  } finally {
    if (priorSisConfigFile === undefined) {
      delete process.env.SIS_CONFIG_FILE
    } else {
      process.env.SIS_CONFIG_FILE = priorSisConfigFile
    }
    if (priorSisConfig !== null) {
      fs.writeFileSync(sisConfigPath, priorSisConfig, "utf8")
    } else {
      fs.rmSync(sisConfigPath, { force: true })
    }
    if (priorAdminUiSettings !== null) {
      fs.writeFileSync(adminUiSettingsPath, priorAdminUiSettings, "utf8")
    }
  }
})

test("buildChildDashboardSnapshot exact-matches assignment bundles for unfinished assignment panels", () => {
  const adminUiSettingsPath = process.env.STUDENT_ADMIN_UI_SETTINGS_FILE || path.resolve(process.cwd(), "runtime-data/admin-ui-settings.json")
  const sisConfigPath = `/tmp/sis-config-current-${process.pid}.json`
  const priorAdminUiSettings = fs.existsSync(adminUiSettingsPath)
    ? fs.readFileSync(adminUiSettingsPath, "utf8")
    : null
  const priorSisConfigFile = process.env.SIS_CONFIG_FILE
  const priorSisConfig = fs.existsSync(sisConfigPath) ? fs.readFileSync(sisConfigPath, "utf8") : null
  const today = new Date()
  const month = String(today.getMonth() + 1).padStart(2, "0")
  const toIsoDate = (date) => {
    const yearPart = date.getFullYear()
    const monthPart = String(date.getMonth() + 1).padStart(2, "0")
    const dayPart = String(date.getDate()).padStart(2, "0")
    return `${yearPart}-${monthPart}-${dayPart}`
  }
  const shiftDays = (value, days) => {
    const copy = new Date(value.getTime())
    copy.setDate(copy.getDate() + days)
    return copy
  }
  const year = today.getFullYear()
  const currentQuarterStart = toIsoDate(today)
  const currentQuarterEnd = toIsoDate(shiftDays(today, 7))
  const pastQuarterStart = toIsoDate(shiftDays(today, -30))
  const pastQuarterEnd = toIsoDate(shiftDays(today, -1))

  const currentBundle = {
    assignmentTemplateId: "bundle-current",
    eaglesId: "S001",
    level: "A1 Movers",
    assignmentTitle: "Current Quarter Bundle",
    assignedAt: currentQuarterStart,
    dueAt: currentQuarterEnd,
    items: [
      { assignmentTemplateItemId: "bundle-current-item-1", title: "Read current passage", url: "https://example.com/current/read" },
    ],
    itemTitles: ["Read current passage"],
    exerciseUrls: ["https://example.com/current/read"],
  }
  const pastBundle = {
    assignmentTemplateId: "bundle-past",
    eaglesId: "S001",
    level: "A1 Movers",
    assignmentTitle: "Past Quarter Bundle",
    assignedAt: pastQuarterStart,
    dueAt: pastQuarterEnd,
    items: [
      { assignmentTemplateItemId: "bundle-past-item-1", title: "Write past answers", url: "https://example.com/past/write" },
    ],
    itemTitles: ["Write past answers"],
    exerciseUrls: ["https://example.com/past/write"],
  }

  try {
    process.env.SIS_CONFIG_FILE = sisConfigPath
    fs.mkdirSync(path.dirname(adminUiSettingsPath), { recursive: true })
    fs.writeFileSync(
      adminUiSettingsPath,
      JSON.stringify({
        uiSettings: {
          schoolSetup: {
            schoolYear: `${year}-${year + 1}`,
            startDate: `${year}-01-01`,
            endDate: `${year}-12-31`,
            quarters: [
              { quarter: "q1", startDate: currentQuarterStart, endDate: currentQuarterEnd },
              { quarter: "q2", startDate: toIsoDate(shiftDays(today, 14)), endDate: toIsoDate(shiftDays(today, 21)) },
              { quarter: "q3", startDate: toIsoDate(shiftDays(today, 28)), endDate: toIsoDate(shiftDays(today, 35)) },
              { quarter: "q4", startDate: pastQuarterStart, endDate: pastQuarterEnd },
            ],
          },
        },
      }),
      "utf8",
    )
    fs.writeFileSync(
      sisConfigPath,
      JSON.stringify({
        uiSettings: {
          schoolSetup: {
            schoolYear: `${year}-${year + 1}`,
            startDate: `${year}-01-01`,
            endDate: `${year}-12-31`,
            quarters: [
              { quarter: "q1", startDate: currentQuarterStart, endDate: currentQuarterEnd },
              { quarter: "q2", startDate: toIsoDate(shiftDays(today, 14)), endDate: toIsoDate(shiftDays(today, 21)) },
              { quarter: "q3", startDate: toIsoDate(shiftDays(today, 28)), endDate: toIsoDate(shiftDays(today, 35)) },
              { quarter: "q4", startDate: pastQuarterStart, endDate: pastQuarterEnd },
            ],
          },
        },
      }),
      "utf8",
    )

    const snapshot = buildChildDashboardSnapshot({
      child: { eaglesId: "S001", fullName: "Jane Student", currentGrade: "A1 Movers" },
      attendanceRows: [],
      gradeRows: [
        {
          id: "grade-current",
          className: "A1 Movers",
          level: "A1 Movers",
          schoolYear: `${year}-${year + 1}`,
          quarter: "q1",
          assignmentName: "Current Quarter Bundle",
          dueAt: currentQuarterEnd,
          submittedAt: null,
          homeworkCompleted: false,
          homeworkOnTime: false,
          score: null,
          maxScore: null,
          comments: "",
          assignmentBundleJson: currentBundle,
        },
        {
          id: "grade-past",
          className: "A1 Movers",
          level: "A1 Movers",
          schoolYear: `${year}-${year + 1}`,
          quarter: "q4",
          assignmentName: "Past Quarter Bundle",
          dueAt: pastQuarterEnd,
          submittedAt: `${year}-${month}-${String(Math.max(today.getDate(), 2)).padStart(2, "0")}T09:00:00.000Z`,
          homeworkCompleted: true,
          homeworkOnTime: false,
          score: 8,
          maxScore: 10,
          comments: "Submitted after the quarter closed.",
          assignmentBundleJson: pastBundle,
        },
      ],
      reportRows: [],
      assignmentTemplates: [
        {
          id: currentBundle.assignmentTemplateId,
          assignmentTitle: currentBundle.assignmentTitle,
          assignedAt: currentBundle.assignedAt,
          dueAt: currentBundle.dueAt,
          level: currentBundle.level,
          eaglesId: currentBundle.eaglesId,
          items: [{ id: "bundle-current-item-1", title: "Read current passage", url: "https://example.com/current/read" }],
          itemsJson: [{ id: "bundle-current-item-1", title: "Read current passage", url: "https://example.com/current/read" }],
          assignmentBundleJson: currentBundle,
          completed: false,
        },
        {
          id: pastBundle.assignmentTemplateId,
          assignmentTitle: pastBundle.assignmentTitle,
          assignedAt: pastBundle.assignedAt,
          dueAt: pastBundle.dueAt,
          level: pastBundle.level,
          eaglesId: pastBundle.eaglesId,
          items: [{ id: "bundle-past-item-1", title: "Write past answers", url: "https://example.com/past/write" }],
          itemsJson: [{ id: "bundle-past-item-1", title: "Write past answers", url: "https://example.com/past/write" }],
          assignmentBundleJson: pastBundle,
          completed: false,
        },
      ],
    })

    assert.equal(snapshot.details.unfinishedCurrentQuarterAssignments.length, 1)
    assert.equal(snapshot.details.pastQuartersUnfinishedAssignments.length, 1)
    assert.equal(snapshot.details.unfinishedCurrentQuarterAssignments[0].href, "https://example.com/current/read")
    assert.equal(snapshot.details.unfinishedCurrentQuarterAssignments[0].itemLinks[0].url, "https://example.com/current/read")
    assert.match(snapshot.details.unfinishedCurrentQuarterAssignments[0].meta || "", /Assigned/i)
    assert.match(snapshot.details.unfinishedCurrentQuarterAssignments[0].note || "", /exercise link/i)
    assert.equal(snapshot.details.pastQuartersUnfinishedAssignments[0].href, "https://example.com/past/write")
    assert.equal(snapshot.details.pastQuartersUnfinishedAssignments[0].tone, "good")
    assert.equal(snapshot.details.pastQuartersUnfinishedAssignments[0].countsTowardQuarter, false)
    assert.match(snapshot.details.pastQuartersUnfinishedAssignments[0].note || "", /progress tracking only/i)
  } finally {
    if (priorSisConfigFile === undefined) {
      delete process.env.SIS_CONFIG_FILE
    } else {
      process.env.SIS_CONFIG_FILE = priorSisConfigFile
    }
    if (priorSisConfig !== null) {
      fs.writeFileSync(sisConfigPath, priorSisConfig, "utf8")
    } else {
      fs.rmSync(sisConfigPath, { force: true })
    }
    if (priorAdminUiSettings !== null) {
      fs.writeFileSync(adminUiSettingsPath, priorAdminUiSettings, "utf8")
    }
  }
})

test("start server for admin routes", async () => {
  await ensureAdminTestServer()
})

test("admin auth CORS allows loopback preview origins", async () => {
  const { startExerciseMailer } = await import(process.cwd() + "/server/exercise-mailer.mjs")
  const originalOrigin = process.env.EXERCISE_MAILER_ORIGIN
  process.env.EXERCISE_MAILER_ORIGIN = "http://example.com"
  const tmp = await startExerciseMailer({ transporter: makeMockTransport(), port: 0 })
  await new Promise((resolve) => tmp.once("listening", resolve))
  const tmpPort = tmp.address().port

  try {
    const pre = await fetchLocal(tmpPort, "/api/admin/auth/login", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:46145",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    })
    assert.equal(pre.status, 204)
    assert.equal(pre.headers.get("access-control-allow-origin"), "http://127.0.0.1:46145")
  } finally {
    await new Promise((resolve) => tmp.close(resolve))
    process.env.EXERCISE_MAILER_ORIGIN = originalOrigin || "*"
  }
})

test("student auth CORS echoes loopback origin and credentials when wildcard origin is configured", async () => {
  const { startExerciseMailer } = await import(process.cwd() + "/server/exercise-mailer.mjs")
  const originalOrigin = process.env.EXERCISE_MAILER_ORIGIN
  process.env.EXERCISE_MAILER_ORIGIN = "*"
  const tmp = await startExerciseMailer({ transporter: makeMockTransport(), port: 0 })
  await new Promise((resolve) => tmp.once("listening", resolve))
  const tmpPort = tmp.address().port

  try {
    const pre = await fetchLocal(tmpPort, "/api/student/auth/me", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:46855",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Content-Type",
      },
    })
    assert.equal(pre.status, 204)
    assert.equal(pre.headers.get("access-control-allow-origin"), "http://127.0.0.1:46855")
    assert.equal(pre.headers.get("access-control-allow-credentials"), "true")
  } finally {
    await new Promise((resolve) => tmp.close(resolve))
    process.env.EXERCISE_MAILER_ORIGIN = originalOrigin || "*"
  }
})

test("GET / returns the public portal hub with branded navigation", async () => {
  const res = await fetchLocal(port, "/")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  assert.match(res.headers.get("cache-control") || "", /no-cache/i)
  const html = await res.text()
  assert.match(html, /<html lang="vi">/i)
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
  assert.ok(titleMatch)
  assert.match(titleMatch[1], /\bEagles\b/i)
  assert.match(titleMatch[1], /\bClub\b/i)
  assert.match(html, /Hệ thống thông tin sinh viên/i)
  assert.match(html, /href="\/admin"/i)
  assert.match(html, /href="\/parent"/i)
  assert.match(html, /href="\/student"/i)
  assert.match(html, /__SIS_ADMIN_PAGE_PATH/i)
  assert.match(html, /__SIS_PARENT_PORTAL_PAGE_PATH/i)
  assert.match(html, /__SIS_STUDENT_PORTAL_PAGE_PATH/i)
  assert.match(html, /portal-card--admin/i)
  assert.match(html, /portal-card--parent/i)
  assert.match(html, /portal-card--student/i)
  assert.match(html, /Admin/i)
  assert.match(html, /Phụ huynh/i)
  assert.match(html, /Học sinh/i)
})

test("GET / renders hub links to canonical portal routes", async () => {
  const res = await fetchLocal(port, "/")
  assert.equal(res.status, 200)
  const html = await res.text()

  const portalLinks = [
    ["/admin", /data-portal-target="admin"/i],
    ["/parent", /data-portal-target="parent"/i],
    ["/student", /data-portal-target="student"/i],
  ]
  for (const [href, targetPattern] of portalLinks) {
    assert.match(html, new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*${targetPattern.source}`, "i"))
  }

  assert.match(html, /href="\/admin"/i)
  assert.match(html, /Hệ thống thông tin sinh viên/i)
  assert.match(html, /portal-card--admin/i)
  assert.match(html, /portal-card--parent/i)
  assert.match(html, /portal-card--student/i)
  assert.match(html, /Admin/i)
  assert.match(html, /Phụ huynh/i)
  assert.match(html, /Học sinh/i)
})

test("GET /admin returns HTML UI", async () => {
  const res = await fetchLocal(port, "/admin")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  assert.match(res.headers.get("cache-control") || "", /no-cache/i)
  assert.match(res.headers.get("cache-control") || "", /no-store/i)
  const responseHtml = await res.text()
  const html = withAdminAssets(responseHtml)
  const inlineStyleBlocks = responseHtml.match(/<style>[\s\S]*?<\/style>/gi) || []
  const renderedSections = renderedAdminPageSections(responseHtml)
  assert.match(html, /Student Admin/i)
  assert.match(html, /id="loginForm"/i)
  assert.match(responseHtml, /data-admin-auth-state="unauthenticated"/i)
  assert.ok(renderedSections.length > 1)
  assert.ok(renderedSections.includes("overview"))
  assert.ok(renderedSections.includes("queue-hub"))
  assert.ok(renderedSections.includes("school-setup"))
  assert.match(responseHtml, /id="overviewClassRows"/i)
  assert.equal(inlineStyleBlocks.length, 1)
  assert.match(inlineStyleBlocks[0], /\.app-shell/i)
  assert.match(responseHtml, /<link[^>]*rel="stylesheet"[^>]*href="\/web-asset\/admin\/admin-portal-theme\.min\.css"/i)
  assert.match(responseHtml, /<link[^>]*rel="stylesheet"[^>]*href="\/web-asset\/admin\/student-admin\.min\.css\?v=[^"]+"/i)
  assert.match(responseHtml, /<script[^>]+id="admin-app-loader"/i)
  assert.match(responseHtml, /script\.src\s*=\s*"\/web-asset\/admin\/student-admin(?:\.min)?\.js(?:\?v=[^"]+)?"/i)
  assert.match(responseHtml, /script\.defer\s*=\s*true/i)
  assert.match(responseHtml, /<button\s+class="portal-theme-toggle portal-button portal-button-immutable-chrome"\s+id="studentThemeToggle"\s+type="button"[^>]*aria-label="Chuyển sang giao diện tối"/i)
  assert.match(responseHtml, /<span\s+class="portal-theme-toggle__icon"[^>]*aria-hidden="true"[\s\S]*?<svg-icon\s+name="theme-moon"[^>]*id="studentThemeToggleIcon"/i)
  assert.doesNotMatch(responseHtml, /id="adminThemeToggle"/i)
  assert.doesNotMatch(responseHtml, /portal-theme-toggle__icon-moon|portal-theme-toggle__icon-sun/i)
  assert.match(responseHtml, /__SIS_ADMIN_INITIAL_AUTH__\?\.authenticated/i)
  assert.match(responseHtml, /loginForm.*requestSubmit/i)
  assert.match(responseHtml, /svg-icon\.js/i)
  assert.match(responseHtml, /href="\/admin"[^>]*data-page-link="overview"/i)
  assert.match(responseHtml, /href="\/admin\/queue-hub"[^>]*data-page-link="queue-hub"/i)
  assert.match(responseHtml, /href="\/admin\/attendance"[^>]*data-page-link="attendance"/i)
  assert.match(responseHtml, /href="\/admin\/assignments"[^>]*data-page-link="assignments"/i)
  assert.match(responseHtml, /href="\/admin\/grades-data"[^>]*data-page-link="grades-data"/i)
  assert.doesNotMatch(responseHtml, /data-page-link="(?:overview|queue-hub|attendance|assignments|grades-data)"[^>]*href="#"/i)
  assert.match(html, /__SIS_ADMIN_API_PREFIX/i)
  assert.match(html, /"\/api\/admin"/i)
  assert.match(html, /__SIS_ADMIN_PAGE_PATH/i)
  assert.match(html, /"\/admin"/i)
  assert.match(html, /__SIS_ADMIN_PAGE_SLUG/i)
  assert.match(html, /"overview"/i)
  assert.match(html, /Static preview mode requires \?apiOrigin=/i)
  assert.match(html, /function assertApiOriginConfiguredForStaticPreview\(\)/i)
  assert.doesNotMatch(html, /function inferLocalPreviewApiOrigin\(/i)
  assert.match(html, /function setActivePage\(/i)
  assert.match(html, /function pageSlugFromLocationSearch\(/i)
  assert.match(SHARED_PORTAL_THEME_SOURCE, /body\.student-portal-page \.chip,[\s\S]*?--chip-height:\s*30px;/i)
  assert.match(SHARED_PORTAL_THEME_SOURCE, /body\.student-portal-page \.chip-ok,[\s\S]*?background:\s*#d8f2e3;/i)
  assert.match(SHARED_PORTAL_THEME_SOURCE, /\.portal-chip,[\s\S]*?min-block-size:\s*var\(--portal-chip-min-block\);/i)
  assert.match(html, /const ADMIN_PAGE_URL_MODE = resolveAdminPageUrlMode\(\);/i)
  assert.match(html, /params\.get\("page"\)\s*\|\|\s*params\.get\("pageSlug"\)/i)
  assert.match(html, /if \(params\.has\("page"\) \|\| params\.has\("pageSlug"\)\) return "query";/i)
  assert.match(html, /urlMode === "query" \? buildPageQueryPath\(pageSlug\)/i)
})

test("GET /llms.txt returns the root agent guidance as plain text", async () => {
  const res = await fetchLocal(port, "/llms.txt")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/plain/i)
  assert.match(res.headers.get("cache-control") || "", /public/i)
  const body = await res.text()
  assert.match(body, /^# {2}The Eagles American English Club, Ltd\.\s/m)
  assert.match(body, /https:\/\/admin\.eagles\.edu\.vn\/admin/)
  assert.doesNotMatch(body, /<html/i)
})

test("portal llms.txt routes return their scoped agent guidance as plain text", async () => {
  const cases = [
    ["/admin/llms.txt", "# The Eagles American English Club, Ltd., Admin Portal"],
    ["/parent/llms.txt", "# The Eagles American English Club, Ltd., Parent Portal"],
    ["/student/llms.txt", "# The Eagles American English Club, Ltd., Student Portal"],
  ]

  for (const [pathname, heading] of cases) {
    const res = await fetchLocal(port, pathname)
    assert.equal(res.status, 200, pathname)
    assert.match(res.headers.get("content-type") || "", /text\/plain/i, pathname)
    const body = await res.text()
    assert.match(body, new RegExp(`^${heading}$`, "m"), pathname)
    assert.match(body, /^\s*- \[[^\]]+\]\(https?:\/\//m, pathname)
    assert.doesNotMatch(body, /<html/i, pathname)
  }
})

test("legacy portal routes redirect to canonical routes", async () => {
  const cases = [
    ["/admin/", "/admin"],
    ["/admin/students", "/admin"],
    ["/admin/students?page=grades-data", "/admin?page=grades-data"],
    ["/admin/students/attendance", "/admin/attendance"],
    ["/admin/students/points-management", "/admin/points-management"],
    ["/parent/portal", "/parent"],
    ["/student/portal", "/student"],
  ]

  for (const [pathname, location] of cases) {
    const res = await fetchLocal(port, pathname, { redirect: "manual" })
    assert.equal(res.status, 308)
    assert.equal(res.headers.get("location"), location)
  }
})

test("GET /admin?page=grades-data resolves query deep-link route", async () => {
  const res = await fetchLocal(port, "/admin?page=grades-data")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const responseHtml = await res.text()
  const html = withAdminAssets(responseHtml)
  const renderedSections = renderedAdminPageSections(responseHtml)
  assert.ok(renderedSections.includes("overview"))
  assert.ok(renderedSections.includes("grades-data"))
  assert.ok(renderedSections.includes("queue-hub"))
  assert.match(responseHtml, /id="openTabulatorGradesBtn"/i)
  assert.match(html, /__SIS_ADMIN_PAGE_SLUG/i)
  assert.match(html, /"grades-data"/i)
  assert.match(html, /pageSlugFromLocationSearch/i)
})

test("GET /admin?page=enrollment resolves the standalone enrollment page", async () => {
  const res = await fetchLocal(port, "/admin?page=enrollment")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const responseHtml = await res.text()
  assert.match(responseHtml, /aria-label="Enrollment workspace"/i)
  assert.match(responseHtml, /id="enrollmentRows"/i)
  assert.doesNotMatch(responseHtml, /id="studentAdminApp"/i)
})

test("GET /admin/attendance returns section page HTML with slug config", async () => {
  const res = await fetchLocal(port, "/admin/attendance")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const responseHtml = await res.text()
  const html = withAdminAssets(responseHtml)
  const renderedSections = renderedAdminPageSections(responseHtml)
  assert.ok(renderedSections.includes("overview"))
  assert.ok(renderedSections.includes("attendance"))
  assert.match(html, /__SIS_ADMIN_PAGE_SLUG/i)
  assert.match(html, /"attendance"/i)
})

test("GET /admin/parent-tracking returns section page HTML with slug config", async () => {
  const res = await fetchLocal(port, "/admin/parent-tracking")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const responseHtml = await res.text()
  const html = withAdminAssets(responseHtml)
  const renderedSections = renderedAdminPageSections(responseHtml)
  assert.ok(renderedSections.includes("overview"))
  assert.ok(renderedSections.includes("parent-tracking"))
  assert.match(html, /__SIS_ADMIN_PAGE_SLUG/i)
  assert.match(html, /"parent-tracking"/i)
})

test("GET /admin/queue-hub returns section page HTML with slug config", async () => {
  const res = await fetchLocal(port, "/admin/queue-hub")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const responseHtml = await res.text()
  const html = withAdminAssets(responseHtml)
  const renderedSections = renderedAdminPageSections(responseHtml)
  assert.ok(renderedSections.includes("overview"))
  assert.ok(renderedSections.includes("queue-hub"))
  assert.match(html, /__SIS_ADMIN_PAGE_SLUG/i)
  assert.match(html, /"queue-hub"/i)
  assert.match(html, /__SIS_ADMIN_QUEUE_HUB_PATH/i)
})

test("GET /admin/news-reports returns section page HTML with slug config", async () => {
  const res = await fetchLocal(port, "/admin/news-reports")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const responseHtml = await res.text()
  const html = withAdminAssets(responseHtml)
  const renderedSections = renderedAdminPageSections(responseHtml)
  assert.ok(renderedSections.includes("overview"))
  assert.ok(renderedSections.includes("news-reports"))
  assert.match(html, /__SIS_ADMIN_PAGE_SLUG/i)
  assert.match(html, /"news-reports"/i)
  assert.match(html, /__SIS_ADMIN_NEWS_REPORTS_PATH/i)
  assert.match(
    html,
    /<div class="text-zoom-controls"[^>]*role="toolbar"[^>]*aria-label="Global text size controls"/i,
  )
  assert.match(
    html,
    /@media\s*\(max-width:\s*560px\)\s*\{[\s\S]*\.text-zoom-controls\s+\.global-text-label\s*\{[\s\S]*display:\s*none;/i
  )
  assert.match(
    html,
    /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*\.page-section\[data-page="news-reports"\]\s+\.table-toolbar\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/i
  )
  assert.match(
    html,
    /@media\s*\(max-width:\s*560px\)\s*\{[\s\S]*\.page-section\[data-page="news-reports"\]\s+\.table-toolbar\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/i
  )
})

test("GET /parent returns parent portal HTML with runtime config", async () => {
  const res = await fetchLocal(port, "/parent")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  assert.match(res.headers.get("cache-control") || "", /no-cache/i)
  assert.match(res.headers.get("cache-control") || "", /no-store/i)
  const html = await res.text()
  assert.match(html, /Parent Portal|Trang chủ dành cho phụ huynh|cổng thông tin dành cho phụ huynh/i)
  assert.match(html, /data-parent-auth-state="unauthenticated"/i)
  assert.match(html, /__SIS_PARENT_API_PREFIX/i)
  assert.match(html, /__SIS_PARENT_AUTH_PREFIX/i)
  assert.match(html, /__SIS_PARENT_INITIAL_AUTH__/i)
  assert.match(html, /id="portalDetailCard"/i)
  assert.match(html, /id="currentHomeworkBadgeValue"/i)
  assert.match(html, /id="currentHomeworkAssignmentLink"/i)
  assert.match(html, /id="pastDueHomeworkBadgeValue"/i)
  assert.match(html, /id="openPastDueHomeworkModalBtn"/i)
  assert.match(html, /id="pastDueHomeworkModal"/i)
  assert.match(html, /id="pastDueHomeworkTableBody"/i)
  assert.match(html, /function renderCurrentHomeworkOverviewCard\(/)
  assert.match(html, /function renderPastDueHomeworkOverviewCard\(/)
  assert.match(html, /function setPastDueHomeworkModalOpen\(/)
  assert.match(html, /function loadPortalAsset\(/i)
  assert.match(html, /fullcalendar:\s*["']\/web-asset\/vendor\/fullcalendar\/index\.global\.min\.js["']/i)
  assert.doesNotMatch(html, /<script[^>]+src=["']\/web-asset\/vendor\/(?:fullcalendar|tabulatorz)\//i)
  assert.doesNotMatch(html, /rel=["']preload["'][^>]+tabulator\.min\.css/i)
  assert.match(html, /id="draftCountBadge"/i)
  assert.match(html, /id="draftActions"/i)
  assert.match(html, /http:\/\/127\.0\.0\.1:8788/i)
  assert.match(html, /function assertApiOriginConfiguredForStaticPreview\(\)/i)
  assert.match(html, /function inferLoopbackPreviewApiOrigin\(\)/i)
  assert.match(html, /function formatQueueDateTimeTz7\(/)
  assert.match(html, /function formatQueueLatestSubmissionHtml\(/)
  assert.match(html, /queue-compact-datetime/)
  assert.match(html, /\$\{hour\}:\$\{minute\}:\$\{second\} \+07/)
  assert.match(html, /<th scope="col">#<\/th>/i)
  assert.match(
    SHARED_PORTAL_THEME_SOURCE,
    /body\.(?:student|parent)-portal-page \.queue-table-wrap table\.news-queue-table th,\s*body\.(?:student|parent)-portal-page \.queue-table-wrap table\.news-queue-table td \{\s*padding:\s*4px 6px;/i
  )
  assert.match(
    SHARED_PORTAL_THEME_SOURCE,
    /body\.(?:student|parent)-portal-page \.queue-table-wrap table\.news-queue-table \.queue-row-btn[\s\S]*?min-height:\s*36px;/i
  )
  assert.match(
    SHARED_PORTAL_THEME_SOURCE,
    /body\.(?:student|parent)-portal-page \.queue-table-wrap table\.news-queue-table td:nth-child\(3\) \.chip[\s\S]*?min-inline-size:\s*0;/i
  )
  assert.doesNotMatch(html, /fonts\\.googleapis\\.com/i)
  assert.doesNotMatch(html, /fonts\\.gstatic\\.com/i)

  const loginRes = await fetchLocal(port, "/api/parent/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentsId: "cmvi001", password: "family-pass-123" }),
  })
  assert.equal(loginRes.status, 200)
  const parentCookie = (loginRes.headers.get("set-cookie") || "").split(";")[0]
  assert.match(parentCookie, /parent_portal_sid=/i)

  const authenticatedRes = await fetchLocal(port, "/parent", {
    headers: { Cookie: parentCookie },
  })
  assert.equal(authenticatedRes.status, 200)
  const authenticatedHtml = await authenticatedRes.text()
  assert.match(authenticatedHtml, /data-parent-auth-state="authenticated"/i)
  assert.match(authenticatedHtml, /__SIS_PARENT_INITIAL_AUTH__=.*"authenticated":true/i)

  const settingsRes = await fetchLocal(port, "/parent/settings", {
    headers: { Cookie: parentCookie },
  })
  assert.equal(settingsRes.status, 200)
  assert.match(settingsRes.headers.get("cache-control") || "", /no-store/i)
  const settingsHtml = await settingsRes.text()
  assert.match(settingsHtml, /__SIS_SETTINGS_LOCALE="vi"/i)
  assert.match(settingsHtml, /id="settingsPrivacyForm"/i)
  assert.match(settingsHtml, /data-settings-consent="supportChat"/i)
  assert.match(settingsHtml, /data-settings-consent="analytics"/i)
  assert.match(settingsHtml, /data-save-settings/i)
  assert.match(settingsHtml, /portal-preferences\.js/i)
  assert.match(settingsHtml, /settingsThemeToggle/i)
  assert.match(settingsHtml, /settingsThemePreference/i)
  assert.match(settingsHtml, /data-switch-state="supportChat"/i)
  assert.match(settingsHtml, /data-switch-state="analytics"/i)
  assert.match(settingsHtml, /data-switch-state="theme"/i)
  assert.match(settingsHtml, /<div class="header-bar portal-login-header" id="portalLoginHeader">[\s\S]*?<button id="menuBtn" class="floating-menu-btn portal-button portal-button-immutable-chrome"/i)
  assert.match(settingsHtml, /class="content topbar"/i)
  assert.match(settingsHtml, /id="settingsThemeToggle"[\s\S]*?class="text-zoom-controls"[\s\S]*?id="studentTextZoomDownBtn"[\s\S]*?id="studentTextZoomUpBtn"[\s\S]*?id="studentTextZoomResetBtn"/i)
  assert.match(settingsHtml, /settings-page-content/i)
  assert.ok(settingsHtml.indexOf('class="content topbar"') < settingsHtml.indexOf('class="content settings-page-content"'), "shared portal header must remain a separate sibling before Settings content")
  assert.doesNotMatch(settingsHtml, /class="portal-button portal-button-immutable-chrome" data-settings-home-link/i, "Settings must not replace the copied portal header controls with Back")
  assert.doesNotMatch(settingsHtml, /sisConsentModal/i)
})

test("portal settings routes require the matching portal session", async () => {
  for (const [pathname, expectedLocation] of [
    ["/parent/settings", "/parent?next=%2Fparent%2Fsettings"],
    ["/student/settings", "/student?next=%2Fstudent%2Fsettings"],
  ]) {
    const res = await fetchLocal(port, pathname, { redirect: "manual" })
    assert.equal(res.status, 302)
    assert.equal(new URL(res.headers.get("location"), "http://127.0.0.1").pathname + new URL(res.headers.get("location"), "http://127.0.0.1").search, expectedLocation)
  }
})

test("GET /admin/points-management returns points page HTML with runtime config", async () => {
  const res = await fetchLocal(port, "/admin/points-management")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  assert.match(res.headers.get("cache-control") || "", /no-cache/i)
  assert.match(res.headers.get("cache-control") || "", /no-store/i)
  const html = await res.text()
  assert.match(html, /Points Management/i)
  assert.match(html, /portal-preferences\.js/i)
  assert.match(html, /document\.documentElement\.dataset\.theme\s*=/i)
  assert.match(html, /href="\/web-asset\/shared\/portal-theme\.min\.css"/i)
  assert.match(html, /class="card portal-theme-card"/i)
  assert.match(html, /__SIS_ADMIN_POINTS_SUMMARY_PATH/i)
  assert.match(html, /__SIS_ADMIN_POINTS_STUDENTS_PATH/i)
  assert.match(html, /__SIS_ADMIN_POINTS_LEDGER_PATH/i)
  assert.match(html, /__SIS_ADMIN_POINTS_ADJUSTMENTS_PATH/i)
})

test("GET /student returns student portal HTML with runtime config", async () => {
  const res = await fetchLocal(port, "/student")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  assert.match(res.headers.get("cache-control") || "", /no-cache/i)
  assert.match(res.headers.get("cache-control") || "", /no-store/i)
  const html = await res.text()
  assert.match(html, /<title>\s*Student Portal\s*<\/title>/i)
  assert.doesNotMatch(html, /<title>\s*Student News Portal\s*<\/title>/i)
  assert.match(html, /Daily News Report/i)
  assert.match(html, /data-student-auth-state="unauthenticated"/i)
  assert.match(html, /id="loginForm"/i)
  assert.match(html, /id="studentHomeCard"/i)
  assert.match(html, /id="studentDetailPageCard"/i)
  assert.match(html, /id="studentHomeGrid" class="portal-col"/i)
  assert.match(html, /id="studentOverviewSummary" class="panel"/i)
  assert.match(html, /id="metricsPanel" class="panel"/i)
  assert.match(html, /id="snapshotBadge" class="chip chip-neutral"/i)
  assert.match(html, /id="dashboardMetrics" class="metrics"/i)
  assert.match(html, /id="studentNumberValue" class="identity-value"/i)
  assert.match(html, /id="quickLinksPanel" class="panel"/i)
  assert.match(html, /id="currentHomeworkBadgeValue"/i)
  assert.match(html, /id="currentHomeworkAssignmentLink"/i)
  assert.match(html, /id="pastDueHomeworkBadgeValue"/i)
  assert.match(html, /id="openPastDueHomeworkModalBtn"/i)
  assert.match(html, /id="pastDueHomeworkModal"/i)
  assert.match(html, /id="pastDueHomeworkTableBody"/i)
  assert.match(html, /id="openNewsComplianceModalBtn"/i)
  assert.match(html, /id="newsComplianceModal"/i)
  assert.match(html, /function renderCurrentHomeworkOverviewCard\(/)
  assert.match(html, /function renderPastDueHomeworkOverviewCard\(/)
  assert.match(html, /function setPastDueHomeworkModalOpen\(/)
  assert.match(html, /function setNewsComplianceModalOpen\(/)
  assert.match(html, /function setNewsComplianceModalCtaVisible\(/)
  assert.match(html, /function renderNewsComplianceModalFromState\(/)
  assert.match(html, /renderNewsComplianceModalFromState\(summaryMessage\)/)
  assert.match(html, /id="portalStatus" class="status"/i)
  assert.match(html, /function loadPortalAsset\(/i)
  assert.match(html, /fullcalendar:\s*["']\/web-asset\/vendor\/fullcalendar\/index\.global\.min\.js["']/i)
  assert.doesNotMatch(html, /<script[^>]+src=["']\/web-asset\/vendor\/(?:fullcalendar|tabulatorz)\//i)
  assert.doesNotMatch(html, /rel=["']preload["'][^>]+tabulator\.min\.css/i)
  assert.match(html, /buttonText:\s*"Your View"/i)
  assert.match(html, /7\. Who or what \(actor\) was doing news action\?/i)
  assert.match(html, /__SIS_STUDENT_DASHBOARD_PATH/i)
  assert.match(html, /__SIS_STUDENT_NEWS_REPORTS_PATH/i)
  assert.match(html, /__SIS_STUDENT_NEWS_REPORTS_CHECK_PATH/i)
  assert.match(html, /__SIS_STUDENT_NEWS_CALENDAR_PATH/i)
  assert.match(html, /http:\/\/127\.0\.0\.1:8788/i)
  assert.match(html, /function assertApiOriginConfiguredForStaticPreview\(\)/i)
  assert.match(html, /function inferLoopbackPreviewApiOrigin\(\)/i)
  assert.match(html, /id="calendarTitle"/i)
  assert.match(html, /id="calendarGrid" class="calendar-shell"/i)
  assert.match(html, /function formatQueueDateTimeTz7\(/)
  assert.match(html, /function formatQueueLatestSubmissionHtml\(/)
  assert.match(html, /queue-compact-datetime/)
    assert.match(html, /\$\{hour\}:\$\{minute\}:\$\{second\} \+07/)
  assert.match(html, /<th scope="col">#<\/th>/i)
  assert.match(html, /\.queue-table-wrap table\.news-queue-table th,\s*[\s\S]*?padding:\s*4px 6px;/i)
  assert.match(
    SHARED_PORTAL_THEME_SOURCE,
    /body\.(?:student|parent)-portal-page \.queue-table-wrap table\.news-queue-table \.queue-row-btn[\s\S]*?min-height:\s*36px;/i
  )
  assert.match(
    SHARED_PORTAL_THEME_SOURCE,
    /body\.(?:student|parent)-portal-page \.queue-table-wrap table\.news-queue-table td:nth-child\(3\) \.chip[\s\S]*?min-inline-size:\s*0;/i
  )
  assert.match(html, /__SIS_STUDENT_INITIAL_AUTH__/i)

  const loginRes = await fetchLocal(port, "/api/student/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eaglesId: "flyers01", password: "student-pass-123" }),
  })
  assert.equal(loginRes.status, 200)
  const studentCookie = (loginRes.headers.get("set-cookie") || "").split(";")[0]
  assert.match(studentCookie, /student_portal_sid=/i)

  const authenticatedRes = await fetchLocal(port, "/student", {
    headers: { Cookie: studentCookie },
  })
  assert.equal(authenticatedRes.status, 200)
  const authenticatedHtml = await authenticatedRes.text()
  assert.match(authenticatedHtml, /data-student-auth-state="authenticated"/i)
  assert.match(authenticatedHtml, /__SIS_STUDENT_INITIAL_AUTH__=.*"authenticated":true/i)

  const settingsRes = await fetchLocal(port, "/student/settings", {
    headers: { Cookie: studentCookie },
  })
  assert.equal(settingsRes.status, 200)
  const settingsHtml = await settingsRes.text()
  assert.match(settingsHtml, /__SIS_SETTINGS_LOCALE="en"/i)
  assert.match(settingsHtml, /id="settingsPrivacyForm"/i)
  assert.match(settingsHtml, /data-settings-consent="supportChat"/i)
  assert.match(settingsHtml, /data-settings-consent="analytics"/i)
  assert.match(settingsHtml, /data-save-settings/i)
  assert.match(settingsHtml, /portal-preferences\.js/i)
  assert.match(settingsHtml, /settingsThemeToggle/i)
  assert.match(settingsHtml, /settingsThemePreference/i)
  assert.match(settingsHtml, /data-switch-state="supportChat"/i)
  assert.match(settingsHtml, /data-switch-state="analytics"/i)
  assert.match(settingsHtml, /data-switch-state="theme"/i)
  assert.match(settingsHtml, /class="content topbar"/i)
  assert.match(settingsHtml, /settings-page-content/i)
  assert.doesNotMatch(settingsHtml, /sisConsentModal/i)
})

test("GET /web-asset/vendor/fullcalendar/index.global.min.js returns runtime static asset", async () => {
  const res = await fetchLocal(port, "/web-asset/vendor/fullcalendar/index.global.min.js")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /javascript/i)
  const js = await res.text()
  assert.match(js, /FullCalendar Standard Bundle v6\.1\.20/i)
})

test("GET /web-asset/admin/student-admin.min.css returns externalized admin styles", async () => {
  const res = await fetchLocal(port, "/web-asset/admin/student-admin.min.css")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/css/i)
  const css = await res.text()
  assert.match(css, /\.page-section\[data-page(?:="|=)news-reports(?:")?\]\s+\.table-toolbar/i)
  assert.match(css, /\.grade-chart-lanes/i)
  assert.match(css, /body\{font-family:var\(--font-base[^}]*margin:0\}/)
  assert.match(css, /\.page-section\[data-page(?:="|=)news-reports(?:")?\][\s\S]*\.queue-row-btn\{[^}]*width:100%/i)
  assert.match(css, /\.row-options-trigger(?::not\(\.portal-button\))?\{/)
  assert.match(css, /\.queue-hub-panel\{/)
  assert.match(css, /\.queue-hub-order-dirty\{/)
})

test("GET /web-asset/shared/portal-theme.min.css returns shared portal toggle styles", async () => {
  const res = await fetchLocal(port, "/web-asset/shared/portal-theme.min.css")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/css/i)
  const css = await res.text()
  assert.match(css, /portal-theme-toggle/i)
  assert.match(css, /portal-theme-toggle__icon/i)
  assert.match(css, /portal-theme-toggle__icon svg/i)
  assert.match(css, /portal-theme-toggle__icon\[data-theme-icon=(?:"|')?moon(?:"|')?\]/i)
  assert.match(
    css,
    /html\[data-theme="dark"\][\s\S]*portal-theme-toggle__icon(?:\s|\{|,)/i,
  )
})

test("GET /web-asset/admin/student-admin.min.js returns externalized admin app script", async () => {
  const res = await fetchLocal(port, "/web-asset/admin/student-admin.min.js")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /javascript/i)
  const js = await res.text()
  assert.match(js, /function setActivePage\(/)
  assert.match(js, /function refreshMenuLinkTargets\(/)
})

test("GET /web-asset/admin/grades-tabulator.html returns tabulator page", async () => {
  const res = await fetchLocal(port, "/web-asset/admin/grades-tabulator.html")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const html = await res.text()
  assert.match(html, /The Eagles Club SIS Grades Table/i)
  assert.match(html, /data-period=\"qtd\"/i)
  assert.match(html, /\/api\/admin\/auth\/me/i)
  assert.match(html, /counts\?\.gradeRecords/)
  assert.match(html, /detail\?\.student/)
  assert.match(html, /normalizeText\(detail\.id\)/)
  assert.match(html, /pagination:\s*false/)
  assert.match(html, /const scoreValues = cells/)
  assert.match(html, /formatQRightStat\(mean\)/)
  assert.match(html, /schoolSetup\?\.letterGradeRanges/)
  assert.match(html, /const localSettingsSchoolYear = schoolYearFromUiSettings\(loadUiSettingsFromLocalStorage\(\)\)/)
  assert.match(html, /if \(isSchoolYearKey\(localSettingsSchoolYear\)\) return localSettingsSchoolYear/)
  assert.match(html, /function refreshSystemCurrentSchoolYear\(/)
  assert.match(html, /schoolYear:\s*normalizeSchoolYearFilter\(input\.schoolYear\)/)
  assert.match(html, /function filterQueryOverridesFromLocation\(/)
  assert.match(html, /const hasQuarterParam = params\.has\("quarter"\)/)
  assert.match(html, /state\.filters = normalizedFiltersSnapshot\(\{/)
  assert.match(html, /applyFilterQueryOverrides\(\)/)
  assert.match(html, /function applyCurrentSchoolYearDefault\(/)
  assert.match(html, /applyCurrentSchoolYearDefault\(\{\s*force:\s*true\s*\}\)/)
  assert.match(html, /function schoolSetupQuarterForIsoDate\(/)
  assert.match(html, /function quarterForSchoolYear\(/)
  assert.match(html, /requestedSchoolYearCurrent/)
  assert.match(html, /studentDisplay:\s*"Mean"/)
  assert.match(html, /studentDisplay:\s*"Grade distribution"/)
  assert.match(html, /id="distributionModal"/)
  assert.match(html, /id="distributionModalChart"/)
  assert.match(html, /id="tableModalBtn"/)
  assert.match(html, /id="tableModalBackdrop"/)
  assert.match(html, /id="distributionModalExpand"/)
  assert.match(html, /id="distributionZoomRange"/)
  assert.match(html, /function renderDistributionMiniCell\(/)
  assert.match(html, /function openDistributionModal\(/)
  assert.match(html, /data-period=\"archive\"/)
  assert.match(html, /2026-2027/)
  assert.match(html, /configuredSchoolName/)
  assert.match(html, /singleSchoolMode/)
  assert.match(html, /function setTableModalOpen\(/)
  assert.match(html, /function bindTableModalControls\(/)
  assert.match(html, /function setDistributionDialogFullscreen\(/)
  assert.match(html, /function applyDistributionChartZoom\(/)
  assert.match(html, /responsiveLayout:\s*false/)
  assert.match(html, /#gradeGrid\s*\{[\s\S]*resize:\s*vertical;/i)
  assert.match(html, /#gradeGrid\s*\{[\s\S]*overflow-x:\s*auto;/i)
  assert.match(html, /\.wrap\s*\{[\s\S]*margin:\s*0 auto;/i)
  assert.match(html, /\.tabulator-tooltip\s*\{[\s\S]*font-size:\s*1rem;/i)
  assert.match(
    SHARED_PORTAL_THEME_SOURCE,
    /html\[data-theme="dark"\] body\.grades-tabulator-page[\s\S]*color:\s*var\(--portal-dark-text\);/i
  )
  assert.match(
    SHARED_PORTAL_THEME_SOURCE,
    /html\[data-theme="dark"\] body\.grades-tabulator-page[\s\S]*--portal-grade-table-text:\s*var\(--portal-dark-text\);/i
  )
  assert.match(html, /\.tabulator\s+\.tabulator-tableholder\s*\{[\s\S]*overflow-x:\s*auto/i)
  assert.match(html, /body\.table-modal-open\s*\{[\s\S]*overflow:\s*hidden;/i)
  assert.match(html, /\.grid-card\.is-table-modal\s*\{/i)
  assert.match(html, /\.wrap\s*>\s*\*\s*\{[\s\S]*min-width:\s*0;/i)
  assert.match(
    SHARED_PORTAL_THEME_SOURCE,
    /body\.grades-tabulator-page \.metric-card h2 \{[\s\S]*font-size:\s*clamp\(/i
  )
  assert.match(
    SHARED_PORTAL_THEME_SOURCE,
    /body\.grades-tabulator-page \.metric-card p \{[\s\S]*font-size:\s*1\.08rem;/i
  )
  assert.match(html, /function buildCoreHeaderCard\(/)
  assert.match(html, /function buildHeaderActionButtons\(/)
  assert.match(html, /function handleHeaderActionClick\(/)
  assert.match(html, /title:\s*buildCoreHeaderCard\("Class Level",\s*"Class",\s*"Grouping"/)
  assert.match(html, /title:\s*buildCoreHeaderCard\("Student",\s*"eaglesId",\s*""/)
  assert.match(html, /title:\s*buildCoreHeaderCard\("Student Number",\s*"Roster",\s*"ID"/)
  assert.match(html, /cssClass:\s*"assignment-col core-col"/)
  assert.match(html, /cssClass:\s*"assignment-col core-col student-number-col"/)
  assert.match(html, /function formatStudentNumberForWrap\(/)
  assert.match(html, /function studentColumnMinWidthForResize\(/)
  assert.match(html, /function coreColumnDataWidth\(/)
  assert.match(html, /function assignmentColumnDataWidth\(/)
  assert.match(html, /coreColumnDataWidth\(studentRows,\s*"studentDisplay"/)
  assert.match(html, /data-header-action=\\\"pin\\\"/)
  assert.match(html, /data-header-action=\\\"hide\\\"/)
  assert.match(html, /columnDefaults:\s*\{[\s\S]*headerClick:\s*handleHeaderActionClick/)
  assert.match(html, /data-header-label=\\\"/)
  assert.doesNotMatch(html, /headerMenu\s*:/)
  assert.match(html, /headerTooltip:\s*\(\)\s*=>\s*"Student \| eaglesId"/)
  assert.match(html, /headerTooltip:\s*\(\)\s*=>\s*`\$\{fullTitle\}\s*\|\s*Q:\s*\$\{questionLabel\}\s*\|\s*Due:\s*\$\{dueLabel\}`/)
  assert.match(html, /const TABLE_PERSISTENCE_ID = "sis-grades-tabulator-v1"/)
  assert.match(html, /const UI_PREFS_KEY = "sis\.grades-tabulator\.ui-prefs\.v1"/)
  assert.match(html, /const TABLE_UI_STATE_KEY = "sis\.grades-tabulator\.table-state\.v1"/)
  assert.match(html, /const TABLE_UI_STATE_SCHEMA_VERSION = 2/)
  assert.match(html, /const AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX = "auto-imported exercise score"/)
  assert.match(html, /const GRADE_RECORD_SOURCE_ASSIGNMENT = "assignment"/)
  assert.match(html, /const GRADE_RECORD_SOURCE_MANUAL = "manual"/)
  assert.match(html, /const GRADE_RECORD_SOURCE_AUTO_IMPORT = "auto-import"/)
  assert.match(html, /const GRADE_RECORD_SOURCES_VISIBLE_IN_MATRIX = new Set/)
  assert.match(html, /function normalizeGradeRecordSource\(/)
  assert.match(html, /const rawScorePercent = toNumber\(record\?\.scorePercent\)/)
  assert.match(html, /const effectiveScore = rawScore/)
  assert.doesNotMatch(html, /fallbackInClassScore/)
  assert.match(html, /function scoreCellRank\(/)
  assert.match(html, /function scoreCellPercentValue\(/)
  assert.match(html, /function shouldReplaceScoreCell\(/)
  assert.match(html, /if \(nextPercent !== existingPercent\) return nextPercent > existingPercent/)
  assert.match(html, /if \(shouldReplaceScoreCell\(currentCell, nextCell\)\)/)
  assert.match(html, /function isStandaloneAutoImportedExerciseRow\(/)
  assert.match(html, /function canonicalizeStandaloneAutoImportedTitle\(/)
  assert.match(html, /function normalizedAssignmentTitleForRow\(/)
  assert.match(html, /source:\s*rowSource,/)
  assert.match(html, /source:\s*GRADE_RECORD_SOURCE_ASSIGNMENT,/)
  assert.match(html, /if \(!GRADE_RECORD_SOURCES_VISIBLE_IN_MATRIX\.has\(rowSource\)\) return false/)
  assert.match(html, /assignment-head elective/)
  assert.match(html, /id:\s*`student-\$\{studentRefId\}`/)
  assert.match(html, /<span class=\\\"exercise-cell\\\"><span><\/span><span><\/span><\/span>/)
  assert.match(html, /const status = \["ontime", "late"\]\.includes\(value\.status\)\s*\?\s*value\.status\s*:\s*\(isCompleted \? "ontime" : ""\)/)
  assert.match(html, /includeWidth:\s*!shouldResetPersistedWidths/)
  assert.match(html, /schemaVersion:\s*TABLE_UI_STATE_SCHEMA_VERSION/)
  assert.match(html, /field:\s*"studentDisplay"[\s\S]*minWidth:\s*studentColumnMinWidth[\s\S]*width:\s*studentColumnWidth[\s\S]*frozen:\s*true/)
  assert.match(html, /field:\s*meta\.key[\s\S]*width:\s*assignmentColumnWidth/)
  assert.doesNotMatch(html, /assignment-title-text\" title=/)
  assert.match(html, /field:\s*"studentDisplay"[\s\S]*frozen:\s*true/)
  assert.match(html, /function applyTableHeight\(/)
  assert.match(html, /function observeTableHeightResize\(/)
  assert.match(html, /\/web-asset\/vendor\/tabulatorz\/tabulator\.min\.js/i)
  assert.match(html, /\/web-asset\/vendor\/tabulatorz\/tabulator\.min\.css/i)
})

test("GET /admin\\/grades-tabulator returns runtime-served tabulator page", async () => {
  const res = await fetchLocal(port, `/admin/grades-tabulator?apiOrigin=http://127.0.0.1:${port}`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const html = await res.text()
  assert.match(html, /The Eagles Club SIS Grades Table/i)
  assert.match(html, /window\.__SIS_ADMIN_PAGE_PATH=/)
  assert.match(html, /window\.__SIS_ADMIN_API_ORIGIN=/)
  assert.match(html, /window\.__SIS_ADMIN_INITIAL_AUTH__=/)
})

test("GET /admin\\?page=grades-tabulator returns runtime-served tabulator page", async () => {
  const res = await fetchLocal(port, `/admin?page=grades-tabulator&apiOrigin=http://127.0.0.1:${port}`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const html = await res.text()
  assert.match(html, /The Eagles Club SIS Grades Table/i)
  assert.match(html, /window\.__SIS_ADMIN_PAGE_PATH=/)
})

test("shared admin chrome routes grade table links through /admin instead of static asset paths", () => {
  const sharedChromeSources = [
    fs.readFileSync(new URL("../web-asset/admin/student-admin.html", import.meta.url), "utf8"),
    fs.readFileSync(new URL("../web-asset/admin/student-enrollment.html", import.meta.url), "utf8"),
    fs.readFileSync(new URL("../web-asset/admin/report-card.html", import.meta.url), "utf8"),
    fs.readFileSync(new URL("../web-asset/admin/grades-tabulator.html", import.meta.url), "utf8"),
  ]

  sharedChromeSources.forEach((source) => {
    assert.doesNotMatch(source, /href="\/web-asset\/admin\/grades-tabulator\.html"/i)
    assert.match(source, /href="\/admin\/grades-tabulator"/i)
  })
})

test("admin runtime helpers preserve apiOrigin across all internal admin anchors", () => {
  const adminSource = fs.readFileSync(
    new URL("../web-asset/admin/student-admin.js", import.meta.url),
    "utf8",
  )
  const enrollmentSource = `${fs.readFileSync(
    new URL("../web-asset/admin/student-enrollment.html", import.meta.url),
    "utf8",
  )}\n${ENROLLMENT_JS_SOURCE}`
  const reportCardSource = `${fs.readFileSync(
    new URL("../web-asset/admin/report-card.html", import.meta.url),
    "utf8",
  )}\n${REPORT_CARD_JS_SOURCE}`
  const gradesTabulatorSource = `${fs.readFileSync(
    new URL("../web-asset/admin/grades-tabulator.html", import.meta.url),
    "utf8",
  )}\n${GRADES_TABULATOR_JS_SOURCE}`

  assert.match(adminSource, /document\.querySelectorAll\('a\[href\^="\/admin"\]'\)/)
  assert.match(adminSource, /function shouldPreserveAdminApiOriginParamFor\(apiOrigin = ""\)/)
  assert.match(adminSource, /function buildAdminRuntimeHrefWithOrigin\(/)
  assert.match(adminSource, /buildAdminRuntimeHrefWithOrigin\(\s*"\/admin\/school-setup#schoolSetupPanel"/)
  assert.match(adminSource, /URLSearchParams\(window\.location\.search \|\| ""\)\.has\("apiOrigin"\)/)
  assert.match(enrollmentSource, /document\.querySelectorAll\('a\[href\^="\/admin"\]'\)/)
  assert.match(reportCardSource, /document\.querySelectorAll\('a\[href\^="\/admin"\]'\)/)
  assert.match(gradesTabulatorSource, /document\.querySelectorAll\('a\[href\^="\/admin"\]'\)/)
  assert.match(gradesTabulatorSource, /const INITIAL_AUTH_STATE =/)
  assert.match(gradesTabulatorSource, /if \(INITIAL_AUTH_STATE\?\.authenticated === true\)/)
})

test("GET /web-asset/vendor/tabulatorz/tabulator.min.js returns runtime static asset", async () => {
  const res = await fetchLocal(port, "/web-asset/vendor/tabulatorz/tabulator.min.js")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /javascript/i)
  const js = await res.text()
  assert.match(js, /Tabulator v6\.4\.0/i)
})

test("GET /web-asset/vendor/tabulatorz/tabulator.min.css returns runtime static asset", async () => {
  const res = await fetchLocal(port, "/web-asset/vendor/tabulatorz/tabulator.min.css")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/css/i)
  const css = await res.text()
  assert.match(css, /\.tabulator/)
})

test("GET /web-asset/images/logo.svg returns runtime image asset", async () => {
  const res = await fetchLocal(port, "/web-asset/images/logo.svg")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /image\/svg\+xml/i)
  const body = await res.text()
  assert.match(body, /<svg/i)
})

test("GET /admin/unknown-section returns 404", async () => {
  const res = await fetchLocal(port, "/admin/unknown-section")
  assert.equal(res.status, 404)
})

test("portal login endpoints establish sessions for admin, parent, and student", async () => {
  const adminLogin = await fetchLocal(port, "/api/admin/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-pass-123" }),
  })
  assert.equal(adminLogin.status, 200)
  const adminCookie = (adminLogin.headers.get("set-cookie") || "").split(";")[0]
  assert.match(adminCookie, /student_admin_sid=/i)

  const adminMe = await fetchLocal(port, "/api/admin/auth/me", {
    headers: { Cookie: adminCookie },
  })
  assert.equal(adminMe.status, 200)

  const parentLogin = await fetchLocal(port, "/api/parent/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "cmvi001", password: "family-pass-123" }),
  })
  assert.equal(parentLogin.status, 200)
  const parentCookie = (parentLogin.headers.get("set-cookie") || "").split(";")[0]
  assert.match(parentCookie, /parent_portal_sid=/i)

  const parentMe = await fetchLocal(port, "/api/parent/auth/me", {
    headers: { Cookie: parentCookie },
  })
  assert.equal(parentMe.status, 200)

  const studentLogin = await fetchLocal(port, "/api/student/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eaglesId: "flyers01", password: "student-pass-123" }),
  })
  assert.equal(studentLogin.status, 200)
  const studentCookie = (studentLogin.headers.get("set-cookie") || "").split(";")[0]
  assert.match(studentCookie, /student_portal_sid=/i)

  const studentMe = await fetchLocal(port, "/api/student/auth/me", {
    headers: { Cookie: studentCookie },
  })
  assert.equal(studentMe.status, 200)
})

test("POST /api/admin/login rejects invalid credentials", async () => {
  const res = await fetchLocal(port, "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "wrong" }),
  })
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Invalid username or password/i)
})

test("POST /api/admin/login returns session cookie", async () => {
  const res = await fetchLocal(port, "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-pass-123" }),
  })
  assert.equal(res.status, 200)
  const setCookie = res.headers.get("set-cookie") || ""
  assert.match(setCookie, /student_admin_sid=/i)
  adminSessionCookie = setCookie.split(";")[0]
  assert.ok(adminSessionCookie.length > 20)
  const body = await res.json()
  assert.equal(body.authenticated, true)
  assert.equal(body.user?.username, "admin")
})

test("GET /api/admin/auth/me returns authenticated user and refreshes cookie", async () => {
  const res = await fetchLocal(port, "/api/admin/auth/me", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 200)
  const setCookie = res.headers.get("set-cookie") || ""
  assert.match(setCookie, /student_admin_sid=/i)
  const body = await res.json()
  assert.equal(body.authenticated, true)
  assert.equal(body.user?.username, "admin")
  assert.equal(body.user?.role, "admin")
})

test("GET /admin with an admin session injects authenticated initial state", async () => {
  const res = await fetchLocal(port, "/admin", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 200)
  assert.match(res.headers.get("cache-control") || "", /no-cache/i)
  assert.match(res.headers.get("cache-control") || "", /no-store/i)
  const html = await res.text()
  assert.match(html, /data-admin-auth-state="authenticated"/i)
  assert.match(html, /window\.__SIS_ADMIN_INITIAL_AUTH__=\{"authenticated":true/i)
  assert.match(html, /"username":"admin"/i)
})

test("POST /api/admin/exports/xlsx returns workbook for admin", async () => {
  const payload = {
    filename: "attendance-export.xlsx",
    sheetName: "Attendance",
    columns: [
      { key: "eaglesId", label: "Eagles ID" },
      { key: "status", label: "Status" },
    ],
    rows: [
      { eaglesId: "SIS-001", status: "Present" },
      { eaglesId: "SIS-002", status: "Absent" },
    ],
  }
  const res = await fetchLocal(port, "/api/admin/exports/xlsx", {
    method: "POST",
    headers: {
      Cookie: adminSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  })
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /spreadsheetml/i)
  assert.match(res.headers.get("content-disposition") || "", /attendance-export\.xlsx/i)

  const bytes = Buffer.from(await res.arrayBuffer())
  const workbook = XLSX.read(bytes, { type: "buffer" })
  assert.equal(workbook.SheetNames.length, 1)
  assert.equal(workbook.SheetNames[0], "Attendance")
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Attendance, { defval: "" })
  assert.equal(rows.length, 2)
  assert.equal(rows[0]["Eagles ID"], "SIS-001")
  assert.equal(rows[1].Status, "Absent")
})

test("POST /api/admin/login returns teacher session cookie", async () => {
  const res = await fetchLocal(port, "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "teacher", password: "teacher-pass-123" }),
  })
  assert.equal(res.status, 200)
  const setCookie = res.headers.get("set-cookie") || ""
  assert.match(setCookie, /student_admin_sid=/i)
  teacherSessionCookie = setCookie.split(";")[0]
  assert.ok(teacherSessionCookie.length > 20)
  const body = await res.json()
  assert.equal(body.authenticated, true)
  assert.equal(body.user?.username, "teacher")
  assert.equal(body.user?.role, "teacher")
})

test("POST /api/admin/login accepts configured teacher aliases", async () => {
  const res = await fetchLocal(port, "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "carole01", password: "carole-pass-123" }),
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.authenticated, true)
  assert.equal(body.user?.username, "carole01")
  assert.equal(body.user?.role, "teacher")
})

test("POST /api/admin/login rejects alias with a different teacher password", async () => {
  const res = await fetchLocal(port, "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "carole01", password: "teacher-pass-123" }),
  })
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /invalid username or password/i)
})

test("all configured teacher accounts receive the same read/write attendance policy", async () => {
  for (const account of [
    { username: "teacher", password: "teacher-pass-123" },
    { username: "carole01", password: "carole-pass-123" },
  ]) {
    const login = await fetchLocal(port, "/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(account),
    })
    assert.equal(login.status, 200)
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0]
    assert.match(cookie, /student_admin_sid=/i)

    const permissions = await fetchLocal(port, "/api/admin/permissions", {
      headers: { Cookie: cookie },
    })
    assert.equal(permissions.status, 200)
    const permissionBody = await permissions.json()
    assert.equal(permissionBody.roles?.teacher?.canRead, true)
    assert.equal(permissionBody.roles?.teacher?.canWrite, true)

    const attendance = await fetchLocal(port, "/api/admin/students/abc/attendance", {
      method: "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({
        className: "A2 KET",
        schoolYear: "2026-2027",
        quarter: "q2",
        attendanceDate: "2026-07-19",
        status: "present",
      }),
    })
    assert.equal(attendance.status, 503)
  }
})

test("GET /api/admin/auth/me works for teacher session", async () => {
  const res = await fetchLocal(port, "/api/admin/auth/me", {
    headers: { Cookie: teacherSessionCookie },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.authenticated, true)
  assert.equal(body.user?.role, "teacher")
})

test("teacher role cannot mutate admin-protected resources", async () => {
  const res = await fetchLocal(port, "/api/admin/students", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      eaglesId: "T-ONLY",
      profile: { fullName: "Teacher Denied Case" },
    }),
  })
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.match(body.error, /Forbidden/i)
})

test("teacher role cannot export xlsx", async () => {
  const res = await fetchLocal(port, "/api/admin/exports/xlsx", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      filename: "teacher-export.xlsx",
      sheetName: "Denied",
      columns: [{ key: "name", label: "Name" }],
      rows: [{ name: "Denied" }],
    }),
  })
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.match(body.error, /Forbidden/i)
})

test("teacher role can read and reaches store-disabled response", async () => {
  const res = await fetchLocal(port, "/api/admin/students", {
    headers: { Cookie: teacherSessionCookie },
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("teacher can queue parent-report notifications for admin review", async () => {
  const res = await fetchLocal(port, "/api/admin/notifications/email", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deliveryMode: "weekend-batch",
      queueType: "parent-report",
      assignmentTitle: "Teacher review report",
      level: "Pre-A1 Starters",
      message: "Queued by teacher for admin review",
      recipients: ["parent-review@example.com"],
    }),
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.queued, true)
  assert.equal(body.deliveryMode, "weekend-batch")
})

test("teacher cannot send immediate notifications", async () => {
  const res = await fetchLocal(port, "/api/admin/notifications/email", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      assignmentTitle: "Immediate send",
      recipients: ["parent-review@example.com"],
      message: "should be forbidden for teacher",
    }),
  })
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.match(body.error, /Forbidden/i)
})

test("teacher can access parent-report save path and reaches store-disabled response", async () => {
  const res = await fetchLocal(port, "/api/admin/students/abc/reports", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      className: "Pre-A1 Starters",
      schoolYear: "2026-2027",
      quarter: "q1",
      comments: "Teacher draft parent report",
    }),
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("teacher can submit a parent report for admin review and reaches store-disabled response", async () => {
  const res = await fetchLocal(port, "/api/admin/students/abc/reports/report-abc/workflow", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "submit" }),
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("teacher can access attendance save path and reaches store-disabled response", async () => {
  const res = await fetchLocal(port, "/api/admin/students/abc/attendance", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      className: "A2 KET",
      schoolYear: "2026-2027",
      quarter: "q3",
      attendanceDate: "2026-03-14T08:00:00.000Z",
      status: "present",
    }),
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("teacher can access grade save path and reaches store-disabled response", async () => {
  const res = await fetchLocal(port, "/api/admin/students/abc/grades", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      className: "A2 KET",
      schoolYear: "2026-2027",
      quarter: "q3",
      assignmentName: "News Summary",
      dueAt: "2026-03-14T08:00:00.000Z",
      submittedAt: "2026-03-14T08:10:00.000Z",
      homeworkCompleted: true,
      homeworkOnTime: true,
    }),
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("teacher cannot mutate incoming exercise-result queue", async () => {
  const res = await fetchLocal(port, "/api/admin/exercise-results/incoming", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "archive",
      incomingResultId: "incoming-01",
    }),
  })
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.match(body.error, /Forbidden/i)
})

test("teacher cannot access runtime service-control endpoint", async () => {
  const res = await fetchLocal(port, "/api/admin/runtime/service-control", {
    headers: { Cookie: teacherSessionCookie },
  })
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.match(body.error, /Forbidden/i)
})

test("teacher cannot run the SIS config sync cron endpoint", async () => {
  const res = await fetchLocal(port, "/api/admin/runtime/sis-config-repair", {
    method: "POST",
    headers: { Cookie: teacherSessionCookie },
  })
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.match(body.error, /Forbidden/i)
})

test("teacher can access runtime health endpoint", async () => {
  const res = await fetchLocal(port, "/api/admin/runtime/health", {
    headers: { Cookie: teacherSessionCookie },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.status, "ok")
  assert.ok(body.studentAdminRuntime && typeof body.studentAdminRuntime === "object")
  assert.equal(body.studentAdminRuntime.apiPrefix, "/api/admin")
  assert.ok(body.studentAdminRuntime.sessionRedis && typeof body.studentAdminRuntime.sessionRedis === "object")
  assert.ok(Object.prototype.hasOwnProperty.call(body.studentAdminRuntime.sessionRedis, "redisConnected"))
  assert.ok(Object.prototype.hasOwnProperty.call(body.studentAdminRuntime.sessionRedis, "redisReady"))
  assert.ok(body.studentAdminRuntime.redis && typeof body.studentAdminRuntime.redis === "object")
  assert.equal(body.studentAdminRuntime.redis.source, "environment")
  assert.ok(Object.prototype.hasOwnProperty.call(body.studentAdminRuntime.redis, "configured"))
  assert.ok(Object.prototype.hasOwnProperty.call(body.studentAdminRuntime.redis, "ready"))
  assert.ok(body.maintenance && typeof body.maintenance === "object")
  assert.ok(Object.prototype.hasOwnProperty.call(body.maintenance, "lastIncomingVacuumAt"))
  assert.ok(Object.prototype.hasOwnProperty.call(body.maintenance, "lastBackupAt"))
  assert.ok(Object.prototype.hasOwnProperty.call(body.maintenance, "dbHealthStatus"))
  assert.ok(Object.prototype.hasOwnProperty.call(body.maintenance, "manualReviewCount"))
  assert.ok(body.runtimeSelfHeal && typeof body.runtimeSelfHeal === "object")
})

test("teacher cannot access queue hub or profile submissions endpoints", async () => {
  const queueHubRes = await fetchLocal(port, "/api/admin/queue-hub", {
    headers: { Cookie: teacherSessionCookie },
  })
  assert.equal(queueHubRes.status, 403)
  const queueHubBody = await queueHubRes.json()
  assert.match(queueHubBody.error, /Forbidden/i)

  const profileSubmissionsRes = await fetchLocal(port, "/api/admin/profile-submissions", {
    headers: { Cookie: teacherSessionCookie },
  })
  assert.equal(profileSubmissionsRes.status, 403)
  const profileSubmissionsBody = await profileSubmissionsRes.json()
  assert.match(profileSubmissionsBody.error, /Forbidden/i)
})

test("teacher cannot apply student news review actions", async () => {
  const res = await fetchLocal(port, "/api/admin/news-reports/news-001", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "approve",
      reviewNote: "approved by teacher",
    }),
  })
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.match(body.error, /Forbidden/i)
})

test("teacher cannot bulk-approve student news review queue", async () => {
  const res = await fetchLocal(port, "/api/admin/news-reports/bulk", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "approve",
      reportIds: ["news-001"],
    }),
  })
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.match(body.error, /Forbidden/i)
})

test("bulk news review route is declared ahead of the single-report matcher", () => {
  const source = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")
  assert.match(source, /const ADMIN_NEWS_REPORTS_BULK_PATH = `\$\{ADMIN_NEWS_REPORTS_PATH\}\/bulk`/)
  assert.match(
    source,
    /if \(method === "POST" && pathname === ADMIN_NEWS_REPORTS_BULK_PATH\) \{[\s\S]*reviewStudentNewsReportsBulk\(payload, \{/,
  )
})

test("teacher cannot create volatile assignment announcement preview", async () => {
  const res = await fetchLocal(port, "/api/admin/assignment-announcements/volatile", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      assignmentTitle: "Teacher Preview",
      level: "Pre-A1 Starters",
      items: [{ title: "Exercise 1", url: "https://example.com/ex-1" }],
    }),
  })
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.match(body.error, /Forbidden/i)
})

test("GET /api/admin/permissions exposes role policies", async () => {
  const res = await fetchLocal(port, "/api/admin/permissions", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.role, "admin")
  assert.ok(Array.isArray(body.pageSections))
  assert.ok(body.pageSections.includes("permissions"))
  assert.ok(body.roles?.admin)
  assert.ok(body.roles?.teacher)
  assert.ok(body.roles?.student)
  assert.ok(body.roles?.parent)
})

test("GET /api/admin/profile-submissions returns queue payload for admin", async () => {
  const res = await fetchLocal(port, "/api/admin/profile-submissions", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.ok(Array.isArray(body.items))
  assert.ok(Number.isInteger(body.total))
})

test("GET /api/admin/queue-hub returns store-disabled response when admin store is disabled", async () => {
  const res = await fetchLocal(port, "/api/admin/queue-hub", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("GET /api/admin/news-reports returns store-disabled response when admin store is disabled", async () => {
  const res = await fetchLocal(port, "/api/admin/news-reports", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("admin can persist and reload school setup ui settings", async () => {
  const loginRes = await fetchLocal(port, "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-pass-123" }),
  })
  assert.equal(loginRes.status, 200)
  const adminCookie = (loginRes.headers.get("set-cookie") || "").split(";")[0]
  assert.match(adminCookie, /student_admin_sid=/i)

  const getBefore = await fetchLocal(port, "/api/admin/settings/ui", {
    headers: { Cookie: adminCookie },
  })
  assert.equal(getBefore.status, 200)
  const beforeBody = await getBefore.json()
  assert.equal(beforeBody.ok, true)
  persistedUiSettingsPath = String(beforeBody.filePath || "")
  const testRuntime = {
    databaseUrl: String(process.env.DATABASE_URL || ""),
    redisUrl: String(process.env.REDIS_SESSION_URL || process.env.REDIS_URL || ""),
    sessionDriver: "memory",
  }

  const payload = {
    uiSettings: {
      multiSchool: true,
      schoolSetup: {
        schoolYear: "2026-2027",
        startDate: "2026-02-21",
        endDate: "2027-01-24",
        quarters: [
          { quarter: "q1", startDate: "2026-02-21", endDate: "2026-05-15" },
          { quarter: "q2", startDate: "2026-05-16", endDate: "2026-08-07" },
          { quarter: "q3", startDate: "2026-08-08", endDate: "2026-10-31" },
          { quarter: "q4", startDate: "2026-11-01", endDate: "2027-01-24" },
        ],
        letterGradeRanges: [
          { letter: "A", minPercent: 92, maxPercent: 100 },
          { letter: "B", minPercent: 84, maxPercent: 91.99 },
          { letter: "C", minPercent: 76, maxPercent: 83.99 },
          { letter: "D", minPercent: 60, maxPercent: 75.99 },
          { letter: "F", minPercent: 0, maxPercent: 59.99 },
        ],
      },
      schoolProfile: {
        schoolName: "Eagles Live",
        logoDataUrl: "data:image/png;base64,AAAA",
        mission: "Persist settings across live upgrades",
      },
    },
    sisConfig: {
      runtime: {
        ...testRuntime,
        adminSessionTtlSeconds: 12345,
        parentSessionTtlSeconds: 23456,
        studentSessionTtlSeconds: 34567,
        redisConnectTimeoutMs: 9876,
      },
      newsReports: {
        weeklyMinimumReports: 5,
        autoApproveEnabled: false,
        autoApproveDelayHours: 20,
      },
    },
  }

  const putRes = await fetchLocal(port, "/api/admin/settings/ui", {
    method: "PUT",
    headers: {
      Cookie: adminCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  })
  assert.equal(putRes.status, 200)
  const putBody = await putRes.json()
  assert.equal(putBody.ok, true)
  assert.equal(putBody.uiSettings.multiSchool, true)
  assert.equal(putBody.uiSettings.schoolProfile.schoolName, "Eagles Live")
  assert.equal(putBody.uiSettings.schoolProfile.logoDataUrl, "data:image/png;base64,AAAA")
  assert.equal(putBody.sisConfig.runtime.sessionDriver, "memory")
  assert.equal(putBody.sisConfig.newsReports.weeklyMinimumReports, 5)
  assert.equal(putBody.sisConfig.newsReports.autoApproveEnabled, false)
  assert.equal(putBody.sisConfig.newsReports.autoApproveDelayHours, 20)
  assert.equal(putBody.meta.schoolSetupState, "ok")

  const getAfter = await fetchLocal(port, "/api/admin/settings/ui", {
    headers: { Cookie: adminCookie },
  })
  assert.equal(getAfter.status, 200)
  const afterBody = await getAfter.json()
  assert.equal(afterBody.ok, true)
  assert.equal(afterBody.uiSettings.multiSchool, true)
  assert.equal(afterBody.uiSettings.schoolSetup.startDate, "2026-02-21")
  assert.equal(afterBody.meta.schoolSetupState, "ok")
  assert.equal(afterBody.uiSettings.schoolSetup.letterGradeRanges[0].letter, "A")
  assert.equal(afterBody.uiSettings.schoolSetup.letterGradeRanges[0].minPercent, 92)
  assert.equal(afterBody.uiSettings.schoolProfile.schoolName, "Eagles Live")
  assert.equal(afterBody.uiSettings.schoolProfile.logoDataUrl, "data:image/png;base64,AAAA")
  assert.equal(afterBody.sisConfig.runtime.redisUrl, testRuntime.redisUrl)
  assert.equal(afterBody.sisConfig.newsReports.weeklyMinimumReports, 5)
  assert.equal(afterBody.sisConfig.newsReports.autoApproveEnabled, false)
  assert.equal(afterBody.sisConfig.newsReports.autoApproveDelayHours, 20)
})

test("admin rejects school setup ui settings without explicit quarters", async () => {
  const res = await fetchLocal(port, "/api/admin/settings/ui", {
    method: "PUT",
    headers: {
      Cookie: adminSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      uiSettings: {
          schoolSetup: {
            schoolYear: "2026-2027",
            startDate: "2026-02-21",
            endDate: "2027-01-24",
            letterGradeRanges: [],
          },
      },
    }),
  })

  assert.equal(res.status, 422)
  const body = await res.json()
  assert.match(body.error, /four explicit quarters/i)
})

test("teacher can read persisted ui settings but cannot update them", async () => {
  const res = await fetchLocal(port, "/api/admin/settings/ui", {
    headers: { Cookie: teacherSessionCookie },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  const put = await fetchLocal(port, "/api/admin/settings/ui", {
    method: "PUT",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ uiSettings: {} }),
  })
  assert.equal(put.status, 403)
})

test("teacher cannot update role policies", async () => {
  const res = await fetchLocal(port, "/api/admin/permissions", {
    method: "PUT",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      teacher: {
        startPage: "overview",
        allowedPages: ["overview"],
      },
    }),
  })
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.match(body.error, /Forbidden/i)
})

test("POST /api/admin/notifications/email queues weekend batch delivery", async () => {
  const res = await fetchLocal(port, "/api/admin/notifications/email", {
    method: "POST",
    headers: {
      Cookie: adminSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deliveryMode: "weekend-batch",
      assignmentTitle: "Parent progress report",
      level: "Pre-A1 Starters",
      message: "Queued weekend report",
      recipients: ["parent-one@example.com", "student-one@example.com"],
    }),
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.queued, true)
  assert.equal(body.deliveryMode, "weekend-batch")
  assert.equal(typeof body.scheduledFor, "string")
  assert.ok(body.scheduledFor.length > 0)
  assert.ok(Number.isInteger(body.queueSize))
  assert.ok(body.queueSize >= 1)
})

test("POST /api/admin/notifications/email allows parent-report queue without recipients", async () => {
  const res = await fetchLocal(port, "/api/admin/notifications/email", {
    method: "POST",
    headers: {
      Cookie: adminSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deliveryMode: "weekend-batch",
      queueType: "parent-report",
      assignmentTitle: "Parent progress report (missing recipients)",
      level: "Pre-A1 Starters",
      message: "Queue for admin review before recipient assignment.",
      recipients: [],
    }),
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.queued, true)
  assert.equal(body.deliveryMode, "weekend-batch")
  assert.ok(Number.isInteger(body.queueSize))
  assert.ok(body.queueSize >= 1)

  const queueRes = await fetchLocal(port, "/api/admin/notifications/batch-status?queueType=parent-report&take=20", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(queueRes.status, 200)
  const queueBody = await queueRes.json()
  assert.ok(
    queueBody.items.some(
      (entry) => entry.assignmentTitle === "Parent progress report (missing recipients)" && Array.isArray(entry.recipients)
    )
  )
})

test("GET /api/admin/notifications/batch-status returns queued parent report items", async () => {
  const res = await fetchLocal(port, "/api/admin/notifications/batch-status?queueType=parent-report&take=10", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.queueType, "parent-report")
  assert.ok(Array.isArray(body.items))
  assert.ok(Number.isInteger(body.total))
  assert.ok(body.total >= 1)
})

test("admin can create volatile assignment announcement preview and retrieve page", async () => {
  const res = await fetchLocal(port, "/api/admin/assignment-announcements/volatile", {
    method: "POST",
    headers: {
      Cookie: adminSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      assignmentTitle: "Starter Week 1 Homework",
      level: "Pre-A1 Starters",
      assignedAt: "2026-03-01",
      dueAt: "2026-03-07",
      message: "This is a preview announcement",
      items: [
        { title: "1.1.1 Common Nouns", url: "https://ex.example.com/common-nouns" },
        { title: "1.1.2 Proper Nouns", url: "https://ex.example.com/proper-nouns" },
      ],
    }),
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.match(body.url || "", /\/assignment-announcements\/volatile\//i)
  assert.match(body.path || "", /^\/assignment-announcements\/volatile\/[a-f0-9]{24}$/i)
  assert.equal(body.assignmentTitle, "Starter Week 1 Homework")
  assert.equal(body.level, "Pre-A1 Starters")
  assert.ok(Number.isInteger(body.ttlMinutes))
  assert.ok(body.ttlMinutes >= 1)
  assignmentAnnouncementPreviewPath = body.path

  const previewRes = await fetchLocal(port, assignmentAnnouncementPreviewPath)
  assert.equal(previewRes.status, 200)
  assert.match(previewRes.headers.get("content-type") || "", /text\/html/i)
  const html = await previewRes.text()
  assert.match(html, /Starter Week 1 Homework/i)
  assert.match(html, /Pre-A1 Starters/i)
  assert.match(html, /https:\/\/ex\.example\.com\/common-nouns/i)
  assert.match(html, /This is a preview announcement/i)
})

test("POST /api/parent/auth/login rejects invalid credentials", async () => {
  const res = await fetchLocal(port, "/api/parent/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentsId: "cmvi001", password: "wrong-password" }),
  })
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Invalid parentsId or password/i)
})

test("POST /api/parent/auth/login returns parent session cookie", async () => {
  const res = await fetchLocal(port, "/api/parent/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentsId: "cmvi001", password: "family-pass-123" }),
  })
  assert.equal(res.status, 200)
  const setCookie = res.headers.get("set-cookie") || ""
  assert.match(setCookie, /parent_portal_sid=/i)
  parentSessionCookie = setCookie.split(";")[0]
  assert.ok(parentSessionCookie.length > 20)
  const body = await res.json()
  assert.equal(body.authenticated, true)
  assert.equal(body.user?.parentsId, "cmvi001")
  assert.equal(body.user?.role, "parent")
})

test("GET /api/parent/auth/me returns authenticated parent user", async () => {
  const res = await fetchLocal(port, "/api/parent/auth/me", {
    headers: { Cookie: parentSessionCookie },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.authenticated, true)
  assert.equal(body.user?.parentsId, "cmvi001")
  assert.equal(body.user?.role, "parent")
})

test("GET /api/parent/children returns linked-children list payload", async () => {
  const res = await fetchLocal(port, "/api/parent/children", {
    headers: { Cookie: parentSessionCookie },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.ok(Array.isArray(body.items))
})

test("GET /api/parent/dashboard returns dashboard payload", async () => {
  const res = await fetchLocal(port, "/api/parent/dashboard", {
    headers: { Cookie: parentSessionCookie },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.ok(Array.isArray(body.children))
})

test("parent profile endpoints reject unlinked child references", async () => {
  const getProfileRes = await fetchLocal(port, "/api/parent/children/vi001/profile", {
    headers: { Cookie: parentSessionCookie },
  })
  assert.equal(getProfileRes.status, 403)
  const getProfileBody = await getProfileRes.json()
  assert.match(getProfileBody.error, /not linked/i)

  const saveDraftRes = await fetchLocal(port, "/api/parent/children/vi001/profile-draft", {
    method: "PUT",
    headers: {
      Cookie: parentSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      patch: {
        fullName: "Updated Name",
      },
    }),
  })
  assert.equal(saveDraftRes.status, 403)
  const saveDraftBody = await saveDraftRes.json()
  assert.match(saveDraftBody.error, /not linked/i)

  const submitRes = await fetchLocal(port, "/api/parent/children/vi001/profile-submit", {
    method: "POST",
    headers: {
      Cookie: parentSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  })
  assert.equal(submitRes.status, 403)
  const submitBody = await submitRes.json()
  assert.match(submitBody.error, /not linked/i)
})

test("POST /api/parent/auth/logout clears parent session cookie", async () => {
  const res = await fetchLocal(port, "/api/parent/auth/logout", {
    method: "POST",
    headers: { Cookie: parentSessionCookie },
  })
  assert.equal(res.status, 200)
  const setCookie = res.headers.get("set-cookie") || ""
  assert.match(setCookie, /Max-Age=0/i)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.authenticated, false)
})

test("GET /api/parent/auth/me requires auth after parent logout", async () => {
  const res = await fetchLocal(port, "/api/parent/auth/me", {
    headers: { Cookie: parentSessionCookie },
  })
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("POST /api/admin/auth/logout clears session cookie", async () => {
  const res = await fetchLocal(port, "/api/admin/auth/logout", {
    method: "POST",
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 200)
  const setCookie = res.headers.get("set-cookie") || ""
  assert.match(setCookie, /Max-Age=0/i)
  const body = await res.json()
  assert.equal(body.authenticated, false)
  assert.equal(body.ok, true)
})

test("GET /api/admin/auth/me returns 401 after logout", async () => {
  const res = await fetchLocal(port, "/api/admin/auth/me", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("POST /api/admin/login refreshes admin session after logout", async () => {
  const res = await fetchLocal(port, "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-pass-123" }),
  })
  assert.equal(res.status, 200)
  const setCookie = res.headers.get("set-cookie") || ""
  assert.match(setCookie, /student_admin_sid=/i)
  adminSessionCookie = setCookie.split(";")[0]
  assert.ok(adminSessionCookie.length > 20)
})

test("GET /api/admin/students requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/students")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("GET /api/admin/students/next-student-number requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/students/next-student-number")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("GET /api/admin/auth/me requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/auth/me")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("GET /api/admin/settings/ui requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/settings/ui")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("GET /api/admin/students/abc/report-card.pdf requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/students/abc/report-card.pdf")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("GET /api/admin/students/import-template.xlsx requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/students/import-template.xlsx")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("GET /api/admin/users requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/users")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("GET /api/admin/dashboard requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/dashboard")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("GET /api/admin/queue-hub requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/queue-hub")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("GET /api/admin/news-reports requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/news-reports")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("GET /api/admin/profile-submissions requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/profile-submissions")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("GET /api/parent/children requires auth", async () => {
  const res = await fetchLocal(port, "/api/parent/children")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("GET /api/admin/exercise-results/incoming requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/exercise-results/incoming")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("GET /api/admin/runtime/service-control requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/runtime/service-control")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("POST /api/admin/runtime/sis-config-repair requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/runtime/sis-config-repair", {
    method: "POST",
  })
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("POST /api/admin/runtime/sis-config-repair runs for admin", async () => {
  const loginRes = await fetchLocal(port, "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-pass-123" }),
  })
  assert.equal(loginRes.status, 200)
  const adminCookie = (loginRes.headers.get("set-cookie") || "").split(";")[0]
  assert.match(adminCookie, /student_admin_sid=/i)

  const res = await fetchLocal(port, "/api/admin/runtime/sis-config-repair", {
    method: "POST",
    headers: { Cookie: adminCookie },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.ok(body.snapshot && typeof body.snapshot === "object")
  assert.ok(body.mirrorHealth && typeof body.mirrorHealth === "object")
  assert.ok(["ok", "warn"].includes(body.mirrorHealth.state))
})

test("GET /api/admin/runtime/health requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/runtime/health")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("POST /api/admin/assignment-announcements/volatile requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/assignment-announcements/volatile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      assignmentTitle: "Unauthorized preview",
      level: "Pre-A1 Starters",
      items: [{ title: "Exercise", url: "https://example.com" }],
    }),
  })
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("volatile preview page is public and does not require auth", async () => {
  assert.ok(assignmentAnnouncementPreviewPath, "preview path is available from previous admin create call")
  const res = await fetchLocal(port, assignmentAnnouncementPreviewPath)
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
})

test("POST /api/admin/exports/xlsx requires auth", async () => {
  const res = await fetchLocal(port, "/api/admin/exports/xlsx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: "unauth-export.xlsx",
      sheetName: "Denied",
      columns: [{ key: "name", label: "Name" }],
      rows: [{ name: "Denied" }],
    }),
  })
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("GET /api/student/news-reports/calendar requires auth", async () => {
  const res = await fetchLocal(port, "/api/student/news-reports/calendar")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("POST /api/student/news-reports/check explains the missing student session", async () => {
  const res = await fetchLocal(port, "/api/student/news-reports/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reportDate: "2026-03-11" }),
  })
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.equal(
    body.error,
    "News Check requires an active student session. Sign in again, then retry Check.",
  )
})

test("GET /api/student/dashboard requires auth", async () => {
  const res = await fetchLocal(port, "/api/student/dashboard")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(body.error, /Unauthorized/i)
})

test("POST /api/student/auth/login returns student session cookie", async () => {
  const res = await fetchLocal(port, "/api/student/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eaglesId: "flyers01", password: "student-pass-123" }),
  })
  assert.equal(res.status, 200)
  const setCookie = res.headers.get("set-cookie") || ""
  assert.match(setCookie, /student_portal_sid=/i)
  studentSessionCookie = setCookie.split(";")[0]
  assert.ok(studentSessionCookie.length > 20)
  const body = await res.json()
  assert.equal(body.authenticated, true)
  assert.equal(body.user?.eaglesId, "flyers01")
})

test("GET /api/student/auth/me returns authenticated student", async () => {
  const res = await fetchLocal(port, "/api/student/auth/me", {
    headers: { Cookie: studentSessionCookie },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.authenticated, true)
  assert.equal(body.user?.role, "student")
})

test("student news endpoints return 503 when admin store disabled", async () => {
  const dashboardRes = await fetchLocal(port, "/api/student/dashboard", {
    headers: { Cookie: studentSessionCookie },
  })
  assert.ok([403, 503].includes(dashboardRes.status))
  const dashboardBody = await dashboardRes.json()
  assert.match(dashboardBody.error, /(store is disabled|not linked|Unable to load student dashboard)/i)

  const calendarRes = await fetchLocal(port, "/api/student/news-reports/calendar", {
    headers: { Cookie: studentSessionCookie },
  })
  assert.ok([403, 503].includes(calendarRes.status))
  const calendarBody = await calendarRes.json()
  assert.match(calendarBody.error, /(store is disabled|not linked)/i)

  const submitRes = await fetchLocal(port, "/api/student/news-reports", {
    method: "POST",
    headers: {
      Cookie: studentSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      reportDate: "2026-03-11",
      sourceLink: "https://example.com/news",
      articleTitle: "Sample title",
      leadSynopsis: "Lead summary",
      actionActor: "Actor",
      actionAffected: "Affected group",
      actionWhere: "Location",
      actionWhat: "Event details",
      actionWhy: "Cause details",
      biasAssessment: "No bias detected",
    }),
  })
  assert.ok([403, 503].includes(submitRes.status))
  const submitBody = await submitRes.json()
  assert.match(submitBody.error, /(store is disabled|not linked)/i)

  const checkRes = await fetchLocal(port, "/api/student/news-reports/check", {
    method: "POST",
    headers: {
      Cookie: studentSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      reportDate: "2026-03-11",
      sourceLink: "https://example.com/news",
      articleTitle: "Sample title",
      leadSynopsis: "Lead summary",
      actionActor: "Actor",
      actionAffected: "Affected group",
      actionWhere: "Location",
      actionWhat: "Event details",
      actionWhy: "Cause details.",
      biasAssessment: "No bias detected.",
    }),
  })
  assert.ok([403, 503].includes(checkRes.status))
  const checkBody = await checkRes.json()
  assert.match(checkBody.error, /(store is disabled|not linked)/i)
})

test("points endpoints return 503 when admin store disabled", async () => {
  const summaryRes = await fetchLocal(port, "/api/admin/points/summary", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(summaryRes.status, 503)
  const summaryBody = await summaryRes.json()
  assert.match(summaryBody.error, /store is disabled/i)

  const studentsRes = await fetchLocal(port, "/api/admin/points/students", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(studentsRes.status, 503)
  const studentsBody = await studentsRes.json()
  assert.match(studentsBody.error, /store is disabled/i)

  const setTotalRes = await fetchLocal(port, "/api/admin/points/students/abc/points", {
    method: "PUT",
    headers: {
      Cookie: adminSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ targetPoints: 100, reason: "test override" }),
  })
  assert.equal(setTotalRes.status, 503)
  const setTotalBody = await setTotalRes.json()
  assert.match(setTotalBody.error, /store is disabled/i)
})

test("GET /api/admin/students returns 503 when admin store disabled", async () => {
  const res = await fetchLocal(port, "/api/admin/students", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("GET /api/admin/students/next-student-number returns 503 when admin store disabled", async () => {
  const res = await fetchLocal(port, "/api/admin/students/next-student-number", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("GET /api/admin/dashboard returns 503 when admin store disabled", async () => {
  const res = await fetchLocal(port, "/api/admin/dashboard", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("GET /api/admin/exercise-results/incoming returns 503 when exercise store disabled", async () => {
  const res = await fetchLocal(port, "/api/admin/exercise-results/incoming", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /Exercise store is disabled/i)
})

test("POST /api/admin/students/import returns 503 when admin store disabled", async () => {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ["eaglesId", "fullName"],
    ["S003", "Imported Student"],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, "Students")
  const xlsxBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })

  const res = await fetchLocal(port, "/api/admin/students/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: adminSessionCookie,
    },
    body: JSON.stringify({
      fileName: "students.xlsx",
      format: "xlsx",
      fileDataBase64: xlsxBuffer.toString("base64"),
    }),
  })

  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("POST /api/admin/students/import preserves UTF-8 JSON rows across chunk boundaries", async () => {
  const payloadBuffer = Buffer.from(JSON.stringify({
    rows: [
      {
        eaglesId: "vi001",
        fullNameStudent: "Trần Nguyễn Thiên Ân",
      },
    ],
  }), "utf8")
  const splitAt = payloadBuffer.findIndex((byte) => byte >= 0x80)
  assert.ok(splitAt > 0, "test payload must include at least one multi-byte UTF-8 byte")

  const response = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/admin/students/import",
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          Cookie: adminSessionCookie,
        },
      },
      (res) => {
        const chunks = []
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8")))
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            bodyText: Buffer.concat(chunks).toString("utf8"),
          })
        })
      }
    )
    req.on("error", reject)
    req.write(payloadBuffer.subarray(0, splitAt + 1))
    req.write(payloadBuffer.subarray(splitAt + 1))
    req.end()
  })

  assert.equal(response.statusCode, 503)
  const body = JSON.parse(response.bodyText)
  assert.match(body.error, /store is disabled/i)
})

test("GET /api/admin/users returns 503 when admin store disabled", async () => {
  const res = await fetchLocal(port, "/api/admin/users", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("POST /api/admin/users returns 503 when admin store disabled", async () => {
  const res = await fetchLocal(port, "/api/admin/users", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: adminSessionCookie,
    },
    body: JSON.stringify({
      username: "teacher2",
      role: "teacher",
      password: "password-123",
    }),
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("PUT /api/admin/users/:id returns 503 when admin store disabled", async () => {
  const res = await fetchLocal(port, "/api/admin/users/abc", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      Cookie: adminSessionCookie,
    },
    body: JSON.stringify({
      role: "admin",
    }),
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("DELETE /api/admin/users/:id returns 503 when admin store disabled", async () => {
  const res = await fetchLocal(port, "/api/admin/users/abc", {
    method: "DELETE",
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("GET /api/admin/students/abc/report-card.pdf returns 503 when admin store disabled", async () => {
  const res = await fetchLocal(port, "/api/admin/students/abc/report-card.pdf", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /store is disabled/i)
})

test("GET /api/admin/students/import-template.xlsx downloads template with auth", async () => {
  const res = await fetchLocal(port, "/api/admin/students/import-template.xlsx", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(res.status, 200)
  assert.match(
    res.headers.get("content-type") || "",
    /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/i
  )
  assert.match(
    res.headers.get("content-disposition") || "",
    /student-import-template\.xlsx/i
  )
  const buffer = Buffer.from(await res.arrayBuffer())
  assert.equal(buffer.subarray(0, 2).toString("utf8"), "PK")
  assert.ok(buffer.length > 500)
})

test("shutdown admin route server", async () => {
  await new Promise((resolve) => server.close(resolve))
})

test("cleanup persisted ui settings test file", () => {
  fs.rmSync(TEST_ADMIN_UI_SETTINGS_FILE, { force: true })
  assert.equal(fs.existsSync(TEST_ADMIN_UI_SETTINGS_FILE), false)
  fs.rmSync(TEST_GENERATED_SIS_CONFIG_FILE, { force: true })
  assert.equal(fs.existsSync(TEST_GENERATED_SIS_CONFIG_FILE), false)
  const preservePersistedUiSettings = path.resolve(process.cwd(), "runtime-data/admin-ui-settings.json")
  if (persistedUiSettingsPath && path.resolve(persistedUiSettingsPath) !== preservePersistedUiSettings) {
    fs.rmSync(persistedUiSettingsPath, { force: true })
    assert.equal(fs.existsSync(persistedUiSettingsPath), false)
  }
})
