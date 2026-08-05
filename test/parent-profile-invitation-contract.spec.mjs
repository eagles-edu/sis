import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { resolveParentPortalAccountIdentity } from "../src/modules/admin/parent-profile-invitations.mjs"

const rootDir = process.cwd()
const invitations = fs.readFileSync(path.resolve(rootDir, "src/modules/admin/parent-profile-invitations.mjs"), "utf8")
const routes = fs.readFileSync(path.resolve(rootDir, "server/student-admin-routes.mjs"), "utf8")

test("parent invitation emails use a tracker-safe route and one-click activation", () => {
  assert.match(invitations, /function invitationUrl\(token\) \{ return `\$\{publicOrigin\(\)\}\/parent\/profile-invitations\/\$\{encodeURIComponent\(token\)\}` \}/)
  assert.doesNotMatch(invitations, /Activation code|activationCode/)
  assert.match(invitations, /idempotencyKey: invitationIdempotencyKey\(invitationId\)/)
  assert.match(invitations, /lower\(invitation\.status\) === "sent"/)
  assert.match(invitations, /if \(!invitation\) return \{ ok: false, status: "missing", duplicate: true \}/)
  assert.match(routes, /next\.searchParams\.set\("activate", decodeURIComponent\(invitationLinkMatch\[1\]\)\)/)
  assert.match(routes, /PARENT_ACTIVATION_RECOVERY_PATH/)
})

test("setting a parent password does not complete an unsaved profile invitation", () => {
  const setPasswordBlock = routes.match(/if \(method === "POST" && pathname === PARENT_SET_PASSWORD_PATH\)[\s\S]*?if \(method === "POST" && pathname === logoutPath\)/)?.[0] || ""
  assert.match(setPasswordBlock, /PARENT_SET_PASSWORD_PATH/)
  assert.doesNotMatch(setPasswordBlock, /status: "completed"|completedAt/)
  assert.match(routes, /markParentProfileInvitationCompleted\(\{ studentRefId: child\.studentRefId \}\)/)
})

test("profile completion requires a saved signature and explicit agreement", () => {
  assert.match(routes, /"signatureAgreed"/)
  assert.match(routes, /The form must be signed, explicitly agreed to, and saved before it can be completed/)
  assert.match(routes, /signatureFullName = normalizeText\(draft\.signatureFullName\)/)
  assert.match(routes, /signatureEmail = normalizeLower\(draft\.signatureEmail\)/)
  assert.match(routes, /signatureAgreed = Array\.isArray\(draft\.signatureAgreed\)/)
  assert.match(routes, /if \(!signatureFullName \|\| !signatureEmail \|\| !signatureAgreed\)/)
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
