import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  EMAIL_DEFAULT_GREETING,
  EMAIL_SIGNATURE_TEXT,
  buildEmailSignatureHtml,
  buildVietnameseEmail,
} from "../src/modules/email/communication-template.mjs"
import {
  buildAnnouncementEmailContent,
  buildParentReportEmailContent,
} from "../src/modules/admin/announcement-email.mjs"
import { invitationMessage } from "../src/modules/admin/parent-profile-invitations.mjs"
import { buildAssignmentReminderMessage } from "../src/modules/admin/assignment-reminder-dispatcher.mjs"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("shared communication template supplies Vietnamese greeting, signature, and logo", () => {
  const message = buildVietnameseEmail({
    bodyText: "Nội dung kiểm tra.",
    recipient: { recipientName: "Nguyen Van An", recipientRelationship: "father" },
    origin: "https://test.eagles.edu.vn",
  })
  assert.match(message.text, /^Anh An:/u)
  assert.match(message.text, /Nội dung kiểm tra\./u)
  assert.equal(message.text.endsWith(EMAIL_SIGNATURE_TEXT), true)
  assert.match(message.html, /src="https:\/\/test\.eagles\.edu\.vn\/web-asset\/images\/logo-wide\.png"/u)
  assert.match(message.html, /Tran Thi Kim Thanh, Principal/u)
})

test("all admin email builders include the fallback or personalized greeting and signature", () => {
  const announcement = buildAnnouncementEmailContent({
    assignmentTitle: "Bài tuần 1",
    message: "Vui lòng hoàn thành.",
    recipients: ["parent@example.test"],
    recipientName: "Nguyen Van An",
    recipientRelationship: "father",
    requestOrigin: "https://test.eagles.edu.vn",
  })
  assert.match(announcement.text, /^Anh An:/u)
  assert.match(announcement.text, /Tran Thi Kim Thanh, Principal/u)
  assert.match(announcement.html, /logo-wide\.png/u)
  assert.match(announcement.subject, /^Thông báo bài tập:/u)

  const report = buildParentReportEmailContent({
    assignmentTitle: "Kết quả tuần 1",
    recipients: ["parent@example.test"],
    requestOrigin: "https://test.eagles.edu.vn",
  }, "parent@example.test")
  assert.match(report.text, new RegExp(`^${EMAIL_DEFAULT_GREETING}`, "u"))
  assert.match(report.text, /Báo cáo kết quả học tập/u)
  assert.match(report.html, /logo-wide\.png/u)

  process.env.STUDENT_ADMIN_PUBLIC_ORIGIN = "https://test.eagles.edu.vn"
  const invitation = invitationMessage({
    student: { eaglesId: "E-1", profile: { fullName: "Test Student", motherEmail: "mother@example.test", motherName: "Tran Thi Mai" } },
    recipientEmail: "mother@example.test",
    url: "https://test.eagles.edu.vn/invite/token",
    openUrl: "https://test.eagles.edu.vn/open.gif",
    parentId: "cmE1",
    mustChangePassword: true,
    expiresAt: new Date("2026-09-01T00:00:00.000Z"),
  })
  assert.match(invitation.textBody, /^Chị Mai:/u)
  assert.match(invitation.textBody, /Vui lòng hoàn tất hồ sơ/u)
  assert.match(invitation.html, /logo-wide\.png/u)
})

test("assignment reminder body is Vietnamese and relies on the shared wrapper for greeting/signature", () => {
  const body = buildAssignmentReminderMessage({
    completed: false,
    assignmentTitle: "Bài tuần 1",
    dueAt: "2026-08-30",
    level: "A2 Flyers",
    studentName: "Student",
    actionUrl: "https://test.eagles.edu.vn/assignment",
    audience: "parent",
  })
  assert.doesNotMatch(body, /\bHello\b|\bAssignment:\b|\bOpen the assignment\b/u)
  assert.match(body, /Bài tập:/u)
  assert.match(body, /Mở bài tập:/u)
})

test("exercise mailer routes every generated message through the shared Vietnamese template", () => {
  const source = fs.readFileSync(path.resolve(rootDir, "server/exercise-mailer.mjs"), "utf8")
  assert.match(source, /import \{ buildVietnameseEmail \}/u)
  assert.match(source, /buildVietnameseEmail\(\{ bodyText: teacherBodyText/u)
  assert.match(source, /buildVietnameseEmail\(\{ bodyText: learnerBodyText/u)
})
