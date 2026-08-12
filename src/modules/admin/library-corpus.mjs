import crypto from "node:crypto"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { queueAnnouncementEmail } from "./notification-queue.mjs"

const MW_BASE = "https://www.dictionaryapi.com/api/v3/references/collegiate/json"
const MAX_PAGE_SIZE = 100
const POS = new Set(["noun", "verb", "adjective", "adverb", "pronoun", "determiner", "conjunction", "preposition", "interjection", "numeral", "proper noun", "phrase", "idiom", "clause"])
const ENTRY_KINDS = new Set(["word", "phrase", "idiom", "phrasal verb"])
const PHRASE_TYPES = new Set(["verb", "noun", "adjective", "adverbial", "prepositional", "idiom"])
const POS_SUBTYPES = new Set(["personal", "possessive", "reflexive", "reciprocal", "demonstrative", "interrogative", "relative", "indefinite", "coordinating", "subordinating", "correlative"])
const VERB_TRANSITIVITY = new Set(["intransitive", "monotransitive", "ditransitive", "ambitransitive", "transitive"])
const NOUN_TYPES = new Set(["common", "proper", "concrete", "abstract", "material", "collective", "compound", "possessive"])
const NOUN_NUMBERS = new Set(["singular", "plural", "singular and plural"])

