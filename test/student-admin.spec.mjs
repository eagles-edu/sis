// test/student-admin.spec.mjs
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import * as XLSX from "xlsx"
import {
  buildStudentPortalCalendarTracks,
  parseSpreadsheetRowsFromUploadPayload,
} from "../server/student-admin-routes.mjs"
import { generateStudentReportCardPdf } from "../server/student-report-card-pdf.mjs"

const TEST_ADMIN_UI_SETTINGS_FILE = `/tmp/sis-admin-ui-settings-${process.pid}.json`

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

async function fetchLocal(port, pathname, init = {}) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, init)
}

let server
let port
let adminSessionCookie = ""
let teacherSessionCookie = ""
let parentSessionCookie = ""
let studentSessionCookie = ""
let assignmentAnnouncementPreviewPath = ""
let persistedUiSettingsPath = ""

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

test("student news compliance save path returns soft-save success payload and keeps resubmission failures in waiting state", () => {
  const store = fs.readFileSync(new URL("../server/student-admin-store.mjs", import.meta.url), "utf8")
  const routes = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")

  assert.doesNotMatch(store, /throw statusErrorWithPayload\(\s*422,/)
  assert.match(store, /saved:\s*true/)
  assert.match(store, /complianceFailed:\s*hasFailures/)
  assert.match(store, /const isResubmission = Boolean\(existing\)/)
  assert.match(store, /const reviewStatus = hasFailures && !isResubmission/)
  assert.match(store, /STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED/)
  assert.match(store, /STUDENT_NEWS_REVIEW_STATUS_SUBMITTED/)
  assert.match(store, /Status remains waiting for admin review\./)
  assert.match(store, /validationIssuesJson:\s*updatedIssues\.issues/)
  assert.match(store, /FIXED PER COMPLIANCE RESOLUTION ON SAVE/)

  assert.match(routes, /error\.payload/)
  assert.match(routes, /column `\(not available\)` does not exist in the current database/)
  assert.match(routes, /Database schema mismatch detected/)
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
  const routes = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")

  assert.match(store, /function hasPrismaDelegateMethod\(/)
  assert.match(store, /findManyOrEmpty\(prisma, "studentPointsAdjustment"/)
  assert.match(store, /hasPrismaDelegateMethod\(prisma, "studentPointsAdjustment", "create"\)/)
  assert.match(store, /hasPrismaDelegateMethod\(prisma, "studentNewsReport", "upsert"\)/)
  assert.match(store, /const GRADE_RECORD_SOURCE_ASSIGNMENT = "assignment"/)
  assert.match(store, /const GRADE_RECORD_SOURCE_MANUAL = "manual"/)
  assert.match(store, /const GRADE_RECORD_SOURCE_AUTO_IMPORT = "auto-import"/)
  assert.match(store, /function inferGradeRecordSource\(/)
  assert.match(store, /function mapGradeRecordForApi\(/)
  assert.match(store, /source:\s*inferGradeRecordSource\(record\),/)
  assert.match(store, /listStudentNewsReportsFromFallbackStore\(/)
  assert.match(store, /upsertStudentNewsReportInFallbackStore\(/)
  assert.match(store, /isStudentNewsReportSchemaUnavailableError\(/)
  assert.match(store, /isStudentNewsReviewSchemaUnavailableError\(/)
  assert.match(store, /buildStudentNewsReviewSelect\(/)
  assert.doesNotMatch(store, /STUDENT_NEWS_REVIEW_STATE_FILE_PATH/)
  assert.match(store, /loadApprovedParentReportRowsForPoints\(prisma, idFilter\)/)
  assert.match(store, /isLegacyParentReportApprovedAtSchemaError/)
  assert.match(store, /isLegacyParentReportParticipationPointsSchemaError/)
  assert.match(store, /stripLegacyParentReportFields\(/)

  assert.match(routes, /const newsCalendar = await listStudentNewsCalendar/)
  assert.match(routes, /statusSummary/)
  assert.match(routes, /function canTeacherWriteDataEntryPath\(/)
  assert.match(routes, /ADMIN_ATTENDANCE_PATH_RE\.test\(pathname\)/)
  assert.match(routes, /ADMIN_GRADES_PATH_RE\.test\(pathname\)/)
  assert.match(routes, /ADMIN_REPORTS_PATH_RE\.test\(pathname\)/)
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
})

test("news review status/action rules and revise chip label keep locked admin ui rules", () => {
  const html = fs.readFileSync(new URL("../web-asset/admin/student-admin.html", import.meta.url), "utf8")
  const statusStart = html.indexOf("function newsReviewWeekSetStatusToken(")
  assert.ok(statusStart >= 0, "newsReviewWeekSetStatusToken is present")
  const statusChunk = html.slice(statusStart, statusStart + 1400)
  assert.match(statusChunk, /if \(reportCount >= 7 && approved >= 7\) return "approved";/)
  assert.match(statusChunk, /return "waiting";/)
  assert.match(statusChunk, /if \(submitted === 0 && revisionRequested === 0\) return "checked";/)
  assert.match(statusChunk, /if \(revisionRequested > 0 \|\| submitted > 0\) return "waiting";/)
  assert.match(html, /if \(normalized === "revise" \|\| normalized === "revision-requested"\)/)
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
        attendanceDate: "2026-09-01",
        status: "present",
      },
      {
        className: "English",
        schoolYear: "2026-2027",
        quarter: "q1",
        attendanceDate: "2026-09-02",
        status: "late",
      },
    ],
    gradeRecords: [
      {
        className: "English",
        schoolYear: "2026-2027",
        quarter: "q1",
        assignmentName: "Homework 1",
        dueAt: "2026-09-05",
        submittedAt: "2026-09-04",
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
        generatedAt: "2026-09-10",
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

test("start server for admin routes", async () => {
  const { startExerciseMailer } = await import(process.cwd() + "/server/exercise-mailer.mjs")
  server = await startExerciseMailer({ transporter: makeMockTransport(), port: 0 })
  await new Promise((resolve) => server.once("listening", resolve))
  port = server.address().port
  assert.ok(Number.isInteger(port) && port > 0)
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

test("GET /admin/students returns HTML UI", async () => {
  const res = await fetchLocal(port, "/admin/students")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const html = await res.text()
  assert.match(html, /Student Admin/i)
  assert.match(html, /id="loginForm"/i)
  assert.match(html, /__SIS_ADMIN_API_PREFIX/i)
  assert.match(html, /"\/api\/admin"/i)
  assert.match(html, /__SIS_ADMIN_PAGE_SLUG/i)
  assert.match(html, /"overview"/i)
  assert.match(html, /id="schoolSetupLetterGradeRanges"/i)
  assert.match(html, /id="openTabulatorGradesBtn"/i)
  assert.match(html, /Open Tabulator Grades Admin/i)
  assert.match(html, /tabulator-entry-callout/i)
  assert.match(html, /\.grade-chart-lanes\s*\{[\s\S]*grid-template-columns:\s*1fr;/i)
  assert.match(html, /@media\s*\(min-width:\s*481px\)\s*\{[\s\S]*\.grade-chart-lanes[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/i)
  assert.match(html, /grade-chart-lane-legend/i)
  assert.match(html, /grade-chart-threshold/i)
  assert.match(html, /grade-chart-average/i)
  assert.match(html, /grade-chart-trend/i)
  assert.match(html, /grade-chart-legend-dot\.trend/i)
  assert.match(html, /data-grade-chart-open=/i)
  assert.match(html, /id="gradeChartModal"/i)
  assert.match(html, /function openGradeChartModalForLaneKey\(/i)
  assert.match(html, /PARENT_TRACKING_SCORE_TOOLTIPS/i)
  assert.match(html, /0 = hiện không áp dụng cho học sinh\./i)
  assert.match(html, /5 = thể hiện hành vi một cách độc lập/i)
  assert.match(html, /radioEl\.title = tooltipText;/i)
  assert.match(
    html,
    /<tr data-pt-min-level="Pre-A1 Starters">[\s\S]*Writes notes independently\./i
  )
  assert.match(
    html,
    /<tr data-pt-min-level="Pre-A1 Starters">[\s\S]*Consistently studies class notes outside of class\./i
  )
  assert.match(
    html,
    /<tr data-pt-min-level="Pre-A1 Starters">[\s\S]*Reviews notes before attending class\./i
  )
  assert.match(
    html,
    /<tr data-pt-min-level="Pre-A1 Starters">[\s\S]*Knows and uses Eagles Club Notebook extensive[\s\S]*practice drills\./i
  )
  assert.match(html, /data-pt-score-legend-toggle/i)
  assert.match(html, /data-pt-score-legend-popover/i)
  assert.match(html, /function initializeParentTrackingScoreLegendPopovers\(/i)
  assert.match(html, /Thang điểm 0-5/i)
  assert.match(html, /function buildGradesTabulatorLaunchUrl\(\)/i)
  assert.match(html, /function applyGradeChartCurrentSchoolYearDefault\(\)/i)
  assert.match(html, /setGradeChartState\(\{\s*period\s*\}\);\s*applyGradeChartCurrentSchoolYearDefault\(\);\s*renderGradePulseChart/i)
  assert.match(html, /applyGradeChartCurrentSchoolYearDefault\(\);\s*renderGradePulseChart\(state\.visibleTableRows\?\.grades \|\| \[\]\);/i)
  assert.doesNotMatch(html, /data-grade-chart-period="archive"/i)
  assert.doesNotMatch(html, /All school years/i)
  assert.match(html, /params\.set\("currentSchoolYear",\s*currentSchoolYear\)/i)
  assert.match(html, /params\.set\("schoolYear",\s*selectedSchoolYear\)/i)
  assert.match(html, /params\.set\("quarter",\s*selectedQuarter\)/i)
  assert.match(html, /params\.set\("period",\s*period\)/i)
  assert.match(html, /window\.location\.assign\(buildGradesTabulatorLaunchUrl\(\)\)/i)
  assert.match(html, /Static preview mode requires \?apiOrigin=/i)
  assert.match(html, /function assertApiOriginConfiguredForStaticPreview\(\)/i)
  assert.doesNotMatch(html, /function inferLocalPreviewApiOrigin\(/i)
  assert.match(html, /function pageSlugFromLocationSearch\(/i)
  assert.match(html, /const ADMIN_PAGE_URL_MODE = resolveAdminPageUrlMode\(\);/i)
  assert.match(html, /params\.get\("page"\)\s*\|\|\s*params\.get\("pageSlug"\)/i)
  assert.match(html, /if \(params\.has\("page"\) \|\| params\.has\("pageSlug"\)\) return "query";/i)
  assert.match(html, /urlMode === "query" \? buildPageQueryPath\(pageSlug\)/i)
})

test("GET /admin/students?page=grades-data resolves query deep-link route", async () => {
  const res = await fetchLocal(port, "/admin/students?page=grades-data")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const html = await res.text()
  assert.match(html, /__SIS_ADMIN_PAGE_SLUG/i)
  assert.match(html, /"grades-data"/i)
  assert.match(html, /pageSlugFromLocationSearch/i)
})

test("GET /admin/students/attendance returns section page HTML with slug config", async () => {
  const res = await fetchLocal(port, "/admin/students/attendance")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const html = await res.text()
  assert.match(html, /__SIS_ADMIN_PAGE_SLUG/i)
  assert.match(html, /"attendance"/i)
})

test("GET /admin/students/parent-tracking returns section page HTML with slug config", async () => {
  const res = await fetchLocal(port, "/admin/students/parent-tracking")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const html = await res.text()
  assert.match(html, /__SIS_ADMIN_PAGE_SLUG/i)
  assert.match(html, /"parent-tracking"/i)
})

test("GET /admin/students/queue-hub returns section page HTML with slug config", async () => {
  const res = await fetchLocal(port, "/admin/students/queue-hub")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const html = await res.text()
  assert.match(html, /__SIS_ADMIN_PAGE_SLUG/i)
  assert.match(html, /"queue-hub"/i)
  assert.match(html, /__SIS_ADMIN_QUEUE_HUB_PATH/i)
})

test("GET /admin/students/news-reports returns section page HTML with slug config", async () => {
  const res = await fetchLocal(port, "/admin/students/news-reports")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const html = await res.text()
  assert.match(html, /__SIS_ADMIN_PAGE_SLUG/i)
  assert.match(html, /"news-reports"/i)
  assert.match(html, /__SIS_ADMIN_NEWS_REPORTS_PATH/i)
  assert.match(html, /class="small global-text-label">Global Text</i)
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

test("GET /parent/portal returns parent portal HTML with runtime config", async () => {
  const res = await fetchLocal(port, "/parent/portal")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const html = await res.text()
  assert.match(html, /Parent Portal/i)
  assert.match(html, /__SIS_PARENT_API_PREFIX/i)
  assert.match(html, /__SIS_PARENT_AUTH_PREFIX/i)
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
  assert.match(html, /\/web-asset\/vendor\/fullcalendar\/index\.global\.min\.js/i)
  assert.match(html, /id="draftCountBadge"/i)
  assert.match(html, /id="draftActions"/i)
  assert.match(html, /Static preview mode requires \?apiOrigin=/i)
  assert.match(html, /function assertApiOriginConfiguredForStaticPreview\(\)/i)
  assert.doesNotMatch(html, /function inferLocalPreviewApiOrigin\(/i)
  assert.doesNotMatch(html, /fonts\\.googleapis\\.com/i)
  assert.doesNotMatch(html, /fonts\\.gstatic\\.com/i)
})

test("GET /admin/students/points-management returns points page HTML with runtime config", async () => {
  const res = await fetchLocal(port, "/admin/students/points-management")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const html = await res.text()
  assert.match(html, /Points Management/i)
  assert.match(html, /__SIS_ADMIN_POINTS_SUMMARY_PATH/i)
  assert.match(html, /__SIS_ADMIN_POINTS_STUDENTS_PATH/i)
  assert.match(html, /__SIS_ADMIN_POINTS_LEDGER_PATH/i)
  assert.match(html, /__SIS_ADMIN_POINTS_ADJUSTMENTS_PATH/i)
})

test("GET /student/portal returns student portal HTML with runtime config", async () => {
  const res = await fetchLocal(port, "/student/portal")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const html = await res.text()
  assert.match(html, /<title>\s*Student Portal\s*<\/title>/i)
  assert.doesNotMatch(html, /<title>\s*Student News Portal\s*<\/title>/i)
  assert.match(html, /Daily News Report/i)
  assert.match(html, /id="loginForm"/i)
  assert.match(html, /id="studentHomeCard"/i)
  assert.match(html, /id="studentDetailPageCard"/i)
  assert.match(html, /id="studentHomeGrid" class="portal-col"/i)
  assert.match(html, /id="overviewPanel" class="toolbar"/i)
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
  assert.match(html, /\/web-asset\/vendor\/fullcalendar\/index\.global\.min\.js/i)
  assert.match(html, /buttonText:\s*"Your View"/i)
  assert.match(html, /II\.E\.i\./i)
  assert.match(html, /__SIS_STUDENT_DASHBOARD_PATH/i)
  assert.match(html, /__SIS_STUDENT_NEWS_REPORTS_PATH/i)
  assert.match(html, /__SIS_STUDENT_NEWS_CALENDAR_PATH/i)
  assert.match(html, /Static preview mode requires \?apiOrigin=/i)
  assert.match(html, /function assertApiOriginConfiguredForStaticPreview\(\)/i)
  assert.doesNotMatch(html, /function inferLocalPreviewApiOrigin\(/i)
  assert.match(html, /id="calendarTitle"/i)
  assert.match(html, /id="calendarGrid" class="calendar-shell"/i)
})

test("GET /web-asset/vendor/fullcalendar/index.global.min.js returns runtime static asset", async () => {
  const res = await fetchLocal(port, "/web-asset/vendor/fullcalendar/index.global.min.js")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /javascript/i)
  const js = await res.text()
  assert.match(js, /FullCalendar Standard Bundle v6\.1\.20/i)
})

test("GET /web-asset/admin/grades-tabulator.html returns tabulator page", async () => {
  const res = await fetchLocal(port, "/web-asset/admin/grades-tabulator.html")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const html = await res.text()
  assert.match(html, /Grades Tabulator/i)
  assert.match(html, /href="\/admin\/students\?page=grades-data"/i)
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
  assert.match(html, /if \(params\.has\("quarter"\)\) \{/)
  assert.match(html, /state\.filters = normalizedFiltersSnapshot\(\{/)
  assert.match(html, /applyFilterQueryOverrides\(\)/)
  assert.match(html, /function applyCurrentSchoolYearDefault\(/)
  assert.match(html, /applyCurrentSchoolYearDefault\(\{\s*force:\s*true\s*\}\)/)
  assert.match(html, /function schoolSetupQuarterForIsoDate\(/)
  assert.match(html, /function quarterForSchoolYear\(/)
  assert.match(html, /requestedSchoolYearAll/)
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
  assert.match(html, /All school years/)
  assert.match(html, /function setTableModalOpen\(/)
  assert.match(html, /function bindTableModalControls\(/)
  assert.match(html, /function setDistributionDialogFullscreen\(/)
  assert.match(html, /function applyDistributionChartZoom\(/)
  assert.match(html, /responsiveLayout:\s*false/)
  assert.match(html, /#gradeGrid\s*\{[\s\S]*resize:\s*vertical;/i)
  assert.match(html, /#gradeGrid\s*\{[\s\S]*overflow-x:\s*auto;/i)
  assert.match(html, /\.page-shell\s*\{[\s\S]*margin:\s*24px auto;/i)
  assert.match(html, /\.tabulator-tooltip\s*\{[\s\S]*font-size:\s*1rem;/i)
  assert.match(html, /\.tabulator\s+\.tabulator-tableholder\s*\{[\s\S]*overflow-x:\s*auto/i)
  assert.match(html, /body\.table-modal-open\s*\{[\s\S]*overflow:\s*hidden;/i)
  assert.match(html, /\.grid-card\.is-table-modal\s*\{/i)
  assert.match(html, /\.page-shell\s*>\s*\*\s*\{[\s\S]*min-width:\s*0;/i)
  assert.match(html, /@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*\.metric-card h2[\s\S]*font-size:\s*clamp\(/i)
  assert.match(html, /@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*\.metric-card p[\s\S]*font-size:\s*clamp\(/i)
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
  assert.match(html, /vendor\/tabulatorz\/tabulator\.min\.js/i)
})

test("GET /web-asset/admin/grades-tabulator-dev.html redirects to consolidated page", async () => {
  const res = await fetchLocal(port, "/web-asset/admin/grades-tabulator-dev.html")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("content-type") || "", /text\/html/i)
  const html = await res.text()
  assert.match(html, /grades-tabulator\.html/i)
  assert.match(html, /window\.location\.replace\(\"\/web-asset\/admin\/grades-tabulator\.html\"\)/i)
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

test("GET /admin/students/unknown-section returns 404", async () => {
  const res = await fetchLocal(port, "/admin/students/unknown-section")
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
  const getBefore = await fetchLocal(port, "/api/admin/settings/ui", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(getBefore.status, 200)
  const beforeBody = await getBefore.json()
  assert.equal(beforeBody.ok, true)
  persistedUiSettingsPath = String(beforeBody.filePath || "")

  const payload = {
    uiSettings: {
      multiSchool: true,
      schoolSetup: {
        startDate: "2026-08-10",
        endDate: "2027-05-28",
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
  }

  const putRes = await fetchLocal(port, "/api/admin/settings/ui", {
    method: "PUT",
    headers: {
      Cookie: adminSessionCookie,
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

  const getAfter = await fetchLocal(port, "/api/admin/settings/ui", {
    headers: { Cookie: adminSessionCookie },
  })
  assert.equal(getAfter.status, 200)
  const afterBody = await getAfter.json()
  assert.equal(afterBody.ok, true)
  assert.equal(afterBody.uiSettings.multiSchool, true)
  assert.equal(afterBody.uiSettings.schoolSetup.startDate, "2026-08-10")
  assert.equal(afterBody.uiSettings.schoolSetup.letterGradeRanges[0].letter, "A")
  assert.equal(afterBody.uiSettings.schoolSetup.letterGradeRanges[0].minPercent, 92)
  assert.equal(afterBody.uiSettings.schoolProfile.schoolName, "Eagles Live")
  assert.equal(afterBody.uiSettings.schoolProfile.logoDataUrl, "data:image/png;base64,AAAA")
})

test("teacher cannot access persisted ui settings endpoint", async () => {
  const res = await fetchLocal(port, "/api/admin/settings/ui", {
    headers: { Cookie: teacherSessionCookie },
  })
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.match(body.error, /Forbidden/i)
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
  if (persistedUiSettingsPath) fs.rmSync(persistedUiSettingsPath, { force: true })
  assert.equal(fs.existsSync(TEST_ADMIN_UI_SETTINGS_FILE), false)
  if (persistedUiSettingsPath) assert.equal(fs.existsSync(persistedUiSettingsPath), false)
})
