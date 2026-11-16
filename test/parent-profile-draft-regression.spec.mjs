import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import vm from "node:vm"

const source = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")
const start = source.indexOf("async function saveParentProfileDraftSubmission(")
const end = source.indexOf("\nasync function setParentProfileSubmissionSubmitted(", start)
assert.ok(start >= 0 && end > start)

test("repeated parent draft saves preserve earlier fields and replace only edited fields", async () => {
  let row = null
  const prisma = { parentProfileSubmissionQueue: {
    findFirst: async () => row,
    create: async ({ data }) => (row = { id: "draft-1", ...data, createdAt: new Date(), updatedAt: new Date() }),
    update: async ({ data }) => (row = { ...row, ...data, updatedAt: new Date() }),
  } }
  const context = vm.createContext({
    Date,
    normalizeText: (value) => String(value ?? "").trim(),
    PARENT_PROFILE_QUEUE_STATUS_DRAFT: "draft",
    runParentPortalDbOperation: (handler) => handler(prisma),
    mapParentProfileSubmissionRecord: (record) => record,
    buildProfileDiffSnapshot: (profile, patch) => ({ changedFields: Object.entries(patch).filter(([key, value]) => JSON.stringify(profile[key] ?? null) !== JSON.stringify(value ?? null)).map(([fieldKey, to]) => ({ fieldKey, to })) }),
  })
  const save = vm.runInContext(`(${source.slice(start, end)})`, context)
  const common = { parentAccountId: "parent-1", studentRefId: "student-1", currentProfile: { fullName: "Old" } }
  await save({ ...common, draftPayloadJson: { fullName: "New", signatureFullName: "Parent", signatureEmail: "parent@example.test", signatureAgreed: ["yes"] } })
  const saved = await save({ ...common, draftPayloadJson: { fullName: "Newest", motherPhone: "123" } })
  assert.deepEqual(JSON.parse(JSON.stringify(saved.draftPayloadJson)), { fullName: "Newest", signatureFullName: "Parent", signatureEmail: "parent@example.test", signatureAgreed: ["yes"], motherPhone: "123" })
  assert.equal(saved.diffPayloadJson.changedFields.length, 5)
})
