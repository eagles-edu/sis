#!/usr/bin/env node

const baseUrl = (process.env.SIS_BASE_URL || "http://127.0.0.1:8787").replace(/\/+$/, "")
const username = String(process.env.STUDENT_ADMIN_USER || "admin").trim()
const password = String(process.env.STUDENT_ADMIN_PASS || "").trim()

if (!password) {
  console.error("Missing STUDENT_ADMIN_PASS in environment")
  process.exit(1)
}

const LEVEL_FIXTURES = [
  { level: "Eggs & Chicks", short: "EggChic", classCode: "EC" },
  { level: "Pre-A1 Starters", short: "Starters", classCode: "STA" },
  { level: "A1 Movers", short: "Movers", classCode: "MOV" },
  { level: "A2 Flyers", short: "Flyers", classCode: "FLY" },
  { level: "A2 KET", short: "KET", classCode: "KET" },
  { level: "B1 PET", short: "PET", classCode: "PET" },
  { level: "B2+ IELTS", short: "IELTS", classCode: "IEL" },
  { level: "C1+ TAYK", short: "TAYK", classCode: "TYK" },
  { level: "Private", short: "Private", classCode: "PRV" },
]

const MS_PER_DAY = 24 * 60 * 60 * 1000

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function toDateText(value) {
  return new Date(value).toISOString().slice(0, 10)
}

function startOfDay(value = new Date()) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function startOfWeekMonday(value = new Date()) {
  const date = startOfDay(value)
  const day = date.getDay()
  const diffToMonday = (day + 6) % 7
  date.setDate(date.getDate() - diffToMonday)
  return date
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function toMiddayIso(value) {
  const date = new Date(value)
  date.setHours(12, 0, 0, 0)
  return date.toISOString()
}

function buildSchoolYear(now = new Date()) {
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
  return `${year}-${year + 1}`
}

function uniqueValues(values = []) {
  const out = []
  const seen = new Set()
  values.forEach((value) => {
    const key = String(value)
    if (seen.has(key)) return
    seen.add(key)
    out.push(value)
  })
  return out
}

function buildWeekContext(now = new Date()) {
  const today = startOfDay(now)
  const weekStart = startOfWeekMonday(today)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart)
    date.setDate(date.getDate() + index)
    return date
  })
  const todayIndex = clampInt(Math.floor((today.valueOf() - weekStart.valueOf()) / MS_PER_DAY), 0, 6)

  return {
    now,
    today,
    weekStart,
    todayIndex,
    days,
    dateAt(index) {
      const safeIndex = clampInt(index, 0, 6)
      return new Date(days[safeIndex])
    },
    isoAt(index) {
      return toDateText(this.dateAt(index))
    },
    isoMiddayAt(index) {
      return toMiddayIso(this.dateAt(index))
    },
  }
}

function phoneWith(basePrefix, number) {
  const suffix = String(number).padStart(7, "0")
  return `${basePrefix}${suffix.slice(-7)}`
}