function text(value) { return String(value == null ? "" : value).trim() }
function lower(value) { return text(value).normalize("NFC").toLocaleLowerCase("en-US") }
function clamp(value, maximum = 240) { return text(value).slice(0, maximum) }
function grammarClassification(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const allowed = ["grammarFamily", "grammarSubtype", "grammarDetail", "grammarNumber"]
  const normalized = Object.fromEntries(allowed.map((key) => [key, clamp(value[key], 120)]).filter(([, item]) => item))
  return Object.keys(normalized).length ? normalized : null
}
function normalizeKey(value) { return lower(value).replace(/[’']/gu, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim() }
function syllableCount(value) { const words = text(value).split(/\s+/u).filter(Boolean); return words.reduce((total, word) => total + Math.max(1, word.split("-").filter(Boolean).length), 0) }
function statusError(message, statusCode = 400) { const error = new Error(message); error.statusCode = statusCode; return error }
function weekNumber(value = new Date()) { const date = new Date(value); const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1)); return Math.max(1, Math.ceil((((date - start) / 86400000) + start.getUTCDay() + 1) / 7)) }

function normalizeEntry(value = {}) {
  const english = clamp(value.english)
  const partOfSpeech = lower(value.partOfSpeech)
  const entryKind = lower(value.entryKind || "word")
  const phraseType = lower(value.phraseType)
  const posSubtype = lower(value.posSubtype)
  const nounType = lower(value.nounType)
  const nounNumber = lower(value.nounNumber)
  if (!english) throw statusError("English word or phrase is required")
  if (!POS.has(partOfSpeech)) throw statusError("A supported part of speech is required")
  if (!ENTRY_KINDS.has(entryKind)) throw statusError("A supported entry kind is required")
  if (phraseType && !PHRASE_TYPES.has(phraseType)) throw statusError("Unsupported phrase type")
  if (posSubtype && !POS_SUBTYPES.has(posSubtype)) throw statusError("Unsupported POS subtype")
  if (nounType && !NOUN_TYPES.has(nounType)) throw statusError("Unsupported noun type")
  if (nounNumber && !NOUN_NUMBERS.has(nounNumber)) throw statusError("Unsupported noun number")
  const data = {
    normalizedKey: normalizeKey(english), english, americanEnglish: clamp(value.americanEnglish) || null,
    britishEnglish: clamp(value.britishEnglish) || null, partOfSpeech, entryKind, phraseType: phraseType || null,
    posSubtype: posSubtype || null, grammarClassification: grammarClassification(value.grammarClassification), vietnamese: clamp(value.vietnamese), syllabication: clamp(value.syllabication),
    syllableCount: syllableCount(value.syllabication), definition: clamp(value.definition, 4000), countability: lower(value.countability) || null,
    nounType: partOfSpeech === "noun" ? nounType || null : null, nounNumber: partOfSpeech === "noun" ? nounNumber || null : null,
    verbRegularity: lower(value.verbRegularity) || null, verbTransitivity: lower(value.verbTransitivity) || null,
    verbInfinitive: clamp(value.verbInfinitive) || null, verbV1: clamp(value.verbV1) || null,
    verbV2: clamp(value.verbV2) || null, verbV3: clamp(value.verbV3) || null,
    verbV4: clamp(value.verbV4) || null, verbV5: clamp(value.verbV5) || null,
    displayVerbForm: lower(value.displayVerbForm) || null, edAdjective: Boolean(value.edAdjective), ingAdjective: Boolean(value.ingAdjective),
    awlFamilyHeadword: clamp(value.awlFamilyHeadword) || null, awlQualifyingMember: clamp(value.awlQualifyingMember) || null,
    awlMemberForm: clamp(value.awlMemberForm) || null, awlSublist: Number.isInteger(Number(value.awlSublist)) ? Number(value.awlSublist) : null,
  }
  if (partOfSpeech === "noun" && !["countable", "uncountable", "both s & p"].includes(data.countability || "")) throw statusError("Nouns require countable, uncountable, or both S & P")
  if (partOfSpeech === "verb") {
    if (!data.verbInfinitive || !data.verbV1 || !data.verbV2 || !data.verbV3 || !data.verbV4 || !data.verbV5) throw statusError("Verbs require infinitive and V1-V5 forms")
    if (!["regular", "irregular"].includes(data.verbRegularity || "")) throw statusError("Verbs require regular or irregular")
    if (!VERB_TRANSITIVITY.has(data.verbTransitivity || "")) throw statusError("Verbs require intransitive, monotransitive, ditransitive, or ambitransitive")
  }
  return data
}

function mapEntry(entry) {
  const revisions = Array.isArray(entry.revisions) ? entry.revisions : []
  return { ...entry, editors: [...new Map(revisions.map((revision) => [revision.actorName, { name: revision.actorName, at: revision.createdAt }])).values()] }
}

async function prisma() { return getSharedPrismaClient() }

export async function listLibraryEntries(query = {}) {
  const client = await prisma()
  const page = Math.max(1, Number.parseInt(text(query.page), 10) || 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(text(query.pageSize), 10) || 25))
  const search = lower(query.search)
  const studentRefId = text(query.studentRefId)
  const myWords = ["1", "true", "yes"].includes(lower(query.myWords))
  const filters = ["partOfSpeech", "entryKind", "phraseType", "countability", "verbRegularity", "verbTransitivity", "awlSublist", "createdByName"].reduce((result, key) => {
    const value = text(query[key]); if (value) result[key] = key === "awlSublist" ? Number(value) : lower(value); return result
  }, {})
  const where = {
    ...filters,
    ...(myWords && studentRefId ? { contributions: { some: { studentRefId, status: { in: ["approved", "migrated"] } } } } : {}),
    ...(search ? { OR: [{ english: { contains: search, mode: "insensitive" } }, { vietnamese: { contains: search, mode: "insensitive" } }, { definition: { contains: search, mode: "insensitive" } }, { awlFamilyHeadword: { contains: search, mode: "insensitive" } }] } : {})
  }
  const sortBy = ["english", "createdAt", "updatedAt", "partOfSpeech", "awlSublist", "syllableCount"].includes(text(query.sortBy)) ? text(query.sortBy) : "english"
  const direction = lower(query.direction) === "desc" ? "desc" : "asc"
  const [total, entries] = await client.$transaction([
    client.libraryEntry.count({ where }),
    client.libraryEntry.findMany({ where, orderBy: [{ [sortBy]: direction }, { english: "asc" }], skip: (page - 1) * pageSize, take: pageSize, include: { revisions: { orderBy: { createdAt: "asc" } } } }),
  ])
  return { ok: true, page, pageSize, total, items: entries.map(mapEntry) }
}

