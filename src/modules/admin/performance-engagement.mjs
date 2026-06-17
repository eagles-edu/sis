// @ts-check

import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { isParentReportPortalVisible, mapParentClassReport } from "./parent-reports.mjs"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeDateKey(value = "") {
  const text = normalizeText(value).slice(0, 10)
  if (!text) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const parsed = new Date(text)
  if (Number.isNaN(parsed.valueOf())) return ""
  return parsed.toISOString().slice(0, 10)
}

function formatDayLabel(dateKey = "") {
  const normalized = normalizeDateKey(dateKey)
  if (!normalized) return ""
  const parsed = new Date(`${normalized}T00:00:00+07:00`)
  if (Number.isNaN(parsed.valueOf())) return ""
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(parsed)
}

function uniqueText(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => normalizeLower(value))
        .filter(Boolean),
    ),
  )
}

function isEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeLower(value))
}

function studentRecipientEmails(student = {}) {
  const profile = student?.profile && typeof student.profile === "object" ? student.profile : {}
  return uniqueText([student?.email, profile?.studentEmail]).filter(isEmail)
}

function parentRecipientEmails(student = {}) {
  const profile = student?.profile && typeof student.profile === "object" ? student.profile : {}
  const studentEmails = new Set(studentRecipientEmails(student))
  return uniqueText([profile?.motherEmail, profile?.fatherEmail, profile?.signatureEmail]).filter(
    (email) => isEmail(email) && !studentEmails.has(email),
  )
}

function firstEventTime(events = [], matcher = () => false) {
  const matched = (Array.isArray(events) ? events : []).find((event) => matcher(event))
  return normalizeText(matched?.eventAt) || ""
}

function rowSearchText(row = {}) {
  return [
    row.reviewed,
    row.id,
    row.englishName,
    row.level,
    row.sentOkReturned,
    row.emailOpened,
    row.linkClicked,
    row.pdfDownloaded,
    row.acknowledged,
    row.classDate,
    row.classDay,
    row.className,
    row.reportId,
  ]
    .map((value) => normalizeLower(value))
    .filter(Boolean)
    .join(" ")
}

function buildRoleRow({
  report,
  student,
  events,
  role,
  recipientEmails,
}) {
  const profile = student?.profile && typeof student.profile === "object" ? student.profile : {}
  const reportId = normalizeText(report?.id)
  const classDate = normalizeDateKey(report?.classDate || report?.generatedAt)
  const classDay = normalizeText(report?.classDay) || formatDayLabel(classDate)
  const className = normalizeText(report?.className)
  const level = role === "student" ? normalizeText(report?.level || profile?.currentGrade) : ""
  const englishName =
    role === "student" ? normalizeText(profile?.englishName || profile?.fullName) : ""
  const rowEvents = Array.isArray(events) ? events : []
  const recipientSet = new Set(uniqueText(recipientEmails))
  const emailOpenedAt = firstEventTime(
    rowEvents,
    (event) =>
      normalizeLower(event?.eventType) === "email_opened" &&
      recipientSet.has(normalizeLower(event?.recipientEmail || event?.actorId)),
  )
  const linkClickedAt = firstEventTime(
    rowEvents,
    (event) =>
      normalizeLower(event?.eventType) === "report_link_clicked" &&
      normalizeLower(event?.actorType) === role,
  )
  const pdfDownloadedAt = firstEventTime(
    rowEvents,
    (event) =>
      normalizeLower(event?.eventType) === "pdf_downloaded" &&
      normalizeLower(event?.actorType) === role,
  )
  const acknowledgedAt = firstEventTime(
    rowEvents,
    (event) =>
      (role === "student"
        ? normalizeLower(event?.eventType) === "student_review_acknowledged"
        : normalizeLower(event?.eventType) === "parent_review_acknowledged") &&
      normalizeLower(event?.actorType) === role,
  )
  const sentOkReturned = Boolean(report?.notificationSentAt) ||
    normalizeLower(report?.workflowState) === "notification_sent" ||
    normalizeLower(report?.workflowState) === "notification_queued"
      ? "yes"
      : "no"

  const row = {
    reviewed: role,
    id: role === "student" ? normalizeText(student?.eaglesId) : normalizeText(profile?.parentsId),
    englishName,
    level,
    sentOkReturned,
    emailOpened: emailOpenedAt ? "yes" : "",
    linkClicked: linkClickedAt ? "yes" : "",
    pdfDownloaded: pdfDownloadedAt ? "yes" : "",
    acknowledged: acknowledgedAt ? "yes" : "",
    emailOpenedAt,
    linkClickedAt,
    pdfDownloadedAt,
    acknowledgedAt,
    classDate,
    classDay,
    className,
    reportId,
    reportDate: normalizeText(report?.generatedAt),
    workflowState: normalizeText(report?.workflowState),
    studentRefId: normalizeText(student?.id),
    parentIds: uniqueText([profile?.parentsId]),
    searchText: "",
  }

  row.searchText = rowSearchText(row)
  return row
}

