function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function isEmailLike(value) {
  const text = normalizeText(value)
  if (!text) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
}

function normalizeRecipientList(value) {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((entry) => normalizeLower(entry))
        .filter((entry) => isEmailLike(entry))
    )
  )
}

function resolveBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return fallback
    if (["true", "1", "yes"].includes(normalized)) return true
    if (["false", "0", "no"].includes(normalized)) return false
  }
  return fallback
}

function resolveSmtpAuthMode(value) {
  const mode = normalizeLower(value)
  if (!mode) return ""
  if (
    mode === "none" ||
    mode === "off" ||
    mode === "disabled" ||
    mode === "false" ||
    mode === "no" ||
    mode === "relay"
  ) {
    return "none"
  }
  if (
    mode === "auth" ||
    mode === "on" ||
    mode === "enabled" ||
    mode === "true" ||
    mode === "yes" ||
    mode === "login"
  ) {
    return "auth"
  }
  return ""
}

// @ts-check
/**
 * @typedef {{
 *   queueType?: unknown,
 *   assignmentTitle?: unknown,
 *   exerciseTitle?: unknown,
 *   dueAt?: unknown,
 *   level?: unknown,
 *   message?: unknown,
 *   senderName?: unknown,
 *   recipients?: unknown,
 *   allowEmptyRecipients?: unknown,
 *   reportId?: unknown,
 *   studentRefId?: unknown,
 *   className?: unknown,
 *   schoolYear?: unknown,
 *   quarter?: unknown,
 *   artifactVersion?: unknown,
 *   requestOrigin?: unknown,
 *   reportSnapshot?: unknown,
 *   requestOrigin?: unknown,
 *   reminderEngagementToken?: unknown,
 * }} AnnouncementEmailPayload
 */

import { getStudentById } from "./student-roster.mjs"
import {
  buildReportCardFilename,
  generateStudentReportCardPdf,
} from "../../../server/student-report-card-pdf.mjs"
import { isBrevoEmailProvider, sendBrevoEmail } from "../email/brevo.mjs"
import { recordBrevoEmailDeliverySafely } from "../email/brevo-delivery.mjs"
import { buildVietnameseEmail, communicationRecipient } from "../email/communication-template.mjs"

/** @type {Promise<{ createTransport: Function }> | null} */
let nodemailerModule = null

/**
 * @returns {Promise<{ createTransport: Function }>}
 */
async function getNodemailer() {
  if (nodemailerModule) return nodemailerModule
  try {
    const mod = await import("nodemailer")
    nodemailerModule = mod?.default || mod
    return nodemailerModule
  } catch (error) {
    const wrapped = new Error("nodemailer is not available in runtime")
    wrapped.statusCode = 503
    throw wrapped
  }
}

function smtpConfigFromEnv() {
  const host = normalizeText(process.env.SMTP_HOST || "smtp.gmail.com")
  const port = Number.parseInt(String(process.env.SMTP_PORT || "465"), 10) || 465
  const secure = resolveBoolean(process.env.SMTP_SECURE, port === 465)
  const user = normalizeText(process.env.SMTP_USER)
  const pass = normalizeText(process.env.SMTP_PASS)
  const authMode = resolveSmtpAuthMode(process.env.SMTP_AUTH_MODE || process.env.SMTP_AUTH)
  const useAuth = authMode ? authMode === "auth" : Boolean(user || pass)
  const from = normalizeText(process.env.SMTP_FROM || user)
  if (!host || !from) {
    const error = new Error("SMTP is not configured for assignment announcements")
    error.statusCode = 503
    throw error
  }
  if (useAuth && (!user || !pass)) {
    const error = new Error("SMTP auth requires SMTP_USER and SMTP_PASS")
    error.statusCode = 503
    throw error
  }
  return { host, port, secure, user, pass, from, useAuth, authMode: authMode || (useAuth ? "auth" : "none") }
}

function escapeHtml(value) {
  return normalizeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
}

