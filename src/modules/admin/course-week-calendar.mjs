// @ts-check

const COURSE_WEEK_COUNT = 52
const MS_PER_DAY = 24 * 60 * 60 * 1000

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function isoDate(value = "") {
  const text = normalizeText(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/u.test(text) ? text : ""
}

function parseIsoDate(value = "") {
  const text = isoDate(value)
  if (!text) return null
  const parsed = new Date(`${text}T00:00:00Z`)
  return Number.isNaN(parsed.valueOf()) ? null : parsed
}

function dateOffset(value = "", days = 0) {
  const parsed = parseIsoDate(value)
  if (!parsed || !Number.isInteger(days)) return ""
  return new Date(parsed.getTime() + days * MS_PER_DAY).toISOString().slice(0, 10)
}

function isSaturday(value = "") {
  const parsed = parseIsoDate(value)
  return Boolean(parsed && parsed.getUTCDay() === 6)
}

function normalizeWeekEntry(entry = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
  const weekNumber = Number.parseInt(String(entry.weekNumber || ""), 10)
  const saturday = isoDate(entry.saturday)
  const sunday = isoDate(entry.sunday)
  const startDate = isoDate(entry.startDate || saturday)
  const endDate = isoDate(entry.endDate || dateOffset(saturday, 6))
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > COURSE_WEEK_COUNT) return null
  if (!saturday || !sunday || !startDate || !endDate) return null
  return { weekNumber, saturday, sunday, startDate, endDate }
}

export function generateCourseWeekCalendar({
  schoolYear = "",
  q1StartDate = "",
  q1EndDate = "",
} = {}) {
  const normalizedSchoolYear = normalizeText(schoolYear)
  const anchor = isoDate(q1StartDate)
  const endDate = isoDate(q1EndDate)
  if (!normalizedSchoolYear || !anchor || !endDate || !isSaturday(anchor)) return null
  const weeks = Array.from({ length: COURSE_WEEK_COUNT }, (_, index) => {
    const saturday = dateOffset(anchor, index * 7)
    return {
      weekNumber: index + 1,
      saturday,
      sunday: dateOffset(saturday, 1),
      startDate: saturday,
      endDate: dateOffset(saturday, 6),
    }
  })
  return {
    schoolYear: normalizedSchoolYear,
    q1StartDate: anchor,
    q1EndDate: endDate,
    generatedAt: new Date().toISOString(),
    weeks,
  }
}

export function normalizeCourseWeekCalendar(calendar = {}) {
  if (!calendar || typeof calendar !== "object" || Array.isArray(calendar)) return null
  const schoolYear = normalizeText(calendar.schoolYear)
  const q1StartDate = isoDate(calendar.q1StartDate)
  const q1EndDate = isoDate(calendar.q1EndDate)
  const weeks = (Array.isArray(calendar.weeks) ? calendar.weeks : [])
    .map((entry) => normalizeWeekEntry(entry))
    .filter(Boolean)
  if (!schoolYear || !q1StartDate || !q1EndDate || weeks.length !== COURSE_WEEK_COUNT) return null
  const complete = weeks.every((entry, index) => {
    const expectedSaturday = dateOffset(q1StartDate, index * 7)
    return entry.weekNumber === index + 1 && entry.saturday === expectedSaturday
  })
  if (!complete) return null
  return { schoolYear, q1StartDate, q1EndDate, generatedAt: normalizeText(calendar.generatedAt), weeks }
}

export function courseWeekCalendarForSchoolYear(calendars = [], schoolYear = "") {
  const target = normalizeText(schoolYear)
  return (Array.isArray(calendars) ? calendars : [])
    .map((calendar) => normalizeCourseWeekCalendar(calendar))
    .find((calendar) => calendar && (!target || calendar.schoolYear === target)) || null
}

export function courseWeekForDate(value = "", calendar = null) {
  const date = isoDate(value)
  const normalized = normalizeCourseWeekCalendar(calendar)
  if (!date || !normalized) return null
  return normalized.weeks.find((week) => week.startDate <= date && date <= week.endDate) || null
}

export function courseWeekNumberForDate(value = "", calendars = [], schoolYear = "") {
  const calendar = courseWeekCalendarForSchoolYear(calendars, schoolYear)
  return courseWeekForDate(value, calendar)?.weekNumber || null
}

export function courseWeekNumberForSchoolSetupDate(value = "", schoolYear = "", schoolSetup = {}) {
  return courseWeekNumberForDate(
    value,
    schoolSetup?.courseWeekCalendars,
    schoolYear,
  )
}

export { COURSE_WEEK_COUNT }