export async function getLibraryEntry(id) {
  const entryId = text(id)
  if (!entryId) throw statusError("Library entry id is required")
  const client = await prisma()
  const entry = await client.libraryEntry.findUnique({ where: { id: entryId }, include: { revisions: { orderBy: { createdAt: "asc" } } } })
  if (!entry) throw statusError("Library entry was not found", 404)
  return mapEntry(entry)
}

export async function getStudentLibraryAssignments(studentRefId) {
  const client = await prisma()
  return { ok: true, items: await client.libraryAssignment.findMany({ where: { studentRefId, status: "assigned" }, include: { entry: true }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }] }) }
}

export async function submitLibraryContribution(studentRefId, contributorName, payload = {}) {
  const rawEntry = payload.entry || payload
  const esl = rawEntry.esl && typeof rawEntry.esl === "object" ? rawEntry.esl : {}
  const entry = {
    english: clamp(rawEntry.english), partOfSpeech: lower(rawEntry.partOfSpeech), vietnamese: clamp(rawEntry.vietnamese),
    syllabication: clamp(rawEntry.syllabication), definition: clamp(rawEntry.definition, 4000),
    ...Object.fromEntries(Object.entries({ ...rawEntry, ...esl }).filter(([key]) => key.startsWith("verb") || ["entryKind", "phraseType", "posSubtype", "grammarClassification", "countability", "nounType", "nounNumber", "edAdjective", "ingAdjective", "displayVerbForm", "awlFamilyHeadword", "awlQualifyingMember", "awlMemberForm", "awlSublist"].includes(key))),
  }
  if (!entry.english || !POS.has(entry.partOfSpeech)) throw statusError("New Words submissions require English and a supported part of speech")
  const client = await prisma()
  const contribution = await client.libraryContribution.create({ data: { entryId: clamp(payload.entryId) || null, studentRefId, contributorName: clamp(contributorName), sourceKind: "student_new_words", sourceId: clamp(payload.sourceId) || null, payloadJson: entry, status: "pending_review" } })
  return { ok: true, contribution, message: "Submitted to Library for review." }
}

async function writeRevision(client, entry, action, actorName, actorRole) {
  return client.libraryEntryRevision.create({ data: { entryId: entry.id, action, actorName: clamp(actorName), actorRole: clamp(actorRole), snapshotJson: entry } })
}

export async function reviewLibraryContribution(id, actor = {}, payload = {}) {
  const client = await prisma()
  const contribution = await client.libraryContribution.findUnique({ where: { id } })
  if (!contribution) throw statusError("Library contribution was not found", 404)
  const approved = Boolean(payload.approved)
  if (!approved) {
    await client.libraryContribution.update({ where: { id }, data: { status: "rejected", reviewedAt: new Date(), reviewedByName: clamp(actor.name) } })
    return { ok: true, status: "rejected" }
  }
  const canonicalContributionId = clamp(payload.canonicalContributionId) || id
  const canonicalContribution = canonicalContributionId === id
    ? contribution
    : await client.libraryContribution.findUnique({ where: { id: canonicalContributionId } })
  if (!canonicalContribution) throw statusError("The selected canonical Library contribution was not found", 404)
  const submitted = normalizeEntry(payload.entry || canonicalContribution.payloadJson)
  const result = await client.$transaction(async (tx) => {
    const existing = contribution.entryId ? await tx.libraryEntry.findUnique({ where: { id: contribution.entryId } }) : null
    const entry = existing
      ? await tx.libraryEntry.update({ where: { id: existing.id }, data: { ...submitted, reviewStatus: "approved", lastEditedByName: clamp(actor.name) } })
      : await tx.libraryEntry.create({ data: { ...submitted, reviewStatus: "approved", createdByName: canonicalContribution.contributorName, lastEditedByName: clamp(actor.name) } })
    await writeRevision(tx, entry, existing ? "approved_edit" : "approved_submission", actor.name, actor.role || "admin")
    await tx.libraryContribution.update({ where: { id }, data: { entryId: entry.id, status: "approved", reviewedAt: new Date(), reviewedByName: clamp(actor.name) } })
    return entry
  })
  return { ok: true, entry: result }
}