function encodeTrackingValue(value) {
  return encodeURIComponent(normalizeText(value))
}

function normalizeQueueType(value) {
  return normalizeLower(value) === "parent-report" ? "parent-report" : "announcement"
}

function normalizeOrigin(value) {
  const raw =
    normalizeText(value)
    || normalizeText(process.env.STUDENT_ADMIN_PUBLIC_ORIGIN)
    || normalizeText(process.env.PUBLIC_APP_ORIGIN)
    || normalizeText(process.env.APP_ORIGIN)
    || normalizeText(process.env.EXERCISE_MAILER_ORIGIN)
  if (!raw) return ""
  return raw.replace(/\/+$/, "")
}

function normalizeReportSlugPart(value) {
  const slug = normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "report"
}

function buildReportAccessSlug(payload = {}) {
  const snapshot =
    payload?.reportSnapshot && typeof payload.reportSnapshot === "object" ? payload.reportSnapshot : {}
  const report = snapshot?.report && typeof snapshot.report === "object" ? snapshot.report : snapshot
  const identity = report?.identity && typeof report.identity === "object" ? report.identity : {}
  const scope = report?.scope && typeof report.scope === "object" ? report.scope : {}
  const reportId =
    normalizeText(payload?.reportId)
    || normalizeText(report?.reportId)
    || normalizeText(report?.snapshot?.reportId)
  const slug = normalizeReportSlugPart([
    identity?.fullName,
    identity?.englishName,
    scope?.className,
    scope?.schoolYear,
    scope?.quarter,
  ].map((entry) => normalizeText(entry)).filter(Boolean).join(" "))
  return `${slug}-${reportId || "report"}`
}

function buildReportDayText(value = "") {
  const text = normalizeText(value)
  if (!text) return ""
  const date = new Date(text)
  if (Number.isNaN(date.valueOf())) return ""
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date)
}

function buildTrackedParentReportUrls(payload = {}, recipient = "") {
  const origin = normalizeOrigin(payload?.requestOrigin)
  const reportId = normalizeText(payload?.reportId)
  const artifactVersion = Number.parseInt(String(payload?.artifactVersion || 0), 10) || 0
  const slug = buildReportAccessSlug(payload)
  const recipientParam = encodeTrackingValue(recipient)
  const artifactParam = encodeTrackingValue(String(artifactVersion))
  const sourceParam = encodeTrackingValue("email")
  const openPixelUrl =
    origin && reportId
      ? `${origin}/api/report-events/email-open.gif?reportId=${encodeTrackingValue(reportId)}&recipient=${recipientParam}&artifactVersion=${artifactParam}`
      : ""
  const reportUrl =
    origin && reportId
      ? `${origin}/reports/access/${encodeURIComponent(slug)}?recipient=${recipientParam}&artifactVersion=${artifactParam}&source=${sourceParam}&button=${encodeTrackingValue("open-report")}`
      : ""
  const pdfUrl =
    origin && reportId
      ? `${origin}/reports/access/${encodeURIComponent(slug)}.pdf?recipient=${recipientParam}&artifactVersion=${artifactParam}&source=${sourceParam}&button=${encodeTrackingValue("download-pdf")}`
      : ""
  return {
    openPixelUrl,
    reportUrl,
    pdfUrl,
  }
}

