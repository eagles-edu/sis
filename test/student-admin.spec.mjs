// test/student-admin.spec.mjs
import test from "node:test"
import assert from "node:assert/strict"
import * as XLSX from "xlsx"
import { parseSpreadsheetRowsFromUploadPayload } from "../server/student-admin-routes.mjs"
import { generateStudentReportCardPdf } from "../server/student-report-card-pdf.mjs"

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
process.env.STUDENT_ADMIN_TOKEN_SECRET = "test-student-admin-token-secret"
process.env.MAILER_DEBUG = "false"

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
let assignmentAnnouncementPreviewPath = ""

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
  assert.match(html, /Static preview mode requires \?apiOrigin=/i)
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

test("GET /admin/students/unknown-section returns 404", async () => {
  const res = await fetchLocal(port, "/admin/students/unknown-section")
  assert.equal(res.status, 404)
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
  assert.ok(body.runtimeSelfHeal && typeof body.runtimeSelfHeal === "object")
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