function buildPairFixtures(levelEntry, levelIndex, weekContext) {
  const now = weekContext.now
  const schoolYear = buildSchoolYear(now)
  const quarter = "q1"
  const seedYear = now.getFullYear()
  const baseStudentNumber = 100 + levelIndex * 2
  const className = `${levelEntry.short} ${String.fromCharCode(65 + (levelIndex % 4))}`
  const schoolName = levelIndex % 2 === 0 ? "Eagles North Campus" : "Eagles South Campus"
  const wardDistrict = `District ${((levelIndex % 12) + 1).toString()}`
  const sharedEmergency = phoneWith("0908", 300000 + levelIndex)

  const positiveStudentId = `TST-${seedYear}-${String(baseStudentNumber).padStart(3, "0")}`
  const riskStudentId = `TST-${seedYear}-${String(baseStudentNumber + 1).padStart(3, "0")}`

  const positiveName = `${levelEntry.short} Explorer ${String(levelIndex + 1).padStart(2, "0")}`
  const riskName = `${levelEntry.short} Risk ${String(levelIndex + 1).padStart(2, "0")}`

  const positiveAttendanceIndexes = uniqueValues([
    weekContext.todayIndex,
    (levelIndex + 1) % 7,
    (levelIndex + 3) % 7,
  ])

  const riskAttendanceIndexes = uniqueValues([
    weekContext.todayIndex,
    0,
    1,
  ])

  const positiveGradeDayIndexes = uniqueValues([
    levelIndex % 7,
    (levelIndex + 2) % 7,
    (levelIndex + 4) % 7,
  ])

  const lateSubmitDate = new Date(weekContext.dateAt(weekContext.todayIndex))
  lateSubmitDate.setDate(lateSubmitDate.getDate() + 1)

  const positiveFixture = {
    studentId: positiveStudentId,
    profile: {
      fullName: `Sample ${positiveName}`,
      englishName: `${positiveName} EN`,
      currentGrade: levelEntry.level,
      schoolName,
      studentEmail: `${normalizeText(positiveStudentId).toLowerCase()}@example.edu`,
      studentPhone: phoneWith("0900", 200000 + baseStudentNumber),
      motherName: `Parent ${positiveName}`,
      motherPhone: phoneWith("0909", 100000 + baseStudentNumber),
      motherEmergencyContact: sharedEmergency,
      motherEmail: `${normalizeText(positiveStudentId).toLowerCase()}-mother@example.edu`,
      fatherName: `Guardian ${positiveName}`,
      fatherPhone: phoneWith("0911", 110000 + baseStudentNumber),
      fatherEmergencyContact: phoneWith("0912", 120000 + baseStudentNumber),
      fatherEmail: `${normalizeText(positiveStudentId).toLowerCase()}-father@example.edu`,
      streetAddress: `${baseStudentNumber} ${levelEntry.short} Avenue`,
      wardDistrict,
      city: "HCMC",
      extraComments: "Diagnostic seed: strong student profile",
    },
    attendance: positiveAttendanceIndexes.map((dayIndex, rowIndex) => ({
      className,
      schoolYear,
      quarter,
      attendanceDate: weekContext.isoMiddayAt(dayIndex),
      status: rowIndex === positiveAttendanceIndexes.length - 1 ? "late" : "present",
      comments:
        rowIndex === positiveAttendanceIndexes.length - 1
          ? "12 min late - traffic"
          : "Present",
    })),
    grades: positiveGradeDayIndexes.map((dayIndex, rowIndex) => ({
      className,
      schoolYear,
      quarter,
      assignmentName: `${levelEntry.short} Assignment ${rowIndex + 1}`,
      dueAt: weekContext.isoMiddayAt(dayIndex),
      submittedAt: weekContext.isoMiddayAt(dayIndex),
      score: 8.5 + (rowIndex % 2),
      maxScore: 10,
      homeworkCompleted: true,
      homeworkOnTime: true,
      behaviorScore: 8 + (rowIndex % 2),
      participationScore: 8,
      inClassScore: 8 + (rowIndex % 2),
      comments: "Completed on time",
    })),
    reports: [
      {
        className,
        schoolYear,
        quarter,
        homeworkCompletionRate: 98,
        homeworkOnTimeRate: 96,
        behaviorScore: 9,
        participationScore: 8,
        inClassScore: 9,
        comments: "Diagnostic seed report: strong progress",
      },
    ],
  }

  const riskFixture = {
    studentId: riskStudentId,
    profile: {
      fullName: `Sample ${riskName}`,
      englishName: `${riskName} EN`,
      currentGrade: levelEntry.level,
      schoolName,
      studentEmail: `${normalizeText(riskStudentId).toLowerCase()}@example.edu`,
      studentPhone: phoneWith("0900", 200000 + baseStudentNumber + 1),
      motherName: `Parent ${riskName}`,
      motherPhone: phoneWith("0909", 100000 + baseStudentNumber + 1),
      motherEmergencyContact: sharedEmergency,
      motherEmail: `${normalizeText(riskStudentId).toLowerCase()}-mother@example.edu`,
      fatherName: `Guardian ${riskName}`,
      fatherPhone: phoneWith("0911", 110000 + baseStudentNumber + 1),
      fatherEmergencyContact: phoneWith("0912", 120000 + baseStudentNumber + 1),
      fatherEmail: `${normalizeText(riskStudentId).toLowerCase()}-father@example.edu`,
      streetAddress: `${baseStudentNumber + 1} ${levelEntry.short} Avenue`,
      wardDistrict,
      city: "HCMC",
      extraComments: "Diagnostic seed: at-risk pattern",
    },
    attendance: riskAttendanceIndexes.map((dayIndex, rowIndex) => {
      if (rowIndex === 0) {
        return {
          className,
          schoolYear,
          quarter,
          attendanceDate: weekContext.isoMiddayAt(dayIndex),
          status: "late",
          comments: "35 min late",
        }
      }
      return {
        className,
        schoolYear,
        quarter,
        attendanceDate: weekContext.isoMiddayAt(dayIndex),
        status: "absent",
        comments: "Absent - diagnostic",
      }
    }),
    grades: [
      {
        className,
        schoolYear,
        quarter,
        assignmentName: `${levelEntry.short} Recovery Task A`,
        dueAt: weekContext.isoMiddayAt(0),
        score: 4,
        maxScore: 10,
        homeworkCompleted: false,
        homeworkOnTime: false,
        behaviorScore: 5,
        participationScore: 5,
        inClassScore: 5,
        comments: "Outstanding",
      },
      {
        className,
        schoolYear,
        quarter,
        assignmentName: `${levelEntry.short} Recovery Task B`,
        dueAt: weekContext.isoMiddayAt(0),
        score: 4.5,
        maxScore: 10,
        homeworkCompleted: false,
        homeworkOnTime: false,
        behaviorScore: 5,
        participationScore: 5,
        inClassScore: 5,
        comments: "Outstanding",
      },
      {
        className,
        schoolYear,
        quarter,
        assignmentName: `${levelEntry.short} Recovery Task C`,
        dueAt: weekContext.isoMiddayAt(weekContext.todayIndex),
        submittedAt: toMiddayIso(lateSubmitDate),
        score: 6,
        maxScore: 10,
        homeworkCompleted: true,
        homeworkOnTime: false,
        behaviorScore: 6,
        participationScore: 6,
        inClassScore: 6,
        comments: "Submitted late",
      },
      {
        className,
        schoolYear,
        quarter,
        assignmentName: `${levelEntry.short} Recovery Task D`,
        dueAt: weekContext.isoMiddayAt((levelIndex + 5) % 7),
        submittedAt: weekContext.isoMiddayAt((levelIndex + 5) % 7),
        score: 7,
        maxScore: 10,
        homeworkCompleted: true,
        homeworkOnTime: true,
        behaviorScore: 6,
        participationScore: 6,
        inClassScore: 6,
        comments: "Recovered",
      },
    ],
    reports: [
      {
        className,
        schoolYear,
        quarter,
        homeworkCompletionRate: 62,
        homeworkOnTimeRate: 48,
        behaviorScore: 6,
        participationScore: 6,
        inClassScore: 6,
        comments: "Diagnostic seed report: intervention needed",
      },
    ],
  }

  return [positiveFixture, riskFixture]
}