export function buildParentReportEmailContent(payload = {}, recipient = "") {
  const assignmentTitle = normalizeText(payload.assignmentTitle) || "Báo cáo kết quả học tập"
  const level = normalizeText(payload.level || payload.className)
  const dueAt = normalizeText(payload.dueAt)
  const urls = buildTrackedParentReportUrls(payload, recipient)
  const reportDay = buildReportDayText(dueAt)
  const subject = [`Báo cáo kết quả học tập: ${assignmentTitle}`, level ? `(${level})` : ""].filter(Boolean).join(" ").trim()

  const bodyLines = [
    "Báo cáo kết quả học tập của học sinh đã sẵn sàng.",
    dueAt ? `Thứ: ${reportDay || "-"}` : "",
    dueAt ? `Ngày: ${dueAt}` : "",
    "",
    "Vui lòng mở báo cáo đã lưu hoặc tải bản PDF bằng các liên kết dưới đây.",
    "",
    `Báo cáo đã lưu: ${urls.reportUrl || "-"}`,
    `Tải bản PDF: ${urls.pdfUrl || "-"}`,
  ].filter(Boolean)

  const bodyHtml = [
    "<p>",
    "<strong>Báo cáo kết quả học tập của học sinh đã sẵn sàng.</strong>",
    dueAt ? `<br><strong>Thứ:</strong> ${escapeHtml(reportDay || "-")}` : "",
    dueAt ? `<br><strong>Ngày:</strong> ${escapeHtml(dueAt)}` : "",
    "</p>",
    "<p>Vui lòng mở báo cáo đã lưu hoặc tải bản PDF bằng các liên kết dưới đây.</p>",
    urls.reportUrl
      ? `<p><a href="${escapeHtml(urls.reportUrl)}" style="display:inline-block;padding:10px 16px;background:#1f5fbf;color:#ffffff;text-decoration:none;border-radius:6px;">Mở báo cáo đã lưu</a></p>`
      : "",
    urls.pdfUrl
      ? `<p><a href="${escapeHtml(urls.pdfUrl)}" style="display:inline-block;padding:10px 16px;background:#f4f6fb;color:#123055;text-decoration:none;border:1px solid #cbd4e6;border-radius:6px;">Tải bản PDF</a></p>`
      : "",
  ].filter(Boolean).join("")
  const email = buildVietnameseEmail({
    bodyText: bodyLines.join("\n"),
    bodyHtml,
    recipient: communicationRecipient(payload),
    origin: payload.requestOrigin,
  })

  return {
    subject,
    text: email.text,
    html: `${email.html}${urls.openPixelUrl ? `<img src="${escapeHtml(urls.openPixelUrl)}" alt="" width="1" height="1" style="display:block;border:0;opacity:0;">` : ""}`,
  }
}

async function buildParentReportPdfAttachment(payload = {}) {
  const studentRefId = normalizeText(payload.studentRefId)
  const reportId = normalizeText(payload.reportId)
  if (!studentRefId || !reportId) return []
  const student = await getStudentById(studentRefId)
  const pdfBuffer = await generateStudentReportCardPdf(student, {
    className: normalizeText(payload.className),
    schoolYear: normalizeText(payload.schoolYear),
    quarter: normalizeText(payload.quarter),
    reportId,
  })
  const filename = buildReportCardFilename(student, {
    className: normalizeText(payload.className),
    schoolYear: normalizeText(payload.schoolYear),
    quarter: normalizeText(payload.quarter),
  })
  return [{
    filename: normalizeText(filename) || `performance-report-${reportId}.pdf`,
    content: pdfBuffer,
    contentType: "application/pdf",
  }]
}

/**
 * @param {AnnouncementEmailPayload} [payload]
 * @returns {{
 *   subject: string,
 *   lines: Array<string>,
 *   htmlLines: string,
 * }}
 */