function compareText(left = "", right = "") {
  return normalizeText(left).localeCompare(normalizeText(right), undefined, {
    sensitivity: "base",
  })
}

function compareRows(left = {}, right = {}) {
  const dayCompare = compareText(right.classDate, left.classDate)
  if (dayCompare) return dayCompare
  const classCompare = compareText(left.className, right.className)
  if (classCompare) return classCompare
  const nameCompare = compareText(left.englishName || left.id, right.englishName || right.id)
  if (nameCompare) return nameCompare
  const reportCompare = compareText(left.reportId, right.reportId)
  if (reportCompare) return reportCompare
  if (left.reviewed === right.reviewed) return 0
  return left.reviewed === "parent" ? -1 : 1
}

export async function listPerformanceEngagementData({
  dateFrom = "",
  dateTo = "",
} = {}) {
  const prisma = await getSharedPrismaClient()
  const reports = await prisma.parentClassReport.findMany({
    include: {
      student: {
        select: {
          id: true,
          eaglesId: true,
          studentNumber: true,
          email: true,
          profile: true,
        },
      },
    },
    orderBy: [{ generatedAt: "desc" }, { updatedAt: "desc" }],
  })

  const mappedReports = reports
    .map((report) => mapParentClassReport(report))
    .filter((report) => isParentReportPortalVisible(report))
    .filter((report) => {
      const classDate = normalizeDateKey(report?.classDate || report?.generatedAt)
      if (dateFrom && classDate && compareText(classDate, normalizeDateKey(dateFrom)) < 0) return false
      if (dateTo && classDate && compareText(classDate, normalizeDateKey(dateTo)) > 0) return false
      return true
    })

  const reportIds = mappedReports.map((report) => normalizeText(report?.id)).filter(Boolean)
  const events = reportIds.length
    ? await prisma.parentClassReportEvent.findMany({
        where: { reportId: { in: reportIds } },
        orderBy: [{ eventAt: "asc" }],
      })
    : []

  const eventsByReportId = new Map()
  events.forEach((event) => {
    const id = normalizeText(event?.reportId)
    if (!id) return
    const bucket = eventsByReportId.get(id) || []
    bucket.push(event)
    eventsByReportId.set(id, bucket)
  })

  const rows = []
  const days = new Map()

  mappedReports.forEach((report) => {
    const student = report?.student && typeof report.student === "object" ? report.student : {}
    const reportEvents = eventsByReportId.get(normalizeText(report?.id)) || []
    const classDate = normalizeDateKey(report?.classDate || report?.generatedAt)
    const classDay = normalizeText(report?.classDay) || formatDayLabel(classDate)
    const className = normalizeText(report?.className)
    const studentEmails = studentRecipientEmails(student)
    const parentEmails = parentRecipientEmails(student)
    const parentRow = buildRoleRow({
      report,
      student,
      events: reportEvents,
      role: "parent",
      recipientEmails: parentEmails,
    })
    const studentRow = buildRoleRow({
      report,
      student,
      events: reportEvents,
      role: "student",
      recipientEmails: studentEmails,
    })
    ;[parentRow, studentRow].forEach((row) => {
      rows.push(row)
      const dayKey = row.classDate || "unknown"
      const day = days.get(dayKey) || {
        dayKey,
        classDate: row.classDate,
        classDay: row.classDay,
        classNames: new Set(),
        reportIds: new Set(),
        rowCount: 0,
        sentCount: 0,
        openCount: 0,
        clickCount: 0,
        downloadCount: 0,
        acknowledgedCount: 0,
      }
      day.classNames.add(className)
      day.reportIds.add(normalizeText(report?.id))
      day.rowCount += 1
      if (row.sentOkReturned === "yes") day.sentCount += 1
      if (row.emailOpenedAt) day.openCount += 1
      if (row.linkClickedAt) day.clickCount += 1
      if (row.pdfDownloadedAt) day.downloadCount += 1
      if (row.acknowledgedAt) day.acknowledgedCount += 1
      days.set(dayKey, day)
    })
  })

  rows.sort(compareRows)

  const dayRows = Array.from(days.values())
    .map((day) => ({
      dayKey: day.dayKey,
      classDate: day.classDate,
      classDay: day.classDay,
      classNames: Array.from(day.classNames).filter(Boolean).sort((left, right) => compareText(left, right)),
      reportCount: day.reportIds.size,
      rowCount: day.rowCount,
      sentCount: day.sentCount,
      openCount: day.openCount,
      clickCount: day.clickCount,
      downloadCount: day.downloadCount,
      acknowledgedCount: day.acknowledgedCount,
    }))
    .sort((left, right) => compareText(right.classDate, left.classDate))

  return {
    generatedAt: new Date().toISOString(),
    totalReports: mappedReports.length,
    totalRows: rows.length,
    days: dayRows,
    rows,
  }
}
