const SIGNATURE_LINES = Object.freeze([
  "Tran Thi Kim Thanh, Principal",
  "Chứng chỉ 'TESOL Trong Lớp' từ Học viện TESOL Hoa Kỳ",
  "",
  "0937 667 818",
  "kimthanh@eagles.edu.vn",
  "",
  "The Eagles American English Club, Ltd.",
  "28 Đường số 30",
  "Phường Bình Trị Đông B, Quận Bình Tân",
  "Thành phố Hồ Chí Minh, Việt Nam",
  "",
  "eagles.edu.vn",
])

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function lower(value) {
  return text(value).toLowerCase()
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character])
}

function normalizeOrigin(value = "") {
  const raw = text(value)
    || text(process.env.STUDENT_ADMIN_PUBLIC_ORIGIN)
    || text(process.env.PUBLIC_APP_ORIGIN)
    || text(process.env.APP_ORIGIN)
    || text(process.env.EXERCISE_MAILER_ORIGIN)
    || "https://eagles.edu.vn"
  return raw.replace(/\/+$/u, "")
}

function firstNameFrom(value) {
  const parts = text(value).split(/\s+/u).filter(Boolean)
  return parts.at(-1) || ""
}

function recipientDetails(recipient = {}) {
  if (typeof recipient === "string") return { firstName: firstNameFrom(recipient) }
  const value = recipient && typeof recipient === "object" ? recipient : {}
  const firstName = text(value.firstName || value.recipientFirstName)
    || firstNameFrom(value.fullName || value.recipientName || value.name || value.parentName)
  const relationship = lower(value.relationship || value.recipientRelationship || value.parentRole)
  const gender = lower(value.gender || value.recipientGender || value.sex)
  return { firstName, relationship, gender }
}

function greetingPrefix({ relationship, gender }) {
  if (/mother|mom|mẹ|female|woman|chị/u.test(relationship) || /female|woman|nữ|chị/u.test(gender)) return "Chị"
  if (/father|dad|ba|bố|male|man|anh/u.test(relationship) || /male|man|nam|anh/u.test(gender)) return "Anh"
  return ""
}

export const EMAIL_DEFAULT_GREETING = "Thân mến Cha Mẹ:"
export const EMAIL_SIGNATURE_TEXT = SIGNATURE_LINES.join("\n")

export function buildVietnameseGreeting(recipient = {}) {
  const details = recipientDetails(recipient)
  const prefix = greetingPrefix(details)
  return details.firstName && prefix
    ? `${prefix} ${details.firstName}:`
    : EMAIL_DEFAULT_GREETING
}

export function buildEmailSignatureText() {
  return EMAIL_SIGNATURE_TEXT
}

export function buildEmailSignatureHtml(origin = "") {
  const lines = SIGNATURE_LINES.map((line) => line ? `<div>${escapeHtml(line)}</div>` : "<div>&nbsp;</div>").join("")
  const logoUrl = `${normalizeOrigin(origin)}/web-asset/images/logo-wide.png`
  return `<div class="eagles-email-signature" style="margin-top:24px;border-top:1px solid #cbd4e6;padding-top:16px;color:#123055;line-height:1.5;">${lines}<div style="margin-top:12px;"><img src="${escapeHtml(logoUrl)}" alt="The Eagles American English Club" width="600" style="display:block;width:min(600px,100%);height:auto;border:0;"></div></div>`
}

function bodyHtmlFromText(value) {
  return text(value)
    .split(/\n/u)
    .map((line) => line ? `<div>${escapeHtml(line)}</div>` : "<div>&nbsp;</div>")
    .join("")
}

export function buildVietnameseEmail({ bodyText = "", bodyHtml = "", recipient = {}, origin = "" } = {}) {
  const greeting = buildVietnameseGreeting(recipient)
  const normalizedBodyText = text(bodyText)
  const normalizedBodyHtml = text(bodyHtml) || bodyHtmlFromText(normalizedBodyText)
  return {
    greeting,
    text: [greeting, normalizedBodyText, EMAIL_SIGNATURE_TEXT].filter(Boolean).join("\n\n"),
    html: `<p>${escapeHtml(greeting)}</p>${normalizedBodyHtml}${buildEmailSignatureHtml(origin)}`,
  }
}

export function communicationRecipient({
  recipientFirstName,
  recipientName,
  recipientGender,
  recipientRelationship,
  parentName,
  motherName,
  fatherName,
} = {}) {
  const relationship = text(recipientRelationship)
    || (text(parentName) === text(motherName) && text(motherName) ? "mother" : "")
    || (text(parentName) === text(fatherName) && text(fatherName) ? "father" : "")
  return {
    firstName: recipientFirstName,
    fullName: recipientName || parentName || motherName || fatherName,
    gender: recipientGender,
    relationship,
  }
}
