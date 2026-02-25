// server/student-report-card-pdf.mjs

import fs from "node:fs"
import path from "node:path"
import PDFDocument from "pdfkit"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
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
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
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

function selectRecords(student, filters = {}) {
  const className = normalizeText(filters.className)
  const schoolYear = normalizeText(filters.schoolYear)
  const quarter = normalizeText(filters.quarter)

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
    ? student.parentReports.filter(matches)
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
    else if (status === "absent") summary.absent += 1
    else if (status === "late") summary.late += 1
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

function toDisplay(value) {
  if (value === undefined || value === null || value === "") return "-"
  return String(value)
}

export function buildReportCardFilename(student, filters = {}) {
  const studentPart = sanitizeFilePart(student?.studentId || student?.profile?.fullName, "student")
  const classPart = sanitizeFilePart(filters.className, "all-classes")
  const yearPart = sanitizeFilePart(filters.schoolYear, "all-years")
  const quarterPart = sanitizeFilePart(filters.quarter, "all-quarters")
  return `report-card-${studentPart}-${classPart}-${yearPart}-${quarterPart}.pdf`
}

export async function generateStudentReportCardPdf(student, filters = {}) {
  const profile = student?.profile || {}
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
  printKeyValue(doc, "Student ID", toDisplay(student.studentId))
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
