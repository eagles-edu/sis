import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { ensureParentPortalAccount, resolveParentPortalAccountIdentity } from "../src/modules/admin/parent-profile-invitations.mjs"

const rootDir = process.cwd()
const invitations = fs.readFileSync(path.resolve(rootDir, "src/modules/admin/parent-profile-invitations.mjs"), "utf8")
const routes = fs.readFileSync(path.resolve(rootDir, "server/student-admin-routes.mjs"), "utf8")
const schema = fs.readFileSync(path.resolve(rootDir, "prisma/schema.prisma"), "utf8")
const adminHtml = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/student-admin.html"), "utf8")
const adminJs = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/student-admin.js"), "utf8")
const profileIsland = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/profile-island.mjs"), "utf8")
const parentJs = fs.readFileSync(path.resolve(rootDir, "web-asset/parent/parent-portal.js"), "utf8")

test("parent invitation emails use a tracker-safe route and one-click activation", () => {
  assert.match(invitations, /function invitationUrl\(token\) \{ return `\$\{publicOrigin\(\)\}\/parent\/profile-invitations\/\$\{encodeURIComponent\(token\)\}` \}/)
  assert.match(invitations, /function invitationOpenUrl\(token\) \{ return `\$\{publicOrigin\(\)\}\/api\/parent\/profile-invitations\/\$\{encodeURIComponent\(token\)\}\/open\.gif` \}/)
  assert.match(invitations, /openPixel = `<img src="\$\{safe\(openUrl\)\}" width="1" height="1" alt="" aria-hidden="true"/)
  assert.doesNotMatch(invitations, /Activation code|activationCode/)
  assert.match(invitations, /idempotencyKey: invitationIdempotencyKey\(invitationId\)/)
  assert.match(invitations, /lower\(invitation\.status\) === "sent"/)
  assert.match(invitations, /if \(!invitation\) return \{ ok: false, status: "missing", duplicate: true \}/)
  assert.match(routes, /next\.searchParams\.set\("activate", decodeURIComponent\(invitationLinkMatch\[1\]\)\)/)
  assert.match(routes, /await consumeParentProfileInvitation\(decodeURIComponent\(invitationLinkMatch\[1\]\), \{ mark: "clicked" \}\)/)
  assert.match(routes, /PARENT_ACTIVATION_RECOVERY_PATH/)
})

test("admin student profiles can create and copy a one-time parent link without sending another email", () => {
  assert.match(invitations, /sendEmail = true, includeUrl = false/u)
  assert.match(invitations, /const email = lower\(recipientEmail \|\| \(allowProfileEmail \? student\.profile\?\.motherEmail \|\| student\.profile\?\.studentEmail : ""\)\)/u)
  assert.match(invitations, /if \(sendEmail\) \{[\s\S]*enqueueAsyncSideEffectJob/u)
  assert.match(invitations, /\.\.\.\(includeUrl \? \{ url: invitationUrl\(token\) \} : \{\}\)/u)
  assert.match(routes, /if \(method === "POST" && pathname === ADMIN_PARENT_PROFILE_INVITATION_PATH\) \{[\s\S]*sendEmail: false[\s\S]*includeUrl: true/u)
  assert.match(adminHtml, /id="profileCopyParentLinkBtn"[\s\S]*>\s*Copy Link/u)
  assert.match(adminJs, /api\("\/api\/admin\/parent-profile-invitations", \{[\s\S]*method: "POST"[\s\S]*studentRefId: state\.currentStudent\.id/u)
  assert.match(adminJs, /await copyTextToClipboard\(result\?\.invitation\?\.url\)/u)
  assert.match(profileIsland, /onProfileCopyParentLink/u)
})

test("copy-link invitations support email-less parent setup for phone, text, or Zalo sharing", () => {
  assert.match(schema, /model ParentProfileInvitation[\s\S]*recipientEmail\s+String\?/u)
  assert.match(invitations, /if \(email && !EMAIL_PATTERN\.test\(email\)\)/u)
  assert.match(invitations, /if \(sendEmail && !email\)/u)
  assert.match(invitations, /recipientEmail: email \|\| null/u)
  assert.match(invitations, /deliveryMethod: sendEmail \? "email" : "phone-text-zalo"/u)
  assert.match(invitations, /allowProfileEmail = true/u)
  assert.match(routes, /allowProfileEmail: false/u)
  assert.match(adminJs, /Parent profile link copied for phone, text, or Zalo/u)
  assert.match(adminHtml, /share by phone, text, or Zalo/u)
})

test("setting a parent password does not complete an unsaved profile invitation", () => {
  const setPasswordBlock = routes.match(/if \(method === "POST" && pathname === PARENT_SET_PASSWORD_PATH\)[\s\S]*?if \(method === "POST" && pathname === logoutPath\)/)?.[0] || ""
  assert.match(setPasswordBlock, /PARENT_SET_PASSWORD_PATH/)
  assert.doesNotMatch(setPasswordBlock, /status: "completed"|completedAt/)
  assert.match(routes, /markParentProfileInvitationCompleted\(\{ studentRefId: child\.studentRefId \}\)/)
})

test("profile completion requires a saved signature, email, and explicit agreement", () => {
  assert.match(routes, /"signatureAgreed"/)
  assert.match(routes, /The form must be signed, explicitly agreed to, and saved before it can be completed/)
  assert.match(routes, /signatureFullName = normalizeText\(draft\.signatureFullName\)/)
  assert.match(routes, /signatureEmail = normalizeLower\(draft\.signatureEmail\)/u)
  assert.match(routes, /signatureAgreed = Array\.isArray\(draft\.signatureAgreed\)/)
  assert.match(routes, /if \(!signatureFullName \|\| !signatureEmail \|\| !signatureAgreed\)/)
  assert.match(parentJs, /key: "motherEmail",[\s\S]{0,180}required: true/u)
  assert.match(parentJs, /key: "signatureEmail",[\s\S]{0,180}required: true/u)
  assert.match(routes, /const required = \[profile\.fullName, profile\.currentGrade, profile\.motherName, profile\.motherEmail, profile\.motherPhone\]/u)
  assert.match(routes, /sentAt: row\.invitationSentAt \|\| row\.invitationQueuedAt/u)
})

test("parent identity rejects email reuse across Parents IDs instead of creating an email-less account", () => {
  assert.match(invitations, /if \(accountByEmail && accountByEmail\.parentsId !== parentsId\)/)
  assert.match(invitations, /code = "PARENT_ID_EMAIL_CONFLICT"/)
  assert.doesNotMatch(invitations, /email: accountByEmail \? null/)
})

test("parent identity firewall rejects a recipient email owned by another Parents ID", async () => {
  const accounts = {
    cmandy001: { id: "account-andy", parentsId: "cmandy001", email: "shared@example.com" },
  }
  const prisma = {
    parentPortalAccount: {
      findUnique: async ({ where }) => {
        if (where.parentsId) return accounts[where.parentsId] || null
        return Object.values(accounts).find((account) => account.email === where.email) || null
      },
    },
  }
  await assert.rejects(
    resolveParentPortalAccountIdentity(prisma, {
      eaglesId: "amos001",
      profile: { parentsId: "cmamos001", motherEmail: "shared@example.com" },
    }),
    (error) => error?.statusCode === 409 && error?.code === "PARENT_ID_EMAIL_CONFLICT",
  )
})

test("email-less parent account setup links the parent account to the student", async () => {
  let account = null
  let link = null
  const prisma = {
    parentPortalAccount: {
      findUnique: async ({ where }) => where.parentsId === "cmalvin001" ? account : null,
      create: async ({ data }) => {
        account = { id: "account-alvin", ...data }
        return account
      },
      update: async ({ data }) => {
        account = { ...account, ...data }
        return account
      },
    },
    parentPortalStudentLink: {
      upsert: async ({ create }) => {
        link = { id: "link-alvin", ...create }
        return link
      },
    },
  }
  const result = await ensureParentPortalAccount(prisma, {
    id: "student-alvin",
    eaglesId: "alvin001",
    profile: {
      parentsId: "cmalvin001",
      motherEmail: "parent@example.com",
      motherPhone: "+84937777888",
      motherMessenger: "Zalo",
    },
  }, "", { allowProfileEmail: false })
  assert.equal(result.account.email, null)
  assert.equal(result.account.parentsId, "cmalvin001")
  assert.deepEqual(link, { id: "link-alvin", parentAccountId: "account-alvin", studentRefId: "student-alvin" })
})