export async function updateLibraryEntry(id, actor = {}, payload = {}) {
  const client = await prisma(); const data = normalizeEntry(payload)
  const entry = await client.$transaction(async (tx) => {
    const updated = await tx.libraryEntry.update({ where: { id }, data: { ...data, lastEditedByName: clamp(actor.name) } })
    await writeRevision(tx, updated, "edited", actor.name, actor.role || "admin")
    return updated
  })
  return { ok: true, entry }
}

export async function assignLibraryWork(actor = {}, payload = {}) {
  const studentIds = Array.isArray(payload.studentRefIds) ? [...new Set(payload.studentRefIds.map(text).filter(Boolean))] : []
  if (!studentIds.length) throw statusError("Select at least one student")
  const taskType = lower(payload.taskType); if (!["new_entry", "edit", "merge"].includes(taskType)) throw statusError("Unsupported Library task type")
  const client = await prisma()
  const assignmentWeek = Number.parseInt(String(payload.weekNumber || weekNumber()), 10) || weekNumber()
  const assignments = await client.libraryAssignment.createManyAndReturn({ data: studentIds.map((studentRefId) => ({ studentRefId, entryId: text(payload.entryId) || null, taskType, subject: `Library Vocabulary Assignment — Week ${assignmentWeek}`, route: null, weekNumber: assignmentWeek, instructions: clamp(payload.instructions, 2000) || null, dueAt: payload.dueAt ? new Date(payload.dueAt) : null, assignedByName: clamp(actor.name) })) })
  return { ok: true, assignments }
}

export async function listLibraryReviewQueue(query = {}) {
  const client = await prisma()
  const status = lower(query.status) || "pending_review"
  const subject = lower(query.subject); const route = lower(query.route)
  const contributions = await client.libraryContribution.findMany({ where: { status }, orderBy: { submittedAt: "asc" }, take: MAX_PAGE_SIZE })
  const grouped = new Map()
  for (const contribution of contributions) {
    const payload = contribution.payloadJson && typeof contribution.payloadJson === "object" ? contribution.payloadJson : {}
    const key = `${normalizeKey(payload.english)}|${lower(payload.partOfSpeech)}`
    const siblings = grouped.get(key) || []
    siblings.push(contribution)
    grouped.set(key, siblings)
  }
  const items = contributions.map((contribution) => {
    const payload = contribution.payloadJson || {}
    const key = `${normalizeKey(payload.english)}|${lower(payload.partOfSpeech)}`
    const siblings = grouped.get(key) || []
    return {
      ...contribution,
      payloadJson: payload,
      queueType: contribution.entryId ? "edit" : "new_entry",
      duplicateGroupKey: key,
      potentialDuplicate: siblings.length > 1,
      duplicateGroup: siblings.length > 1 ? siblings.map((sibling) => ({
        id: sibling.id,
        entryId: sibling.entryId,
        contributorName: sibling.contributorName,
        submittedAt: sibling.submittedAt,
        payloadJson: sibling.payloadJson || {},
        queueType: sibling.entryId ? "edit" : "new_entry",
      })) : [],
    }
  })
  const assignments = await client.libraryAssignment.findMany({ where: { status: "assigned", ...(subject ? { subject: { contains: subject, mode: "insensitive" } } : {}), ...(route ? { route: { contains: route, mode: "insensitive" } } : {}) }, include: { entry: true }, orderBy: { createdAt: "asc" }, take: MAX_PAGE_SIZE })
  return { ok: true, total: items.length + assignments.length, items, assignments }
}

export async function listLibraryStudents() {
  const client = await prisma()
  const students = await client.student.findMany({ include: { profile: true }, orderBy: { eaglesId: "asc" } })
  return { ok: true, items: students.map((student) => ({ id: student.id, eaglesId: student.eaglesId, name: text(student.profile?.englishName || student.profile?.fullName || student.eaglesId), email: text(student.email || student.profile?.studentEmail) })) }
}