export function buildAnnouncementEmailContent(payload = {}) {
  const assignmentTitle = normalizeText(payload.assignmentTitle) || "Cập nhật bài tập"
  const exerciseTitle = normalizeText(payload.exerciseTitle)
  const dueAt = normalizeText(payload.dueAt)
  const level = normalizeText(payload.level)
  const customMessage = normalizeText(payload.message)
  const sender = normalizeText(payload.senderName) || "Eagles Student Admin"
  const trackingOrigin = normalizeOrigin(payload.requestOrigin)
  const reminderToken = normalizeText(payload.reminderEngagementToken)
  const libraryToken = normalizeText(payload.libraryAssignmentToken)
  const openPixelUrl = trackingOrigin && (reminderToken || libraryToken)
    ? `${trackingOrigin}${libraryToken ? "/api/library-assignments/track/open/" : "/api/assignment-reminders/track/open/"}${encodeURIComponent(libraryToken || reminderToken)}`
    : ""

  const subjectParts = [`Thông báo bài tập: ${assignmentTitle}`]
  if (exerciseTitle) subjectParts.push(`(${exerciseTitle})`)
  const subject = subjectParts.join(" ").trim()

  const baseLines = [
    `Thông báo từ ${sender}`,
    "",
    `Bài tập: ${assignmentTitle}`,
    exerciseTitle ? `Bài luyện tập: ${exerciseTitle}` : "",
    level ? `Trình độ/Lớp: ${level}` : "",
    dueAt ? `Hạn hoàn thành: ${dueAt}` : "",
    "",
  ].filter(Boolean)
  const message = customMessage || "Vui lòng xem và hoàn thành bài tập này."
  const bodyText = [...baseLines, message].join("\n")

  const escapedMessage = escapeHtml(message)
    .replace(/(https?:\/\/[^\s<]+)/giu, '<a href="$1">$1</a>')
  const htmlLines = baseLines
    .map((line) => escapeHtml(line))
    .join("<br>")
  const email = buildVietnameseEmail({
    bodyText,
    bodyHtml: `${htmlLines}<br><br>${escapedMessage}`,
    recipient: communicationRecipient(payload),
    origin: trackingOrigin,
  })

  return {
    subject,
    lines: email.text.split("\n"),
    htmlLines: email.html,
    text: email.text,
    html: `${email.html}${openPixelUrl ? `<img src="${escapeHtml(openPixelUrl)}" alt="" width="1" height="1" style="display:block;border:0;opacity:0;">` : ""}`,
  }
}

/**
 * @param {AnnouncementEmailPayload} [payload]
 * @param {{ allowEmptyRecipients?: boolean }} [options]
 * @returns {{
 *   recipients: Array<string>,
 *   assignmentTitle: string,
 *   exerciseTitle: string,
 *   dueAt: string,
 *   level: string,
 *   message: string,
 *   senderName: string,
 * }}
 */
function normalizeAnnouncementPayload(payload = {}, options = {}) {
  const allowEmptyRecipients = Boolean(options.allowEmptyRecipients)
  const recipients = normalizeRecipientList(payload.recipients)
  if (!recipients.length && !allowEmptyRecipients) {
    const error = new Error("At least one valid recipient email is required")
    error.statusCode = 400
    throw error
  }

  return {
    recipients,
    assignmentTitle: normalizeText(payload.assignmentTitle) || "Cập nhật bài tập",
    exerciseTitle: normalizeText(payload.exerciseTitle),
    dueAt: normalizeText(payload.dueAt),
    level: normalizeText(payload.level),
    message: normalizeText(payload.message),
    senderName: normalizeText(payload.senderName) || "Eagles Student Admin",
    queueId: normalizeText(payload.queueId),
    requestOrigin: normalizeOrigin(payload.requestOrigin),
    reminderEngagementToken: normalizeText(payload.reminderEngagementToken),
    libraryAssignmentToken: normalizeText(payload.libraryAssignmentToken),
  }
}

/**
 * @param {AnnouncementEmailPayload} [payload]
 * @returns {Promise<{
 *   ok: true,
 *   sent: number,
 *   subject: string,
 *   deliveryMode: "immediate",
 * }>}
 */
