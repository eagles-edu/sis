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

function buildParentReportEmailContent(payload = {}, recipient = "") {
  const sender = normalizeText(payload.senderName) || "Eagles Student Admin"
  const assignmentTitle = normalizeText(payload.assignmentTitle) || "Performance report"
  const level = normalizeText(payload.level || payload.className)
  const dueAt = normalizeText(payload.dueAt)
  const urls = buildTrackedParentReportUrls(payload, recipient)
  const reportDay = buildReportDayText(dueAt)
  const subject = [assignmentTitle, level ? `(${level})` : ""].filter(Boolean).join(" ").trim()

  const lines = [
    `Hello,`,
    "",
    `Your report card is ready.`,
    dueAt ? `Day: ${reportDay || "-"}` : "",
    dueAt ? `Date: ${dueAt}` : "",
    "",
    `Open the saved report or download the PDF using the links below.`,
    "",
    `Saved report: ${urls.reportUrl || "-"}`,
    `Download PDF: ${urls.pdfUrl || "-"}`,
  ].filter(Boolean)

  const htmlBlocks = [
    `<p>Hello,</p>`,
    "<p>",
    `<strong>Your report card is ready.</strong>`,
    dueAt ? `<br><strong>Day:</strong> ${escapeHtml(reportDay || "-")}` : "",
    dueAt ? `<br><strong>Date:</strong> ${escapeHtml(dueAt)}` : "",
    "</p>",
    "<p>Open the saved report or download the PDF using the buttons below.</p>",
    urls.reportUrl
      ? `<p><a href="${escapeHtml(urls.reportUrl)}" style="display:inline-block;padding:10px 16px;background:#1f5fbf;color:#ffffff;text-decoration:none;border-radius:6px;">Open Saved Report</a></p>`
      : "",
    urls.pdfUrl
      ? `<p><a href="${escapeHtml(urls.pdfUrl)}" style="display:inline-block;padding:10px 16px;background:#f4f6fb;color:#123055;text-decoration:none;border:1px solid #cbd4e6;border-radius:6px;">Download PDF</a></p>`
      : "",
    urls.openPixelUrl
      ? `<img src="${escapeHtml(urls.openPixelUrl)}" alt="" width="1" height="1" style="display:block;border:0;opacity:0;">`
      : "",
  ].filter(Boolean)

  return {
    subject,
    text: lines.join("\n"),
    html: htmlBlocks.join(""),
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
function buildAnnouncementEmailContent(payload = {}) {
  const assignmentTitle = normalizeText(payload.assignmentTitle) || "Assignment update"
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

  const subjectParts = [assignmentTitle]
  if (exerciseTitle) subjectParts.push(`(${exerciseTitle})`)
  const subject = subjectParts.join(" ").trim()

  const baseLines = [
    `${sender} announcement`,
    "",
    `Assignment: ${assignmentTitle}`,
    exerciseTitle ? `Exercise: ${exerciseTitle}` : "",
    level ? `Level/Class: ${level}` : "",
    dueAt ? `Due: ${dueAt}` : "",
    "",
  ].filter(Boolean)
  const message = customMessage || "Please review and complete this assignment."
  const lines = [...baseLines, message]

  const escapedMessage = escapeHtml(customMessage || "Please review and complete this assignment.")
    .replace(/(https?:\/\/[^\s<]+)/giu, '<a href="$1">$1</a>')
  const htmlLines = baseLines
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .join("<br>")

  return {
    subject,
    lines,
    htmlLines: `${htmlLines}<br><br>${escapedMessage}${openPixelUrl ? `<img src="${escapeHtml(openPixelUrl)}" alt="" width="1" height="1" style="display:block;border:0;opacity:0;">` : ""}`,
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
    assignmentTitle: normalizeText(payload.assignmentTitle) || "Assignment update",
    exerciseTitle: normalizeText(payload.exerciseTitle),
    dueAt: normalizeText(payload.dueAt),
    level: normalizeText(payload.level),
    message: normalizeText(payload.message),
    senderName: normalizeText(payload.senderName) || "Eagles Student Admin",
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
          attachments,
        })
        await recordBrevoEmailDeliverySafely({
          messageId: sentResult.messageId,
          batchId: payload.queueId,
          recipientEmail: recipient,
          reportId: payload.reportId,
          queueType,
          subject: emailContent.subject,
          metadata: { provider: sentResult.provider, libraryAssignmentToken: normalizedPayload.libraryAssignmentToken || "" },
        })
        sent += 1
      }
      return {
        ok: true,
        sent,
        subject: normalizeText(normalizedPayload.assignmentTitle) || "Performance report",
        deliveryMode: "immediate",
      }
    }

    const emailContent = buildAnnouncementEmailContent({ ...payload, ...normalizedPayload })
    const sentResult = await sendBrevoEmail({
      from,
      to: [{ email: from.email }],
      bcc: normalizedPayload.recipients.map((email) => ({ email })),
      subject: emailContent.subject,
      text: emailContent.lines.join("\n"),
      html: `<p>${emailContent.htmlLines}</p>`,
    })
    await Promise.all(normalizedPayload.recipients.map((recipient) => recordBrevoEmailDeliverySafely({
      messageId: sentResult.messageId,
      batchId: payload.queueId,
      recipientEmail: recipient,
      reportId: payload.reportId,
      queueType,
      subject: emailContent.subject,
      metadata: { provider: sentResult.provider, deliveryMode: "bcc", libraryAssignmentToken: normalizedPayload.libraryAssignmentToken || "" },
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
      subject: normalizeText(normalizedPayload.assignmentTitle) || "Performance report",
      deliveryMode: "immediate",
    }
  }

  const emailContent = buildAnnouncementEmailContent({ ...payload, ...normalizedPayload })
  await transporter.sendMail({
    from: smtp.from,
    to: smtp.from,
    bcc: normalizedPayload.recipients,
    subject: emailContent.subject,
    text: emailContent.lines.join("\n"),
    html: `<p>${emailContent.htmlLines}</p>`,
  })

  return {
    ok: true,
    sent: normalizedPayload.recipients.length,
    subject: emailContent.subject,
    deliveryMode: "immediate",
  }
}