export async function sendLibraryAssignmentEmail(id, actor = {}) {
  const client = await prisma()
  const assignment = await client.libraryAssignment.findUnique({ where: { id }, include: { entry: true } })
  if (!assignment) throw statusError("Library assignment was not found", 404)
  const student = await client.student.findUnique({ where: { id: assignment.studentRefId }, include: { profile: true } })
  const recipient = lower(student?.email || student?.profile?.studentEmail)
  if (!recipient) throw statusError("Assigned student has no email address")
  const token = crypto.randomBytes(24).toString("hex")
  const origin = text(process.env.STUDENT_ADMIN_PUBLIC_ORIGIN || process.env.PUBLIC_APP_ORIGIN || "https://eagles.edu.vn").replace(/\/+$/u, "")
  const actionUrl = `${origin}/api/library-assignments/track/click/${token}`
  const message = `Library task: ${assignment.taskType}. ${assignment.instructions || "Please open the Library and complete your assigned vocabulary work."}`
  const queued = await queueAnnouncementEmail({ deliveryMode: "weekend-batch", queueType: "announcement", assignmentTitle: assignment.subject || `Library Vocabulary Assignment — Week ${assignment.weekNumber || weekNumber(assignment.createdAt)}`, exerciseTitle: assignment.entry?.english || "Library vocabulary", dueAt: assignment.dueAt?.toISOString?.() || "", message, recipients: [recipient], requestOrigin: origin, actionUrl, libraryAssignmentToken: token }, { queuedByUsername: actor.name || "library-admin" })
  const engagement = await client.libraryAssignmentEngagement.create({ data: { assignmentId: id, recipientEmail: recipient, trackingToken: token, queueId: queued.queueId, metadataJson: { taskType: assignment.taskType, entryId: assignment.entryId, assignedByName: assignment.assignedByName } } })
  return { ok: true, queueId: queued.queueId, engagement }
}

export async function trackLibraryAssignment(token, action = "click") {
  const client = await prisma()
  const engagement = await client.libraryAssignmentEngagement.findUnique({ where: { trackingToken: token } })
  if (!engagement) return null
  const field = action === "open" ? "openedAt" : action === "complete" ? "completedAt" : "clickedAt"
  await client.libraryAssignmentEngagement.update({ where: { id: engagement.id }, data: { [field]: engagement[field] || new Date() } })
  return engagement
}

export async function listLibraryAssignmentEngagement(query = {}) {
  const client = await prisma()
  const rows = await client.libraryAssignmentEngagement.findMany({ orderBy: { queuedAt: "desc" }, take: MAX_PAGE_SIZE, include: { assignment: { include: { entry: true } } } })
  const queueIds = rows.map((row) => row.queueId).filter(Boolean)
  const queues = queueIds.length ? await client.adminNotificationQueue.findMany({ where: { id: { in: queueIds } }, select: { id: true, sentAt: true, status: true } }) : []
  const queueMap = new Map(queues.map((queue) => [queue.id, queue]))
  const students = await client.student.findMany({ include: { profile: true } })
  const names = new Map(students.map((student) => [student.id, text(student.profile?.englishName || student.profile?.fullName || student.eaglesId)]))
  return { ok: true, total: rows.length, items: rows.map((row) => ({ ...row, sentAt: row.sentAt || queueMap.get(row.queueId)?.sentAt || null, queueStatus: queueMap.get(row.queueId)?.status || "queued", studentName: names.get(row.assignment.studentRefId) || row.assignment.studentRefId, assignmentTitle: row.assignment.entry?.english || "New Library entry", subject: row.assignment.subject || "", route: row.assignment.route || "", status: row.sentAt || queueMap.get(row.queueId)?.sentAt ? "sent" : "queued" })) }
}

