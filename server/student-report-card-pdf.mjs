// @ts-check
// server/student-report-card-pdf.mjs

import fs from "node:fs"
import path from "node:path"
import PDFDocument from "pdfkit"

const FIXED_TIME_ZONE_OFFSET_MS = 7 * 60 * 60 * 1000

/**
 * @typedef {Record<string, unknown> & {
 *   eaglesId?: unknown,
 *   studentNumber?: unknown,
 *   profile?: Record<string, unknown> | null,
 *   attendanceRecords?: Array<Record<string, unknown>> | null,
 *   gradeRecords?: Array<Record<string, unknown>> | null,
 *   parentReports?: Array<Record<string, unknown>> | null,
 *   email?: unknown,
 * }} StudentReportCardEntity
 *
 * @typedef {Record<string, unknown> & {
 *   className?: unknown,
 *   schoolYear?: unknown,
 *   quarter?: unknown,
 * }} ReportCardFilters
 */

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizePositiveInteger(value) {
  if (value === undefined || value === null || value === "") return null
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return parsed
}

function sameText(value, expected) {
  const left = normalizeLower(value)
  const right = normalizeLower(expected)
  if (!right) return true
  return left === right
}

function sanitizeFilePart(value, fallback) {
  const normalized = normalizeText(value)
  if (!normalized) return fallback
  const cleaned = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return cleaned || fallback
}

