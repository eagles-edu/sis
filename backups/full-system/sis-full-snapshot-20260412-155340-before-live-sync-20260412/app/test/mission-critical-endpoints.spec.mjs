import test from "node:test"
import assert from "node:assert/strict"

process.env.NODE_ENV = "test"
process.env.EXERCISE_MAILER_ORIGIN = "*"
process.env.EXERCISE_STORE_ENABLED = "false"
process.env.EXERCISE_STORE_REQUIRED = "false"
process.env.STUDENT_INTAKE_STORE_ENABLED = "false"
process.env.STUDENT_ADMIN_STORE_ENABLED = "false"
process.env.STUDENT_ADMIN_USER = "admin"
process.env.STUDENT_ADMIN_PASS = "admin-pass-123"
process.env.STUDENT_TEACHER_ACCOUNTS_JSON = JSON.stringify([
  { username: "teacher", role: "teacher", password: "teacher-pass-123" },
])
process.env.STUDENT_PARENT_PORTAL_ACCOUNTS_JSON = JSON.stringify([
  { parentsId: "cmvi001", password: "family-pass-123", status: "active" },
])
process.env.STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON = JSON.stringify([
  {
    eaglesId: "flyers01",
    password: "student-pass-123",
    studentRefId: "student-ref-flyers01",
    status: "active",
  },
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

async function assertUnauthorized(res) {
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.match(String(body?.error || ""), /Unauthorized/i)
}

async function assertForbidden(res) {
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.match(String(body?.error || ""), /Forbidden/i)
}

let server
let port
let adminSessionCookie = ""
let teacherSessionCookie = ""
let parentSessionCookie = ""
let studentSessionCookie = ""

test("start server for mission-critical endpoint checks", async () => {
  const { startExerciseMailer } = await import(process.cwd() + "/server/exercise-mailer.mjs")
  server = await startExerciseMailer({ transporter: makeMockTransport(), port: 0 })
  await new Promise((resolve) => server.once("listening", resolve))
  port = server.address().port
  assert.ok(Number.isInteger(port) && port > 0)
})

test("establish admin/teacher/parent/student sessions", async () => {
  const adminLogin = await fetchLocal(port, "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-pass-123" }),
  })
  assert.equal(adminLogin.status, 200)
  adminSessionCookie = (adminLogin.headers.get("set-cookie") || "").split(";")[0]
  assert.match(adminSessionCookie, /student_admin_sid=/i)

  const teacherLogin = await fetchLocal(port, "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "teacher", password: "teacher-pass-123" }),
  })
  assert.equal(teacherLogin.status, 200)
  teacherSessionCookie = (teacherLogin.headers.get("set-cookie") || "").split(";")[0]
  assert.match(teacherSessionCookie, /student_admin_sid=/i)

  const parentLogin = await fetchLocal(port, "/api/parent/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentsId: "cmvi001", password: "family-pass-123" }),
  })
  assert.equal(parentLogin.status, 200)
  parentSessionCookie = (parentLogin.headers.get("set-cookie") || "").split(";")[0]
  assert.match(parentSessionCookie, /parent_portal_sid=/i)

  const studentLogin = await fetchLocal(port, "/api/student/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eaglesId: "flyers01", password: "student-pass-123" }),
  })
  assert.equal(studentLogin.status, 200)
  studentSessionCookie = (studentLogin.headers.get("set-cookie") || "").split(";")[0]
  assert.match(studentSessionCookie, /student_portal_sid=/i)
})

test("public submit endpoints keep accepting valid payloads", async () => {
  const exerciseRes = await fetchLocal(port, "/api/exercise-submission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "student@example.com",
      eaglesId: "abc123",
      pageTitle: "Mission Critical Check",
      completedAt: "2026-03-01T07:34:04.862Z",
      correctCount: 9,
      pendingCount: 0,
      incorrectCount: 1,
      totalQuestions: 10,
      scorePercent: 90,
      recipients: ["teacher@example.com"],
    }),
  })
  assert.equal(exerciseRes.status, 204)

  const intakeRes = await fetchLocal(port, "/api/student-intake-submission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      studentName: "Test Student",
      studentDob: "2015-01-01",
      proposedStartDate: "2026-09-01",
      estimatedLevel: "Starters",
      parentName: "Parent",
      parentPhone: "+84912345678",
      parentEmail: "parent@example.com",
      sourceChannel: "website",
    }),
  })
  assert.equal(intakeRes.status, 204)
})