function legacyEntry(raw = {}) {
  const esl = raw.esl && typeof raw.esl === "object" ? raw.esl : {}
  return { normalizedKey: normalizeKey(raw.english), english: clamp(raw.english), americanEnglish: null, britishEnglish: null, partOfSpeech: lower(raw.partOfSpeech), entryKind: lower(esl.entryKind || "word") || "word", phraseType: lower(esl.phraseType) || null, posSubtype: lower(esl.posSubtype) || null, vietnamese: clamp(raw.vietnamese), syllabication: clamp(raw.syllabication), syllableCount: syllableCount(raw.syllabication), definition: clamp(raw.definition, 4000), countability: lower(esl.countability) || null, nounType: lower(esl.nounType) || null, nounNumber: lower(esl.nounNumber) || null, verbRegularity: lower(esl.verbRegularity) || null, verbTransitivity: lower(esl.verbTransitivity) || null, verbInfinitive: clamp(esl.verbInfinitive) || null, verbV1: clamp(esl.verbV1) || null, verbV2: clamp(esl.verbV2) || null, verbV3: clamp(esl.verbV3) || null, verbV4: clamp(esl.verbV4) || null, verbV5: clamp(esl.verbV5) || null, displayVerbForm: lower(esl.displayVerbForm) || null, edAdjective: Boolean(esl.edAdjective), ingAdjective: Boolean(esl.ingAdjective), awlFamilyHeadword: clamp(esl.awlFamilyHeadword) || null, awlQualifyingMember: clamp(esl.awlQualifyingMember) || null, awlMemberForm: clamp(esl.awlMemberForm) || null, awlSublist: Number(esl.awlSublist) || null }
}

function conflicts(rows) {
  const fields = ["english", "vietnamese", "syllabication", "definition"]
  return Object.fromEntries(fields.map((field) => [field, [...new Set(rows.map((row) => text(row.payload[field])).filter(Boolean))]]).filter(([, values]) => values.length > 1))
}

export async function createLibraryLegacyPreflight(runKey = "legacy-cutover-v1") {
  const client = await prisma()
  const [words, reports, students] = await Promise.all([
    client.studentNewWord.findMany({ where: { archivedAt: null } }),
    client.studentNewsReport.findMany({ where: { OR: [{ mmrPassedAt: { not: null } }, { dateSatisfiedAt: { not: null } }, { submissionState: "ready" }, { submissionState: "submitted", firstSubmittedAt: { not: null } }] } }),
    client.student.findMany({ include: { profile: true } }),
  ])
  const names = new Map(students.map((student) => [student.id, text(student.profile?.englishName || student.profile?.fullName || student.eaglesId)]))
  const rows = [
    ...words.map((word) => ({ sourceKind: "legacy_new_word", sourceId: word.id, studentRefId: word.studentRefId, contributorName: names.get(word.studentRefId) || word.studentRefId, createdAt: word.createdAt, payload: { english: word.english, partOfSpeech: word.partOfSpeech, vietnamese: word.vietnamese, syllabication: word.syllabication, definition: word.definition, esl: word.eslJson || {} } })),
    ...reports.flatMap((report) => (Array.isArray(report.vocabularyJson) ? report.vocabularyJson : []).map((payload, index) => ({ sourceKind: "legacy_news_vocabulary", sourceId: `${report.id}:${index}`, studentRefId: report.studentRefId, contributorName: names.get(report.studentRefId) || report.studentRefId, createdAt: report.createdAt, payload }))),
  ].filter((row) => normalizeKey(row.payload.english) && lower(row.payload.partOfSpeech))
  const groups = new Map(); for (const row of rows) { const key = `${normalizeKey(row.payload.english)}|${lower(row.payload.partOfSpeech)}`; groups.set(key, [...(groups.get(key) || []), row]) }
  await client.$transaction(async (tx) => { for (const [key, group] of groups) { const [normalizedKey, partOfSpeech] = key.split("|"); await tx.libraryMigrationPreflight.upsert({ where: { runKey_normalizedKey_partOfSpeech: { runKey, normalizedKey, partOfSpeech } }, update: { sourceRowsJson: group, conflictsJson: conflicts(group) }, create: { runKey, normalizedKey, partOfSpeech, sourceRowsJson: group, conflictsJson: conflicts(group) } }) } })
  return { ok: true, runKey, groups: groups.size, sourceRows: rows.length }
}

