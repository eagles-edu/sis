// server/attendance-summary.mjs

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function parseTardyMinutesFromText(value) {
  const text = normalizeLower(value)
  if (!text) return 0
  const minuteMatch = text.match(/(\d{1,3})\s*\+?\s*(?:m|min|mins|minute|minutes)\b/)
  if (minuteMatch && minuteMatch[1]) return Number.parseInt(minuteMatch[1], 10) || 0
  const numberMatch = text.match(/\b(\d{1,3})\b/)
  if (numberMatch && numberMatch[1]) return Number.parseInt(numberMatch[1], 10) || 0
  return 0
}

function isLateAttendanceStatus(value) {
  const status = normalizeLower(value)
  if (!status) return false
  if (status === "late" || status === "tardy") return true
  return status.startsWith("late") || status.startsWith("tardy")
}

function attendanceTardyMinutesFromRecord(record = {}) {
  const status = normalizeLower(record?.status)
  if (status.includes("30")) return 30
  if (status.includes("10")) return 10

  const parsedMinutes = parseTardyMinutesFromText(record?.comments)
  if (parsedMinutes >= 30) return 30
  if (parsedMinutes >= 10) return 10

  return isLateAttendanceStatus(status) ? 10 : 0
}

export function summarizeAttendanceRows(rows = []) {
  const summary = {
    total: 0,
    present: 0,
    absent: 0,
    late: 0,
    tardy10: 0,
    tardy30: 0,
    excused: 0,
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    summary.total += 1
    const status = normalizeLower(row?.status)

    if (status === "absent") {
      summary.absent += 1
      continue
    }

    if (status === "excused") {
      summary.excused += 1
      continue
    }

    if (isLateAttendanceStatus(status)) {
      summary.present += 1
      summary.late += 1
      const tardyMinutes = attendanceTardyMinutesFromRecord(row)
      if (tardyMinutes >= 30) summary.tardy30 += 1
      else summary.tardy10 += 1
      continue
    }

    summary.present += 1
  }

  return summary
}