function formatDate(value) {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.valueOf())) return ""
  const shifted = new Date(date.getTime() + FIXED_TIME_ZONE_OFFSET_MS)
  const yyyy = shifted.getUTCFullYear()
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(shifted.getUTCDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function formatDateTime(value) {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.valueOf())) return ""
  const shifted = new Date(date.getTime() + FIXED_TIME_ZONE_OFFSET_MS)
  const yyyy = shifted.getUTCFullYear()
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(shifted.getUTCDate()).padStart(2, "0")
  const hh = String(shifted.getUTCHours()).padStart(2, "0")
  const min = String(shifted.getUTCMinutes()).padStart(2, "0")
  const ss = String(shifted.getUTCSeconds()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} GMT+07:00`
}

function average(values) {
  const numeric = values.filter((entry) => Number.isFinite(entry))
  if (!numeric.length) return null
  const total = numeric.reduce((sum, entry) => sum + entry, 0)
  return Number((total / numeric.length).toFixed(2))
}

function percentage(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null
  return Number(((numerator / denominator) * 100).toFixed(2))
}

function normalizeSnapshotAssignmentEntries(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null
      return {
        title: normalizeText(entry.assignmentName) || normalizeText(entry.title) || "Assignment",
        subject: normalizeText(entry.className) || normalizeText(entry.subject),
        teacher: normalizeText(entry.teacher) || "Teacher",
        note: normalizeText(entry.note) || normalizeText(entry.comments),
        dueDate: formatDate(entry.dueAt),
        submittedDate: formatDate(entry.submittedAt),
        status: normalizeText(entry.status),
        deepLink: normalizeText(entry.deepLink),
      }
    })
    .filter((entry) => Boolean(entry?.title || entry?.dueDate || entry?.submittedDate))
}

function buildSnapshotHomeworkSection(assignments = [], fallback = {}, kind = "current") {
  const normalized = normalizeSnapshotAssignmentEntries(assignments)
  const statusFallback = kind === "past-due" ? "Overdue" : "Assigned"
  const exercises = normalized.map((entry) => ({
    title: entry.title,
    detail: [
      entry.note,
      entry.dueDate ? `Due ${entry.dueDate}` : "",
      entry.submittedDate ? `Submitted ${entry.submittedDate}` : "",
      entry.deepLink ? `Details ${entry.deepLink}` : "",
    ].filter(Boolean).join(" | "),
    status: entry.status || statusFallback,
  }))
  return {
    title: normalized[0]?.title || normalizeText(fallback.title),
    subject: normalized[0]?.subject || normalizeText(fallback.subject),
    teacher: normalized[0]?.teacher || normalizeText(fallback.teacher),
    note: normalizeText(fallback.note),
    assignmentsCount: normalized.length,
    exercisesCount: exercises.length,
    exercises,
  }
}

function selectRecords(student, filters = {}) {
  const className = normalizeText(filters.className)
  const schoolYear = normalizeText(filters.schoolYear)
  const quarter = normalizeText(filters.quarter)
  const reportId = normalizeText(filters.reportId)

  const matches = (record) => {
    if (className && !sameText(record.className, className)) return false
    if (schoolYear && !sameText(record.schoolYear, schoolYear)) return false
    if (quarter && !sameText(record.quarter, quarter)) return false
    return true
  }

  const attendanceRecords = Array.isArray(student.attendanceRecords)
    ? student.attendanceRecords.filter(matches)
    : []
  const gradeRecords = Array.isArray(student.gradeRecords) ? student.gradeRecords.filter(matches) : []
  const parentReports = Array.isArray(student.parentReports)
    ? student.parentReports.filter((record) => {
        if (reportId && normalizeText(record?.id) !== reportId) return false
        return matches(record)
      })
    : []

  return {
    attendanceRecords,
    gradeRecords,
    parentReports,
  }
}

async function loadPhotoBuffer(photoUrl) {
  const value = normalizeText(photoUrl)
  if (!value) return null

  if (/^data:image\/.+;base64,/i.test(value)) {
    const index = value.indexOf(",")
    if (index <= 0) return null
    return Buffer.from(value.slice(index + 1), "base64")
  }

  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value)
    if (!response.ok) return null
    const contentType = normalizeLower(response.headers.get("content-type") || "")
    if (!contentType.startsWith("image/")) return null
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  const absolutePath = path.isAbsolute(value) ? value : path.resolve(process.cwd(), value)
  if (!fs.existsSync(absolutePath)) return null
  return fs.readFileSync(absolutePath)
}

function drawSectionTitle(doc, title) {
  doc.moveDown(0.8)
  doc.fontSize(12).fillColor("#0f6ad8").text(title)
  doc.moveDown(0.2)
  doc.fillColor("#1b2538")
}

function printKeyValue(doc, label, value) {
  doc.font("Helvetica-Bold").text(`${label}: `, { continued: true })
  doc.font("Helvetica").text(value || "-")
}

function drawDivider(doc) {
  const y = doc.y + 2
  doc.moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(0.4)
    .strokeColor("#d5ddea")
    .stroke()
  doc.moveDown(0.5)
}

function summarizeAttendance(attendanceRecords) {
  const summary = {
    total: attendanceRecords.length,
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
  }

  attendanceRecords.forEach((entry) => {
    const status = normalizeLower(entry.status)
    if (status === "present") summary.present += 1
    else if (status === "late") {
      summary.present += 1
      summary.late += 1
    } else if (status === "absent") summary.absent += 1
    else if (status === "excused") summary.excused += 1
  })

  return summary
}

function summarizeGrades(gradeRecords) {
  const homeworkTotal = gradeRecords.length
  const homeworkCompleted = gradeRecords.filter((entry) => {
    if (entry.homeworkCompleted === true) return true
    return Boolean(entry.submittedAt)
  }).length

  const homeworkOnTime = gradeRecords.filter((entry) => {
    if (entry.homeworkOnTime === true) return true
    if (!entry.dueAt || !entry.submittedAt) return false
    return new Date(entry.submittedAt).valueOf() <= new Date(entry.dueAt).valueOf()
  }).length

  return {
    totalAssignments: homeworkTotal,
    homeworkCompletionRate: percentage(homeworkCompleted, homeworkTotal),
    homeworkOnTimeRate: percentage(homeworkOnTime, homeworkTotal),
    averageScore: average(
      gradeRecords
        .map((entry) => {
          if (!Number.isFinite(entry.score) || !Number.isFinite(entry.maxScore) || entry.maxScore <= 0) return null
          return (entry.score / entry.maxScore) * 100
        })
        .filter((entry) => Number.isFinite(entry))
    ),
    behaviorScore: average(gradeRecords.map((entry) => entry.behaviorScore)),
    participationScore: average(gradeRecords.map((entry) => entry.participationScore)),
    inClassScore: average(gradeRecords.map((entry) => entry.inClassScore)),
  }
}

function parseDateOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.valueOf())) return null
  return date
}

function compareDateDescending(left, right) {
  const leftTime = parseDateOrNull(left)?.valueOf() || 0
  const rightTime = parseDateOrNull(right)?.valueOf() || 0
  return rightTime - leftTime
}

const RUBRIC_FIELD_META = [
  ["pt_skill_internationalNews", "pt_rec_internationalNews", "Leverages computer/phone daily to read international news", "Flyers and above only."],
  ["pt_skill_readingEnglishEnjoyment", "pt_rec_readingEnglishEnjoyment", "Leverages computer/phone to read for enjoyment in English", "Flyers and above only."],
  ["pt_skill_vocabularyLookup", "pt_rec_vocabularyLookup", "Leverages computer/phone to look up, translate, and hear new vocabulary", "Flyers and above only."],
  ["pt_skill_noteTaking", "pt_rec_noteTaking", "Writes notes independently.", ""],
  ["pt_skill_questions", "pt_rec_questions", "Asks questions in real-time whenever needed.", ""],
  ["pt_skill_studyOutsideClass", "pt_rec_studyOutsideClass", "Consistently studies class notes outside of class.", ""],
  ["pt_skill_reviewBeforeClass", "pt_rec_reviewBeforeClass", "Reviews notes before attending class.", ""],
  ["pt_skill_memoryRecall", "pt_rec_memoryRecall", "Demonstrates age-appropriate memory recall.", "Remembers to study lessons, complete homework, and ask questions well."],
  ["pt_skill_notebookUsage", "pt_rec_notebookUsage", "Knows and uses the Eagles Club notebook well.", "Uses grammar references, word lists, and speaking drills."],
  ["pt_skill_phonics", "pt_rec_phonics", "Uses English phonics and spelling patterns well.", ""],
  ["pt_skill_englishContentExposure", "pt_rec_englishContentExposure", "Reads, listens to, and watches English content regularly.", ""],
  ["pt_skill_logic", "pt_rec_logic", "Demonstrates logical thinking abilities.", ""],
  ["pt_conduct_listening", "pt_rec_listening", "Does not talk to others during lessons; listens while others speak.", ""],
  ["pt_conduct_emotion", "pt_rec_emotion", "Has age-appropriate control of emotions.", ""],
  ["pt_conduct_cooperation", "pt_rec_cooperation", "Always cheerfully follows in-class teacher instructions; cooperative.", ""],
  ["pt_conduct_maturity", "pt_rec_maturity", "Displays age-appropriate maturity.", ""],
  ["pt_conduct_focus", "pt_rec_focus", "Can easily concentrate, follow along, and stay on task during class.", ""],
  ["pt_conduct_respect", "pt_rec_respect", "Respects the classroom, desks, computers, and TV in room; keeps area clean.", ""],
  ["pt_conduct_materials", "pt_rec_materials", "Always brings notebook and pencils with eraser attached every class.", ""],
  ["pt_conduct_learnsFromMistakes", "pt_rec_learnsFromMistakes", "Learns from mistakes and successes.", ""],
  ["pt_conduct_remembersLessons", "pt_rec_remembersLessons", "Shows effort to remember lessons well.", ""],
  ["pt_conduct_help", "pt_rec_help", "Asks for help when translation or explanation is needed.", ""],
  ["pt_conduct_coversMouthNose", "pt_rec_coversMouthNose", "Covers mouth and/or nose when yawning, coughing, or sneezing.", ""],
  ["pt_conduct_handwashing", "pt_rec_handwashing", "Regularly washes hands and understands self-protection from transmission.", ""],
  ["pt_conduct_noFingerContact", "pt_rec_noFingerContact", "Never sticks fingers in eyes, nose, or mouth; uses tissue/handkerchief instead.", ""],
]

function rubricScoreMeaning(scoreValue) {
  const score = Number.parseInt(String(scoreValue), 10)
  if (!Number.isFinite(score)) return ""
  switch (Math.max(0, Math.min(5, score))) {
    case 0:
      return "not yet observed"
    case 1:
      return "just beginning"
    case 2:
      return "emerging with support"
    case 3:
      return "developing"
    case 4:
      return "usually secure"
    case 5:
      return "consistently mastered"
    default:
      return ""
  }
}

function savedRubricRowsFromPayload(rubricPayload = null, overallComment = "") {
  const source = rubricPayload && typeof rubricPayload === "object" ? rubricPayload : null
  if (!source) return []
  const skillScores = source.skillScores && typeof source.skillScores === "object" ? source.skillScores : {}
  const conductScores = source.conductScores && typeof source.conductScores === "object" ? source.conductScores : {}
  const recommendations = source.recommendations && typeof source.recommendations === "object" ? source.recommendations : {}
  return RUBRIC_FIELD_META
    .map(([scoreKey, recommendationKey, title, detail]) => {
      const scoreValue = normalizeText(skillScores[scoreKey] ?? conductScores[scoreKey])
      const recommendation = normalizeText(recommendations[recommendationKey] || overallComment)
      if (!scoreValue && !recommendation) return null
      const meaning = rubricScoreMeaning(scoreValue)
      return {
        prompt: title,
        metric: title,
        title,
        resultScore: scoreValue || "-",
        observedResult: scoreValue || "-",
        resultExplanation: meaning || detail || "Saved rubric snapshot.",
        detail: detail || meaning || "Saved rubric snapshot.",
        summary: meaning || detail || "Saved rubric snapshot.",
        recommendation: recommendation || "-",
        actionNote: recommendation || "-",
      }
    })
    .filter(Boolean)
}

function normalizeExerciseItems(entry) {
  const items = Array.isArray(entry?.assignmentBundleJson?.items)
    ? entry.assignmentBundleJson.items
    : []
  return items
    .map((item, index) => {
      const title = normalizeText(item?.title) || `Exercise ${index + 1}`
      const detail = normalizeText(item?.url) || normalizeText(entry?.comments)
      const status = entry?.homeworkCompleted === true
        ? "Submitted"
        : entry?.submittedAt
          ? "Pending"
          : "Assigned"
      return {
        title,
        detail,
        status,
      }
    })
    .filter((item) => Boolean(item.title))
}

function buildHomeworkSection({ records = [], now = new Date(), kind = "current" } = {}) {
  const selectedRecords = (Array.isArray(records) ? records : [])
    .filter((entry) => {
      const dueAt = parseDateOrNull(entry?.dueAt)
      const submittedAt = parseDateOrNull(entry?.submittedAt)
      const isCompleted = entry?.homeworkCompleted === true || Boolean(submittedAt)
      if (kind === "current") {
        if (isCompleted) return false
        if (!dueAt) return true
        return dueAt.valueOf() >= now.valueOf()
      }
      if (!dueAt) return !isCompleted
      return !isCompleted && dueAt.valueOf() < now.valueOf()
    })
    .sort((left, right) => compareDateDescending(left?.dueAt || left?.submittedAt, right?.dueAt || right?.submittedAt))

  const assignments = selectedRecords.map((entry) => {
    const dueAt = parseDateOrNull(entry?.dueAt)
    const submittedAt = parseDateOrNull(entry?.submittedAt)
    const exercises = normalizeExerciseItems(entry)
    return {
      title: normalizeText(entry?.assignmentName) || "Assignment",
      subject: normalizeText(entry?.className) || normalizeText(entry?.level),
      teacher: normalizeText(entry?.teacherName) || normalizeText(entry?.sourceOriginLabel) || "Teacher",
      note: normalizeText(entry?.comments) || normalizeText(entry?.assignmentBundleJson?.note) || "",
      dueDate: formatDate(dueAt),
      submittedDate: formatDate(submittedAt),
      status: entry?.homeworkCompleted === true
        ? "Submitted"
        : submittedAt
          ? "Pending"
          : dueAt && dueAt.valueOf() < now.valueOf()
            ? "Overdue"
            : "Assigned",
      exercises,
    }
  })

  return {
    assignmentsCount: assignments.length,
    exercisesCount: assignments.reduce((total, entry) => total + Math.max(1, entry.exercises.length), 0),
    assignments,
  }
}

/**
 * @param {StudentReportCardEntity} student
 * @param {ReportCardFilters} [filters]
 * @returns {Record<string, unknown>}
 */
export function buildStudentReportCardPayload(student, filters = {}) {
  const identity = assertStudentIdentity(student, "report-card payload")
  const profile = /** @type {Record<string, unknown>} */ (student?.profile || {})
  const selected = selectRecords(student, filters)
  const attendanceSummary = summarizeAttendance(selected.attendanceRecords)
  const gradeSummary = summarizeGrades(selected.gradeRecords)
  const latestParentReport = selected.parentReports
    .slice()
    .sort((left, right) => compareDateDescending(left?.generatedAt, right?.generatedAt))[0] || null
  const now = new Date()
  const currentHomework = buildHomeworkSection({ records: selected.gradeRecords, now, kind: "current" })
  const pastDueHomework = buildHomeworkSection({ records: selected.gradeRecords, now, kind: "past-due" })
  const attendancePercent = percentage(attendanceSummary.present, attendanceSummary.total)
  const attendanceRate = attendancePercent === null ? null : `${attendancePercent}%`
  const currentReportDate = formatDate(latestParentReport?.generatedAt || new Date())
  const snapshotCapturedAt = normalizeText(latestParentReport?.generatedAt) || new Date().toISOString()
  const latestMeta = latestParentReport?.metaPayload && typeof latestParentReport.metaPayload === "object"
    ? latestParentReport.metaPayload
    : {}
  const parentReviewedBy = normalizeText(
    latestMeta.parentReviewedByUsername || latestMeta.parentReviewedBy
  )
  const parentReviewedAt = normalizeText(latestMeta.parentReviewedAt)
  const studentReviewedBy = normalizeText(
    latestMeta.studentReviewedByUsername || latestMeta.studentReviewedBy
  )
  const studentReviewedAt = normalizeText(latestMeta.studentReviewedAt)
  const currentHomeworkSnapshot = buildSnapshotHomeworkSection(
    latestParentReport?.currentHomeworkAssignments,
    {
      title: currentHomework.assignments[0]?.title || "Current assignment",
      subject: currentHomework.assignments[0]?.subject || normalizeText(filters.className),
      teacher: currentHomework.assignments[0]?.teacher || "Teacher",
      note:
        normalizeText(latestMeta.currentHomeworkSummary)
        || currentHomework.assignments[0]?.note
        || "Active assignment details will appear here.",
    },
    "current"
  )
  const pastDueHomeworkSnapshot = buildSnapshotHomeworkSection(
    latestParentReport?.pastDueHomeworkAssignments?.length
      ? latestParentReport.pastDueHomeworkAssignments
      : latestParentReport?.outstandingAssignments,
    {
      title: pastDueHomework.assignments[0]?.title || "Past due assignment",
      subject: pastDueHomework.assignments[0]?.subject || normalizeText(filters.className),
      teacher: pastDueHomework.assignments[0]?.teacher || "Teacher",
      note:
        normalizeText(latestMeta.pastDueHomeworkSummary)
        || pastDueHomework.assignments[0]?.note
        || "Outstanding work details will appear here.",
    },
    "past-due"
  )
  const immutableMetric = (reportValue, liveValue) =>
    reportValue !== undefined && reportValue !== null && reportValue !== "" ? reportValue : liveValue
  const reportComment = normalizeText(latestParentReport?.comments)
  const savedRubricRows = savedRubricRowsFromPayload(latestParentReport?.rubricPayload, reportComment)
  const fallbackRubricRows = [
    {
      prompt: "Homework completion",
      resultScore: toDisplay(immutableMetric(latestParentReport?.homeworkCompletionRate, gradeSummary.homeworkCompletionRate)),
      resultExplanation: "Average completion across the selected scope.",
      recommendation: "Review incomplete assignments and reinforce deadlines.",
      metric: "Homework completion",
      observedResult: toDisplay(immutableMetric(latestParentReport?.homeworkCompletionRate, gradeSummary.homeworkCompletionRate)),
      detail: "Average completion across the selected scope.",
      summary: "Review incomplete assignments and reinforce deadlines.",
      actionNote: "Review incomplete assignments and reinforce deadlines.",
    },
    {
      prompt: "Homework on-time",
      resultScore: toDisplay(immutableMetric(latestParentReport?.homeworkOnTimeRate, gradeSummary.homeworkOnTimeRate)),
      resultExplanation: "Submission timing against due dates.",
      recommendation: "Confirm due-date awareness and home support.",
      metric: "Homework on-time",
      observedResult: toDisplay(immutableMetric(latestParentReport?.homeworkOnTimeRate, gradeSummary.homeworkOnTimeRate)),
      detail: "Submission timing against due dates.",
      summary: "Confirm due-date awareness and home support.",
      actionNote: "Confirm due-date awareness and home support.",
    },
    {
      prompt: "Behavior",
      resultScore: toDisplay(immutableMetric(latestParentReport?.behaviorScore, gradeSummary.behaviorScore)),
      resultExplanation: "Teacher-scored behavior signal.",
      recommendation: "Follow up on conduct notes where needed.",
      metric: "Behavior",
      observedResult: toDisplay(immutableMetric(latestParentReport?.behaviorScore, gradeSummary.behaviorScore)),
      detail: "Teacher-scored behavior signal.",
      summary: "Follow up on conduct notes where needed.",
      actionNote: "Follow up on conduct notes where needed.",
    },
    {
      prompt: "Participation",
      resultScore: toDisplay(immutableMetric(latestParentReport?.participationScore, gradeSummary.participationScore)),
      resultExplanation: "Teacher-scored participation signal.",
      recommendation: "Prompt participation and check in with the student.",
      metric: "Participation",
      observedResult: toDisplay(immutableMetric(latestParentReport?.participationScore, gradeSummary.participationScore)),
      detail: "Teacher-scored participation signal.",
      summary: "Prompt participation and check in with the student.",
      actionNote: "Prompt participation and check in with the student.",
    },
    {
      prompt: "In class",
      resultScore: toDisplay(immutableMetric(latestParentReport?.inClassScore, gradeSummary.inClassScore)),
      resultExplanation: "Teacher-scored in-class work signal.",
      recommendation: "Reinforce in-class practice routines.",
      metric: "In class",
      observedResult: toDisplay(immutableMetric(latestParentReport?.inClassScore, gradeSummary.inClassScore)),
      detail: "Teacher-scored in-class work signal.",
      summary: "Reinforce in-class practice routines.",
      actionNote: "Reinforce in-class practice routines.",
    },
  ]
  const rubricRows = savedRubricRows.length ? savedRubricRows : fallbackRubricRows
  const metrics = {
    homeworkCompletionRate: toDisplay(immutableMetric(latestParentReport?.homeworkCompletionRate, gradeSummary.homeworkCompletionRate)),
    homeworkOnTimeRate: toDisplay(immutableMetric(latestParentReport?.homeworkOnTimeRate, gradeSummary.homeworkOnTimeRate)),
    behaviorScore: toDisplay(immutableMetric(latestParentReport?.behaviorScore, gradeSummary.behaviorScore)),
    participationScore: toDisplay(immutableMetric(latestParentReport?.participationScore, gradeSummary.participationScore)),
    inClassScore: toDisplay(immutableMetric(latestParentReport?.inClassScore, gradeSummary.inClassScore)),
    participationPointsAward: toDisplay(latestParentReport?.participationPointsAward),
    teacherComment: reportComment || "-",
    teacherName: normalizeText(latestMeta.teacherName) || "Teacher",
    lessonSummary: normalizeText(latestMeta.lessonSummary) || "-",
    visionStatus: normalizeText(latestMeta.visionStatus) || "-",
  }

  return {
    identity: {
      controlNumber: identity.studentNumber,
      eaglesId: identity.eaglesId,
      studentNumber: identity.studentNumber,
      fullName: normalizeText(profile.fullName) || normalizeText(profile.englishName),
      englishName: normalizeText(profile.englishName),
      dayDate: currentReportDate,
      reportDate: currentReportDate,
    },
    scope: {
      className: normalizeText(filters.className),
      schoolYear: normalizeText(filters.schoolYear),
      quarter: normalizeText(filters.quarter),
    },
    attendance: {
      total: attendanceSummary.total,
      absences: attendanceSummary.absent,
      tardy: attendanceSummary.late,
      percent: attendanceRate,
      rate: attendanceRate,
    },
    currentHomework: {
      title: currentHomeworkSnapshot.title || "Current assignment",
      subject: currentHomeworkSnapshot.subject || normalizeText(filters.className),
      teacher: currentHomeworkSnapshot.teacher || "Teacher",
      note: currentHomeworkSnapshot.note || "Active assignment details will appear here.",
      assignmentsCount: currentHomeworkSnapshot.assignmentsCount ?? currentHomework.assignmentsCount,
      exercisesCount: currentHomeworkSnapshot.exercisesCount ?? currentHomework.exercisesCount,
      exercises: currentHomeworkSnapshot.exercises.length
        ? currentHomeworkSnapshot.exercises
        : currentHomework.assignments.flatMap((entry) => entry.exercises.length ? entry.exercises : [{ title: entry.title, detail: entry.note, status: entry.status }]),
    },
    pastDueHomework: {
      title: pastDueHomeworkSnapshot.title || "Past due assignment",
      subject: pastDueHomeworkSnapshot.subject || normalizeText(filters.className),
      teacher: pastDueHomeworkSnapshot.teacher || "Teacher",
      note: pastDueHomeworkSnapshot.note || "Outstanding work details will appear here.",
      assignmentsCount: pastDueHomeworkSnapshot.assignmentsCount ?? pastDueHomework.assignmentsCount,
      exercisesCount: pastDueHomeworkSnapshot.exercisesCount ?? pastDueHomework.exercisesCount,
      exercises: pastDueHomeworkSnapshot.exercises.length
        ? pastDueHomeworkSnapshot.exercises
        : pastDueHomework.assignments.flatMap((entry) => entry.exercises.length ? entry.exercises : [{ title: entry.title, detail: entry.note, status: entry.status }]),
    },
    rubric: {
      title: "How to read the rubric",
      note: "Scoring interpretation for the rubric rows below.",
      body: "This template renders the immutable rubric snapshot from the saved report payload. Each row carries the prompt, the score with its explanation, and any recommendation for success.",
      rows: rubricRows,
    },
    metrics,
    parentReview: {
      reviewedBy: parentReviewedBy,
      reviewedAt: parentReviewedAt ? formatDateTime(parentReviewedAt) : "",
    },
    studentReview: {
      reviewedBy: studentReviewedBy,
      reviewedAt: studentReviewedAt ? formatDateTime(studentReviewedAt) : "",
    },
    snapshot: {
      source: latestParentReport ? "saved-parent-report" : "derived-current-records",
      reportId: normalizeText(latestParentReport?.id),
      studentRefId: normalizeText(student?.id),
      capturedAt: snapshotCapturedAt,
      capturedAtDisplay: formatDateTime(snapshotCapturedAt),
      approvedAt: normalizeText(latestParentReport?.approvedAt),
      approvedAtDisplay: formatDateTime(latestParentReport?.approvedAt),
      className: normalizeText(filters.className) || normalizeText(latestParentReport?.className),
      schoolYear: normalizeText(filters.schoolYear) || normalizeText(latestParentReport?.schoolYear),
      quarter: normalizeText(filters.quarter) || normalizeText(latestParentReport?.quarter),
    },
    latestParentReport: latestParentReport
      ? {
          id: normalizeText(latestParentReport.id),
          generatedAt: normalizeText(latestParentReport.generatedAt),
          approvedAt: normalizeText(latestParentReport.approvedAt),
          approvedByUsername: normalizeText(latestParentReport.approvedByUsername),
          homeworkCompletionRate: latestParentReport.homeworkCompletionRate,
          homeworkOnTimeRate: latestParentReport.homeworkOnTimeRate,
          behaviorScore: latestParentReport.behaviorScore,
          participationScore: latestParentReport.participationScore,
          inClassScore: latestParentReport.inClassScore,
          comments: normalizeText(latestParentReport.comments),
          className: normalizeText(latestParentReport.className),
          schoolYear: normalizeText(latestParentReport.schoolYear),
          quarter: normalizeText(latestParentReport.quarter),
          parentReviewedAt,
          parentReviewedByUsername: parentReviewedBy,
          studentReviewedAt,
          studentReviewedByUsername: studentReviewedBy,
        }
      : null,
  }
}

function toDisplay(value) {
  if (value === undefined || value === null || value === "") return "-"
  const text = String(value).trim()
  if (!text) return "-"
  if (/^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(text)) {
    const date = new Date(text)
    if (!Number.isNaN(date.valueOf())) {
      const parts = new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        timeZone: "Asia/Ho_Chi_Minh",
      }).formatToParts(date)
      const pick = (type) => parts.find((part) => part.type === type)?.value || ""
      const day = pick("day")
      const month = pick("month")
      const year = pick("year")
      if (day && month && year) return `${day}/${month}/${year}`
    }
  }
  return text
}

function assertStudentIdentity(student, context = "student") {
  const eaglesId = normalizeText(student?.eaglesId)
  if (!eaglesId) {
    throw new Error(`Data integrity error: eaglesId is required (${context})`)
  }
  const studentNumber = normalizePositiveInteger(student?.studentNumber)
  if (!studentNumber) {
    throw new Error(`Data integrity error: studentNumber is required (${context})`)
  }
  return {
    eaglesId,
    studentNumber,
  }
}

/**
 * @param {StudentReportCardEntity} student
 * @param {ReportCardFilters} [filters]
 * @returns {string}
 */
export function buildReportCardFilename(student, filters = {}) {
  const identity = assertStudentIdentity(student, "report-card filename")
  const studentPart = sanitizeFilePart(`${identity.eaglesId}-${identity.studentNumber}`, "student")
  const classPart = sanitizeFilePart(filters.className, "all-classes")
  const yearPart = sanitizeFilePart(filters.schoolYear, "all-years")
  const quarterPart = sanitizeFilePart(filters.quarter, "all-quarters")
  return `report-card-${studentPart}-${classPart}-${yearPart}-${quarterPart}.pdf`
}

/**
 * @param {StudentReportCardEntity} student
 * @param {ReportCardFilters} [filters]
 * @returns {Promise<Buffer>}
 */
export async function generateStudentReportCardPdf(student, filters = {}) {
  const identity = assertStudentIdentity(student, "report-card PDF")
  const profile = /** @type {Record<string, unknown>} */ (student?.profile || {})
  const selected = selectRecords(student, filters)
  const attendanceSummary = summarizeAttendance(selected.attendanceRecords)
  const gradeSummary = summarizeGrades(selected.gradeRecords)
  const latestParentReport = selected.parentReports[0] || null

  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: "Student Report Card" } })
  const chunks = []

  doc.on("data", (chunk) => chunks.push(chunk))

  const donePromise = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
  })

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f6ad8").text("Student Report Card")
  doc.fillColor("#1b2538")

  let photoBottomY = doc.y
  const photoUrl = normalizeText(profile.photoUrl)
  if (photoUrl) {
    try {
      const photoBuffer = await loadPhotoBuffer(photoUrl)
      if (photoBuffer) {
        const imageX = doc.page.width - doc.page.margins.right - 110
        const imageY = 48
        doc.image(photoBuffer, imageX, imageY, {
          fit: [100, 100],
          align: "center",
          valign: "center",
        })
        photoBottomY = imageY + 104
      }
    } catch (error) {
      void error
    }
  }

  drawSectionTitle(doc, "Student Information")
  printKeyValue(doc, "Eagles ID", toDisplay(identity.eaglesId))
  printKeyValue(doc, "Student Number", toDisplay(identity.studentNumber))
  printKeyValue(doc, "Full Name", toDisplay(profile.fullName))
  printKeyValue(doc, "English Name", toDisplay(profile.englishName))
  printKeyValue(doc, "Date of Birth", toDisplay(profile.dobText))
  printKeyValue(doc, "Level", toDisplay(profile.currentGrade))
  printKeyValue(doc, "School", toDisplay(profile.schoolName))
  printKeyValue(doc, "Student Email", toDisplay(profile.studentEmail || student.email))
  printKeyValue(doc, "Student Phone", toDisplay(profile.studentPhone))

  if (doc.y < photoBottomY) {
    doc.y = photoBottomY
  }

  drawDivider(doc)
  drawSectionTitle(doc, "Parent Contacts")
  printKeyValue(doc, "Mother", `${toDisplay(profile.motherName)} | ${toDisplay(profile.motherPhone)} | Emergency: ${toDisplay(profile.motherEmergencyContact)}`)
  printKeyValue(doc, "Father", `${toDisplay(profile.fatherName)} | ${toDisplay(profile.fatherPhone)} | Emergency: ${toDisplay(profile.fatherEmergencyContact)}`)
  printKeyValue(doc, "Address", `${toDisplay(profile.streetAddress)}, ${toDisplay(profile.wardDistrict)}, ${toDisplay(profile.city)}`)

  drawDivider(doc)
  drawSectionTitle(doc, "Report Scope")
  printKeyValue(doc, "Class", toDisplay(filters.className))
  printKeyValue(doc, "School Year", toDisplay(filters.schoolYear))
  printKeyValue(doc, "Quarter", toDisplay(filters.quarter))

  drawDivider(doc)
  drawSectionTitle(doc, "Attendance Summary")
  printKeyValue(doc, "Total Records", toDisplay(attendanceSummary.total))
  printKeyValue(
    doc,
    "Breakdown",
    `Present: ${attendanceSummary.present}, Absent: ${attendanceSummary.absent}, Late: ${attendanceSummary.late}, Excused: ${attendanceSummary.excused}`
  )

  drawDivider(doc)
  drawSectionTitle(doc, "Grades and Class Performance")
  printKeyValue(doc, "Assignments", toDisplay(gradeSummary.totalAssignments))
  printKeyValue(doc, "Homework Completion %", toDisplay(gradeSummary.homeworkCompletionRate))
  printKeyValue(doc, "Homework On-Time %", toDisplay(gradeSummary.homeworkOnTimeRate))
  printKeyValue(doc, "Average Score %", toDisplay(gradeSummary.averageScore))
  printKeyValue(doc, "Behavior", toDisplay(gradeSummary.behaviorScore))
  printKeyValue(doc, "Participation", toDisplay(gradeSummary.participationScore))
  printKeyValue(doc, "In Class", toDisplay(gradeSummary.inClassScore))

  drawDivider(doc)
  drawSectionTitle(doc, "Recent Assignments")
  if (!selected.gradeRecords.length) {
    doc.font("Helvetica").text("No grade records for the selected scope.")
  } else {
    selected.gradeRecords.slice(0, 12).forEach((entry, index) => {
      const dueDate = formatDate(entry.dueAt)
      const submittedDate = formatDate(entry.submittedAt)
      const scoreText = Number.isFinite(entry.score) && Number.isFinite(entry.maxScore)
        ? `${entry.score}/${entry.maxScore}`
        : "-"
      doc
        .font("Helvetica-Bold")
        .text(`${index + 1}. ${toDisplay(entry.assignmentName)} (${toDisplay(entry.className)})`)
      doc
        .font("Helvetica")
        .text(
          `Due: ${toDisplay(dueDate)} | Submitted: ${toDisplay(submittedDate)} | Score: ${scoreText} | HW: ${toDisplay(entry.homeworkCompleted)} | On time: ${toDisplay(entry.homeworkOnTime)}`
        )
      if (entry.comments) doc.text(`Comment: ${entry.comments}`)
      doc.moveDown(0.2)
    })
  }

  drawDivider(doc)
  drawSectionTitle(doc, "Parent Report Notes")
  if (!latestParentReport) {
    doc.font("Helvetica").text("No parent report record for the selected scope.")
  } else {
    printKeyValue(doc, "Generated", toDisplay(formatDate(latestParentReport.generatedAt)))
    printKeyValue(doc, "Class", toDisplay(latestParentReport.className))
    printKeyValue(doc, "Homework Completion %", toDisplay(latestParentReport.homeworkCompletionRate))
    printKeyValue(doc, "Homework On-Time %", toDisplay(latestParentReport.homeworkOnTimeRate))
    printKeyValue(doc, "Behavior", toDisplay(latestParentReport.behaviorScore))
    printKeyValue(doc, "Participation", toDisplay(latestParentReport.participationScore))
    printKeyValue(doc, "In Class", toDisplay(latestParentReport.inClassScore))
    printKeyValue(doc, "Comments", toDisplay(latestParentReport.comments))
  }

  doc.moveDown(0.8)
  doc.font("Helvetica-Oblique").fontSize(9).fillColor("#5f6d87")
  doc.text(`Generated at ${formatDate(new Date())}`, {
    align: "right",
  })

  doc.end()
  return donePromise
}