export async function cutoverLegacyLibrary(actor = {}, runKey = "legacy-cutover-v1") {
  const client = await prisma(); const preflight = await client.libraryMigrationPreflight.findMany({ where: { runKey }, orderBy: { normalizedKey: "asc" } }); if (!preflight.length) throw statusError("Run the immutable legacy preflight before cutover")
  let migrated = 0
  await client.$transaction(async (tx) => { for (const group of preflight) { const rows = Array.isArray(group.sourceRowsJson) ? group.sourceRowsJson : []; const canonical = [...rows].sort((left, right) => Object.values(right.payload).filter(Boolean).length - Object.values(left.payload).filter(Boolean).length || new Date(left.createdAt) - new Date(right.createdAt))[0]; if (!canonical) continue; let entry = await tx.libraryEntry.findFirst({ where: { normalizedKey: group.normalizedKey, partOfSpeech: group.partOfSpeech } }); if (!entry) { entry = await tx.libraryEntry.create({ data: { ...legacyEntry(canonical.payload), reviewStatus: "legacy_imported", createdByName: canonical.contributorName, lastEditedByName: clamp(actor.name || "legacy cutover") } }); await writeRevision(tx, entry, "legacy_cutover", actor.name || "legacy cutover", actor.role || "system") }
    for (const row of rows) { const existing = await tx.libraryContribution.findFirst({ where: { sourceKind: row.sourceKind, sourceId: row.sourceId } }); if (!existing) await tx.libraryContribution.create({ data: { entryId: entry.id, studentRefId: row.studentRefId, contributorName: row.contributorName, sourceKind: row.sourceKind, sourceId: row.sourceId, payloadJson: row.payload, status: "migrated", submittedAt: new Date(row.createdAt), reviewedAt: new Date(), reviewedByName: clamp(actor.name || "legacy cutover") } }); if (row.sourceKind === "legacy_new_word") await tx.studentNewWord.update({ where: { id: row.sourceId }, data: { archivedAt: new Date(), archivedLibraryEntryId: entry.id } }) }
    migrated += 1
  } })
  return { ok: true, runKey, migrated }
}

function stripMw(textValue) { return text(textValue).replace(/\{[^}]*\}/gu, "").replace(/\*+/gu, "-").trim() }
export async function previewMerriamWebsterLibraryEntry(entry) {
  const word = clamp(entry?.english); const key = text(process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY)
  if (!word || !key) return { ok: false, available: false, message: "Merriam-Webster Collegiate is unavailable; no Library data was changed." }
  const response = await fetch(`${MW_BASE}/${encodeURIComponent(word)}?key=${encodeURIComponent(key)}`); if (!response.ok) return { ok: false, available: false, message: "Merriam-Webster is unavailable; no Library data was changed." }
  const payload = await response.json(); const result = Array.isArray(payload) ? payload.find((item) => item && typeof item === "object") : null
  if (!result) return { ok: false, available: false, message: "No Merriam-Webster entry was found; no Library data was changed." }
  return { ok: true, available: true, fields: { english: stripMw(result?.hwi?.hw), partOfSpeech: lower(result?.fl), syllabication: stripMw(result?.hwi?.hw), definition: stripMw(result?.shortdef?.[0]), verbV3: stripMw(result?.ins?.[0]?.if) }, rawSource: "Merriam-Webster Collegiate" }
}

export async function applyMerriamWebsterLibraryEntry(id, actor = {}, payload = {}) {
  const preview = await previewMerriamWebsterLibraryEntry(payload.entry); if (!preview.ok) throw statusError(preview.message, 503)
  const client = await prisma(); const existing = await client.libraryEntry.findUnique({ where: { id } }); if (!existing) throw statusError("Library entry was not found", 404)
  const mode = lower(payload.mode); const chosen = Array.isArray(payload.fields) ? payload.fields : Object.keys(preview.fields)
  const data = {}; for (const field of chosen) { if (!Object.hasOwn(preview.fields, field) || !preview.fields[field]) continue; if (mode === "fill_missing" && text(existing[field])) continue; data[field] = preview.fields[field] }
  const updated = await client.$transaction(async (tx) => { const value = await tx.libraryEntry.update({ where: { id }, data: { ...data, lastEditedByName: clamp(actor.name) } }); await writeRevision(tx, value, "mw_import", actor.name, actor.role || "admin"); return value })
  return { ok: true, entry: updated, appliedFields: Object.keys(data) }
}
