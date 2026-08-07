import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const writeImport = fs.readFileSync(path.resolve(rootDir, "src/modules/admin/student-write-import.mjs"), "utf8")
const invitations = fs.readFileSync(path.resolve(rootDir, "src/modules/admin/parent-profile-invitations.mjs"), "utf8")
const routes = fs.readFileSync(path.resolve(rootDir, "server/student-admin-routes.mjs"), "utf8")
const adminHtml = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/student-admin.html"), "utf8")
const adminJs = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/student-admin.js"), "utf8")

test("permanent student deletion covers all student-linked records", () => {
  for (const delegate of [
    "incomingExerciseResult",
    "studentNewsReport",
    "studentPointsAdjustment",
    "studentNewWord",
    "assignmentReminderDispatch",
    "parentPortalStudentLink",
    "parentProfileInvitation",
    "parentProfileSubmissionQueue",
    "parentProfileFieldLock",
    "studentEnrollmentPeriod",
    "studentPortalAccount",
  ]) {
    assert.match(writeImport, new RegExp(`tx\\.${delegate}\\.deleteMany`), delegate)
  }
  assert.match(writeImport, /deleteParentAccounts === true/)
  assert.match(writeImport, /remainingLinks = await tx\.parentPortalStudentLink\.findMany/)
  assert.match(writeImport, /parentPortalAccount\.deleteMany/)
  assert.match(routes, /deleteParentAccounts: payload\?\.deleteParentAccounts === true/)
})

test("admin deletion exposes an explicit parent-account checkbox", () => {
  assert.match(adminHtml, /id="deleteParentAccountCheckbox"[^>]*type="checkbox"/)
  assert.match(adminJs, /deleteParentAccounts: confirmation\.deleteParentAccounts === true/)
  assert.match(adminHtml, /Permanently delete student/)
})

test("parent email reuse preserves the explicit parent ID and rejects conflicts", () => {
  assert.match(invitations, /const accountByEmail = email\s*\? await prisma\.parentPortalAccount\.findUnique\(\{ where: \{ email \} \}\)/)
  assert.match(invitations, /Parent identity conflict: parentsId/)
  assert.match(invitations, /if \(accountByEmail && accountByEmail\.parentsId !== parentsId\)/)
  assert.match(invitations, /error\.statusCode = 409/)
  assert.match(invitations, /let account = accountByParentsId \|\| accountByEmail/)
  assert.match(invitations, /email: email \|\| null/)
  assert.doesNotMatch(invitations, /email: accountByEmail \? null/)
  assert.doesNotMatch(invitations, /account = \(email && await prisma\.parentPortalAccount\.findUnique/)
  assert.doesNotMatch(invitations, /parentPortalAccount\.update\(\{ where: \{ id: account\.id \}, data: \{ parentsId \}/)
  assert.match(routes, /resolveParentPortalAccountIdentity\(prisma, \{[\s\S]*?profile: payload\?\.profile,[\s\S]*?\}\)/)
})