function buildFixtures(now = new Date()) {
  const weekContext = buildWeekContext(now)
  const fixtures = LEVEL_FIXTURES.flatMap((entry, index) =>
    buildPairFixtures(entry, index, weekContext)
  )

  return {
    weekContext,
    fixtures,
  }
}

function parseSetCookie(setCookie) {
  if (!setCookie) return ""
  return String(setCookie).split(";")[0].trim()
}

async function request(path, init = {}, cookie = "") {
  const headers = { ...(init.headers || {}) }
  if (cookie) headers.Cookie = cookie
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers })
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { raw: text }
  }
  return { response, body, text }
}

async function mustRequest(path, init = {}, cookie = "") {
  const result = await request(path, init, cookie)
  if (!result.response.ok) {
    const message = result.body?.error || result.text || `HTTP ${result.response.status}`
    throw new Error(`${init.method || "GET"} ${path} failed: ${message}`)
  }
  return result
}

async function loginAndGetCookie() {
  const login = await mustRequest("/api/admin/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
  const cookie = parseSetCookie(login.response.headers.get("set-cookie") || "")
  if (!cookie) throw new Error("Login succeeded but no session cookie was returned")
  return cookie
}

async function upsertStudent(cookie, fixture, byStudentId) {
  const payload = {
    studentId: fixture.studentId,
    profile: {
      sourceFormId: "sample-seed",
      sourceUrl: "tools/seed-student-sample-data",
      ...fixture.profile,
    },
  }

  const existing = byStudentId.get(fixture.studentId)
  if (existing?.id) {
    await mustRequest(
      `/api/admin/students/${encodeURIComponent(existing.id)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      cookie
    )
    return { id: existing.id, action: "updated" }
  }

  const created = await mustRequest(
    "/api/admin/students",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
    cookie
  )
  return { id: created.body?.student?.id, action: "created" }
}

async function refreshStudent(cookie, studentId) {
  const detail = await mustRequest(`/api/admin/students/${encodeURIComponent(studentId)}`, { method: "GET" }, cookie)
  return detail.body
}

async function clearStudentRecords(cookie, student) {
  const id = student.id
  let deletedAttendance = 0
  let deletedGrades = 0
  let deletedReports = 0

  for (const row of student.attendanceRecords || []) {
    await mustRequest(
      `/api/admin/students/${encodeURIComponent(id)}/attendance/${encodeURIComponent(row.id)}`,
      {
        method: "DELETE",
      },
      cookie
    )
    deletedAttendance += 1
  }

  for (const row of student.gradeRecords || []) {
    await mustRequest(
      `/api/admin/students/${encodeURIComponent(id)}/grades/${encodeURIComponent(row.id)}`,
      {
        method: "DELETE",
      },
      cookie
    )
    deletedGrades += 1
  }

  for (const row of student.parentReports || []) {
    await mustRequest(
      `/api/admin/students/${encodeURIComponent(id)}/reports/${encodeURIComponent(row.id)}`,
      {
        method: "DELETE",
      },
      cookie
    )
    deletedReports += 1
  }

  return { deletedAttendance, deletedGrades, deletedReports }
}

async function createStudentRecords(cookie, studentId, fixture) {
  let createdAttendance = 0
  let createdGrades = 0
  let createdReports = 0

  for (const row of fixture.attendance || []) {
    await mustRequest(
      `/api/admin/students/${encodeURIComponent(studentId)}/attendance`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...row, level: fixture.profile.currentGrade }),
      },
      cookie
    )
    createdAttendance += 1
  }

  for (const row of fixture.grades || []) {
    await mustRequest(
      `/api/admin/students/${encodeURIComponent(studentId)}/grades`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...row, level: fixture.profile.currentGrade }),
      },
      cookie
    )
    createdGrades += 1
  }

  for (const row of fixture.reports || []) {
    await mustRequest(
      `/api/admin/students/${encodeURIComponent(studentId)}/reports`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...row, level: fixture.profile.currentGrade }),
      },
      cookie
    )
    createdReports += 1
  }

  return { createdAttendance, createdGrades, createdReports }
}

async function main() {
  const { weekContext, fixtures } = buildFixtures(new Date())

  const cookie = await loginAndGetCookie()
  const listing = await mustRequest("/api/admin/students?take=5000", { method: "GET" }, cookie)
  const students = Array.isArray(listing.body?.items) ? listing.body.items : []
  const byStudentId = new Map(students.map((entry) => [String(entry.studentId || "").trim(), entry]))

  const summary = {
    seededStudents: fixtures.length,
    createdStudents: 0,
    updatedStudents: 0,
    deletedAttendance: 0,
    deletedGrades: 0,
    deletedReports: 0,
    createdAttendance: 0,
    createdGrades: 0,
    createdReports: 0,
    weekWindow: {
      weekStart: toDateText(weekContext.weekStart),
      weekEnd: toDateText(weekContext.dateAt(6)),
      today: toDateText(weekContext.today),
      todayIndex: weekContext.todayIndex,
    },
    levelsSeeded: LEVEL_FIXTURES.map((entry) => entry.level),
  }

  for (const fixture of fixtures) {
    const result = await upsertStudent(cookie, fixture, byStudentId)
    if (result.action === "created") summary.createdStudents += 1
    else summary.updatedStudents += 1

    const student = await refreshStudent(cookie, result.id)
    const cleared = await clearStudentRecords(cookie, student)
    summary.deletedAttendance += cleared.deletedAttendance
    summary.deletedGrades += cleared.deletedGrades
    summary.deletedReports += cleared.deletedReports

    const created = await createStudentRecords(cookie, result.id, fixture)
    summary.createdAttendance += created.createdAttendance
    summary.createdGrades += created.createdGrades
    summary.createdReports += created.createdReports
  }

  const filters = await mustRequest("/api/admin/filters", { method: "GET" }, cookie)
  summary.levels = Array.isArray(filters.body?.levels) ? filters.body.levels : []

  const dashboard = await mustRequest("/api/admin/dashboard", { method: "GET" }, cookie)
  const weeklyRows = Array.isArray(dashboard.body?.weeklyAssignmentCompletion)
    ? dashboard.body.weeklyAssignmentCompletion
    : []

  summary.dashboard = {
    atRiskWeekTotal: Number(dashboard.body?.atRiskWeek?.total || 0),
    outstandingNow: Number(dashboard.body?.assignments?.outstanding || 0),
    levelCompletionCount: Array.isArray(dashboard.body?.levelCompletion)
      ? dashboard.body.levelCompletion.length
      : 0,
    weeklyAssigned: weeklyRows.map((row) => Number(row.studentsWithAssignments || 0)),
    weeklyCompletedAll: weeklyRows.map((row) => Number(row.studentsCompletedAll || 0)),
  }

  const familyProbePhone = fixtures[0]?.profile?.motherEmergencyContact || ""
  if (familyProbePhone) {
    const familyProbe = await mustRequest(
      `/api/admin/family?phone=${encodeURIComponent(familyProbePhone)}`,
      { method: "GET" },
      cookie
    )
    summary.familyProbe = {
      phone: familyProbePhone,
      matches: Number(familyProbe.body?.total || 0),
    }
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
