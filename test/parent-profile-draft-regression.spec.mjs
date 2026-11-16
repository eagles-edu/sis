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
const adminReviewRouteStart = source.indexOf("  if (profileSubmissionMatch && method === \"POST\") {")
const adminReviewRouteEnd = source.indexOf("\n\n  if (method === \"POST\" && pathname === ADMIN_NOTIFY_EMAIL_PATH)", adminReviewRouteStart)
assert.ok(draftStart >= 0 && draftEnd > draftStart)
assert.ok(start >= 0 && end > start)
assert.ok(submitStart >= 0 && submitEnd > submitStart)
assert.ok(listStart >= 0 && listEnd > listStart)
assert.ok(parentSubmitRouteStart >= 0 && parentSubmitRouteEnd > parentSubmitRouteStart)
assert.ok(adminReviewRouteStart >= 0 && adminReviewRouteEnd > adminReviewRouteStart)

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

test("parent submission approval updates only its linked official profile and retains signature evidence", async () => {
  const submission = {
    id: "synthetic-approval-submission-021",
    studentRefId: "synthetic-approval-student-021",
    status: "submitted",
    draftPayloadJson: {
      fullName: "Updated Synthetic Learner",
      signatureFullName: "Synthetic Parent",
      signatureEmail: "parent@example.invalid",
      signatureAgreed: ["yes"],
      eaglesId: "attempted-id-change",
      studentNumber: 999999,
      adminOnlyValue: "discard this field",
    },
    adminEditedPayloadJson: null,
    diffPayloadJson: {},
  }
  const existingProfile = {
    studentRefId: "synthetic-approval-student-021",
    fullName: "Original Synthetic Learner",
    normalizedFormPayload: { existingNormalized: "keep" },
    rawFormPayload: { existingRaw: "keep" },
  }
  let profileLookupWhere = null
  let profileUpdateCall = null
  let profileCreateCall = null
  let queueUpdate = null
  let responsePayload = null
  const prisma = {
    studentProfile: {
      findUnique: async ({ where }) => {
        profileLookupWhere = where
        return existingProfile
      },
      update: async (args) => {
        profileUpdateCall = args
        return { ...existingProfile, ...args.data }
      },
      create: async (args) => {
        profileCreateCall = args
        return args.data
      },
    },
  }
  const context = vm.createContext({
    Date,
    Error,
    PARENT_PROFILE_IMMUTABLE_FIELDS: new Set(["eaglesId", "studentNumber"]),
    PARENT_PROFILE_EDITABLE_FIELDS: new Set(["fullName", "signatureFullName", "signatureEmail", "signatureAgreed", "eaglesId", "studentNumber"]),
    PARENT_PROFILE_QUEUE_STATUS_APPROVED: "approved",
    normalizeText: (value) => String(value ?? "").trim(),
    normalizeLower: (value) => String(value ?? "").trim().toLowerCase(),
    normalizeParentProfilePatch: (patch) => ({ ...patch }),
    listParentProfileFieldLocks: async () => [],
    getParentProfileSubmissionById: async (id) => id === submission.id ? submission : null,
    getSharedPrismaClient: async () => prisma,
    buildProfileDiffSnapshot: (profile, patch) => ({
      changedFields: Object.entries(patch)
        .filter(([key, value]) => JSON.stringify(profile?.[key] ?? null) !== JSON.stringify(value ?? null))
        .map(([fieldKey, to]) => ({ fieldKey, from: profile?.[fieldKey] ?? null, to })),
    }),
    updateParentProfileSubmissionById: async (id, patch) => {
      assert.equal(id, submission.id)
      queueUpdate = patch
      return { ...submission, ...patch }
    },
    assertCanManageUsers: () => {},
    nowIso: () => "2026-11-17T08:30:00.000Z",
    parseBody: async () => ({ action: "approve" }),
    sendJson: (_response, status, payload) => {
      responsePayload = { status, payload }
    },
    decodeURIComponent,
    PARENT_PROFILE_QUEUE_STATUS_SUBMITTED: "submitted",
    profileSubmissionMatch: ["/api/admin/profile-submissions/synthetic-approval-submission-021", submission.id],
    method: "POST",
    pathname: `/api/admin/profile-submissions/${submission.id}`,
    rolePolicy: { canManageUsers: true },
    session: { username: "synthetic-admin-021" },
    request: {},
    response: {},
  })
  const handleReview = vm.runInContext(
    `(async () => { ${source.slice(adminReviewRouteStart, adminReviewRouteEnd)} })`,
    context,
  )
  const handled = await handleReview()

  assert.equal(handled, true)
  assert.deepEqual(JSON.parse(JSON.stringify(profileLookupWhere)), {
    studentRefId: "synthetic-approval-student-021",
  })
  assert.equal(profileUpdateCall.where.studentRefId, "synthetic-approval-student-021")
  assert.equal(profileCreateCall, null)
  assert.equal(profileUpdateCall.data.fullName, "Updated Synthetic Learner")
  assert.equal(profileUpdateCall.data.signatureFullName, "Synthetic Parent")
  assert.equal(profileUpdateCall.data.signatureEmail, "parent@example.invalid")
  assert.equal(Object.hasOwn(profileUpdateCall.data, "signatureAgreed"), false)
  assert.equal(profileUpdateCall.data.normalizedFormPayload.existingNormalized, "keep")
  assert.equal(profileUpdateCall.data.rawFormPayload.existingRaw, "keep")
  for (const payload of [profileUpdateCall.data.normalizedFormPayload, profileUpdateCall.data.rawFormPayload]) {
    assert.equal(payload.signatureFullName, "Synthetic Parent")
    assert.equal(payload.signatureEmail, "parent@example.invalid")
    assert.deepEqual(JSON.parse(JSON.stringify(payload.signatureAgreed)), ["yes"])
  }
  assert.equal(Object.hasOwn(profileUpdateCall.data, "eaglesId"), false)
  assert.equal(Object.hasOwn(profileUpdateCall.data, "studentNumber"), false)
  assert.equal(Object.hasOwn(profileUpdateCall.data, "adminOnlyValue"), false)
  assert.equal(queueUpdate.status, "approved")
  assert.equal(queueUpdate.reviewedByUsername, "synthetic-admin-021")
  assert.ok(queueUpdate.diffPayloadJson.changedFields.some((field) => field.fieldKey === "fullName"))
  assert.equal(responsePayload.status, 200)
  assert.equal(responsePayload.payload.action, "approve")
  assert.equal(responsePayload.payload.item.status, "approved")
})
