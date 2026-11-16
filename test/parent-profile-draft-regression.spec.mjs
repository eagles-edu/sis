import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import vm from "node:vm"

const source = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")
const draftStart = source.indexOf("async function loadParentProfileDraftPayload(")
const draftEnd = source.indexOf("\nasync function saveParentProfileDraftSubmission(", draftStart)
const start = source.indexOf("async function saveParentProfileDraftSubmission(")
const end = source.indexOf("\nasync function setParentProfileSubmissionSubmitted(", start)
const submitStart = source.indexOf("async function setParentProfileSubmissionSubmitted(")
const submitEnd = source.indexOf("\nasync function listParentProfileSubmissions(", submitStart)
const listStart = source.indexOf("async function listParentProfileSubmissions(", submitEnd)
const listEnd = source.indexOf("\nasync function getParentProfileSubmissionById(", listStart)
const parentSubmitRouteStart = source.indexOf("  const submitPathMatch = pathname.match(PARENT_CHILD_PROFILE_SUBMIT_PATH_RE)")
const parentSubmitRouteEnd = source.indexOf("\n\n  return false", parentSubmitRouteStart)
assert.ok(draftStart >= 0 && draftEnd > draftStart)
assert.ok(start >= 0 && end > start)
assert.ok(submitStart >= 0 && submitEnd > submitStart)
assert.ok(listStart >= 0 && listEnd > listStart)
assert.ok(parentSubmitRouteStart >= 0 && parentSubmitRouteEnd > parentSubmitRouteStart)

test("parent profile reload reads only the latest draft for the authenticated parent and linked student", async () => {
  let query = null
  const savedDraft = {
    schoolName: "Draft School",
    otherLanguage: "Saved draft language",
    signatureFullName: "Parent Name",
    signatureEmail: "parent@example.test",
    signatureAgreed: ["yes"],
  }
  const context = vm.createContext({
    normalizeText: (value) => String(value ?? "").trim(),
    PARENT_PROFILE_QUEUE_STATUS_DRAFT: "draft",
    PARENT_PORTAL_MEMORY: { submissions: [] },
    runParentPortalDbOperation: (handler) => handler({
      parentProfileSubmissionQueue: {
        findFirst: async (args) => {
          query = args
          return { draftPayloadJson: savedDraft }
        },
      },
    }),
  })
  const loadDraft = vm.runInContext(`(${source.slice(draftStart, draftEnd)})`, context)
  const payload = await loadDraft({ parentAccountId: "parent-1", studentRefId: "student-1" })
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), savedDraft)
  assert.deepEqual(JSON.parse(JSON.stringify(query.where)), {
    parentAccountId: "parent-1",
    studentRefId: "student-1",
    status: "draft",
  })
  assert.deepEqual(JSON.parse(JSON.stringify(query.orderBy)), { updatedAt: "desc" })
})

test("parent profile reload uses the newest matching draft in volatile test storage", async () => {
  const context = vm.createContext({
    normalizeText: (value) => String(value ?? "").trim(),
    PARENT_PROFILE_QUEUE_STATUS_DRAFT: "draft",
    PARENT_PORTAL_MEMORY: {
      submissions: [
        { parentAccountId: "parent-1", studentRefId: "student-1", status: "draft", updatedAt: "2026-01-01T00:00:00.000Z", draftPayloadJson: { schoolName: "Older" } },
        { parentAccountId: "parent-1", studentRefId: "student-1", status: "draft", updatedAt: "2026-01-02T00:00:00.000Z", draftPayloadJson: { schoolName: "Newest", signatureAgreed: ["yes"] } },
        { parentAccountId: "parent-2", studentRefId: "student-1", status: "draft", updatedAt: "2026-01-03T00:00:00.000Z", draftPayloadJson: { schoolName: "Other parent" } },
      ],
    },
    runParentPortalDbOperation: async (_handler, memoryFallback) => memoryFallback(),
  })
  const loadDraft = vm.runInContext(`(${source.slice(draftStart, draftEnd)})`, context)
  const payload = await loadDraft({ parentAccountId: "parent-1", studentRefId: "student-1" })
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), { schoolName: "Newest", signatureAgreed: ["yes"] })
})

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

