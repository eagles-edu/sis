import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import vm from "node:vm"
import {
  createActivationAttemptLimiter,
  ensureParentPortalAccount,
  resolveParentPortalAccountIdentity,
} from "../src/modules/admin/parent-profile-invitations.mjs"

const rootDir = process.cwd()
const invitations = fs.readFileSync(path.resolve(rootDir, "src/modules/admin/parent-profile-invitations.mjs"), "utf8")
const routes = fs.readFileSync(path.resolve(rootDir, "server/student-admin-routes.mjs"), "utf8")
const schema = fs.readFileSync(path.resolve(rootDir, "prisma/schema.prisma"), "utf8")
const adminHtml = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/student-admin.html"), "utf8")
const adminJs = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/student-admin.js"), "utf8")
const profileIsland = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/profile-island.mjs"), "utf8")
const parentJs = fs.readFileSync(path.resolve(rootDir, "web-asset/parent/parent-portal.js"), "utf8")
const redeemStart = invitations.indexOf("export async function redeemParentProfileInvitation(")
const redeemEnd = invitations.indexOf("\nexport async function recoverParentProfileInvitation(", redeemStart)
assert.ok(redeemStart >= 0 && redeemEnd > redeemStart)

test("parent invitation emails use a tracker-safe route and one-click activation", () => {
  assert.match(invitations, /function invitationUrl\(token, origin = publicOrigin\(\)\) \{ return `\$\{origin\}\/parent\/profile-invitations\/\$\{encodeURIComponent\(token\)\}` \}/)
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
  assert.match(invitations, /\.\.\.\(includeUrl \? \{ url: invitationUrl\(token, invitationOrigin\) \} : \{\}\)/u)
  assert.match(routes, /if \(method === "POST" && pathname === ADMIN_PARENT_PROFILE_INVITATION_PATH\) \{[\s\S]*sendEmail: false[\s\S]*includeUrl: true/u)
  assert.match(adminHtml, /id="profileCopyParentLinkBtn"[\s\S]*>\s*Copy Link/u)
  assert.match(adminJs, /api\("\/api\/admin\/parent-profile-invitations", \{[\s\S]*method: "POST"[\s\S]*studentRefId: state\.currentStudent\.id/u)
  assert.match(adminJs, /await copyTextToClipboard\(result\?\.invitation\?\.url\)/u)
  assert.match(profileIsland, /onProfileCopyParentLink/u)
})

test("profile invitation validates its public origin before creating a database record", () => {
  const originIndex = invitations.indexOf("const invitationOrigin = publicOrigin()")
  const transactionIndex = invitations.indexOf("const invitation = await prisma.$transaction")
  assert.ok(originIndex >= 0, "profile invitation origin validation is required")
  assert.ok(transactionIndex >= 0, "profile invitation transaction is required")
  assert.ok(originIndex < transactionIndex, "profile invitation origin must validate before the transaction")
  assert.match(invitations, /url: invitationUrl\(token, invitationOrigin\)/u)
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

test("parent submission rejects each missing signature component without changing draft state", async () => {
  const source = routes
  const submitStart = source.indexOf("async function setParentProfileSubmissionSubmitted(")
  const submitEnd = source.indexOf("\nasync function listParentProfileSubmissions(", submitStart)
  assert.ok(submitStart >= 0 && submitEnd > submitStart)
  const cases = [
    { label: "signature name", draft: { signatureFullName: "", signatureEmail: "parent@example.invalid", signatureAgreed: ["yes"] } },
    { label: "signature email", draft: { signatureFullName: "Synthetic Parent", signatureEmail: "", signatureAgreed: ["yes"] } },
    { label: "agreement", draft: { signatureFullName: "Synthetic Parent", signatureEmail: "parent@example.invalid", signatureAgreed: ["no"] } },
  ]

  for (const [index, entry] of cases.entries()) {
    const row = {
      id: `synthetic-signature-submission-${index + 1}`,
      parentAccountId: "synthetic-parent-signature",
      studentRefId: "synthetic-student-signature",
      status: "draft",
      draftPayloadJson: entry.draft,
    }
    let updateCalls = 0
    const context = vm.createContext({
      Date,
      Error,
      PARENT_PROFILE_QUEUE_STATUS_DRAFT: "draft",
      PARENT_PROFILE_QUEUE_STATUS_SUBMITTED: "submitted",
      normalizeText: (value) => String(value ?? "").trim(),
      normalizeLower: (value) => String(value ?? "").trim().toLowerCase(),
      resolveBoolean: (value, fallback = false) => value === true || String(value).toLowerCase() === "true" || (value === undefined ? fallback : false),
      withParentProfileSubmissionWriteLock: async (prisma, _parentAccountId, _studentRefId, handler) => handler(prisma),
      runParentPortalDbOperation: (handler) => handler({
        parentProfileSubmissionQueue: {
          findFirst: async () => row,
          update: async ({ data }) => {
            updateCalls += 1
            Object.assign(row, data)
            return row
          },
        },
      }),
      mapParentProfileSubmissionRecord: (record) => record,
    })
    const submit = vm.runInContext(`(${source.slice(submitStart, submitEnd)})`, context)

    await assert.rejects(
      submit({ parentAccountId: row.parentAccountId, studentRefId: row.studentRefId }),
      (error) => error?.statusCode === 400 && /signed, explicitly agreed to, and saved/i.test(error.message),
      `${entry.label} must be required`,
    )
    assert.equal(row.status, "draft", `${entry.label} failure must leave the draft unsubmitted`)
    assert.equal(updateCalls, 0, `${entry.label} failure must not update the queue row`)
  }
})

test("expired and reused parent activation links are rejected without consuming them again", async () => {
  const token = "synthetic-parent-invitation-token-025"
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex")
  const expiredInvitation = {
    id: "synthetic-expired-invitation-025",
    tokenHash,
    status: "sent",
    expiresAt: new Date(Date.now() - 60_000),
  }
  const activatedInvitation = {
    id: "synthetic-activated-invitation-025",
    tokenHash,
    status: "activated",
    expiresAt: new Date(Date.now() + 60_000),
  }
  let selectedInvitation = expiredInvitation
  let updateManyCalls = 0
  const context = vm.createContext({
    Date,
    Error,
    activationAttemptLimiter: {
      assertNotLocked: () => {},
      recordFailure: () => {},
      clear: () => {},
    },
    text: (value) => value === undefined || value === null ? "" : String(value).trim(),
    lower: (value) => value === undefined || value === null ? "" : String(value).trim().toLowerCase(),
    tokenHash: (value) => crypto.createHash("sha256").update(String(value ?? "").trim()).digest("hex"),
    getSharedPrismaClient: async () => ({
      parentProfileInvitation: {
        findUnique: async ({ where }) => {
          assert.equal(where.tokenHash, tokenHash)
          return selectedInvitation
        },
        updateMany: async () => {
          updateManyCalls += 1
          return { count: 0 }
        },
      },
    }),
  })
  const redeem = vm.runInContext(`(${invitations.slice(redeemStart, redeemEnd).replace("export async function", "async function")})`, context)

  await assert.rejects(
    redeem({ token, sourceKey: "synthetic-expired-source" }),
    (error) => error?.statusCode === 410 && /invalid, expired, or has already been used/i.test(error.message),
  )
  assert.equal(updateManyCalls, 0, "expired invitation must not be activated")

  selectedInvitation = activatedInvitation
  await assert.rejects(
    redeem({ token, sourceKey: "synthetic-reused-source" }),
    (error) => error?.statusCode === 410 && /invalid, expired, or has already been used/i.test(error.message),
  )
  assert.equal(updateManyCalls, 0, "already activated invitation must not be activated a second time")

  selectedInvitation = { ...activatedInvitation, status: "sent" }
  await assert.rejects(
    redeem({ token, sourceKey: "synthetic-race-source" }),
    (error) => error?.statusCode === 410 && /already been used/i.test(error.message),
  )
  assert.equal(updateManyCalls, 1, "conditional activation must reject a concurrent prior redemption")
})

test("successful parent activations do not exhaust the shared source failure limit", async () => {
  const windowMs = 15 * 60 * 1000
  const clockState = { now: 1_800_000_000_000 }
  const activationAttemptLimiter = createActivationAttemptLimiter({
    windowMs,
    maxAttempts: 8,
    clock: () => clockState.now,
  })
  let validInvitations = true
  let databaseLookupCount = 0
  const context = vm.createContext({
    Date,
    Error,
    activationAttemptLimiter,
    text: (value) => value === undefined || value === null ? "" : String(value).trim(),
    lower: (value) => value === undefined || value === null ? "" : String(value).trim().toLowerCase(),
    tokenHash: (value) => String(value ?? "").trim(),
    getSharedPrismaClient: async () => ({
      parentProfileInvitation: {
        findUnique: async ({ where }) => {
          databaseLookupCount += 1
          return validInvitations
            ? { id: where.tokenHash, status: "sent", expiresAt: new Date(Date.now() + 60000), clickedAt: null }
            : null
        },
        updateMany: async () => ({ count: 1 }),
      },
    }),
  })
  const redeem = vm.runInContext(
    `(${invitations.slice(redeemStart, redeemEnd).replace("export async function", "async function")})`,
    context,
  )

  for (let index = 0; index < 12; index += 1) {
    const invitation = await redeem({ token: `synthetic-valid-token-${index}`, sourceKey: "shared-school-nat" })
    assert.equal(invitation.status, "sent")
  }

  validInvitations = false
  for (let index = 0; index < 8; index += 1) {
    await assert.rejects(
      redeem({ token: `synthetic-invalid-token-${index}`, sourceKey: "shared-school-nat" }),
      (error) => error?.statusCode === 410,
    )
  }
  await assert.rejects(
    redeem({ token: "synthetic-invalid-token-locked", sourceKey: "shared-school-nat" }),
    (error) => error?.statusCode === 429,
  )
  assert.equal(databaseLookupCount, 20, "a locked source must be rejected before another database lookup")

  clockState.now += windowMs
  activationAttemptLimiter.assertNotLocked("shared-school-nat")
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
