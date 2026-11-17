import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import test from "node:test"
import { parse as parseDotenv } from "dotenv"
import "../tools/assert-prisma-environment.mjs"

const ENV_FILE = String(process.env.SIS_ENV_FILE || "").trim()
const ENV_VALUES = fs.existsSync(ENV_FILE) ? parseDotenv(fs.readFileSync(ENV_FILE)) : {}
const IS_DEV_RUN = process.env.NODE_ENV === "development" && ENV_FILE === ".env.dev"

test("dev Library review persists rejection, duplicate canonicalization, and legacy replacement outcomes", { skip: !IS_DEV_RUN }, async (t) => {
  Object.assign(process.env, ENV_VALUES)
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { listLibraryReviewQueue, reviewLibraryContribution } = await import("../src/modules/admin/library-corpus.mjs")
  const prisma = await getSharedPrismaClient()
  const database = await prisma.$queryRawUnsafe("SELECT current_database() AS name")
  assert.equal(database[0]?.name, "sis_dev", "the integration regression must use the development database")

  const stamp = randomUUID().replaceAll("-", "")
  const rejectEnglish = `ka045reject${stamp}`
  const duplicateEnglish = `ka045duplicate${stamp}`
  const legacyEnglish = `ka045legacy${stamp}`
  const fixtureIds = {
    reject: `ka045-${stamp}-reject`,
    duplicateA: `ka045-${stamp}-duplicate-a`,
    duplicateB: `ka045-${stamp}-duplicate-b`,
    legacy: `ka045-${stamp}-legacy`,
    awaiting: `ka045-${stamp}-awaiting`,
  }
  const payload = (english, definition) => ({
    english,
    partOfSpeech: "noun",
    vietnamese: "test word",
    syllabication: english,
    definition,
    countability: "countable",
    nounType: "common",
    nounNumber: "singular",
    physicalQuality: "concrete",
    grammaticalNumber: "singular",
    primaryClassification: "common",
  })
  const cleanup = async () => {
    const contributionIds = Object.values(fixtureIds)
    await prisma.libraryContributionRevision.deleteMany({ where: { contributionId: { in: contributionIds } } })
    await prisma.libraryContribution.deleteMany({ where: { id: { in: contributionIds } } })
    const entries = await prisma.libraryEntry.findMany({
      where: { normalizedKey: { in: [rejectEnglish, duplicateEnglish, legacyEnglish] } },
      select: { id: true },
    })
    const entryIds = entries.map((entry) => entry.id)
    if (entryIds.length) {
      await prisma.libraryEntryRevision.deleteMany({ where: { entryId: { in: entryIds } } })
      await prisma.libraryEntry.deleteMany({ where: { id: { in: entryIds } } })
    }
  }

  t.after(async () => {
    let cleanupError
    for (let pass = 0; pass < 2; pass += 1) {
      try {
        await cleanup()
      } catch (error) {
        cleanupError = error
      }
    }
    await prisma.$disconnect()
    if (cleanupError) throw cleanupError
  })

  const fixtures = [
    { id: fixtureIds.reject, english: rejectEnglish, status: "pending_review", definition: "Rejected synthetic contribution." },
    { id: fixtureIds.duplicateA, english: duplicateEnglish, status: "pending_review", definition: "A shorter duplicate definition." },
    { id: fixtureIds.duplicateB, english: duplicateEnglish, status: "pending_review", definition: "A longer duplicate definition retained for canonical review." },
    { id: fixtureIds.legacy, english: legacyEnglish, status: "legacy_pending_review", definition: "Legacy source retained for canonical review." },
    { id: fixtureIds.awaiting, english: legacyEnglish, status: "awaiting_legacy_canonical", definition: "Legacy replacement waiting for canonical selection." },
  ]
  await prisma.libraryContribution.createMany({
    data: fixtures.map((fixture) => ({
      id: fixture.id,
      contributorName: "KA-045 synthetic review regression",
      sourceKind: "student_new_words",
      sourceId: fixture.id,
      payloadJson: payload(fixture.english, fixture.definition),
      status: fixture.status,
    })),
  })

  const queue = await listLibraryReviewQueue({ status: "open_review" })
  const duplicateQueueItem = queue.items.find((item) => item.duplicateGroupKey === `${duplicateEnglish}|noun`)
  assert.equal(duplicateQueueItem?.potentialDuplicate, true, "the review queue groups duplicate pending contributions")
  assert.deepEqual(new Set(duplicateQueueItem?.duplicateGroup.map((item) => item.id)), new Set([fixtureIds.duplicateA, fixtureIds.duplicateB]))
  const legacyQueueItem = queue.items.find((item) => item.duplicateGroupKey === `${legacyEnglish}|noun`)
  assert.equal(legacyQueueItem?.legacyGroup, true, "the review queue identifies a legacy canonicalization group")

  const rejected = await reviewLibraryContribution(fixtureIds.reject, { name: "KA-045 reviewer", role: "admin" }, { approved: false })
  assert.deepEqual(rejected, { ok: true, status: "rejected" })
  const rejectedRow = await prisma.libraryContribution.findUnique({ where: { id: fixtureIds.reject } })
  assert.equal(rejectedRow?.status, "rejected")
  assert.equal(rejectedRow?.reviewedByName, "KA-045 reviewer")
  assert.ok(rejectedRow?.reviewedAt)
  assert.equal(await prisma.libraryEntry.findUnique({ where: { normalizedKey_partOfSpeech: { normalizedKey: rejectEnglish, partOfSpeech: "noun" } } }), null, "rejection does not create a canonical Library entry")
  assert.equal(await prisma.libraryContributionRevision.count({ where: { contributionId: fixtureIds.reject, action: "rejected" } }), 1, "rejection records one immutable contribution revision")

  const duplicateApproved = await reviewLibraryContribution(fixtureIds.duplicateA, { name: "KA-045 reviewer", role: "admin" }, {
    approved: true,
    canonicalContributionId: fixtureIds.duplicateA,
    entry: payload(duplicateEnglish, "Canonical duplicate definition."),
  })
  assert.equal(duplicateApproved.ok, true)
  const duplicateRows = await prisma.libraryContribution.findMany({ where: { id: { in: [fixtureIds.duplicateA, fixtureIds.duplicateB] } }, orderBy: { id: "asc" } })
  assert.equal(duplicateRows.every((row) => row.status === "canonicalized"), true, "approval canonicalizes every duplicate contribution")
  assert.equal(new Set(duplicateRows.map((row) => row.entryId)).size, 1, "all duplicate contributions point to the single canonical entry")
  assert.equal(duplicateApproved.entry.id, duplicateRows[0].entryId)
  assert.equal(duplicateApproved.entry.definition, "Canonical duplicate definition.")
  assert.equal(await prisma.libraryContributionRevision.count({ where: { contributionId: { in: [fixtureIds.duplicateA, fixtureIds.duplicateB] }, action: "canonicalized" } }), 2, "duplicate review records both contribution decisions")

  const legacyApproved = await reviewLibraryContribution(fixtureIds.legacy, { name: "KA-045 reviewer", role: "admin" }, {
    approved: true,
    canonicalContributionId: fixtureIds.legacy,
    entry: payload(legacyEnglish, "Canonicalized legacy definition."),
  })
  const legacyRows = await prisma.libraryContribution.findMany({ where: { id: { in: [fixtureIds.legacy, fixtureIds.awaiting] } } })
  const legacy = legacyRows.find((row) => row.id === fixtureIds.legacy)
  const awaiting = legacyRows.find((row) => row.id === fixtureIds.awaiting)
  assert.equal(legacyApproved.ok, true)
  assert.equal(legacy?.status, "canonicalized", "the selected legacy source becomes the canonicalized contribution")
  assert.equal(awaiting?.status, "pending_canonical_replacement", "the waiting source becomes a pending canonical replacement")
  assert.equal(legacy?.entryId, awaiting?.entryId, "legacy and replacement contributions point to one canonical entry")
  assert.ok(awaiting?.dueAt, "the replacement receives its student edit deadline")
  assert.equal(await prisma.libraryContributionRevision.count({ where: { contributionId: fixtureIds.awaiting, action: "legacy_canonical_declared" } }), 1, "the legacy replacement decision is audited")
})