test("parent submission enters the review queue without changing the official profile", async () => {
  const originalOfficialProfile = { fullName: "Synthetic Learner", schoolName: "Official School" }
  const officialProfile = structuredClone(originalOfficialProfile)
  let row = {
    id: "synthetic-parent-profile-submission-019",
    parentAccountId: "synthetic-parent-019",
    studentRefId: "synthetic-student-019",
    status: "draft",
    draftPayloadJson: {
      fullName: "Updated Synthetic Learner",
      schoolName: "Requested School",
      signatureFullName: "Synthetic Parent",
      signatureEmail: "parent@example.invalid",
      signatureAgreed: ["yes"],
    },
    comment: null,
    submittedAt: null,
    reviewedAt: null,
    createdAt: new Date("2026-11-17T00:00:00.000Z"),
    updatedAt: new Date("2026-11-17T00:00:00.000Z"),
  }
  let officialProfileWrites = 0
  const prisma = {
    parentProfileSubmissionQueue: {
      findFirst: async ({ where }) => row.parentAccountId === where.parentAccountId
        && row.studentRefId === where.studentRefId
        && row.status === where.status
        ? row
        : null,
      update: async ({ data }) => {
        row = { ...row, ...data, updatedAt: new Date("2026-11-17T00:01:00.000Z") }
        return row
      },
      findMany: async ({ where }) => {
        if (where.parentAccountId && row.parentAccountId !== where.parentAccountId) return []
        if (where.status?.in?.length && !where.status.in.includes(row.status)) return []
        return [row]
      },
    },
    studentProfile: {
      update: async () => { officialProfileWrites += 1 },
      create: async () => { officialProfileWrites += 1 },
    },
  }
  const context = vm.createContext({
    Date,
    normalizeText: (value) => String(value ?? "").trim(),
    normalizeLower: (value) => String(value ?? "").trim().toLowerCase(),
    resolveBoolean: (value, fallback = false) => value === true || String(value).toLowerCase() === "true" || (value === undefined ? fallback : false),
    PARENT_PROFILE_QUEUE_STATUS_DRAFT: "draft",
    PARENT_PROFILE_QUEUE_STATUS_SUBMITTED: "submitted",
    PARENT_PROFILE_QUEUE_ALLOWED_STATUSES: new Set(["draft", "submitted", "approved", "rejected"]),
    runParentPortalDbOperation: (handler) => handler(prisma),
    mapParentProfileSubmissionRecord: (record) => record,
    PARENT_PORTAL_MEMORY: { submissions: [] },
  })
  const submit = vm.runInContext(`(${source.slice(submitStart, submitEnd)})`, context)
  const list = vm.runInContext(`(${source.slice(listStart, listEnd)})`, context)
  const submitted = await submit({
    parentAccountId: "synthetic-parent-019",
    studentRefId: "synthetic-student-019",
    comment: "Synthetic review request",
  })
  const queued = await list({ statuses: ["submitted"], parentAccountId: "synthetic-parent-019" })

  assert.equal(submitted.status, "submitted")
  assert.ok(submitted.submittedAt)
  assert.equal(queued.length, 1)
  assert.equal(queued[0].id, "synthetic-parent-profile-submission-019")
  assert.deepEqual(JSON.parse(JSON.stringify(queued[0].draftPayloadJson)), {
    fullName: "Updated Synthetic Learner",
    schoolName: "Requested School",
    signatureFullName: "Synthetic Parent",
    signatureEmail: "parent@example.invalid",
    signatureAgreed: ["yes"],
  })
  assert.deepEqual(officialProfile, originalOfficialProfile)
  assert.equal(officialProfileWrites, 0)

  const route = source.slice(parentSubmitRouteStart, parentSubmitRouteEnd)
  assert.match(route, /setParentProfileSubmissionSubmitted\(/)
  assert.doesNotMatch(route, /studentProfile\.(?:create|update)\(/)
})
