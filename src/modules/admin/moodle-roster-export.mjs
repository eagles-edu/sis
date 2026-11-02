// @ts-check
import * as XLSX from "xlsx"
import { canonicalizeLevel } from "./level-catalog.mjs"

const MOODLE_HEADERS = Object.freeze(["username", "idnumber", "firstname", "lastname", "email"])
const SIS_HEADERS = Object.freeze(["eaglesId", "studentNumber", "englishName", "fullName", "email", "level"])

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim().replace(/\s+/gu, " ")
}

function csvField(value) {
  const field = text(value)
  return /[",\r\n]/u.test(field) ? `"${field.replace(/"/gu, '""')}"` : field
}

/**
 * Build the SIS workbook used either by Moodle's native CSV uploader or the SIS enrolment importer.
 * @param {Array<Record<string, any>>} students
 */
export function buildMoodleRosterExport(students = []) {
  if (!Array.isArray(students) || !students.length) {
    throw Object.assign(new Error("No current students are available for Moodle export"), { statusCode: 409 })
  }

  const errors = []
  const moodleRows = []
  const sisRows = []
  const seenEaglesIds = new Set()
  const seenStudentNumbers = new Set()

  for (let index = 0; index < students.length; index += 1) {
    const student = students[index] || {}
    const profile = student.profile && typeof student.profile === "object" ? student.profile : {}
    const eaglesId = text(student.eaglesId)
    const studentNumber = text(student.studentNumber)
    const englishName = text(profile.englishName)
    const fullName = text(profile.fullName)
    const email = text(profile.studentEmail || student.email).toLowerCase()
    const level = canonicalizeLevel(student.currentEnrollment?.level || profile.currentGrade)
    const missing = []
    if (!eaglesId || eaglesId !== eaglesId.toLowerCase()) missing.push("lowercase eaglesId")
    if (!/^\d+$/u.test(studentNumber)) missing.push("numeric studentNumber")
    if (!englishName) missing.push("englishName")
    if (!fullName) missing.push("fullName")
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) missing.push("valid student email")
    if (!level) missing.push("current SIS level")

    const normalizedEaglesId = eaglesId.toLowerCase()
    if (normalizedEaglesId && seenEaglesIds.has(normalizedEaglesId)) missing.push("unique eaglesId")
    if (studentNumber && seenStudentNumbers.has(studentNumber)) missing.push("unique studentNumber")
    if (missing.length) {
      errors.push({ rowNumber: index + 2, eaglesId: eaglesId || "(blank)", missing })
      continue
    }

    seenEaglesIds.add(normalizedEaglesId)
    seenStudentNumbers.add(studentNumber)
    moodleRows.push([eaglesId, studentNumber, englishName, fullName, email])
    sisRows.push([eaglesId, studentNumber, englishName, fullName, email, level])
  }

  if (errors.length) {
    const issueCounts = new Map()
    for (const row of errors) {
      for (const field of row.missing) issueCounts.set(field, (issueCounts.get(field) || 0) + 1)
    }
    const issueSummary = [...issueCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([field, count]) => `${count} ${field}`)
      .join(", ")
    const affectedLabel = errors.length === 1 ? "current student needs" : "current students need"
    throw Object.assign(new Error(`Moodle roster export blocked: ${errors.length} ${affectedLabel} correction (${issueSummary})`), {
      statusCode: 409,
      details: errors,
    })
  }

  const moodleSheet = XLSX.utils.aoa_to_sheet([MOODLE_HEADERS, ...moodleRows])
  const sisSheet = XLSX.utils.aoa_to_sheet([SIS_HEADERS, ...sisRows])
  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ["Moodle current-student import"],
    ["Moodle 4.5 native Upload users accepts CSV text files, not XLSX workbooks."],
    ["For native upload, save the Moodle CSV sheet as CSV UTF-8, then upload that CSV in Site administration > Users > Upload users."],
    ["Select create-password-if-needed; Moodle generates passwords and its scheduled task emails them. Do not add passwords to this workbook."],
    ["After native upload, upload this XLSX in Site administration > Plugins > Enrolments > SIS roster import to reconcile SIS links and SIS-owned courses/cohorts."],
    ["The SIS Link sheet is for the SIS enrolment importer and is not a Moodle native upload sheet."],
    ["Current SIS level is included in the SIS Link sheet; every imported student is added to Eagles Club."],
  ])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, moodleSheet, "Moodle CSV")
  XLSX.utils.book_append_sheet(workbook, sisSheet, "SIS Link")
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, "Instructions")
  const csv = `${[MOODLE_HEADERS, ...moodleRows].map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`
  return {
    workbook: XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }),
    csv: Buffer.from(csv, "utf8"),
    rowCount: moodleRows.length,
  }
}

