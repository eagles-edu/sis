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

let nodemailerModule = null

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

function buildAnnouncementEmailContent(payload = {}) {
  const assignmentTitle = normalizeText(payload.assignmentTitle) || "Assignment update"
  const exerciseTitle = normalizeText(payload.exerciseTitle)
  const dueAt = normalizeText(payload.dueAt)
  const level = normalizeText(payload.level)
  const customMessage = normalizeText(payload.message)
  const sender = normalizeText(payload.senderName) || "Eagles Student Admin"

  const subjectParts = [assignmentTitle]
  if (exerciseTitle) subjectParts.push(`(${exerciseTitle})`)
  const subject = subjectParts.join(" ").trim()

  const lines = [
    `${sender} announcement`,
    "",
    `Assignment: ${assignmentTitle}`,
    exerciseTitle ? `Exercise: ${exerciseTitle}` : "",
    level ? `Level/Class: ${level}` : "",
    dueAt ? `Due: ${dueAt}` : "",
    "",
    customMessage || "Please review and complete this assignment.",
  ].filter(Boolean)

  const htmlLines = lines
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .join("<br>")

  return {
    subject,
    lines,
    htmlLines,
  }
}

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
  }
}

export async function sendAnnouncementEmail(payload = {}) {
  const normalizedPayload = normalizeAnnouncementPayload(payload)
  const emailContent = buildAnnouncementEmailContent(normalizedPayload)

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
