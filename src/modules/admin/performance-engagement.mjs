// @ts-check

import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { isParentReportPortalVisible, mapParentClassReport } from "./parent-reports.mjs"
import { parentProctorEmails } from "./proctor-recipient-routing.mjs"
import { courseWeekNumberForSchoolSetupDate } from "./course-week-calendar.mjs"
import { getSisConfigSnapshotSync } from "./sis-config-store.mjs"

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
  return new Intl.DateTimeFormat("vi-VN", {
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
  return uniqueText([...parentProctorEmails(profile), profile?.signatureEmail]).filter(
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
    row.emailUsed,
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
  brevoDeliveries = [],
}) {
  const profile = student?.profile && typeof student.profile === "object" ? student.profile : {}
  const reportId = normalizeText(report?.id)
  const classDate = normalizeDateKey(report?.classDate || report?.generatedAt)
  const setup = getSisConfigSnapshotSync()?.uiSettings?.schoolSetup || {}
  const weekNumber = Number.isInteger(Number(report?.weekNumber))
    ? Number(report.weekNumber)
    : courseWeekNumberForSchoolSetupDate(
        classDate,
        normalizeText(report?.schoolYear || setup?.schoolYear),
        setup,
      )
  const classDay = normalizeText(report?.classDay) || formatDayLabel(classDate)
  const className = normalizeText(report?.className)
  const level = role === "student" ? normalizeText(report?.level || profile?.currentGrade) : ""
  const englishName =
    role === "student" ? normalizeText(profile?.englishName || profile?.fullName) : ""
  const rowEvents = Array.isArray(events) ? events : []
  const recipientSet = new Set(uniqueText(recipientEmails))
  const recipientDeliveries = (Array.isArray(brevoDeliveries) ? brevoDeliveries : [])
    .filter((delivery) => recipientSet.has(normalizeLower(delivery?.recipientEmail)))
  const firstDeliveryTime = (field) => {
    const delivery = recipientDeliveries.find((entry) => entry?.[field])
    return delivery?.[field] ? new Date(delivery[field]).toISOString() : ""
  }
  const emailSentAt = firstDeliveryTime("sentAt")
  const emailDeliveredAt = firstDeliveryTime("deliveredAt")
  const emailProxyAt = firstDeliveryTime("proxyLoadedAt")
  const emailFirstAt = firstDeliveryTime("firstOpenedAt")
  const emailUniqueAt = firstDeliveryTime("uniqueOpenedAt")
  const brevoOpenedAt = firstDeliveryTime("openedAt")
  const brevoClickedAt = firstDeliveryTime("clickedAt")
  const emailDeferredAt = firstDeliveryTime("deferredAt")
  const emailErrorAt = firstDeliveryTime("errorAt")
  const emailInvalidAt = firstDeliveryTime("invalidAt")
  const emailSoftBouncedAt = firstDeliveryTime("softBouncedAt")
  const emailHardBouncedAt = firstDeliveryTime("hardBouncedAt") || firstDeliveryTime("bouncedAt")
  const emailBlockedAt = firstDeliveryTime("blockedAt")
  const emailComplainedAt = firstDeliveryTime("complainedAt")
  const emailUnsubscribedAt = firstDeliveryTime("unsubscribedAt")
  const localEmailOpenedAt = firstEventTime(
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
    familyId: normalizeText(profile?.familyId || profile?.parentsId),
    emailUsed: normalizeText(recipientEmails?.[0]),
    batchId: normalizeText(recipientDeliveries[0]?.batchId),
    queueType: normalizeText(recipientDeliveries[0]?.queueType),
    providerMessageId: normalizeText(recipientDeliveries[0]?.providerMessageId),
    englishName,
    level,
    sentOkReturned,
    emailQueued: recipientDeliveries.length ? "yes" : "",
    emailQueuedAt: firstDeliveryTime("queuedAt"),
    emailSent: emailSentAt ? "yes" : (sentOkReturned === "yes" ? "yes" : ""),
    emailDelivered: emailDeliveredAt ? "yes" : "",
    emailProxy: emailProxyAt ? "yes" : "",
    emailFirst: emailFirstAt ? "yes" : "",
    emailUnique: emailUniqueAt ? "yes" : "",
    emailOpened: brevoOpenedAt || localEmailOpenedAt ? "yes" : "",
    emailClicked: brevoClickedAt ? "yes" : "",
    emailDeferred: emailDeferredAt ? "yes" : "",
    emailError: emailErrorAt ? "yes" : "",
    emailInvalid: emailInvalidAt ? "yes" : "",
    emailBlocked: emailBlockedAt ? "yes" : "",
    emailSoft: emailSoftBouncedAt ? "yes" : "",
    emailHard: emailHardBouncedAt ? "yes" : "",
    emailComplained: emailComplainedAt ? "yes" : "",
    emailUnsubscribed: emailUnsubscribedAt ? "yes" : "",
    emailSentAt,
    emailDeliveredAt,
    emailProxyAt,
    emailFirstAt,
    emailUniqueAt,
    emailOpenedAt: brevoOpenedAt || localEmailOpenedAt,
    emailClickedAt: brevoClickedAt,
    emailDeferredAt,
    emailErrorAt,
    emailInvalidAt,
    emailBlockedAt,
    emailSoftAt: emailSoftBouncedAt,
    emailHardAt: emailHardBouncedAt,
    emailComplainedAt,
    emailUnsubscribedAt,
    linkClicked: linkClickedAt ? "yes" : "",
    pdfDownloaded: pdfDownloadedAt ? "yes" : "",
    acknowledged: acknowledgedAt ? "yes" : "",
    linkClickedAt,
    pdfDownloadedAt,
    acknowledgedAt,
    classDate,
    weekNumber,
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
      brevoDeliveries: {
        include: { webhookEvents: true },
        orderBy: { sentAt: "asc" },
      },
    },
    orderBy: [{ generatedAt: "desc" }, { updatedAt: "desc" }],
  })

  const mappedReports = reports
    .map((report) => ({
      ...mapParentClassReport(report),
      brevoDeliveries: report.brevoDeliveries,
    }))
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
    const brevoDeliveries = Array.isArray(report?.brevoDeliveries) ? report.brevoDeliveries : []
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
      brevoDeliveries,
    })
    const studentRow = buildRoleRow({
      report,
      student,
      events: reportEvents,
      role: "student",
      recipientEmails: studentEmails,
      brevoDeliveries,
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
