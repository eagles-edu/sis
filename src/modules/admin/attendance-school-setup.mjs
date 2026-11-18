// @ts-check

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const SCHOOL_YEAR_PATTERN = /^\d{4}-\d{4}$/u

function fail(message) {
  throw Object.assign(new Error(message), { statusCode: 422 })
}

function parseIsoDate(value) {
  const text = typeof value === "string" ? value.trim() : ""
  if (!ISO_DATE_PATTERN.test(text)) return null
  const date = new Date(`${text}T00:00:00.000Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== text) return null
  return text
}

function parseAttendanceDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value.toISOString().slice(0, 10)
  }
  const text = typeof value === "string" ? value.trim() : ""
  const datePart = parseIsoDate(text.slice(0, 10))
  if (!datePart) return null
  if (text === datePart) return datePart
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(text)) return null
  const parsed = new Date(text)
  if (Number.isNaN(parsed.valueOf())) return null
  return parsed.toISOString().slice(0, 10)
}

function nextIsoDate(value) {
  const dateText = parseIsoDate(value)
  if (!dateText) return ""
  const date = new Date(`${dateText}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/**
 * Validates that an attendance date and its supplied school context match the
 * authoritative configured school setup.
 *
 * @param {{ schoolYear: string, quarter: string, attendanceDate: string | Date, setup: Record<string, unknown> }} input
 * @returns {{ schoolYear: string, quarter: string, attendanceDate: string }}
 */
export function validateAttendanceSchoolContext(input) {
  const setup = input?.setup && typeof input.setup === "object" ? input.setup : {}
  const configuredSchoolYear = typeof setup.schoolYear === "string" ? setup.schoolYear.trim() : ""
  const startDate = parseIsoDate(setup.startDate)
  const endDate = parseIsoDate(setup.endDate)
  const attendanceDate = parseAttendanceDate(input?.attendanceDate)
  const schoolYear = typeof input?.schoolYear === "string" ? input.schoolYear.trim() : ""
  const quarter = typeof input?.quarter === "string" ? input.quarter.trim().toLowerCase() : ""

  if (
    setup.schoolSetupState !== "ok" ||
    !SCHOOL_YEAR_PATTERN.test(configuredSchoolYear) ||
    !startDate ||
    !endDate ||
    startDate > endDate ||
    configuredSchoolYear !== `${startDate.slice(0, 4)}-${endDate.slice(0, 4)}`
  ) {
    fail("SIS school setup is invalid or incomplete")
  }

  if (!Array.isArray(setup.quarters) || setup.quarters.length !== 4) {
    fail("SIS school setup has invalid quarter boundaries")
  }

  const quarters = []
  for (const [index, entry] of setup.quarters.entries()) {
    const expectedQuarter = `q${index + 1}`
    const quarterName = typeof entry?.quarter === "string" ? entry.quarter.trim().toLowerCase() : ""
    const quarterStart = parseIsoDate(entry?.startDate)
    const quarterEnd = parseIsoDate(entry?.endDate)
    if (quarterName !== expectedQuarter || !quarterStart || !quarterEnd || quarterStart > quarterEnd) {
      fail("SIS school setup has invalid quarter boundaries")
    }
    if (index === 0 && quarterStart !== startDate) {
      fail("SIS Q1 does not match the school-year start date")
    }
    if (index > 0 && quarterStart !== nextIsoDate(quarters[index - 1].endDate)) {
      fail("SIS quarter dates are not sequential")
    }
    quarters.push({ quarter: quarterName, startDate: quarterStart, endDate: quarterEnd })
  }

  if (quarters[3].endDate !== endDate) {
    fail("SIS Q4 does not match the school-year end date")
  }
  if (schoolYear !== configuredSchoolYear) {
    fail("schoolYear does not match configured SIS school year")
  }
  if (!attendanceDate || attendanceDate < startDate || attendanceDate > endDate) {
    fail("attendanceDate is outside configured SIS school-year dates")
  }

  const matches = quarters.filter((entry) => attendanceDate >= entry.startDate && attendanceDate <= entry.endDate)
  if (matches.length !== 1) {
    fail("attendanceDate does not fall within exactly one configured SIS quarter")
  }
  if (quarter !== matches[0].quarter) {
    fail("quarter does not match attendanceDate's configured SIS quarter")
  }

  return { schoolYear, quarter, attendanceDate }
}