test("all protected write endpoints reject unauthenticated requests", async () => {
  const checks = [
    { method: "PUT", path: "/api/admin/permissions", body: { teacher: { startPage: "overview" } } },
    { method: "PUT", path: "/api/admin/settings/ui", body: { uiSettings: { multiSchool: false } } },
    { method: "POST", path: "/api/admin/runtime/service-control", body: { action: "restart" } },
    {
      method: "POST",
      path: "/api/admin/assignment-announcements/volatile",
      body: { assignmentTitle: "x", level: "Pre-A1 Starters", items: [] },
    },
    {
      method: "POST",
      path: "/api/admin/points/adjustments",
      body: { studentRefId: "student-1", pointsDelta: 1, reason: "test" },
    },
    {
      method: "PUT",
      path: "/api/admin/points/students/student-1/points",
      body: { targetPoints: 10, reason: "override" },
    },
    { method: "POST", path: "/api/admin/exercise-results/incoming", body: { action: "archive", incomingResultId: "x" } },
    { method: "POST", path: "/api/admin/notifications/batch-status", body: { action: "send-all", queueType: "parent-report" } },
    { method: "PUT", path: "/api/admin/profile-submissions/sub-1", body: { patch: { fullName: "x" } } },
    { method: "POST", path: "/api/admin/profile-submissions/sub-1", body: { action: "reject", reason: "x" } },
    { method: "POST", path: "/api/admin/notifications/email", body: { message: "x", recipients: ["p@example.com"] } },
    {
      method: "POST",
      path: "/api/admin/exports/xlsx",
      body: { filename: "x.xlsx", sheetName: "x", columns: [{ key: "a", label: "A" }], rows: [{ a: "1" }] },
    },
    { method: "POST", path: "/api/admin/students", body: { eaglesId: "x001", studentNumber: 1001 } },
    { method: "POST", path: "/api/admin/students/import", body: { rows: [{ eaglesId: "x001", studentNumber: "1001" }] } },
    { method: "POST", path: "/api/admin/users", body: { username: "u1", role: "teacher", password: "pass-123" } },
    { method: "PUT", path: "/api/admin/users/u1", body: { role: "teacher" } },
    { method: "DELETE", path: "/api/admin/users/u1" },
    { method: "PUT", path: "/api/admin/students/student-1", body: { profile: { fullName: "x" } } },
    { method: "DELETE", path: "/api/admin/students/student-1" },
    {
      method: "POST",
      path: "/api/admin/students/student-1/attendance",
      body: { attendanceDate: "2026-03-01", status: "present", className: "Starter" },
    },
    { method: "DELETE", path: "/api/admin/students/student-1/attendance/att-1" },
    {
      method: "POST",
      path: "/api/admin/students/student-1/grades",
      body: { assignmentName: "HW1", className: "Starter", dueAt: "2026-03-01" },
    },
    { method: "DELETE", path: "/api/admin/students/student-1/grades/grade-1" },
    { method: "POST", path: "/api/admin/students/student-1/reports", body: { className: "Starter", comments: "ok" } },
    { method: "POST", path: "/api/admin/students/student-1/reports/generate", body: { className: "Starter" } },
    { method: "DELETE", path: "/api/admin/students/student-1/reports/report-1" },
    { method: "POST", path: "/api/admin/news-reports/news-1", body: { action: "approve" } },
    {
      method: "PUT",
      path: "/api/parent/children/vi001/profile-draft",
      body: { patch: { fullName: "Parent Edit" } },
    },
    { method: "POST", path: "/api/parent/children/vi001/profile-submit", body: { comment: "submit" } },
    {
      method: "POST",
      path: "/api/student/news-reports",
      body: {
        reportDate: "2026-03-11",
        sourceLink: "https://example.com/news",
        articleTitle: "Sample",
        leadSynopsis: "Sample lead",
        actionActor: "Actor",
        actionAffected: "Affected",
        actionWhere: "Location",
        actionWhat: "What happened here in complete sentence.",
        actionWhy: "Why it happened here in complete sentence.",
        biasAssessment: "Bias check sentence.",
      },
    },
  ]

  for (const check of checks) {
    const headers = {}
    let body
    if (Object.prototype.hasOwnProperty.call(check, "body")) {
      headers["content-type"] = "application/json"
      body = JSON.stringify(check.body)
    }
    const res = await fetchLocal(port, check.path, {
      method: check.method,
      headers,
      body,
    })
    await assertUnauthorized(res)
  }
})

