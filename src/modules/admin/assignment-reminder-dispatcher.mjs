// @ts-check

import crypto from "node:crypto"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import {
  getWeeklyMinimumReportsSync,
} from "./sis-config-store.mjs"
import {
  queueAnnouncementEmail,
  sendAllQueuedAnnouncements,
} from "./notification-queue.mjs"
import { parentProctorEmails, studentProctorSelectionIsExplicit } from "./proctor-recipient-routing.mjs"

const FIXED_OFFSET_MS = 7 * 60 * 60 * 1000
const WEDNESDAY_START_MINUTE = 9 * 60
const WEDNESDAY_END_MINUTE = 16 * 60
export const NEWS_MMR_LEVELS = Object.freeze(["A2 Flyers", "A2 KET", "B1 PET"])

function text(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function lower(value) {
  return text(value).toLowerCase()
}

function email(value) {
  const normalized = lower(value)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : ""
}

function fixedDate(value = new Date()) {
  const date = value instanceof Date ? new Date(value.valueOf()) : new Date(value)
  return Number.isNaN(date.valueOf()) ? new Date() : date
}

function shifted(value = new Date()) {
  return new Date(fixedDate(value).valueOf() + FIXED_OFFSET_MS)
}

function localDateKey(value = new Date()) {
  return shifted(value).toISOString().slice(0, 10)
}

function localDay(value = new Date()) {
  return shifted(value).getUTCDay()
}

function localMinute(value = new Date()) {
  const date = shifted(value)
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

function startOfLocalWeek(value = new Date()) {
  const date = shifted(value)
  const day = date.getUTCDay()
  date.setUTCDate(date.getUTCDate() - ((day + 6) % 7))
  date.setUTCHours(0, 0, 0, 0)
  return new Date(date.valueOf() - FIXED_OFFSET_MS)
}

function endOfLocalSunday(value = new Date()) {
  const start = startOfLocalWeek(value)
  return new Date(start.valueOf() + 7 * 24 * 60 * 60 * 1000 - 1)
}

function parseDate(value) {
  const parsed = new Date(text(value))
  return Number.isNaN(parsed.valueOf()) ? null : parsed
}

function levelKey(value) {
  return lower(value).replace(/[^a-z0-9]+/g, "-")
}

function stableHash(value) {
  return crypto.createHash("sha256").update(text(value)).digest().readUInt32BE(0)
}

function stableReminderToken(dispatchKey) {
  return crypto.createHash("sha256").update(text(dispatchKey)).digest("hex")
}

function stableReminderQueueId(dispatchKey) {
  return `assignment-reminder-${crypto.createHash("sha256").update(text(dispatchKey)).digest("hex").slice(0, 40)}`
}

/**
 * Wednesday reminders use a stable weekly slot per class. This is operationally
 * random-looking while remaining deterministic across retries and restarts.
 * @param {string} level
 * @param {Date} now
 * @returns {number}
 */
export function wednesdayBusinessSlotMinute(level, now = new Date()) {
  const week = localDateKey(startOfLocalWeek(now))
  const range = WEDNESDAY_END_MINUTE - WEDNESDAY_START_MINUTE
  return WEDNESDAY_START_MINUTE + (stableHash(`${week}:${levelKey(level)}`) % (range + 1))
}

function appendTrackingToken(url, token) {
  const target = text(url)
  if (!target || !token) return target
  try {
    const parsed = new URL(target)
    parsed.searchParams.set("reminderToken", token)
    return parsed.toString()
  } catch {
    return target
  }
}

function reminderTrackingOrigin() {
  return (text(process.env.STUDENT_ADMIN_PUBLIC_ORIGIN || process.env.PUBLIC_APP_ORIGIN || process.env.APP_ORIGIN || process.env.EXERCISE_MAILER_ORIGIN || "https://eagles.edu.vn")).replace(/\/+$/, "")
}

function buildTrackedActionUrl(url, token) {
  const actionUrl = text(url)
  if (!actionUrl || !token) return actionUrl
  return `${reminderTrackingOrigin()}/api/assignment-reminders/track/click/${encodeURIComponent(token)}`
}

/**
 * @param {{ completed: boolean, assignmentTitle: string, dueAt: string, level: string, studentName: string, actionUrl: string, audience: string, mmr?: { completed: number, required: number, remaining: number, daysRemaining: number, warning: boolean } }} input
 * @returns {string}
 */
export function buildAssignmentReminderMessage(input) {
  const status = input.completed ? "Trạng thái: đã hoàn thành." : "Trạng thái: chưa hoàn thành."
  const lines = [
    `Bài tập: ${input.assignmentTitle}`,
    `Lớp: ${input.level}`,
    `Hạn hoàn thành: ${input.dueAt || "theo ngày đã thông báo"} (giờ Việt Nam)`,
    status,
    `Mở bài tập: ${input.actionUrl}`,
  ]
  if (input.mmr) {
    lines.push(
      "",
      `MMR bài tin tức của lớp ${input.level}: đã hoàn thành ${input.mmr.completed}/${input.mmr.required} bài trong tuần này.`,
      `Còn ${input.mmr.remaining} bài cần hoàn thành trước 23:59:59 Chủ nhật theo giờ Việt Nam.`,
    )
    if (input.mmr.warning) {
      lines.push("Lưu ý: số bài còn lại nhiều hơn số ngày còn lại đến Chủ nhật.")
    }
  }
  lines.push("", "Đây là thông báo nhắc việc. Vui lòng liên hệ nhà trường nếu liên kết bài tập hoặc thông tin tài khoản chưa chính xác.")
  return lines.join("\n")
}

function assignmentCompleted(studentId, templateId, grades) {
  return grades.some((grade) => {
    if (text(grade.studentRefId) !== text(studentId)) return false
    const bundle = grade.assignmentBundleJson && typeof grade.assignmentBundleJson === "object"
      ? grade.assignmentBundleJson
      : {}
    return text(bundle.assignmentTemplateId) === text(templateId)
  })
}

function mmrMetrics(reports, now = new Date()) {
  const required = Math.max(1, getWeeklyMinimumReportsSync())
  const completed = reports.length
  const remaining = Math.max(0, required - completed)
  const day = localDay(now)
  const daysRemaining = Math.max(0, 7 - day)
  return {
    completed,
    required,
    remaining,
    daysRemaining,
    warning: daysRemaining < remaining,
  }
}

function isUniqueError(error) {
  return text(error?.code).toUpperCase() === "P2002"
}

async function claimDispatch(prisma, dispatchKey, data) {
  const existing = await prisma.assignmentReminderDispatch.findUnique({ where: { dispatchKey } })
  if (existing && ["pending", "queued", "sent"].includes(lower(existing.status))) return null
  if (existing) {
    return prisma.assignmentReminderDispatch.update({
      where: { id: existing.id },
      data: { ...data, status: "pending", lastError: null },
    })
  }
  try {
    return await prisma.assignmentReminderDispatch.create({ data: { dispatchKey, ...data, status: "pending" } })
  } catch (error) {
    if (!isUniqueError(error)) throw error
    return null
  }
}

async function queueOneReminder({ prisma, template, student, audience, kind, now, mmr, dryRun, recipientOverride = "" }) {
  const studentId = text(student.id)
  const localDate = localDateKey(now)
  const recipient = audience === "student"
    ? email(student.email || student.profile?.studentEmail)
    : email(recipientOverride || student.parentEmail)
  if (!recipient) return { skipped: true, reason: `missing-${audience}-email` }
  const dispatchKey = [text(template.id), studentId, audience, kind, localDate, recipient].join(":")

  const actionUrl = text(template.itemsJson?.[0]?.url || template.assignmentBundleJson?.items?.[0]?.url)
  const token = stableReminderToken(dispatchKey)
  const queueId = stableReminderQueueId(dispatchKey)
  if (dryRun) return { dryRun: true, dispatchKey, audience, recipient }

  const dispatch = await claimDispatch(prisma, dispatchKey, {
    assignmentTemplateId: text(template.id),
    studentRefId: studentId,
    reminderKind: kind,
    localDate,
    audience,
  })
  if (!dispatch) return { skipped: true, reason: "already-dispatched" }

  const trackedActionUrl = buildTrackedActionUrl(actionUrl, token)
  const message = buildAssignmentReminderMessage({
    completed: student.completed,
    assignmentTitle: text(template.assignmentTitle),
    dueAt: text(template.dueAt),
    level: text(template.level),
    studentName: audience === "parent" ? text(student.englishName || student.fullName) : text(student.englishName || student.fullName),
    actionUrl: trackedActionUrl,
    audience,
    mmr,
  })
  try {
    const queued = await queueAnnouncementEmail({
      deliveryMode: "weekend-batch",
      queueType: "announcement",
      assignmentTitle: text(template.assignmentTitle),
      exerciseTitle: text(template.exerciseTitle),
      dueAt: text(template.dueAt),
      level: text(template.level),
      message,
      recipients: [recipient],
      reminderDispatchKey: dispatchKey,
      reminderEngagementToken: token,
      queueId,
      requestOrigin: reminderTrackingOrigin(),
      assignmentTemplateId: text(template.id),
      studentRefId: studentId,
    }, { queuedByUsername: "assignment-reminder-dispatcher" })
    const engagement = await prisma.assignmentReminderEngagement.upsert({
      where: { dispatchId_audience_recipientEmail: { dispatchId: dispatch.id, audience, recipientEmail: recipient } },
      update: { trackingToken: token, actionUrl, metadataJson: { assignmentTemplateId: template.id, reminderKind: kind, level: template.level } },
      create: { dispatchId: dispatch.id, audience, recipientEmail: recipient, trackingToken: token, actionUrl, metadataJson: { assignmentTemplateId: template.id, reminderKind: kind, level: template.level } },
    })
    await prisma.assignmentReminderDispatch.update({
      where: { id: dispatch.id },
      data: { status: "queued", queueId: queued.queueId },
    })
    return { queued: true, queueId: queued.queueId, engagementId: engagement.id, audience, recipient }
  } catch (error) {
    await prisma.assignmentReminderDispatch.update({
      where: { id: dispatch.id },
      data: { status: "failed", lastError: text(error?.message || error).slice(0, 500) },
    })
    throw error
  }
}

function reminderKinds(now) {
  const kinds = []
  const day = localDay(now)
  const minute = localMinute(now)
  if (day === 3) kinds.push("wednesday")
  if (day === 5 && minute >= 18 * 60) kinds.push("friday")
  if (day >= 1 && day <= 6 && minute >= 18 * 60) kinds.push("mmr-daily")
  if (day === 0 && minute >= 18 * 60) kinds.push("mmr-daily")
  return kinds
}

function kindIsDue(kind, level, now) {
  const minute = localMinute(now)
  if (kind === "wednesday") return minute >= wednesdayBusinessSlotMinute(level, now)
  return true
}

/**
 * Run the scheduled assignment reminder pass. It is safe to call repeatedly.
 * @param {{ now?: Date, dryRun?: boolean }} [options]
 */
export async function runAssignmentReminderDispatcher(options = {}) {
  const now = fixedDate(options.now || new Date())
  const assignmentCreatedTemplateId = text(options.assignmentCreatedTemplateId)
  const kinds = assignmentCreatedTemplateId ? ["assignment-created"] : reminderKinds(now)
  if (!kinds.length) return { ok: true, dispatched: 0, skipped: 0, reason: "outside-schedule" }
  const prisma = await getSharedPrismaClient()
  const templates = await prisma.assignmentTemplate.findMany({
    where: { level: { not: null }, ...(assignmentCreatedTemplateId ? { id: assignmentCreatedTemplateId } : {}) },
    orderBy: { updatedAt: "desc" },
  })
  const students = await prisma.student.findMany({
    where: { profile: { is: { currentGrade: { not: null } } } },
    select: {
      id: true, eaglesId: true, email: true,
      profile: { select: { fullName: true, englishName: true, currentGrade: true, studentEmail: true, parentsId: true, motherEmail: true, maIsHomeworkProctor: true, fatherEmail: true, baIsHomeworkProctor: true, rawFormPayload: true } },
      parentPortalLinks: { select: { parentAccount: { select: { parentsId: true, email: true, status: true } } } },
    },
  })
  const ids = students.map((student) => student.id)
  const grades = await prisma.studentGradeRecord.findMany({ where: { studentRefId: { in: ids } }, select: { studentRefId: true, assignmentBundleJson: true } })
  const weekStart = startOfLocalWeek(now)
  const weekEnd = endOfLocalSunday(now)
  const mmrStudents = students.filter((student) => NEWS_MMR_LEVELS.some((level) => lower(student.profile?.currentGrade) === lower(level)))
  const reports = mmrStudents.length
    ? await prisma.studentNewsReport.findMany({ where: { studentRefId: { in: mmrStudents.map((student) => student.id) }, reportDate: { gte: weekStart, lte: weekEnd }, mmrPassedAt: { not: null } }, select: { studentRefId: true } })
    : []
  const reportsByStudent = new Map()
  reports.forEach((report) => reportsByStudent.set(report.studentRefId, (reportsByStudent.get(report.studentRefId) || 0) + 1))
  const queueIds = []
  let dispatched = 0
  let skipped = 0
  for (const template of templates) {
    const assignedAt = parseDate(template.assignedAt)
    const dueAt = parseDate(template.dueAt)
    if (!assignmentCreatedTemplateId && assignedAt && now < assignedAt) continue
    if (!assignmentCreatedTemplateId && dueAt && now > dueAt) continue
    const levelStudents = students.filter((student) => lower(student.profile?.currentGrade) === lower(template.level))
    for (const baseStudent of levelStudents) {
      const completed = assignmentCompleted(baseStudent.id, template.id, grades)
      const hasNewsMmr = NEWS_MMR_LEVELS.some((level) => lower(template.level) === lower(level))
      const mmr = hasNewsMmr ? mmrMetrics(Array(reportsByStudent.get(baseStudent.id) || 0).fill({}), now) : undefined
      const profileParentEmails = parentProctorEmails(baseStudent.profile || {})
      const linkedParentEmails = (baseStudent.parentPortalLinks || [])
        .filter((link) => lower(link.parentAccount?.status) === "active")
        .map((link) => email(link.parentAccount?.email))
        .filter(Boolean)
      const parentEmails = studentProctorSelectionIsExplicit(baseStudent.profile || {})
        ? linkedParentEmails.filter((address) => profileParentEmails.includes(address))
        : Array.from(new Set([...linkedParentEmails, ...profileParentEmails]))
      const student = {
        ...baseStudent,
        completed,
        parentEmails,
        englishName: baseStudent.profile?.englishName,
        fullName: baseStudent.profile?.fullName,
      }
      for (const kind of kinds) {
        if (!kindIsDue(kind, text(template.level), now)) continue
        if (kind === "friday" && completed) continue
        if (kind === "mmr-daily" && (!hasNewsMmr || !mmr?.remaining || mmr.daysRemaining > mmr.remaining)) continue
        const audiences = ["student"]
        if (kind !== "mmr-daily" || mmr?.warning) audiences.push("parent")
        for (const audience of audiences) {
          const recipients = audience === "parent" ? student.parentEmails : [""]
          for (const recipientOverride of recipients) {
            try {
              const result = await queueOneReminder({ prisma, template, student, audience, kind, now, mmr, dryRun: options.dryRun === true, recipientOverride })
              if (result.queued) { dispatched += 1; if (result.queueId) queueIds.push(result.queueId) }
              else skipped += 1
            } catch (error) {
              skipped += 1
              console.error("assignment reminder dispatch failed", { templateId: template.id, studentRefId: student.id, audience, recipientOverride, error: text(error?.message || error) })
            }
          }
        }
      }
    }
  }
  if (!options.dryRun && queueIds.length) await sendAllQueuedAnnouncements({ queueType: "announcement", queueIds, reviewedByUsername: "assignment-reminder-dispatcher" })
  return { ok: true, dispatched, skipped, queueIds, kinds, localDate: localDateKey(now) }
}

export async function dispatchAssignmentCreated(assignmentTemplateId, options = {}) {
  return runAssignmentReminderDispatcher({
    ...options,
    assignmentCreatedTemplateId: text(assignmentTemplateId),
  })
}

/** @param {string} queueId @param {boolean} [sent] */
export async function markAssignmentReminderEngagementSent(queueId, sent = true) {
  const id = text(queueId)
  if (!id) return null
  const prisma = await getSharedPrismaClient().catch(() => null)
  if (!prisma?.assignmentReminderEngagement) return null
  const queue = await prisma.adminNotificationQueue.findUnique({ where: { id }, select: { payloadJson: true } })
  const payload = queue?.payloadJson && typeof queue.payloadJson === "object" ? queue.payloadJson : {}
  const token = text(payload.reminderEngagementToken)
  if (!token) return null
  return prisma.assignmentReminderEngagement.updateMany({
    where: { trackingToken: token },
    data: sent ? { sentAt: new Date() } : {},
  })
}