export async function sendAnnouncementEmail(payload = {}) {
  const normalizedPayload = normalizeAnnouncementPayload(payload)
  const queueType = normalizeQueueType(payload.queueType)

  if (isBrevoEmailProvider()) {
    const from = {
      email: normalizeText(process.env.BREVO_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER),
      name: normalizeText(process.env.BREVO_FROM_NAME || normalizedPayload.senderName),
    }
    if (queueType === "parent-report") {
      const attachments = await buildParentReportPdfAttachment(payload)
      let sent = 0
      for (let i = 0; i < normalizedPayload.recipients.length; i += 1) {
        const recipient = normalizedPayload.recipients[i]
        const emailContent = buildParentReportEmailContent({ ...payload, ...normalizedPayload }, recipient)
        const sentResult = await sendBrevoEmail({
          from,
          to: [{ email: recipient }],
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
          idempotencyKey: normalizeText(payload.queueId) ? `sis-email-${normalizeText(payload.queueId)}-${encodeURIComponent(recipient)}` : "",
          attachments,
        })
        await recordBrevoEmailDeliverySafely({
          messageId: sentResult.messageId,
          batchId: payload.queueId,
          recipientEmail: recipient,
          reportId: payload.reportId,
          queueType,
          subject: emailContent.subject,
          metadata: { provider: sentResult.provider, reportId: normalizeText(payload.reportId), profileInvitationId: normalizeText(payload.profileInvitationId), libraryAssignmentToken: normalizedPayload.libraryAssignmentToken || "", reminderEngagementToken: normalizedPayload.reminderEngagementToken || "" },
        })
        sent += 1
      }
      return {
        ok: true,
        sent,
        subject: buildParentReportEmailContent({ ...payload, ...normalizedPayload }, normalizedPayload.recipients[0]).subject,
        deliveryMode: "immediate",
      }
    }

    const emailContent = buildAnnouncementEmailContent({ ...payload, ...normalizedPayload })
    const sentResult = await sendBrevoEmail({
      from,
      to: [{ email: from.email }],
      bcc: normalizedPayload.recipients.map((email) => ({ email })),
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
      idempotencyKey: normalizeText(payload.queueId) ? `sis-email-${normalizeText(payload.queueId)}` : "",
    })
    await Promise.all(normalizedPayload.recipients.map((recipient) => recordBrevoEmailDeliverySafely({
      messageId: sentResult.messageId,
      batchId: payload.queueId,
      recipientEmail: recipient,
      reportId: payload.reportId,
      queueType,
      subject: emailContent.subject,
      metadata: { provider: sentResult.provider, deliveryMode: "bcc", reportId: normalizeText(payload.reportId), profileInvitationId: normalizeText(payload.profileInvitationId), libraryAssignmentToken: normalizedPayload.libraryAssignmentToken || "", reminderEngagementToken: normalizedPayload.reminderEngagementToken || "" },
    })))
    return {
      ok: true,
      sent: normalizedPayload.recipients.length,
      subject: emailContent.subject,
      deliveryMode: "immediate",
    }
  }

  const nodemailer = await getNodemailer()
  const smtp = smtpConfigFromEnv()
  const transportOptions = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
  }
  if (smtp.useAuth) {
    transportOptions.auth = {
      user: smtp.user,
      pass: smtp.pass,
    }
  }
  const transporter = nodemailer.createTransport(transportOptions)

  if (queueType === "parent-report") {
    const attachments = await buildParentReportPdfAttachment(payload)
    let sent = 0
    for (let i = 0; i < normalizedPayload.recipients.length; i += 1) {
      const recipient = normalizedPayload.recipients[i]
      const emailContent = buildParentReportEmailContent({ ...payload, ...normalizedPayload }, recipient)
      await transporter.sendMail({
        from: smtp.from,
        to: recipient,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
        attachments,
      })
      sent += 1
    }

    return {
      ok: true,
      sent,
      subject: buildParentReportEmailContent({ ...payload, ...normalizedPayload }, normalizedPayload.recipients[0]).subject,
      deliveryMode: "immediate",
    }
  }

  const emailContent = buildAnnouncementEmailContent({ ...payload, ...normalizedPayload })
  await transporter.sendMail({
    from: smtp.from,
    to: smtp.from,
    bcc: normalizedPayload.recipients,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  })

  return {
    ok: true,
    sent: normalizedPayload.recipients.length,
    subject: emailContent.subject,
    deliveryMode: "immediate",
  }
}