test("teacher cannot execute admin-only write actions", async () => {
  const checks = [
    { method: "PUT", path: "/api/admin/permissions", body: { teacher: { startPage: "overview" } } },
    { method: "PUT", path: "/api/admin/settings/ui", body: { uiSettings: { multiSchool: false } } },
    { method: "POST", path: "/api/admin/runtime/service-control", body: { action: "restart" } },
    {
      method: "POST",
      path: "/api/admin/assignment-announcements/volatile",
      body: { assignmentTitle: "x", level: "Pre-A1 Starters", items: [] },
    },
    { method: "POST", path: "/api/admin/exercise-results/incoming", body: { action: "archive", incomingResultId: "x" } },
    { method: "POST", path: "/api/admin/notifications/batch-status", body: { action: "send-all", queueType: "parent-report" } },
    { method: "PUT", path: "/api/admin/profile-submissions/sub-1", body: { patch: { fullName: "x" } } },
    { method: "POST", path: "/api/admin/profile-submissions/sub-1", body: { action: "reject", reason: "x" } },
    { method: "POST", path: "/api/admin/news-reports/news-1", body: { action: "approve" } },
    { method: "POST", path: "/api/admin/users", body: { username: "u1", role: "teacher", password: "pass-123" } },
    { method: "PUT", path: "/api/admin/users/u1", body: { role: "teacher" } },
    { method: "DELETE", path: "/api/admin/users/u1" },
  ]

  for (const check of checks) {
    const headers = { Cookie: teacherSessionCookie }
    let body
    if (Object.prototype.hasOwnProperty.call(check, "body")) {
      headers["content-type"] = "application/json"
      body = JSON.stringify(check.body)
    }
    const res = await fetchLocal(port, check.path, {
      method: check.method,
      headers,
      body,
    })
    await assertForbidden(res)
  }
})

test("teacher write-allowed endpoints remain reachable with expected behavior", async () => {
  const queueRes = await fetchLocal(port, "/api/admin/notifications/email", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deliveryMode: "weekend-batch",
      queueType: "parent-report",
      assignmentTitle: "Teacher Queue",
      level: "Pre-A1 Starters",
      message: "queued",
      recipients: ["parent@example.com"],
    }),
  })
  assert.equal(queueRes.status, 200)
  const queueBody = await queueRes.json()
  assert.equal(queueBody.ok, true)
  assert.equal(queueBody.queued, true)

  const attendanceRes = await fetchLocal(port, "/api/admin/students/student-1/attendance", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ attendanceDate: "2026-03-01", status: "present", className: "Starter" }),
  })
  assert.equal(attendanceRes.status, 503)

  const gradesRes = await fetchLocal(port, "/api/admin/students/student-1/grades", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ assignmentName: "HW1", className: "Starter", dueAt: "2026-03-01" }),
  })
  assert.equal(gradesRes.status, 503)

  const reportsRes = await fetchLocal(port, "/api/admin/students/student-1/reports", {
    method: "POST",
    headers: {
      Cookie: teacherSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ className: "Starter", comments: "ok" }),
  })
  assert.equal(reportsRes.status, 503)
})

test("student and parent mission-critical submission endpoints remain callable", async () => {
  const studentNewsRes = await fetchLocal(port, "/api/student/news-reports", {
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
      actionWhat: "Event details sentence here.",
      actionWhy: "Cause details sentence here.",
      biasAssessment: "No bias detected in this sentence.",
    }),
  })
  assert.ok([403, 503].includes(studentNewsRes.status))
  const studentNewsBody = await studentNewsRes.json()
  assert.match(String(studentNewsBody?.error || ""), /(store is disabled|not linked)/i)

  const draftRes = await fetchLocal(port, "/api/parent/children/vi001/profile-draft", {
    method: "PUT",
    headers: {
      Cookie: parentSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ patch: { fullName: "Updated Name" } }),
  })
  assert.equal(draftRes.status, 403)
  const draftBody = await draftRes.json()
  assert.match(String(draftBody?.error || ""), /not linked/i)

  const submitRes = await fetchLocal(port, "/api/parent/children/vi001/profile-submit", {
    method: "POST",
    headers: {
      Cookie: parentSessionCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ comment: "submit" }),
  })
  assert.equal(submitRes.status, 403)
  const submitBody = await submitRes.json()
  assert.match(String(submitBody?.error || ""), /not linked/i)
})

test("shutdown mission-critical endpoint server", async () => {
  await new Promise((resolve) => server.close(resolve))
})
