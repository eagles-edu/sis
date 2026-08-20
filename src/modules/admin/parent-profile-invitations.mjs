// @ts-check
import crypto from "node:crypto"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { recordBrevoEmailDeliverySafely } from "../email/brevo-delivery.mjs"
import { enqueueAsyncSideEffectJob } from "../async/side-effect-jobs.mjs"
import { sendBrevoEmail, isBrevoEmailProvider } from "../email/brevo.mjs"
import { hashScryptPassword } from "./users.mjs"

export const ASYNC_SIDE_EFFECT_JOB_TYPE_PARENT_PROFILE_INVITATION = "parent-profile-invitation"
const INVITATION_EXPIRY_DEFAULT_DAYS = 7
const INVITATION_EXPIRY_MAX_DAYS = 30
const ACTIVATION_RATE_WINDOW_MS = 15 * 60 * 1000
const ACTIVATION_RATE_MAX_ATTEMPTS = 8
const activationAttemptsBySource = new Map()
const invitationRecoveryById = new Map()

function text(value) { return value === undefined || value === null ? "" : String(value).trim() }
function lower(value) { return text(value).toLowerCase() }
function tokenHash(token) { return crypto.createHash("sha256").update(token).digest("hex") }
function invitationIdempotencyKey(invitationId) {
  const hex = crypto.createHash("sha256").update(text(invitationId)).digest("hex").slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20)}`
}
function invitationExpiryDays() {
  const requested = Number.parseInt(text(process.env.PARENT_PROFILE_INVITATION_EXPIRY_DAYS || INVITATION_EXPIRY_DEFAULT_DAYS), 10)
  return Math.min(INVITATION_EXPIRY_MAX_DAYS, Math.max(1, Number.isInteger(requested) ? requested : INVITATION_EXPIRY_DEFAULT_DAYS))
}
function assertActivationRateLimit(sourceKey) {
  const key = text(sourceKey) || "unknown"
  const now = Date.now()
  const prior = activationAttemptsBySource.get(key)
  const attempts = prior && now - prior.startedAt < ACTIVATION_RATE_WINDOW_MS ? prior.attempts + 1 : 1
  activationAttemptsBySource.set(key, { startedAt: prior && now - prior.startedAt < ACTIVATION_RATE_WINDOW_MS ? prior.startedAt : now, attempts })
  if (activationAttemptsBySource.size > 5000) {
    for (const [entryKey, entry] of activationAttemptsBySource.entries()) {
      if (now - entry.startedAt >= ACTIVATION_RATE_WINDOW_MS) activationAttemptsBySource.delete(entryKey)
    }
  }
  if (attempts > ACTIVATION_RATE_MAX_ATTEMPTS) throw Object.assign(new Error("Too many activation attempts. Please wait and try again."), { statusCode: 429 })
}
function assertInvitationRecoveryRateLimit(invitationId) {
  const key = text(invitationId)
  const now = Date.now()
  const previous = invitationRecoveryById.get(key)
  if (previous && now - previous < ACTIVATION_RATE_WINDOW_MS) {
    throw Object.assign(new Error("A replacement link was already sent recently. Please check your email or try again later."), { statusCode: 429 })
  }
  invitationRecoveryById.set(key, now)
  if (invitationRecoveryById.size > 5000) {
    for (const [entryKey, sentAt] of invitationRecoveryById.entries()) {
      if (now - sentAt >= ACTIVATION_RATE_WINDOW_MS) invitationRecoveryById.delete(entryKey)
    }
  }
}
function publicOrigin() {
  const origin = text(process.env.STUDENT_ADMIN_PUBLIC_ORIGIN || process.env.PUBLIC_APP_ORIGIN || process.env.APP_ORIGIN || process.env.EXERCISE_MAILER_ORIGIN)
  if (!origin) throw Object.assign(new Error("A public application origin is required for profile invitations"), { statusCode: 503 })
  return origin.replace(/\/+$/, "")
}
function invitationUrl(token) { return `${publicOrigin()}/parent/profile-invitations/${encodeURIComponent(token)}` }
function invitationOpenUrl(token) { return `${publicOrigin()}/api/parent/profile-invitations/${encodeURIComponent(token)}/open.gif` }

function initialPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  const bytes = crypto.randomBytes(14)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}

export async function resolveParentPortalAccountIdentity(prisma, student, recipientEmail = "") {
  if (!prisma?.parentPortalAccount) {
    throw Object.assign(new Error("Parent portal persistence is unavailable"), { statusCode: 503 })
  }
  const profile = student?.profile || {}
  const eaglesId = text(student?.eaglesId)
  const requestedParentsId = text(profile.parentsId)
  const defaultParentsId = eaglesId ? `cm${eaglesId}` : `cm${text(student?.studentNumber)}`
  const parentsId = requestedParentsId || defaultParentsId
  const email = lower(profile.motherEmail || profile.studentEmail || recipientEmail)
  const accountByParentsId = await prisma.parentPortalAccount.findUnique({ where: { parentsId } })
  const accountByEmail = email
    ? await prisma.parentPortalAccount.findUnique({ where: { email } })
    : null
  if (accountByEmail && accountByEmail.parentsId !== parentsId) {
    const error = new Error(
      `Parent identity conflict: parentsId ${parentsId} does not own ${email}; that email belongs to ${accountByEmail.parentsId}. Correct the Parents ID or choose the verified existing family before sending the invitation.`,
    )
    error.statusCode = 409
    error.code = "PARENT_ID_EMAIL_CONFLICT"
    throw error
  }
  return { parentsId, email, accountByParentsId, accountByEmail }
}

export async function ensureParentPortalAccount(prisma, student, recipientEmail = "") {
  if (!prisma?.parentPortalAccount || !prisma?.parentPortalStudentLink) {
    throw Object.assign(new Error("Parent portal persistence is unavailable"), { statusCode: 503 })
  }
  const { parentsId, email, accountByParentsId, accountByEmail } = await resolveParentPortalAccountIdentity(prisma, student, recipientEmail)
  let account = accountByParentsId || accountByEmail
  let firstPassword = ""
  if (!account) {
    firstPassword = initialPassword()
    try {
      account = await prisma.parentPortalAccount.create({
        data: { parentsId, email: email || null, passwordHash: hashScryptPassword(firstPassword), mustChangePassword: true, status: "active" },
      })
    } catch (error) {
      if (error?.code !== "P2002") throw error
      account = await prisma.parentPortalAccount.findUnique({ where: { parentsId } })
      if (!account) throw error
      firstPassword = ""
    }
  }
  if (account.email == null && email && !accountByEmail) {
    account = await prisma.parentPortalAccount.update({ where: { id: account.id }, data: { email } })
  }
  await prisma.parentPortalStudentLink.upsert({
    where: { parentAccountId_studentRefId: { parentAccountId: account.id, studentRefId: student.id } },
    update: {},
    create: { parentAccountId: account.id, studentRefId: student.id },
  })
  return { account }
}

function invitationMessage({ student, url, openUrl, parentId, mustChangePassword, expiresAt }) {
  const name = text(student?.profile?.fullName || student?.profile?.englishName || student?.eaglesId) || "your learner"
  const subject = `Complete the Eagles student profile for ${name}`
  const expiresOn = expiresAt instanceof Date ? expiresAt.toLocaleDateString("en-CA") : "the configured expiry date"
  const credentials = mustChangePassword
    ? `Parent ID: ${parentId}\nOpen the link, then choose a new password and save both your Parent ID and password in a safe place.\n\n`
    : `Parent ID: ${parentId}\nUse your existing parent-portal password at ${publicOrigin()}/parent.\n\n`
  const textBody = `Complete the student profile for ${name} using this secure link:\n\n${url}\n\n${credentials}This invitation expires on ${expiresOn} and can be used once.\n\nIf you did not expect this email, you can ignore it.`
  const safe = (value) => text(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
  const completionHtml = `<p><strong>Complete the student profile using this link:</strong></p><p><a href="${url}">Complete the student profile</a></p><p>This invitation expires on ${safe(expiresOn)} and can be used once.</p>`
  const credentialHtml = mustChangePassword
    ? `<p><strong>Parent ID:</strong> ${safe(parentId)}<br>When the completion link opens, choose a new password and save both your Parent ID and password in a safe place.</p>`
    : `<p><strong>Parent ID:</strong> ${safe(parentId)}<br>Use your existing parent-portal password at <a href="${publicOrigin()}/parent">the parent portal</a>.</p>`
  const openPixel = `<img src="${safe(openUrl)}" width="1" height="1" alt="" aria-hidden="true" style="display:block;border:0" />`
  const html = `${completionHtml}<p>Student: <strong>${safe(name)}</strong></p>${credentialHtml}${openPixel}`
  return { subject, textBody, html }
}

async function sendInvitationEmail({ invitationId, recipientEmail, student, token, expiresAt, parentId, mustChangePassword }) {
  const url = invitationUrl(token)
  const message = invitationMessage({ student, url, openUrl: invitationOpenUrl(token), parentId, mustChangePassword, expiresAt })
  const fromEmail = text(process.env.BREVO_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER)
  const fromName = text(process.env.BREVO_FROM_NAME || "The Eagles Club")
  if (isBrevoEmailProvider()) {
    const result = await sendBrevoEmail({ from: { email: fromEmail, name: fromName }, to: [{ email: recipientEmail }], subject: message.subject, text: message.textBody, html: message.html, idempotencyKey: invitationIdempotencyKey(invitationId) })
    return { providerMessageId: text(result.messageId), provider: "brevo" }
  }
  const nodemailer = await import("nodemailer")
  const host = text(process.env.SMTP_HOST)
  const port = Number.parseInt(text(process.env.SMTP_PORT || "465"), 10) || 465
  if (!host || !fromEmail) throw Object.assign(new Error("SMTP invitation settings are incomplete"), { statusCode: 503 })
  const transporter = nodemailer.default.createTransport({ host, port, secure: String(process.env.SMTP_SECURE || "true").toLowerCase() === "true", auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined })
  const result = await transporter.sendMail({ from: fromEmail, to: recipientEmail, subject: message.subject, text: message.textBody, html: message.html })
  return { providerMessageId: text(result.messageId), provider: "smtp" }
}

export async function createParentProfileInvitation({ studentRefId, recipientEmail, queuedBy = "" } = {}) {
  const prisma = await getSharedPrismaClient()
  if (!prisma?.parentProfileInvitation) throw Object.assign(new Error("Parent profile invitation persistence is unavailable"), { statusCode: 503 })
  const email = lower(recipientEmail)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("A valid parent/adult student email is required"), { statusCode: 400 })
  const student = await prisma.student.findUnique({ where: { id: text(studentRefId) }, include: { profile: true } })
  if (!student) throw Object.assign(new Error("Student not found"), { statusCode: 404 })
  const account = await ensureParentPortalAccount(prisma, student, email)
  const token = crypto.randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + invitationExpiryDays() * 24 * 60 * 60 * 1000)
  const invitation = await prisma.$transaction(async (tx) => {
    await tx.parentProfileInvitation.updateMany({ where: { studentRefId: student.id, status: { in: ["queued", "sent", "clicked"] } }, data: { status: "expired", lastError: "Superseded by a newer invitation" } })
    return tx.parentProfileInvitation.create({ data: { tokenHash: tokenHash(token), recipientEmail: email, studentRefId: student.id, parentAccountId: account.account.id, status: "queued", expiresAt, batchId: `profile-invite-${student.id}-${Date.now().toString(36)}` } })
  })
  await enqueueAsyncSideEffectJob(ASYNC_SIDE_EFFECT_JOB_TYPE_PARENT_PROFILE_INVITATION, { invitationId: invitation.id, token, queuedBy, parentId: account.account.parentsId, mustChangePassword: Boolean(account.account.mustChangePassword) }, { dedupeKey: invitation.id })
  return { id: invitation.id, status: invitation.status, recipientEmail: email, expiresAt: invitation.expiresAt.toISOString() }
}

export async function resendParentProfileInvitation({ invitationId, queuedBy = "" } = {}) {
  const prisma = await getSharedPrismaClient()
  const previous = await prisma.parentProfileInvitation.findUnique({ where: { id: text(invitationId) } })
  if (!previous) throw Object.assign(new Error("Parent profile invitation not found"), { statusCode: 404 })
  return createParentProfileInvitation({ studentRefId: previous.studentRefId, recipientEmail: previous.recipientEmail, queuedBy })
}

export async function processParentProfileInvitationJob(job = {}) {
  const prisma = await getSharedPrismaClient()
  const invitationId = text(job?.payloadJson?.invitationId)
  const token = text(job?.payloadJson?.token)
  const invitation = await prisma.parentProfileInvitation.findUnique({ where: { id: invitationId }, include: { student: { include: { profile: true } } } })
  if (!invitation) return { ok: false, status: "missing", duplicate: true }
  if (lower(invitation.status) === "sent") {
    return { ok: true, status: "sent", providerMessageId: text(invitation.providerMessageId), duplicate: true }
  }
  if (invitation.expiresAt <= new Date() || ["expired", "completed", "activated"].includes(lower(invitation.status))) {
    await prisma.parentProfileInvitation.update({ where: { id: invitation.id }, data: { status: "expired", lastError: "Invitation is expired or already completed" } })
    return { ok: false, status: "expired" }
  }
  try {
    const sent = await sendInvitationEmail({ invitationId: invitation.id, recipientEmail: invitation.recipientEmail, student: invitation.student, token, expiresAt: invitation.expiresAt, parentId: text(job?.payloadJson?.parentId || invitation.parentAccount?.parentsId), mustChangePassword: Boolean(job?.payloadJson?.mustChangePassword) })
    await recordBrevoEmailDeliverySafely({
      messageId: sent.providerMessageId,
      recipientEmail: invitation.recipientEmail,
      batchId: invitation.batchId,
      queueType: "profile-invitation",
      subject: "Complete your Eagles student profile",
      metadata: { invitationId: invitation.id, profileInvitationId: invitation.id, studentRefId: invitation.studentRefId },
    })
    await prisma.parentProfileInvitation.update({ where: { id: invitation.id }, data: { status: "sent", sentAt: new Date(), providerMessageId: sent.providerMessageId || null } })
    return { ok: true, status: "sent", providerMessageId: sent.providerMessageId || "" }
  } catch (error) {
    await prisma.parentProfileInvitation.update({ where: { id: invitation.id }, data: { status: "failed", lastError: text(error?.message || error).slice(0, 1000) } })
    throw error
  }
}

export async function consumeParentProfileInvitation(token, { mark = "clicked" } = {}) {
  const prisma = await getSharedPrismaClient()
  const invitation = await prisma.parentProfileInvitation.findUnique({ where: { tokenHash: tokenHash(text(token)) }, include: { student: { include: { profile: true } } } })
  if (!invitation || invitation.expiresAt <= new Date() || ["expired", "completed", "activated"].includes(lower(invitation.status))) {
    if (invitation && invitation.status !== "completed") await prisma.parentProfileInvitation.update({ where: { id: invitation.id }, data: { status: "expired" } })
    throw Object.assign(new Error("This profile invitation is expired or has already been used"), { statusCode: 410 })
  }
  const data = mark === "opened" ? { openedAt: invitation.openedAt || new Date() } : { clickedAt: invitation.clickedAt || new Date(), status: "clicked" }
  const updated = await prisma.parentProfileInvitation.update({ where: { id: invitation.id }, data })
  return { invitation: updated, student: invitation.student }
}

export async function redeemParentProfileInvitation({ token = "", sourceKey = "" } = {}) {
  assertActivationRateLimit(sourceKey)
  const tokenValue = text(token)
  if (!tokenValue) throw Object.assign(new Error("This invitation link is unavailable."), { statusCode: 400 })
  const prisma = await getSharedPrismaClient()
  const invitation = await prisma.parentProfileInvitation.findUnique({
    where: { tokenHash: tokenHash(tokenValue) },
    include: { student: { include: { profile: true } }, parentAccount: true },
  })
  if (!invitation || invitation.expiresAt <= new Date() || !["queued", "sent", "clicked"].includes(lower(invitation.status))) {
    throw Object.assign(new Error("This invitation link is invalid, expired, or has already been used."), { statusCode: 410 })
  }
  const changed = await prisma.parentProfileInvitation.updateMany({
    where: { id: invitation.id, status: { in: ["queued", "sent", "clicked"] } },
    data: { status: "activated", activatedAt: new Date(), clickedAt: invitation.clickedAt || new Date() },
  })
  if (changed.count !== 1) throw Object.assign(new Error("This invitation link has already been used."), { statusCode: 410 })
  return invitation
}

export async function recoverParentProfileInvitation({ token = "", queuedBy = "" } = {}) {
  const prisma = await getSharedPrismaClient()
  const previous = await prisma.parentProfileInvitation.findUnique({ where: { tokenHash: tokenHash(text(token)) } })
  if (!previous || lower(previous.status) === "completed") {
    throw Object.assign(new Error("This link cannot be replaced. Please contact Eagles support."), { statusCode: 410 })
  }
  assertInvitationRecoveryRateLimit(previous.id)
  return resendParentProfileInvitation({ invitationId: previous.id, queuedBy })
}

export async function markParentProfileInvitationCompleted({ studentRefId } = {}) {
  const prisma = await getSharedPrismaClient()
  await prisma.parentProfileInvitation.updateMany({ where: { studentRefId: text(studentRefId), status: { in: ["sent", "clicked", "activated"] } }, data: { status: "completed", completedAt: new Date() } })
}

export async function listParentProfileInvitations({ studentRefId = "", take = 100 } = {}) {
  const prisma = await getSharedPrismaClient()
  return prisma.parentProfileInvitation.findMany({ where: studentRefId ? { studentRefId: text(studentRefId) } : {}, orderBy: { createdAt: "desc" }, take: Math.min(500, Math.max(1, Number.parseInt(String(take), 10) || 100)) })
}
