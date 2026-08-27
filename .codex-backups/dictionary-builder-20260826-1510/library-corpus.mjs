import crypto from "node:crypto"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { buildOriginReference, normalizeDefinitionText, normalizeOriginReferences } from "./library-origin.mjs"
import { queueAnnouncementEmail } from "./notification-queue.mjs"
import { checkVerbFormsTransitivity, getVerbTransitivity } from "./verb-transitivity.mjs"
import { getVerbForms, getVerbRegularity } from "./verb-regularity.mjs"
import { normalizeVocabularySyllabication, vocabularyEnglishCapitalizationError } from "./vocabulary-syllabication.mjs"
import { engagementRetentionCutoff, isEngagementVisible } from "./engagement-retention.mjs"
import { previewLdoceLibraryEntry } from "./ldoce-provider.mjs"
import { previewOxfordLibraryEntry } from "./oxford-provider.mjs"
import { previewBritannicaLibraryEntry } from "./britannica-provider.mjs"
import { fetchMerriamWebsterBrowserPage, MERRIAM_WEBSTER_BASE_URL, previewMerriamWebsterDictionaryEntry } from "./merriam-webster-provider.mjs"
import {
  discardLibraryAudio,
  downloadLibraryAudio,
  finalizeLibraryAudio,
  removeLibraryAudio,
  upsertLibraryMediaAsset,
} from "./library-media.mjs"

const MW_BASE = "https://www.dictionaryapi.com/api/v3/references/collegiate/json"
const MAX_PAGE_SIZE = 100
export const LIBRARY_DEFINITION_MAX_LENGTH = 50000
const MAX_REVIEW_QUEUE_SIZE = 10000
const POS = new Set(["noun", "verb", "adjective", "adverb", "pronoun", "determiner", "conjunction", "preposition", "interjection", "numeral", "proper noun", "phrase", "idiom", "clause"])
const PHRASE_TYPES = new Set(["verb", "noun", "adjective", "adverbial", "prepositional", "idiom"])
const VERB_TRANSITIVITY = new Set(["intransitive", "monotransitive", "ditransitive", "ambitransitive", "transitive"])
const NOUN_TYPES = new Set(["common", "proper", "concrete", "abstract", "material", "collective", "compound", "possessive"])
const NOUN_NUMBERS = new Set(["singular", "plural", "singular and plural"])
const NOUN_COUNTABILITY = new Set(["countable", "uncountable", "countable_and_uncountable"])
const NOUN_QUALITIES = new Set(["concrete", "material", "abstract"])
const NOUN_NUMBERS_V2 = new Set(["singular", "plural", "singular_and_plural"])
const NOUN_PRIMARY_CLASSIFICATIONS = new Set(["common", "proper", "collective", "compound", "possessive"])
const NOUN_MATERIAL_USAGES = new Set(["mass", "variety"])
const NOUN_DUAL_USAGES = new Set(["same_sense", "different_senses"])
const ETYMOLOGY_TYPES = new Set(["native", "borrowed", "derived", "compound", "eponym", "onomatopoeic", "unknown"])
const CONTRIBUTION_LIFETIME_DAYS = 15
const LEGACY_PENDING_REVIEW = "legacy_pending_review"
const AWAITING_LEGACY_CANONICAL = "awaiting_legacy_canonical"
const PENDING_CANONICAL_REPLACEMENT = "pending_canonical_replacement"
const LEGACY_MIGRATION_TRANSACTION_OPTIONS = { maxWait: 30000, timeout: 120000 }
const MW_POS_ALIASES = new Map([
  ["adjective", "adjective"],
  ["adverb", "adverb"],
  ["clause", "clause"],
  ["conjunction", "conjunction"],
  ["determiner", "determiner"],
  ["idiom", "idiom"],
  ["interjection", "interjection"],
  ["noun", "noun"],
  ["numeral", "numeral"],
  ["phrase", "phrase"],
  ["preposition", "preposition"],
  ["proper noun", "proper noun"],
  ["pronoun", "pronoun"],
  ["verb", "verb"],
])
const LDOCE_APPLY_FIELDS = new Set(["definition", "countability", "verbTransitivity", "grammarClassification"])
const LDOCE_MEDIA_DIALECTS = ["uk", "us"]
const OXFORD_APPLY_FIELDS = new Set(["definition", "countability", "verbTransitivity", "grammarClassification"])
const OXFORD_MEDIA_DIALECTS = ["us"]
const BRITANNICA_APPLY_FIELDS = new Set(["definition", "etymology", "originReferences", "countability", "nounNumber", "verbTransitivity", "grammarClassification"])
const BRITANNICA_MEDIA_DIALECTS = []
const MERRIAM_WEBSTER_DICTIONARY_APPLY_FIELDS = new Set(["definition", "etymology", "originReferences", "countability", "nounNumber", "verbTransitivity", "grammarClassification"])
const MERRIAM_WEBSTER_DICTIONARY_MEDIA_DIALECTS = []

function text(value) { return String(value == null ? "" : value).trim() }
function lower(value) { return text(value).normalize("NFC").toLocaleLowerCase("en-US") }
function libraryAssignmentQueueId(assignmentId) {
  return `library-assignment-${crypto.createHash("sha256").update(text(assignmentId)).digest("hex").slice(0, 40)}`
}
function libraryAssignmentTrackingToken(assignmentId, recipientEmail) {
  return crypto.createHash("sha256").update(`${text(assignmentId)}|${lower(recipientEmail)}`).digest("hex")
}
function dateText(value) { return value?.toISOString?.() || text(value) }
const engagementTimelineFields = ["queuedAt", "sentAt", "deliveredAt", "proxyLoadedAt", "firstOpenedAt", "uniqueOpenedAt", "openedAt", "clickedAt"]
function mergeEngagementDelivery(existing, candidate) {
  if (!existing) return candidate
  const merged = { ...existing }
  for (const field of engagementTimelineFields) {
    const left = existing[field]
    const right = candidate?.[field]
    if (!left && right) merged[field] = right
    else if (left && right && new Date(right).valueOf() < new Date(left).valueOf()) merged[field] = right
  }
  return merged
}
export function normalizeLibraryEnum(value) {
  const candidate = lower(value)
  return ["null", "undefined"].includes(candidate) ? "" : candidate
}
function clamp(value, maximum = 240) { return text(value).slice(0, maximum) }
export function normalizeLibraryDefinition(value) { return normalizeDefinitionText(value).slice(0, LIBRARY_DEFINITION_MAX_LENGTH) }
function grammarClassification(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const allowed = ["grammarFamily", "grammarSubtype", "grammarDetail", "grammarNumber"]
  const normalized = Object.fromEntries(allowed.map((key) => [key, clamp(value[key], 120)]).filter(([, item]) => item))
  return Object.keys(normalized).length ? normalized : null
}
function normalizeNounProfile(value = {}, partOfSpeech = "") {
  if (partOfSpeech !== "noun") return { physicalQuality: null, grammaticalNumber: null, primaryClassification: null, materialUsage: null, properNounVariantShift: false, dualCountabilityUsage: null }
  const countability = normalizeLibraryEnum(value.countability)
  const physicalQuality = normalizeLibraryEnum(value.physicalQuality)
  const grammaticalNumber = normalizeLibraryEnum(value.grammaticalNumber)
  const primaryClassification = normalizeLibraryEnum(value.primaryClassification)
  const materialUsage = normalizeLibraryEnum(value.materialUsage)
  const properNounVariantShift = Boolean(value.properNounVariantShift)
  const dualCountabilityUsage = normalizeLibraryEnum(value.dualCountabilityUsage)
  const provided = [physicalQuality, grammaticalNumber, primaryClassification, materialUsage, dualCountabilityUsage].some(Boolean) || properNounVariantShift
  if (!provided) return { physicalQuality: null, grammaticalNumber: null, primaryClassification: null, materialUsage: null, properNounVariantShift: false, dualCountabilityUsage: null }
  if (!NOUN_COUNTABILITY.has(countability) || !NOUN_QUALITIES.has(physicalQuality) || !NOUN_NUMBERS_V2.has(grammaticalNumber) || !NOUN_PRIMARY_CLASSIFICATIONS.has(primaryClassification)) throw statusError("Nouns require a complete supported noun-class profile")
  if (countability === "uncountable" && grammaticalNumber !== "singular") throw statusError("Uncountable nouns must be singular")
  if (countability === "countable_and_uncountable" && grammaticalNumber !== "singular_and_plural") throw statusError("Dual-countability nouns require singular and plural")
  if (countability === "countable_and_uncountable" && !NOUN_DUAL_USAGES.has(dualCountabilityUsage)) throw statusError("Dual-countability nouns require a usage classification")
  if (countability !== "countable_and_uncountable" && dualCountabilityUsage) throw statusError("Dual-countability usage only applies to dual-countability nouns")
  if (physicalQuality === "material") {
    if (!NOUN_MATERIAL_USAGES.has(materialUsage)) throw statusError("Material nouns require mass or variety usage")
    const mass = materialUsage === "mass"
    if ((mass && (countability !== "uncountable" || grammaticalNumber !== "singular" || primaryClassification !== "common")) || (!mass && (countability !== "countable" && countability !== "countable_and_uncountable" || primaryClassification !== "common" || grammaticalNumber !== (countability === "countable" ? "plural" : "singular_and_plural")))) throw statusError("Material noun profile is incompatible with its usage")
  } else if (materialUsage) throw statusError("Material usage only applies to material nouns")
  if (primaryClassification === "collective" && physicalQuality !== "concrete") throw statusError("Collective nouns must be concrete")
  if (["collective", "proper"].includes(primaryClassification) && physicalQuality === "abstract") throw statusError("Abstract nouns cannot be collective or proper")
  if (primaryClassification === "proper" && (physicalQuality !== "concrete" || (!properNounVariantShift && grammaticalNumber !== "singular"))) throw statusError("Proper nouns require concrete singular unless their variant shift is enabled")
  return { physicalQuality, grammaticalNumber, primaryClassification, materialUsage: materialUsage || null, properNounVariantShift, dualCountabilityUsage: dualCountabilityUsage || null }
}
function normalizeKey(value) { return lower(value).replace(/[’']/gu, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim() }
function syllableCount(value) { const words = text(value).split(/\s+/u).filter(Boolean); return words.reduce((total, word) => total + Math.max(1, word.split("-").filter(Boolean).length), 0) }
function statusError(message, statusCode = 400) { const error = new Error(message); error.statusCode = statusCode; return error }
function weekNumber(value = new Date()) { const date = new Date(value); const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1)); return Math.max(1, Math.ceil((((date - start) / 86400000) + start.getUTCDay() + 1) / 7)) }

export function libraryContributionDeadline(submittedAt) {
  const start = new Date(submittedAt)
  if (Number.isNaN(start.valueOf())) throw statusError("A valid contribution submission time is required")
  return new Date(start.getTime() + CONTRIBUTION_LIFETIME_DAYS * 24 * 60 * 60 * 1000)
}

export function isStudentLibraryContributionEditable(contribution = {}, now = new Date()) {
  const status = text(contribution.status)
  if (["pending_review", LEGACY_PENDING_REVIEW, AWAITING_LEGACY_CANONICAL].includes(status)) return true
  if (!["approved", "canonicalized", PENDING_CANONICAL_REPLACEMENT].includes(status)) return false
  const dueAt = new Date(contribution.dueAt || 0)
  return !Number.isNaN(dueAt.valueOf()) && dueAt > now
}

export function selectLargestDuplicate(rows = []) {
  return [...rows].sort((left, right) => {
    const leftPayload = left?.payloadJson || left?.payload || {}
    const rightPayload = right?.payloadJson || right?.payload || {}
    const definitionLength = (payload) => text(payload.definition).length
    const lengthDifference = definitionLength(rightPayload) - definitionLength(leftPayload)
    if (lengthDifference) return lengthDifference
    const submittedDifference = new Date(left?.submittedAt || left?.createdAt || 0).valueOf() - new Date(right?.submittedAt || right?.createdAt || 0).valueOf()
    if (submittedDifference) return submittedDifference
    return text(left?.id).localeCompare(text(right?.id))
  })[0] || null
}

export function selectReviewQueueRepresentatives(rows = []) {
  const grouped = new Map()
  for (const row of rows) {
    const payload = row?.payloadJson || row?.payload || {}
    const key = `${normalizeKey(payload.english)}|${lower(payload.partOfSpeech)}`
    const siblings = grouped.get(key) || []
    siblings.push(row)
    grouped.set(key, siblings)
  }
  return rows.filter((row) => {
    const payload = row?.payloadJson || row?.payload || {}
    const key = `${normalizeKey(payload.english)}|${lower(payload.partOfSpeech)}`
    const siblings = grouped.get(key) || []
    const legacySiblings = siblings.filter((sibling) => isLegacyPending(sibling.status))
    const candidates = legacySiblings.length ? legacySiblings : siblings
    return selectLargestDuplicate(candidates)?.id === row.id
  })
}

function isLegacyPending(value) { return text(value) === LEGACY_PENDING_REVIEW }
function isAwaitingLegacyCanonical(value) { return text(value) === AWAITING_LEGACY_CANONICAL }

function activePayloadValue(value, key = "") {
  if (value === null || value === undefined) {
    if (/references|items|editors/iu.test(key)) return []
    if (/classification|payloadJson/iu.test(key)) return {}
    return ""
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => activePayloadValue(item, key))
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, activePayloadValue(child, childKey)]))
  return value
}

export function normalizeActiveLibraryPayload(value) {
  return activePayloadValue(value)
}

function mapContribution(contribution = {}) {
  const mapped = activePayloadValue(contribution)
  mapped.payloadJson = activePayloadValue(contribution.payloadJson || {}, "payloadJson")
  return mapped
}

function canonicalPair(payload = {}) {
  return { normalizedKey: normalizeKey(payload.english), partOfSpeech: lower(payload.partOfSpeech) }
}

const OPEN_CANONICAL_CONTRIBUTION_STATUSES = ["pending_review", LEGACY_PENDING_REVIEW, AWAITING_LEGACY_CANONICAL]
const LIBRARY_STUDENT_EDIT_FIELDS = new Set([
  "english", "americanEnglish", "britishEnglish", "partOfSpeech", "phraseType", "grammarClassification",
  "etymologyType", "etymology", "originPath", "originReferences", "vietnamese", "syllabication", "syllableCount",
  "definition", "countability", "nounType", "nounNumber", "physicalQuality", "grammaticalNumber",
  "primaryClassification", "materialUsage", "properNounVariantShift", "dualCountabilityUsage",
  "verbRegularity", "verbTransitivity", "verbInfinitive", "verbV1", "verbV2", "verbV3", "verbV4", "verbV5",
  "displayVerbForm", "edAdjective", "ingAdjective", "awlFamilyHeadword", "awlQualifyingMember", "awlMemberForm", "awlSublist",
])

export function selectContributionsForCanonicalEntry(rows = [], entry = {}) {
  const pair = canonicalPair(entry)
  return rows.filter((row) => {
    if (!OPEN_CANONICAL_CONTRIBUTION_STATUSES.includes(text(row?.status))) return false
    const payload = row?.payloadJson && typeof row.payloadJson === "object" ? row.payloadJson : row?.payload || {}
    const candidate = canonicalPair(payload)
    return candidate.normalizedKey === pair.normalizedKey && candidate.partOfSpeech === pair.partOfSpeech
  })
}

export function checkLibraryEntryVerbTransitivity(payload = {}) {
  try {
    return checkVerbFormsTransitivity(payload)
  } catch (error) {
    return {
      expected: lower(payload.verbTransitivity) || null,
      checkedForms: [],
      foundForms: [],
      missingForms: [],
      directForms: [],
      inheritedForms: [],
      reviewGaps: [],
      matchesExpected: null,
      verificationStatus: "unavailable",
      verificationMessage: error.message || "The bundled transitivity list is unavailable; saving remains allowed.",
      checks: [],
    }
  }
}

export function autoFillLibraryEntryVerbTransitivity(payload = {}) {
  const result = checkLibraryEntryVerbTransitivity(payload)
  const preferredForms = [payload.verbInfinitive, payload.verb, payload.verbV1, payload.verbV2, payload.verbV3, payload.verbV4, payload.verbV5]
    .map((value) => lower(value))
    .filter(Boolean)
  const allowed = VERB_TRANSITIVITY
  const checks = Array.isArray(result.checks) ? result.checks : []
  const preferred = preferredForms
    .map((form) => checks.find((check) => check.verb === form && check.found && allowed.has(check.classification)))
    .find(Boolean)
  if (!preferred) {
    return {
      ...result,
      autofillStatus: "unavailable",
      suggestedVerbTransitivity: null,
      autofillMessage: "No corpus match; saving remains allowed.",
    }
  }
  const lemmaResult = getVerbTransitivity(lower(payload.verbInfinitive || payload.verb))
  const selected = lemmaResult.found && allowed.has(lemmaResult.classification) ? lemmaResult : preferred
  return {
    ...result,
    autofillStatus: "suggested",
    suggestedVerbTransitivity: selected.classification,
    autofillSource: selected.classificationEvidence,
    autofillVerb: selected.verb,
    autofillMessage: `Suggested ${selected.classification} from the bundled corpus list. Review it before saving.`,
  }
}

function normalizeEntry(value = {}, { allowIncomplete = false } = {}) {
  const english = clamp(value.english)
  const partOfSpeech = lower(value.partOfSpeech)
  const phraseType = normalizeLibraryEnum(value.phraseType)
  const nounType = normalizeLibraryEnum(value.nounType)
  const nounNumber = normalizeLibraryEnum(value.nounNumber)
  if (!english) throw statusError("English word or phrase is required")
  if (!POS.has(partOfSpeech)) throw statusError("A supported part of speech is required")
  const capitalizationError = vocabularyEnglishCapitalizationError({ ...value, english, partOfSpeech })
  if (capitalizationError) throw statusError(capitalizationError)
  if (phraseType && !PHRASE_TYPES.has(phraseType)) throw statusError("Unsupported phrase type")
  const etymologyType = normalizeLibraryEnum(value.etymologyType)
  if (etymologyType && !ETYMOLOGY_TYPES.has(etymologyType)) throw statusError("Unsupported etymology type")
  if (nounType && !NOUN_TYPES.has(nounType)) throw statusError("Unsupported noun type")
  if (nounNumber && !NOUN_NUMBERS.has(nounNumber)) throw statusError("Unsupported noun number")
  const nounProfile = normalizeNounProfile(value, partOfSpeech)
  const data = {
    normalizedKey: normalizeKey(english), english, americanEnglish: clamp(value.americanEnglish) || null,
    britishEnglish: clamp(value.britishEnglish) || null, partOfSpeech, phraseType: phraseType || null,
    grammarClassification: grammarClassification(value.grammarClassification), etymologyType: etymologyType || null, etymology: clamp(value.etymology, 4000) || null,
    originPath: clamp(value.originPath, 500) || null, originReferences: normalizeOriginReferences(value.originReferences), vietnamese: clamp(value.vietnamese), syllabication: normalizeVocabularySyllabication(value.syllabication),
    syllableCount: syllableCount(value.syllabication), definition: normalizeLibraryDefinition(value.definition), countability: normalizeLibraryEnum(value.countability) || null,
    nounType: partOfSpeech === "noun" ? nounType || null : null, nounNumber: partOfSpeech === "noun" ? nounNumber || null : null,
    ...nounProfile,
    verbRegularity: normalizeLibraryEnum(value.verbRegularity) || null, verbTransitivity: normalizeLibraryEnum(value.verbTransitivity) || null,
    verbInfinitive: clamp(value.verbInfinitive) || null, verbV1: clamp(value.verbV1) || null,
    verbV2: clamp(value.verbV2) || null, verbV3: clamp(value.verbV3) || null,
    verbV4: clamp(value.verbV4) || null, verbV5: clamp(value.verbV5) || null,
    displayVerbForm: lower(value.displayVerbForm) || null, edAdjective: Boolean(value.edAdjective), ingAdjective: Boolean(value.ingAdjective),
    awlFamilyHeadword: clamp(value.awlFamilyHeadword) || null, awlQualifyingMember: clamp(value.awlQualifyingMember) || null,
    awlMemberForm: clamp(value.awlMemberForm) || null, awlSublist: Number.isInteger(Number(value.awlSublist)) ? Number(value.awlSublist) : null,
    dictionaryProvider: clamp(value.dictionaryProvider, 80) || null,
    dictionarySourceUrl: clamp(value.dictionarySourceUrl, 1000) || null,
    dictionaryMetadata: value.dictionaryMetadata && typeof value.dictionaryMetadata === "object" && !Array.isArray(value.dictionaryMetadata) ? value.dictionaryMetadata : null,
  }
  if (partOfSpeech === "noun" && !allowIncomplete && !NOUN_COUNTABILITY.has(data.countability || "")) throw statusError("Nouns require countable, uncountable, or countable and uncountable")
  if (partOfSpeech === "verb") {
    if (!allowIncomplete && (!data.verbInfinitive || !data.verbV1 || !data.verbV2 || !data.verbV3 || !data.verbV4 || !data.verbV5)) throw statusError("Verbs require infinitive and V1-V5 forms")
    if (!allowIncomplete && !["regular", "irregular"].includes(data.verbRegularity || "")) throw statusError("Verbs require regular or irregular")
    if (data.verbTransitivity && !VERB_TRANSITIVITY.has(data.verbTransitivity)) throw statusError("Transitivity must be blank, intransitive, monotransitive, transitive, ditransitive, or ambitransitive")
  }
  return data
}

function mapEntry(entry, { now = new Date(), studentRefId = "" } = {}) {
  const revisions = Array.isArray(entry.revisions) ? entry.revisions : []
  const mapped = activePayloadValue(entry)
  const studentContribution = Array.isArray(entry.contributions) ? entry.contributions[0] : null
  if (studentRefId && studentContribution) {
    const contributionPayload = activePayloadValue(studentContribution.payloadJson || {}, "payloadJson")
    for (const [field, value] of Object.entries(contributionPayload)) {
      if (LIBRARY_STUDENT_EDIT_FIELDS.has(field)) mapped[field] = value
    }
  }
  mapped.grammarClassification = activePayloadValue(mapped.grammarClassification, "grammarClassification")
  mapped.originReferences = Array.isArray(mapped.originReferences) ? activePayloadValue(mapped.originReferences, "originReferences") : []
  mapped.mediaAssets = Array.isArray(entry.mediaAssets)
    ? entry.mediaAssets.map((asset) => ({ id: asset.id, provider: asset.provider, dialect: asset.dialect, mimeType: asset.mimeType, byteLength: asset.byteLength, sha256: asset.sha256 }))
    : []
  mapped.editors = [...new Map(revisions.map((revision) => [revision.actorName, { name: revision.actorName || "", at: revision.createdAt || "" }])).values()]
  mapped.isLegacyPending = text(entry.reviewStatus) === LEGACY_PENDING_REVIEW
  mapped.reviewLabel = mapped.isLegacyPending ? "Legacy review pending" : ""
  if (studentContribution) {
    mapped.studentContributionId = studentContribution.id || ""
    mapped.studentContributionStatus = studentContribution.status || ""
    mapped.studentContributionDueAt = studentContribution.dueAt || ""
    mapped.studentCanEdit = isStudentLibraryContributionEditable(studentContribution, now)
  } else {
    mapped.studentContributionId = ""
    mapped.studentContributionStatus = ""
    mapped.studentContributionDueAt = ""
    mapped.studentCanEdit = false
  }
  return mapped
}

async function prisma() { return getSharedPrismaClient() }

export async function listLibraryEntries(query = {}) {
  const client = await prisma()
  await reconcileStudentLibraryLifecycle(text(query.studentRefId))
  const page = Math.max(1, Number.parseInt(text(query.page), 10) || 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(text(query.pageSize), 10) || 25))
  const search = lower(query.search)
  const studentRefId = text(query.studentRefId)
  const myWords = ["1", "true", "yes"].includes(lower(query.myWords))
  const filters = ["partOfSpeech", "phraseType", "countability", "verbRegularity", "verbTransitivity", "createdByName", "physicalQuality", "grammaticalNumber", "primaryClassification", "materialUsage"].reduce((result, key) => {
    const value = text(query[key]); if (value) result[key] = lower(value); return result
  }, {})
  const where = {
    ...filters,
    ...(myWords && studentRefId ? { contributions: { some: { studentRefId, status: { in: ["pending_review", "approved", "migrated", "canonicalized", LEGACY_PENDING_REVIEW, AWAITING_LEGACY_CANONICAL, PENDING_CANONICAL_REPLACEMENT] } } } } : {}),
    ...(search ? { OR: [{ english: { contains: search, mode: "insensitive" } }, { vietnamese: { contains: search, mode: "insensitive" } }, { definition: { contains: search, mode: "insensitive" } }, { etymology: { contains: search, mode: "insensitive" } }] } : {})
  }
  const sortBy = ["english", "createdAt", "updatedAt", "partOfSpeech", "syllableCount"].includes(text(query.sortBy)) ? text(query.sortBy) : "english"
  const direction = lower(query.direction) === "desc" ? "desc" : "asc"
  const entryInclude = {
    revisions: { orderBy: { createdAt: "asc" } },
    mediaAssets: { select: { id: true, provider: true, dialect: true, mimeType: true, byteLength: true, sha256: true } },
    ...(studentRefId ? { contributions: { where: { studentRefId }, orderBy: { submittedAt: "desc" }, take: 1 } } : {}),
  }
  const [total, entries] = await client.$transaction([
    client.libraryEntry.count({ where }),
    client.libraryEntry.findMany({ where, orderBy: [{ [sortBy]: direction }, { english: "asc" }], skip: (page - 1) * pageSize, take: pageSize, include: entryInclude }),
  ])
  const pending = myWords && studentRefId
    ? await client.libraryContribution.findMany({ where: { studentRefId, entryId: null, status: { in: ["pending_review", LEGACY_PENDING_REVIEW, AWAITING_LEGACY_CANONICAL] } }, orderBy: { submittedAt: "asc" } })
    : []
  const pendingItems = pending
    .filter((contribution) => {
      const payload = contribution.payloadJson && typeof contribution.payloadJson === "object" ? contribution.payloadJson : {}
      return (!filters.partOfSpeech || lower(payload.partOfSpeech) === filters.partOfSpeech)
        && (!search || [payload.english, payload.vietnamese, payload.definition].some((value) => lower(value).includes(search)))
    })
    .map((contribution) => ({
      ...activePayloadValue(contribution.payloadJson || {}, "payloadJson"),
      id: contribution.id,
      isContribution: true,
      contributionId: contribution.id,
      contributionStatus: contribution.status,
      dueAt: contribution.dueAt || "",
      submittedAt: contribution.submittedAt || "",
      canonicalEntryId: contribution.entryId || "",
      sourceKind: contribution.sourceKind || "",
      sourceId: contribution.sourceId || "",
      editors: [],
      studentContributionId: contribution.id,
      studentContributionStatus: contribution.status,
      studentContributionDueAt: contribution.dueAt || "",
      studentCanEdit: isStudentLibraryContributionEditable(contribution),
    }))
  const items = [...entries.map((entry) => mapEntry(entry, { studentRefId })), ...pendingItems].sort((left, right) => text(left.english).localeCompare(text(right.english)) || text(left.partOfSpeech).localeCompare(text(right.partOfSpeech)))
  return { ok: true, page, pageSize, total: total + pendingItems.length, items: items.slice(0, pageSize) }
}

export async function getLibraryEntry(id) {
  const entryId = text(id)
  if (!entryId) throw statusError("Library entry id is required")
  const client = await prisma()
  const entry = await client.libraryEntry.findUnique({ where: { id: entryId }, include: { revisions: { orderBy: { createdAt: "asc" } }, mediaAssets: { select: { id: true, provider: true, dialect: true, mimeType: true, byteLength: true, sha256: true } } } })
  if (!entry) throw statusError("Library entry was not found", 404)
  return mapEntry(entry)
}

export async function getStudentLibraryAssignments(studentRefId) {
  const client = await prisma()
  return { ok: true, items: (await client.libraryAssignment.findMany({ where: { studentRefId, status: "assigned" }, include: { entry: true }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }] })).map((item) => ({ ...activePayloadValue(item), entry: item.entry ? mapEntry(item.entry) : {} })) }
}

export async function submitLibraryContribution(studentRefId, contributorName, payload = {}) {
  const rawEntry = payload.entry || payload
  const esl = rawEntry.esl && typeof rawEntry.esl === "object" ? rawEntry.esl : {}
  const entry = {
    english: clamp(rawEntry.english), partOfSpeech: lower(rawEntry.partOfSpeech), vietnamese: clamp(rawEntry.vietnamese),
    syllabication: normalizeVocabularySyllabication(rawEntry.syllabication), definition: normalizeLibraryDefinition(rawEntry.definition),
    ...Object.fromEntries(Object.entries({ ...rawEntry, ...esl }).filter(([key]) => key.startsWith("verb") || ["phraseType", "grammarClassification", "countability", "nounType", "nounNumber", "physicalQuality", "grammaticalNumber", "primaryClassification", "materialUsage", "properNounVariantShift", "dualCountabilityUsage", "edAdjective", "ingAdjective", "displayVerbForm", "etymologyType", "etymology", "originPath", "originReferences"].includes(key))),
  }
  if (!entry.english || !POS.has(entry.partOfSpeech)) throw statusError("New Words submissions require English and a supported part of speech")
  const capitalizationError = vocabularyEnglishCapitalizationError(entry)
  if (capitalizationError) throw statusError(capitalizationError)
  const client = await prisma()
  const studentId = text(studentRefId)
  const sourceId = clamp(payload.sourceId)
  const existingEntryId = clamp(payload.entryId)
  const contributionId = clamp(payload.contributionId)
  const now = new Date()
  const refreshExistingContribution = async (existing) => {
    if (!existing || text(existing.studentRefId) !== studentId) throw statusError("Students may edit only their own Library contribution", 403)
    if (!isStudentLibraryContributionEditable(existing, now)) {
      if (existing.dueAt && new Date(existing.dueAt) <= now) await reconcileStudentLibraryLifecycle(studentId, now)
      throw statusError("This Library contribution is no longer editable", 403)
    }
    const pendingBeforeCanonicalization = ["pending_review", LEGACY_PENDING_REVIEW, AWAITING_LEGACY_CANONICAL].includes(text(existing.status))
    const refreshed = await client.$transaction(async (tx) => {
      const updated = await tx.libraryContribution.update({
        where: { id: existing.id },
        data: { payloadJson: activePayloadValue(entry, "payloadJson"), dueAt: pendingBeforeCanonicalization ? null : existing.dueAt },
      })
      await writeContributionRevision(tx, updated, isAwaitingLegacyCanonical(existing.status) ? "student_refresh_awaiting_legacy_canonical" : "student_refresh")
      return updated
    })
    return {
      ok: true,
      contribution: mapContribution(refreshed),
      refreshed: true,
      message: isAwaitingLegacyCanonical(existing.status)
        ? "Your contribution is waiting for the legacy canonical review."
        : "Your Library contribution was refreshed.",
    }
  }
  if (studentId && contributionId) {
    const existing = await client.libraryContribution.findUnique({ where: { id: contributionId } })
    return refreshExistingContribution(existing)
  }
  if (studentId && existingEntryId) {
    const existing = await client.libraryContribution.findFirst({
      where: {
        studentRefId: studentId,
        entryId: existingEntryId,
        status: { in: ["pending_review", "approved", "canonicalized", LEGACY_PENDING_REVIEW, AWAITING_LEGACY_CANONICAL, PENDING_CANONICAL_REPLACEMENT] },
      },
      orderBy: { submittedAt: "desc" },
    })
    return refreshExistingContribution(existing)
  }
  if (studentId && sourceId) {
    const existing = await client.libraryContribution.findFirst({ where: { studentRefId: studentId, sourceKind: "student_new_words", sourceId }, orderBy: { submittedAt: "desc" } })
    if (existing) return refreshExistingContribution(existing)
  }
  const submittedAt = now
  const pair = canonicalPair(entry)
  const provisional = studentId
    ? await client.libraryEntry.findFirst({ where: { normalizedKey: pair.normalizedKey, partOfSpeech: pair.partOfSpeech, reviewStatus: LEGACY_PENDING_REVIEW }, select: { id: true } })
    : null
  const contribution = await client.$transaction(async (tx) => {
    const created = await tx.libraryContribution.create({ data: {
      entryId: existingEntryId || provisional?.id || null,
      studentRefId: studentId || null,
      contributorName: clamp(contributorName),
      sourceKind: studentId ? "student_new_words" : "admin_library",
      sourceId: sourceId || null,
      payloadJson: activePayloadValue(entry, "payloadJson"),
      status: provisional ? AWAITING_LEGACY_CANONICAL : "pending_review",
      submittedAt,
      dueAt: null,
    } })
    await writeContributionRevision(tx, created, provisional ? "submitted_awaiting_legacy_canonical" : "submitted")
    return created
  })
  return { ok: true, contribution: mapContribution(contribution), message: provisional ? "Submitted and waiting for the legacy canonical review." : "Submitted to Library for review." }
}

export async function refreshStudentLibraryContributions(studentRefId, contributorName, entries = []) {
  const studentId = text(studentRefId)
  const rows = Array.isArray(entries) ? entries : []
  if (!studentId || !rows.length) return { ok: true, refreshed: 0 }
  const client = await prisma()
  const sourceIds = rows.map((row) => clamp(row?.id)).filter(Boolean)
  const pending = sourceIds.length
    ? await client.libraryContribution.findMany({ where: { studentRefId: studentId, sourceKind: "student_new_words", sourceId: { in: sourceIds }, status: { in: ["pending_review", AWAITING_LEGACY_CANONICAL] } } })
    : []
  let refreshed = 0
  for (const contribution of pending) {
    const source = rows.find((row) => clamp(row?.id) === contribution.sourceId)
    if (!source) continue
    await submitLibraryContribution(studentId, contributorName, { sourceId: contribution.sourceId, entry: source })
    refreshed += 1
  }
  return { ok: true, refreshed }
}

async function writeRevision(client, entry, action, actorName, actorRole) {
  return client.libraryEntryRevision.create({ data: { entryId: entry.id, action, actorName: clamp(actorName), actorRole: clamp(actorRole), snapshotJson: entry } })
}

async function writeContributionRevision(client, contribution, action) {
  return client.libraryContributionRevision.create({ data: {
    contributionId: contribution.id,
    action,
    snapshotJson: {
      id: contribution.id,
      entryId: contribution.entryId || "",
      studentRefId: contribution.studentRefId || "",
      contributorName: contribution.contributorName || "",
      sourceKind: contribution.sourceKind || "",
      sourceId: contribution.sourceId || "",
      payloadJson: activePayloadValue(contribution.payloadJson || {}, "payloadJson"),
      status: contribution.status || "",
      submittedAt: contribution.submittedAt?.toISOString?.() || "",
      dueAt: contribution.dueAt?.toISOString?.() || "",
      canonicalizedAt: contribution.canonicalizedAt?.toISOString?.() || "",
    },
  } })
}

async function canonicalEntryForContribution(tx, payload, actor = {}, options = {}) {
  const data = normalizeEntry(payload, options)
  const pair = canonicalPair(data)
  const existing = await tx.libraryEntry.findUnique({ where: { normalizedKey_partOfSpeech: pair } })
  const entry = await tx.libraryEntry.upsert({
    where: { normalizedKey_partOfSpeech: pair },
    update: { ...data, reviewStatus: "approved", lastEditedByName: clamp(actor.name) },
    create: { ...data, reviewStatus: "approved", createdByName: clamp(actor.name || "Library canonicalization"), lastEditedByName: clamp(actor.name || "Library canonicalization") },
  })
  return { entry, existing }
}

export async function reconcileStudentLibraryLifecycle(studentRefId, now = new Date()) {
  const studentId = text(studentRefId)
  if (!studentId) return { ok: true, reconciled: 0 }
  const client = await prisma()
  const pending = await client.libraryContribution.findMany({ where: { studentRefId: studentId, status: { in: ["approved", "canonicalized", PENDING_CANONICAL_REPLACEMENT] }, dueAt: { lte: now } }, orderBy: { dueAt: "asc" } })
  let reconciled = 0
  for (const contribution of pending) {
    await client.$transaction(async (tx) => {
      const current = await tx.libraryContribution.findUnique({ where: { id: contribution.id } })
      if (!current || !["approved", "canonicalized", PENDING_CANONICAL_REPLACEMENT].includes(current.status) || !current.dueAt || current.dueAt > now) return
      const payload = current.payloadJson && typeof current.payloadJson === "object" ? current.payloadJson : {}
      const preservedCanonical = current.status === PENDING_CANONICAL_REPLACEMENT && current.entryId
        ? await tx.libraryEntry.findUnique({ where: { id: current.entryId } })
        : null
      const { entry, existing } = preservedCanonical
        ? { entry: preservedCanonical, existing: true }
        : await canonicalEntryForContribution(tx, payload, { name: "Library lifecycle", role: "system" })
      const updated = await tx.libraryContribution.update({ where: { id: current.id }, data: { entryId: entry.id, status: "canonicalized", canonicalizedAt: now, reviewedAt: now, reviewedByName: "Library lifecycle", dueAt: current.dueAt } })
      await writeContributionRevision(tx, updated, current.status === PENDING_CANONICAL_REPLACEMENT ? "expired_canonical_replacement" : "expired_canonicalization")
      if (!existing) await writeRevision(tx, entry, "expired_canonicalization", "Library lifecycle", "system")
      if (current.sourceKind === "student_new_words" && current.sourceId) {
        await tx.studentNewWord.updateMany({ where: { id: current.sourceId, studentRefId: studentId }, data: { englishKey: normalizeKey(entry.english), english: entry.english, partOfSpeech: entry.partOfSpeech, vietnamese: entry.vietnamese, syllabication: entry.syllabication, definition: entry.definition, eslJson: activePayloadValue(entry, "payloadJson"), archivedLibraryEntryId: entry.id } })
      }
      reconciled += 1
    })
  }
  return { ok: true, reconciled }
}

export async function reconcileLibraryLifecycle(now = new Date()) {
  const client = await prisma()
  const students = await client.libraryContribution.findMany({ where: { status: { in: ["approved", "canonicalized", PENDING_CANONICAL_REPLACEMENT] }, dueAt: { lte: now }, studentRefId: { not: null } }, distinct: ["studentRefId"], select: { studentRefId: true } })
  let reconciled = 0
  for (const row of students) reconciled += (await reconcileStudentLibraryLifecycle(row.studentRefId, now)).reconciled
  return { ok: true, reconciled, students: students.length }
}

export async function reviewLibraryContribution(id, actor = {}, payload = {}) {
  const client = await prisma()
  const contribution = await client.libraryContribution.findUnique({ where: { id } })
  if (!contribution) throw statusError("Library contribution was not found", 404)
  const approved = Boolean(payload.approved)
  if (!approved) {
    const rejected = await client.libraryContribution.update({ where: { id }, data: { status: "rejected", reviewedAt: new Date(), reviewedByName: clamp(actor.name) } })
    await writeContributionRevision(client, rejected, "rejected")
    return { ok: true, status: "rejected" }
  }
  const canonicalContributionId = clamp(payload.canonicalContributionId) || id
  const canonicalContribution = canonicalContributionId === id
    ? contribution
    : await client.libraryContribution.findUnique({ where: { id: canonicalContributionId } })
  if (!canonicalContribution) throw statusError("The selected canonical Library contribution was not found", 404)
  const submitted = normalizeEntry(payload.entry || canonicalContribution.payloadJson, { allowIncomplete: true })
  const result = await client.$transaction(async (tx) => {
    const pair = canonicalPair(submitted)
    const siblings = await tx.libraryContribution.findMany({ where: { status: { in: ["pending_review", LEGACY_PENDING_REVIEW, AWAITING_LEGACY_CANONICAL] } } })
    const sourceEntryIds = new Set([contribution.entryId, canonicalContribution.entryId].map(text).filter(Boolean))
    const matching = siblings.filter((candidate) => {
      const candidatePayload = candidate.payloadJson && typeof candidate.payloadJson === "object" ? candidate.payloadJson : {}
      const sameSourceEntry = sourceEntryIds.has(text(candidate.entryId))
      const sameCanonicalPair = lower(candidatePayload.partOfSpeech) === submitted.partOfSpeech && normalizeKey(candidatePayload.english) === pair.normalizedKey
      return sameSourceEntry || sameCanonicalPair
    })
    const legacy = matching.some((candidate) => isLegacyPending(candidate.status)) || isLegacyPending(contribution.status)
    const duplicate = matching.length > 1 || legacy
    const { entry, existing } = await canonicalEntryForContribution(tx, submitted, actor, { allowIncomplete: true })
    if (!existing || duplicate) await writeRevision(tx, entry, legacy ? "legacy_canonicalization" : duplicate ? "canonicalization" : "approved_submission", actor.name, actor.role || "admin")
    const targets = duplicate ? matching.filter((target) => !isAwaitingLegacyCanonical(target.status)) : [contribution]
    const canonicalizedAt = new Date()
    for (const target of targets) {
      const targetStatus = duplicate ? "canonicalized" : "approved"
      const dueAt = target.studentRefId && !isLegacyPending(target.status)
        ? libraryContributionDeadline(canonicalizedAt)
        : null
      const updated = await tx.libraryContribution.update({ where: { id: target.id }, data: { entryId: entry.id, status: targetStatus, reviewedAt: canonicalizedAt, reviewedByName: clamp(actor.name), canonicalizedAt, dueAt } })
      await writeContributionRevision(tx, updated, legacy ? "legacy_canonicalized" : duplicate ? "canonicalized" : "approved")
    }
    if (legacy) {
      const waiting = matching.filter((target) => isAwaitingLegacyCanonical(target.status))
      for (const target of waiting) {
        const updated = await tx.libraryContribution.update({ where: { id: target.id }, data: { entryId: entry.id, status: PENDING_CANONICAL_REPLACEMENT, dueAt: libraryContributionDeadline(canonicalizedAt), reviewedAt: canonicalizedAt, reviewedByName: clamp(actor.name) } })
        await writeContributionRevision(tx, updated, "legacy_canonical_declared")
      }
    }
    return entry
  })
  return { ok: true, entry: mapEntry(result) }
}

export async function updateLibraryEntry(id, actor = {}, payload = {}) {
  const client = await prisma(); const data = normalizeEntry(payload, { allowIncomplete: true })
  const result = await client.$transaction(async (tx) => {
    const updated = await tx.libraryEntry.update({ where: { id }, data: { ...data, reviewStatus: "approved", lastEditedByName: clamp(actor.name) } })
    await writeRevision(tx, updated, "approved_edit", actor.name, actor.role || "admin")
    const openContributions = await tx.libraryContribution.findMany({ where: { status: { in: OPEN_CANONICAL_CONTRIBUTION_STATUSES } } })
    const matching = openContributions.filter((contribution) => contribution.entryId === updated.id || selectContributionsForCanonicalEntry([contribution], updated).length > 0)
    const legacy = matching.some((contribution) => isLegacyPending(contribution.status))
    const canonicalizedAt = new Date()
    let canonicalizedContributions = 0
    for (const contribution of matching.filter((candidate) => !isAwaitingLegacyCanonical(candidate.status))) {
      const dueAt = contribution.studentRefId && !isLegacyPending(contribution.status)
        ? libraryContributionDeadline(canonicalizedAt)
        : null
      const canonicalized = await tx.libraryContribution.update({ where: { id: contribution.id }, data: { entryId: updated.id, status: "canonicalized", reviewedAt: canonicalizedAt, reviewedByName: clamp(actor.name), canonicalizedAt, dueAt } })
      await writeContributionRevision(tx, canonicalized, "canonicalized_by_admin_edit")
      canonicalizedContributions += 1
    }
    for (const contribution of matching.filter((candidate) => isAwaitingLegacyCanonical(candidate.status))) {
      const waiting = await tx.libraryContribution.update({ where: { id: contribution.id }, data: { entryId: updated.id, status: PENDING_CANONICAL_REPLACEMENT, dueAt: libraryContributionDeadline(canonicalizedAt), reviewedAt: canonicalizedAt, reviewedByName: clamp(actor.name) } })
      await writeContributionRevision(tx, waiting, "legacy_canonical_declared_by_admin_edit")
    }
    if (legacy) await writeRevision(tx, updated, "canonicalization_by_admin_edit", actor.name, actor.role || "admin")
    return { entry: updated, canonicalizedContributions }
  })
  return { ok: true, entry: mapEntry(result.entry), canonicalizedContributions: result.canonicalizedContributions }
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
  const requestedStatus = lower(query.status)
  const status = requestedStatus || "open_review"
  const subject = lower(query.subject); const route = lower(query.route)
  const contributionWhere = status === "open_review"
    ? { status: { in: ["pending_review", LEGACY_PENDING_REVIEW] } }
    : { status }
  const contributions = await client.libraryContribution.findMany({ where: contributionWhere, orderBy: { submittedAt: "asc" }, take: MAX_REVIEW_QUEUE_SIZE })
  const grouped = new Map()
  for (const contribution of contributions) {
    const payload = contribution.payloadJson && typeof contribution.payloadJson === "object" ? contribution.payloadJson : {}
    const key = `${normalizeKey(payload.english)}|${lower(payload.partOfSpeech)}`
    const siblings = grouped.get(key) || []
    siblings.push(contribution)
    grouped.set(key, siblings)
  }
  const queueContributions = selectReviewQueueRepresentatives(contributions)
  const items = queueContributions.map((contribution) => {
    const payload = contribution.payloadJson || {}
    const key = `${normalizeKey(payload.english)}|${lower(payload.partOfSpeech)}`
    const siblings = grouped.get(key) || []
    const legacyReview = isLegacyPending(contribution.status)
    const legacyGroup = siblings.some((sibling) => isLegacyPending(sibling.status))
    const legacySiblings = siblings.filter((sibling) => isLegacyPending(sibling.status))
    const comparable = siblings.length > 1 || legacyReview || legacyGroup
    return {
      ...mapContribution(contribution),
      payloadJson: activePayloadValue(payload, "payloadJson"),
      queueType: contribution.entryId ? "edit" : "new_entry",
      duplicateGroupKey: key,
      potentialDuplicate: siblings.length > 1,
      legacyReview,
      legacyGroup,
      canonicalizationMode: legacyGroup ? "legacy_canonicalization" : siblings.length > 1 ? "canonicalization" : "approval",
      largestDuplicateId: comparable ? selectLargestDuplicate(legacyGroup ? legacySiblings : siblings)?.id || "" : "",
      duplicateGroup: comparable ? siblings.map((sibling) => ({
        id: sibling.id,
        entryId: sibling.entryId,
        contributorName: sibling.contributorName || "",
        submittedAt: sibling.submittedAt || "",
        dueAt: sibling.dueAt || "",
        canonicalizedAt: sibling.canonicalizedAt || "",
        status: sibling.status || "",
        legacyReview: isLegacyPending(sibling.status),
        payloadJson: activePayloadValue(sibling.payloadJson || {}, "payloadJson"),
        queueType: sibling.entryId ? "edit" : "new_entry",
      })) : [],
    }
  })
  const assignments = await client.libraryAssignment.findMany({ where: { status: "assigned", ...(subject ? { subject: { contains: subject, mode: "insensitive" } } : {}), ...(route ? { route: { contains: route, mode: "insensitive" } } : {}) }, include: { entry: true }, orderBy: { createdAt: "asc" }, take: MAX_PAGE_SIZE })
  return { ok: true, total: items.length + assignments.length, items, assignments: assignments.map((assignment) => ({ ...activePayloadValue(assignment), entry: assignment.entry ? mapEntry(assignment.entry) : {} })) }
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
  const existing = await client.libraryAssignmentEngagement.findUnique({ where: { assignmentId_recipientEmail: { assignmentId: id, recipientEmail: recipient } } })
  if (existing) return { ok: true, duplicate: true, queueId: existing.queueId || "", engagement: existing }
  const queueId = libraryAssignmentQueueId(id)
  const token = libraryAssignmentTrackingToken(id, recipient)
  const origin = text(process.env.STUDENT_ADMIN_PUBLIC_ORIGIN || process.env.PUBLIC_APP_ORIGIN || "https://eagles.edu.vn").replace(/\/+$/u, "")
  const actionUrl = `${origin}/api/library-assignments/track/click/${token}`
  const message = `Nhiệm vụ Thư viện: ${assignment.taskType}. ${assignment.instructions || "Vui lòng mở Thư viện và hoàn thành phần bài tập từ vựng được giao."}`
  const queued = await queueAnnouncementEmail({ queueId, deliveryMode: "weekend-batch", queueType: "announcement", assignmentTitle: assignment.subject || `Library Vocabulary Assignment — Week ${assignment.weekNumber || weekNumber(assignment.createdAt)}`, exerciseTitle: assignment.entry?.english || "Library vocabulary", dueAt: assignment.dueAt?.toISOString?.() || "", message, recipients: [recipient], requestOrigin: origin, actionUrl, libraryAssignmentToken: token }, { queuedByUsername: actor.name || "library-admin" })
  const engagement = await client.libraryAssignmentEngagement.upsert({
    where: { assignmentId_recipientEmail: { assignmentId: id, recipientEmail: recipient } },
    update: { queueId: queued.queueId },
    create: { assignmentId: id, recipientEmail: recipient, trackingToken: token, queueId: queued.queueId, metadataJson: { taskType: assignment.taskType, entryId: assignment.entryId, assignedByName: assignment.assignedByName } },
  })
  return { ok: true, queueId: queued.queueId, engagement }
}

export async function trackLibraryAssignment(token, action = "click") {
  const client = await prisma()
  const engagement = await client.libraryAssignmentEngagement.findUnique({ where: { trackingToken: token } })
  if (!engagement) return null
  const field = action === "open" ? "openedAt" : action === "complete" ? "completedAt" : "clickedAt"
  if (!engagement[field]) await client.libraryAssignmentEngagement.updateMany({ where: { id: engagement.id, [field]: null }, data: { [field]: new Date() } })
  return client.libraryAssignmentEngagement.findUnique({ where: { id: engagement.id } })
}

export async function listLibraryAssignmentEngagement(query = {}) {
  const client = await prisma()
  const rows = (await client.libraryAssignmentEngagement.findMany({
    where: {
      sentAt: { not: null },
      OR: [{ completedAt: null }, { completedAt: { gte: engagementRetentionCutoff() } }],
    },
    orderBy: { queuedAt: "desc" },
    take: MAX_PAGE_SIZE,
    include: { assignment: { include: { entry: true } } },
  }))
    .filter((row) => isEngagementVisible({ sentAt: row.sentAt, completedAt: row.completedAt }))
  const queueIds = rows.map((row) => row.queueId).filter(Boolean)
  const queues = queueIds.length ? await client.adminNotificationQueue.findMany({ where: { id: { in: queueIds } }, select: { id: true, sentAt: true, status: true } }) : []
  const queueMap = new Map(queues.map((queue) => [queue.id, queue]))
  const deliveries = queueIds.length && client.brevoEmailDelivery?.findMany
    ? await client.brevoEmailDelivery.findMany({ where: { batchId: { in: queueIds } }, orderBy: { createdAt: "asc" } })
    : []
  const deliveryMap = new Map()
  for (const delivery of deliveries) {
    const key = `${delivery.batchId}|${lower(delivery.recipientEmail)}`
    deliveryMap.set(key, mergeEngagementDelivery(deliveryMap.get(key), delivery))
  }
  const students = await client.student.findMany({ include: { profile: true } })
  const names = new Map(students.map((student) => [student.id, text(student.profile?.englishName || student.profile?.fullName || student.eaglesId)]))
  return {
    ok: true,
    total: rows.length,
    items: rows.map((row) => {
      const queue = queueMap.get(row.queueId)
      const delivery = deliveryMap.get(`${row.queueId}|${lower(row.recipientEmail)}`)
      const sentAt = dateText(row.sentAt || delivery?.sentAt || queue?.sentAt)
      const deliveredAt = dateText(row.deliveredAt || delivery?.deliveredAt)
      const proxyLoadedAt = dateText(row.proxyLoadedAt || delivery?.proxyLoadedAt)
      const firstOpenedAt = dateText(row.firstOpenedAt || delivery?.firstOpenedAt)
      const uniqueOpenedAt = dateText(row.uniqueOpenedAt || delivery?.uniqueOpenedAt)
      const openedAt = dateText(row.openedAt || delivery?.openedAt)
      const clickedAt = dateText(row.clickedAt || delivery?.clickedAt)
      return activePayloadValue({
        ...row,
        sentAt,
        deliveredAt,
        proxyLoadedAt,
        firstOpenedAt,
        uniqueOpenedAt,
        openedAt,
        clickedAt,
        queueStatus: queue?.status || "queued",
        studentName: names.get(row.assignment.studentRefId) || row.assignment.studentRefId,
        assignmentTitle: row.assignment.entry?.english || "New Library entry",
        subject: row.assignment.subject || "",
        route: row.assignment.route || "",
        status: clickedAt ? "clicked" : openedAt || uniqueOpenedAt || firstOpenedAt ? "opened" : deliveredAt ? "delivered" : sentAt ? "sent" : "queued",
      })
    }),
  }
}

function legacyEntry(raw = {}) {
  const esl = raw.esl && typeof raw.esl === "object" ? raw.esl : {}
  const value = { ...raw, ...esl }
  return { normalizedKey: normalizeKey(value.english), english: clamp(value.english), americanEnglish: clamp(value.americanEnglish) || null, britishEnglish: clamp(value.britishEnglish) || null, partOfSpeech: lower(value.partOfSpeech), phraseType: lower(value.phraseType) || null, grammarClassification: grammarClassification(value.grammarClassification), etymologyType: lower(value.etymologyType) || null, etymology: clamp(value.etymology, 4000) || null, originPath: clamp(value.originPath, 500) || null, originReferences: normalizeOriginReferences(value.originReferences), vietnamese: clamp(value.vietnamese), syllabication: clamp(value.syllabication), syllableCount: syllableCount(value.syllabication), definition: normalizeLibraryDefinition(value.definition), countability: lower(value.countability) || null, nounType: lower(value.nounType) || null, nounNumber: lower(value.nounNumber) || null, physicalQuality: lower(value.physicalQuality) || null, grammaticalNumber: lower(value.grammaticalNumber) || null, primaryClassification: lower(value.primaryClassification) || null, materialUsage: lower(value.materialUsage) || null, properNounVariantShift: Boolean(value.properNounVariantShift), dualCountabilityUsage: lower(value.dualCountabilityUsage) || null, verbRegularity: lower(value.verbRegularity) || null, verbTransitivity: lower(value.verbTransitivity) || null, verbInfinitive: clamp(value.verbInfinitive) || null, verbV1: clamp(value.verbV1) || null, verbV2: clamp(value.verbV2) || null, verbV3: clamp(value.verbV3) || null, verbV4: clamp(value.verbV4) || null, verbV5: clamp(value.verbV5) || null, displayVerbForm: lower(value.displayVerbForm) || null, edAdjective: Boolean(value.edAdjective), ingAdjective: Boolean(value.ingAdjective), awlFamilyHeadword: clamp(value.awlFamilyHeadword) || null, awlQualifyingMember: clamp(value.awlQualifyingMember) || null, awlMemberForm: clamp(value.awlMemberForm) || null, awlSublist: Number(value.awlSublist) || null }
}

function conflicts(rows) {
  const fields = ["english", "vietnamese", "syllabication", "definition"]
  return Object.fromEntries(fields.map((field) => [field, [...new Set(rows.map((row) => text(row.payload[field])).filter(Boolean))]]).filter(([, values]) => values.length > 1))
}

export async function createLibraryLegacyPreflight(runKey = "legacy-cutover-v1") {
  const client = await prisma()
  const [words, reports, students, entries] = await Promise.all([
    client.studentNewWord.findMany({ where: { archivedAt: null } }),
    client.studentNewsReport.findMany({ where: { OR: [{ mmrPassedAt: { not: null } }, { dateSatisfiedAt: { not: null } }, { submissionState: "ready" }, { submissionState: "submitted", firstSubmittedAt: { not: null } }] } }),
    client.student.findMany({ include: { profile: true } }),
    client.libraryEntry.findMany({ include: { revisions: { orderBy: { createdAt: "asc" } } } }),
  ])
  const names = new Map(students.map((student) => [student.id, text(student.profile?.englishName || student.profile?.fullName || student.eaglesId)]))
  const entryGroups = new Map()
  for (const entry of entries) {
    const key = `${entry.normalizedKey}|${lower(entry.partOfSpeech)}`
    entryGroups.set(key, [...(entryGroups.get(key) || []), entry])
  }
  const legacyEntries = [...entryGroups.values()].flat().filter((entry) => (entryGroups.get(`${entry.normalizedKey}|${lower(entry.partOfSpeech)}`) || []).length > 1 || text(entry.reviewStatus) !== "approved")
  const rows = [
    ...words.map((word) => ({ sourceKind: "legacy_new_word", sourceId: word.id, studentRefId: word.studentRefId, contributorName: names.get(word.studentRefId) || word.studentRefId, createdAt: word.createdAt, payload: { english: word.english, partOfSpeech: word.partOfSpeech, vietnamese: word.vietnamese, syllabication: word.syllabication, definition: word.definition, esl: word.eslJson || {} } })),
    ...reports.flatMap((report) => (Array.isArray(report.vocabularyJson) ? report.vocabularyJson : []).map((payload, index) => ({ sourceKind: "legacy_news_vocabulary", sourceId: `${report.id}:${index}`, studentRefId: report.studentRefId, contributorName: names.get(report.studentRefId) || report.studentRefId, createdAt: report.createdAt, payload }))),
    ...legacyEntries.map((entry) => ({ sourceKind: "legacy_library_entry", sourceId: entry.id, studentRefId: null, contributorName: entry.createdByName || "legacy Library", createdAt: entry.createdAt, payload: activePayloadValue(entry, "payloadJson"), entrySnapshotJson: activePayloadValue(entry, "payloadJson"), entryRevisionsJson: activePayloadValue(entry.revisions || [], "items") })),
  ].filter((row) => normalizeKey(row.payload.english) && lower(row.payload.partOfSpeech))
  const groups = new Map(); for (const row of rows) { const key = `${normalizeKey(row.payload.english)}|${lower(row.payload.partOfSpeech)}`; groups.set(key, [...(groups.get(key) || []), row]) }
  await client.$transaction(async (tx) => { for (const [key, group] of groups) { const [normalizedKey, partOfSpeech] = key.split("|"); await tx.libraryMigrationPreflight.upsert({ where: { runKey_normalizedKey_partOfSpeech: { runKey, normalizedKey, partOfSpeech } }, update: { sourceRowsJson: group, conflictsJson: conflicts(group) }, create: { runKey, normalizedKey, partOfSpeech, sourceRowsJson: group, conflictsJson: conflicts(group) } }) } }, LEGACY_MIGRATION_TRANSACTION_OPTIONS)
  return { ok: true, runKey, groups: groups.size, sourceRows: rows.length }
}

export async function cutoverLegacyLibrary(actor = {}, runKey = "legacy-cutover-v1") {
  const client = await prisma()
  const preflight = await client.libraryMigrationPreflight.findMany({ where: { runKey }, orderBy: { normalizedKey: "asc" } })
  if (!preflight.length) throw statusError("Run the immutable legacy preflight before cutover")
  let migrated = 0
  let archivedSources = 0
  let collapsedEntries = 0
  await client.$transaction(async (tx) => {
    for (const group of preflight) {
      const rows = Array.isArray(group.sourceRowsJson) ? group.sourceRowsJson : []
      const selected = selectLargestDuplicate(rows)
      if (!selected) continue
      for (const row of rows) {
        await tx.libraryLegacySourceArchive.upsert({
          where: { runKey_sourceKind_sourceId: { runKey, sourceKind: text(row.sourceKind), sourceId: text(row.sourceId) } },
          update: {},
          create: { runKey, sourceKind: text(row.sourceKind), sourceId: text(row.sourceId), normalizedKey: group.normalizedKey, partOfSpeech: group.partOfSpeech, payloadJson: activePayloadValue(row.payload || {}, "payloadJson"), entrySnapshotJson: row.entrySnapshotJson || null, entryRevisionsJson: row.entryRevisionsJson || null },
        })
        archivedSources += 1
      }
      const existingEntries = await tx.libraryEntry.findMany({ where: { normalizedKey: group.normalizedKey, partOfSpeech: group.partOfSpeech }, include: { revisions: true } })
      let entry = null
      if (existingEntries.length > 1) {
        const selectedExisting = selected.sourceKind === "legacy_library_entry" ? existingEntries.find((candidate) => candidate.id === selected.sourceId) : null
        const retained = selectedExisting || selectLargestDuplicate(existingEntries.map((candidate) => ({ id: candidate.id, createdAt: candidate.createdAt, payload: candidate })))
        const retainedId = retained?.id || existingEntries[0].id
        entry = await tx.libraryEntry.update({ where: { id: retainedId }, data: { ...legacyEntry(selected.payload), reviewStatus: LEGACY_PENDING_REVIEW, lastEditedByName: clamp(actor.name || "legacy cutover") } })
        const retiredIds = existingEntries.map((candidate) => candidate.id).filter((id) => id !== entry.id)
        if (retiredIds.length) {
          await tx.libraryContribution.updateMany({ where: { entryId: { in: retiredIds } }, data: { entryId: entry.id } })
          await tx.libraryAssignment.updateMany({ where: { entryId: { in: retiredIds } }, data: { entryId: entry.id } })
          await tx.libraryEntryRevision.deleteMany({ where: { entryId: { in: retiredIds } } })
          await tx.libraryEntry.deleteMany({ where: { id: { in: retiredIds } } })
          collapsedEntries += retiredIds.length
        }
        await writeRevision(tx, entry, "legacy_cutover_provisional", actor.name || "legacy cutover", actor.role || "system")
      } else if (existingEntries.length === 1) {
        entry = existingEntries[0]
        if (text(entry.reviewStatus) !== "approved" && text(entry.reviewStatus) !== LEGACY_PENDING_REVIEW) {
          entry = await tx.libraryEntry.update({ where: { id: entry.id }, data: { ...legacyEntry(selected.payload), reviewStatus: LEGACY_PENDING_REVIEW, lastEditedByName: clamp(actor.name || "legacy cutover") } })
          await writeRevision(tx, entry, "legacy_cutover_provisional", actor.name || "legacy cutover", actor.role || "system")
        }
      } else {
        entry = await tx.libraryEntry.create({ data: { ...legacyEntry(selected.payload), reviewStatus: LEGACY_PENDING_REVIEW, createdByName: selected.contributorName, lastEditedByName: clamp(actor.name || "legacy cutover") } })
        await writeRevision(tx, entry, "legacy_cutover_provisional", actor.name || "legacy cutover", actor.role || "system")
      }
      for (const row of rows) {
        const existing = await tx.libraryContribution.findFirst({ where: { sourceKind: text(row.sourceKind), sourceId: text(row.sourceId) }, orderBy: { submittedAt: "asc" } })
        const data = { entryId: entry.id, studentRefId: row.studentRefId || null, contributorName: text(row.contributorName), sourceKind: text(row.sourceKind), sourceId: text(row.sourceId), payloadJson: activePayloadValue(row.payload || {}, "payloadJson"), status: LEGACY_PENDING_REVIEW, submittedAt: new Date(row.createdAt), dueAt: null, reviewedAt: null, reviewedByName: null, canonicalizedAt: null }
        const alreadyCutOver = existing && existing.status === LEGACY_PENDING_REVIEW && existing.entryId === entry.id
        const contribution = existing
          ? alreadyCutOver ? existing : await tx.libraryContribution.update({ where: { id: existing.id }, data })
          : await tx.libraryContribution.create({ data })
        if (!alreadyCutOver) await writeContributionRevision(tx, contribution, existing ? "legacy_cutover_reopened" : "legacy_cutover_pending")
        if (row.sourceKind === "legacy_new_word") await tx.studentNewWord.updateMany({ where: { id: row.sourceId, archivedAt: null }, data: { archivedAt: new Date(), archivedLibraryEntryId: entry.id } })
      }
      migrated += 1
    }
  }, LEGACY_MIGRATION_TRANSACTION_OPTIONS)
  return { ok: true, runKey, migrated, archivedSources, collapsedEntries }
}

function stripMwMarkup(textValue, { preserveFormatting = false } = {}) {
  let value = text(textValue)
  if (preserveFormatting) {
    value = value
      .replace(/\{(?:it|italic)\}([\s\S]*?)\{\/(?:it|italic)\}/giu, "*$1*")
      .replace(/\{(?:b|bold)\}([\s\S]*?)\{\/(?:b|bold)\}/giu, "**$1**")
      .replace(/\{(?:sc|smallcaps)\}([\s\S]*?)\{\/(?:sc|smallcaps)\}/giu, "**$1**")
      .replace(/\{(?:br|brk)\}/giu, "\n")
  }
  return value
    .replace(/\{(?:bc)\}/giu, "")
    .replace(/\{(?:ldquo)\}/gu, '"')
    .replace(/\{(?:rdquo)\}/gu, '"')
    .replace(/\{(?:lsquo)\}/gu, "'")
    .replace(/\{(?:rsquo)\}/gu, "'")
    .replace(/\{[^{}|]+\|([^{}]*)\}/gu, (_, content) => content.split("|")[0])
    .replace(/\{\/?[^{}]+\}/gu, "")
    .replace(/[ \t]+/gu, " ")
    .replace(/[ \t]*\n[ \t]*/gu, "\n")
    .trim()
}

function stripMwDefinition(textValue) {
  return stripMwMarkup(textValue, { preserveFormatting: true })
}

function stripMw(textValue) { return stripMwMarkup(textValue).replace(/\*+/gu, "-") }
function stripMwWord(textValue) { return stripMwMarkup(textValue).replace(/\*+/gu, "").trim() }

function uniqueText(values, normalizer = stripMw) {
  const flatten = (value) => Array.isArray(value) ? value.flatMap(flatten) : [value]
  const flattened = flatten(Array.isArray(values) ? values : [values])
  return [...new Set(flattened.map(normalizer).filter(Boolean))]
}

function collectDefinitionText(value, output = []) {
  if (Array.isArray(value)) {
    if (typeof value[0] === "string" && ["text", "t"].includes(value[0])) output.push(value[1])
    else value.forEach((item) => collectDefinitionText(item, output))
    return output
  }
  if (!value || typeof value !== "object") return output
  Object.entries(value).forEach(([key, child]) => {
    if (["dt", "vis", "sdsense", "sseq", "pseq", "sense", "sen", "def", "dros", "bs", "uns", "uros"].includes(key)) collectDefinitionText(child, output)
    else if (key === "t") output.push(child)
  })
  return output
}

function collectSenseDefinitionText(value, output = []) {
  if (Array.isArray(value)) {
    if (typeof value[0] === "string" && ["text", "t"].includes(value[0])) output.push(value[1])
    else if (value[0] !== "vis") value.forEach((item) => collectSenseDefinitionText(item, output))
    return output
  }
  if (!value || typeof value !== "object") return output
  Object.entries(value).forEach(([key, child]) => {
    if (key === "vis") return
    if (key === "t") output.push(child)
    else collectSenseDefinitionText(child, output)
  })
  return output
}

function collectSenseExamples(value, output = [], inVisualExample = false) {
  if (Array.isArray(value)) {
    if (value[0] === "vis") value.slice(1).forEach((item) => collectSenseExamples(item, output, true))
    else if (typeof value[0] === "string" && ["text", "t"].includes(value[0])) {
      if (inVisualExample) output.push(value[1])
    } else value.forEach((item) => collectSenseExamples(item, output, inVisualExample))
    return output
  }
  if (!value || typeof value !== "object") return output
  Object.entries(value).forEach(([key, child]) => {
    if (key === "vis") collectSenseExamples(child, output, true)
    else if (key === "t") {
      if (inVisualExample) output.push(child)
    } else collectSenseExamples(child, output, inVisualExample)
  })
  return output
}

function senseListPrefix(value) {
  const label = stripMw(value).replace(/\s+/gu, " ").trim()
  const match = label.match(/^(\d+)(?:\s*([a-z]))?(?:\s*\((\d+)\))?$/iu)
  if (!match) return { indentation: "", level: 0, marker: "" }
  if (match[3]) return { indentation: "        ", level: 2, marker: `${match[3]}.` }
  if (match[2]) return { indentation: "    ", level: 1, marker: `${match[2]}.` }
  return { indentation: "", level: 0, marker: `${match[1]}.` }
}

function collectEtymologyText(value, output = []) {
  if (typeof value === "string") {
    output.push(value)
    return output
  }
  if (Array.isArray(value)) {
    if (typeof value[0] === "string" && ["text", "t"].includes(value[0])) output.push(value[1])
    else value.forEach((item) => collectEtymologyText(item, output))
    return output
  }
  if (!value || typeof value !== "object") return output
  Object.entries(value).forEach(([key, child]) => {
    if (["et", "etymology", "text", "t"].includes(key) && typeof child === "string") output.push(child)
    else collectEtymologyText(child, output)
  })
  return output
}

function collectDefinitionBlocks(value, output = []) {
  if (Array.isArray(value)) {
    if (value[0] === "sense" && value[1] && typeof value[1] === "object") {
      collectDefinitionBlocks({ sense: value[1] }, output)
      return output
    }
    value.forEach((item) => collectDefinitionBlocks(item, output))
    return output
  }
  if (!value || typeof value !== "object") return output
  Object.entries(value).forEach(([key, child]) => {
    if (key === "sense" && child && typeof child === "object" && !Array.isArray(child)) {
      const prefix = senseListPrefix(child.sn)
      const definitions = uniqueText(collectSenseDefinitionText(child.dt), stripMwDefinition)
      const dividedSense = child.sdsense && typeof child.sdsense === "object"
        ? [stripMw(child.sdsense.sd), ...uniqueText(collectSenseDefinitionText(child.sdsense.dt), stripMwDefinition)].filter(Boolean).join(" ")
        : ""
      const definition = [definitions.join(" ").trim(), dividedSense].filter(Boolean).join(dividedSense && definitions.length ? "; " : "")
      const examples = uniqueText([
        ...collectSenseExamples(child.dt),
        ...collectSenseExamples(child.vis, [], true),
        ...collectSenseExamples(child.sdsense),
      ], stripMwDefinition)
      const senseLines = [
        definition ? (prefix.marker ? `${prefix.indentation}${prefix.marker} ${definition}` : definition) : "",
        ...examples.map((example) => `${"    ".repeat(prefix.level + 1)}- ${example}`),
      ].filter(Boolean)
      if (senseLines.length) output.push(senseLines.join("\n"))
      Object.entries(child).forEach(([childKey, nested]) => {
        if (!["dt", "vis", "sdsense"].includes(childKey)) collectDefinitionBlocks(nested, output)
      })
      return
    }
    if (["def", "dros", "bs", "uns", "uros", "sseq", "pseq", "sdsense"].includes(key)) {
      collectDefinitionBlocks(child, output)
    }
  })
  return output
}

function collectFieldValues(value, field, output = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectFieldValues(item, field, output))
    return output
  }
  if (!value || typeof value !== "object") return output
  if (typeof value[field] === "string") output.push(value[field])
  Object.values(value).forEach((child) => collectFieldValues(child, field, output))
  return output
}

function normalizePronunciations(value = []) {
  return (Array.isArray(value) ? value : []).map((pronunciation) => ({
    mw: stripMw(pronunciation?.mw),
    ipa: stripMw(pronunciation?.ipa),
    label: stripMw(pronunciation?.l || pronunciation?.l2),
    punctuation: stripMw(pronunciation?.pun),
    audio: stripMw(pronunciation?.sound?.audio),
  })).filter((pronunciation) => Object.values(pronunciation).some(Boolean))
}

function normalizeInflections(value = []) {
  return (Array.isArray(value) ? value : []).map((inflection) => ({
    form: stripMwWord(inflection?.if),
    cutback: stripMwWord(inflection?.ifc),
    label: stripMw(inflection?.il),
    grammar: stripMw(inflection?.sgram),
    pronunciations: normalizePronunciations(inflection?.prs),
  })).filter((inflection) => Object.values(inflection).some((item) => Array.isArray(item) ? item.length : Boolean(item)))
}

function normalizeVariants(value = []) {
  return (Array.isArray(value) ? value : []).map((variant) => ({
    label: stripMw(variant?.vl),
    forms: uniqueText((Array.isArray(variant?.va) ? variant.va : [variant?.va]).map(stripMwWord)),
    pronunciations: normalizePronunciations(variant?.prs),
  })).filter((variant) => variant.label || variant.forms.length || variant.pronunciations.length)
}

function normalizeCrossReferences(value = []) {
  return (Array.isArray(value) ? value : []).flatMap((reference) => (Array.isArray(reference?.cxtis) ? reference.cxtis : []).map((target) => ({
    label: stripMw(target?.cxl || reference?.cxl),
    target: stripMw(target?.cxt),
    sense: stripMw(target?.cxn),
  }))).filter((reference) => Object.values(reference).some(Boolean))
}

function normalizeMwEntry(entry, index) {
  const headword = stripMwWord(entry?.hwi?.hw)
  const syllabication = stripMw(entry?.hwi?.hw)
  const detailedDefinitions = [...new Set(collectDefinitionBlocks(entry?.def).map((value) => value.trim()).filter(Boolean))]
  const shortDefinitions = uniqueText(entry?.shortdef, stripMwDefinition)
  const inflections = normalizeInflections(entry?.ins)
  return {
    index,
    headword,
    syllabication,
    alternateHeadwords: uniqueText((Array.isArray(entry?.ahws) ? entry.ahws : []).flatMap((item) => [item?.hw, item?.hwi?.hw, item?.ahw])),
    partOfSpeech: stripMw(entry?.fl),
    labels: uniqueText([...(Array.isArray(entry?.lbs) ? entry.lbs : []), ...(Array.isArray(entry?.sls) ? entry.sls : [])]),
    verbDividers: uniqueText(collectFieldValues(entry?.def, "vd")),
    pronunciations: normalizePronunciations(entry?.hwi?.prs),
    variants: normalizeVariants(entry?.vrs),
    inflections,
    crossReferences: normalizeCrossReferences(entry?.cxs),
    stems: uniqueText(entry?.meta?.stems),
    shortDefinitions,
    definitions: detailedDefinitions.length ? detailedDefinitions : shortDefinitions,
    etymology: uniqueText(collectEtymologyText(entry?.et)),
    firstKnownUse: stripMw(entry?.date).replace(/(century|year|\d)t$/iu, "$1"),
    synonyms: uniqueText(entry?.meta?.syns || entry?.syns),
    antonyms: uniqueText(entry?.meta?.ants || entry?.ants),
    table: entry?.table ? { id: stripMw(entry.table.tableid), name: stripMw(entry.table.displayname) } : null,
  }
}

function normalizeMwPartOfSpeech(value) {
  const candidate = lower(stripMw(value)).replace(/\s+/gu, " ")
  if (MW_POS_ALIASES.has(candidate)) return MW_POS_ALIASES.get(candidate)
  if (/\bverb\b/u.test(candidate)) return "verb"
  if (/\bnoun\b/u.test(candidate)) return "noun"
  if (/\badjective\b/u.test(candidate)) return "adjective"
  if (/\badverb\b/u.test(candidate)) return "adverb"
  return candidate
}

function mergeMwRecords(records = []) {
  const primary = records[0]
  if (!primary) return null
  const uniqueFormatted = (values) => uniqueText(values, (value) => text(value))
  return {
    ...primary,
    labels: uniqueFormatted(records.flatMap((record) => record.labels)),
    verbDividers: uniqueFormatted(records.flatMap((record) => record.verbDividers)),
    stems: uniqueFormatted(records.flatMap((record) => record.stems)),
    definitions: uniqueFormatted(records.flatMap((record) => record.definitions)),
    etymology: uniqueFormatted(records.flatMap((record) => record.etymology)),
    synonyms: uniqueFormatted(records.flatMap((record) => record.synonyms)),
    antonyms: uniqueFormatted(records.flatMap((record) => record.antonyms)),
    firstKnownUse: uniqueFormatted(records.map((record) => record.firstKnownUse)).join("; "),
    inflections: records.flatMap((record) => record.inflections),
  }
}

function mwDefinition(record) {
  const sections = [...record.definitions]
  if (record.firstKnownUse) sections.push(`**First known use**\n${record.firstKnownUse}`)
  if (record.stems.length) sections.push(`**Stems:**\n${record.stems.map((stem) => `- ${stem}`).join("\n")}`)
  if (record.synonyms.length) sections.push(`**Synonyms:**\n${record.synonyms.map((synonym) => `- ${synonym}`).join("\n")}`)
  if (record.antonyms.length) sections.push(`**Antonyms:**\n${record.antonyms.map((antonym) => `- ${antonym}`).join("\n")}`)
  return sections.join("\n\n")
}

function explicitEslFields(record) {
  const signals = [...record.labels, ...record.verbDividers, ...record.inflections.map((item) => item.grammar)]
    .map((value) => lower(value))
    .filter(Boolean)
  const joined = signals.join(" | ")
  const fields = {}
  if (lower(record.partOfSpeech) === "noun") {
    const countable = /\b(?:count noun|countable)\b/u.test(joined)
    const uncountable = /\b(?:noncount noun|uncountable)\b/u.test(joined)
    if (countable && uncountable) fields.countability = "both S & P"
    else if (countable) fields.countability = "countable"
    else if (uncountable) fields.countability = "uncountable"
    if (/\b(?:singular and plural|singular or plural)\b/u.test(joined)) fields.nounNumber = "singular and plural"
    else if (/\bplural noun\b/u.test(joined)) fields.nounNumber = "plural"
    else if (/\bsingular noun\b/u.test(joined)) fields.nounNumber = "singular"
  }
  if (lower(record.partOfSpeech) === "verb") {
    const regularity = getVerbRegularity(record.headword)
    if (regularity.found) fields.verbRegularity = regularity.regularity
    const transitive = record.verbDividers.some((value) => /\btransitive verb\b/iu.test(value) && !/\bintransitive verb\b/iu.test(value))
    const intransitive = record.verbDividers.some((value) => /\bintransitive verb\b/iu.test(value))
    if (transitive && intransitive) fields.verbTransitivity = "ambitransitive"
    else if (transitive) fields.verbTransitivity = "transitive"
    else if (intransitive) fields.verbTransitivity = "intransitive"
  }
  return fields
}

function mwFields(record) {
  const forms = record.inflections.map((inflection) => inflection.form).filter(Boolean)
  const fields = {
    english: record.headword,
    partOfSpeech: normalizeMwPartOfSpeech(record.partOfSpeech),
    definition: mwDefinition(record),
    etymology: record.etymology.join("\n"),
    originReferences: record.etymology.length ? [buildOriginReference({
      source: "Merriam-Webster Collegiate",
      url: `https://www.merriam-webster.com/dictionary/${encodeURIComponent(record.headword)}`,
      claims: ["etymology"],
      provider: "Merriam-Webster",
    })] : null,
    ...explicitEslFields(record),
  }
  if (lower(record.partOfSpeech) !== "verb") return fields
  const labelledPast = record.inflections.find((inflection) => /past(?! participle)|preterite/iu.test(inflection.label))?.form || ""
  const labelledParticiple = record.inflections.find((inflection) => /past participle/iu.test(inflection.label))?.form || ""
  const nonGerunds = forms.filter((form) => !/ing$/iu.test(form))
  const past = labelledPast || nonGerunds[0] || ""
  const participle = labelledParticiple || nonGerunds.find((form) => /(?:ed|en)$/iu.test(form)) || nonGerunds[1] || past
  const presentParticiple = forms.find((form) => /ing$/iu.test(form)) || ""
  const plainHeadword = record.headword.replace(/[^\p{L}\p{N}]+/gu, "")
  const labelledThirdPerson = record.inflections.find((inflection) => /third person|present tense/iu.test(inflection.label))?.form || ""
  const thirdPerson = labelledThirdPerson || record.stems.find((form) => [plainHeadword + "s", plainHeadword + "es"].includes(lower(form))) || record.stems.find((form) => /(?:s|es)$/iu.test(form) && !/(?:ss|us)$/iu.test(form)) || ""
  const referenceForms = getVerbForms(record.headword)
  if (referenceForms.found) {
    return {
      ...fields,
      verbInfinitive: referenceForms.infinitive,
      verbV1: referenceForms.forms.V1,
      verbV2: referenceForms.forms.V2,
      verbV3: referenceForms.forms.V3,
      verbV4: referenceForms.forms.V4,
      verbV5: referenceForms.forms.V5,
    }
  }
  return { ...fields, verbInfinitive: `to ${record.headword}`, verbV1: record.headword, verbV2: past, verbV3: participle, verbV4: presentParticiple, verbV5: thirdPerson }
}

function normalizedMwLookupWord(value) {
  return lower(value).replace(/^to\s+/u, "").replace(/[^\p{L}\p{N}\s'-]+/gu, " ").replace(/[’‘]/gu, "'").replace(/\s+/gu, " ").trim()
}

function verbLookupCandidates(entry = {}) {
  const candidates = []
  const seen = new Set()
  const add = (value) => {
    const cleaned = normalizedMwLookupWord(value)
    const key = cleaned.replace(/[^\p{L}\p{N}]+/gu, "")
    if (!cleaned || !key || seen.has(key)) return
    seen.add(key)
    candidates.push(cleaned)
  }
  const addInflectedCandidates = (value) => {
    const source = normalizedMwLookupWord(value)
    if (!source || /\s/gu.test(source)) return
    if (source.endsWith("ies") && source.length > 3) add(`${source.slice(0, -3)}y`)
    if (source.endsWith("ied") && source.length > 3) add(`${source.slice(0, -3)}y`)
    if (source.endsWith("ing") && source.length > 4) {
      const stem = source.slice(0, -3)
      add(stem)
      if (stem.length > 1 && stem.at(-1) === stem.at(-2) && /[^aeiou]/u.test(stem.at(-1) || "")) add(stem.slice(0, -1))
      add(`${stem}e`)
    }
    if (source.endsWith("ed") && source.length > 3) {
      const stem = source.slice(0, -2)
      add(stem)
      if (stem.length > 1 && stem.at(-1) === stem.at(-2) && /[^aeiou]/u.test(stem.at(-1) || "")) add(stem.slice(0, -1))
      add(`${stem}e`)
    }
    if (source.endsWith("ies") || source.endsWith("ied")) return
    if (source.endsWith("es") && source.length > 3) add(source.slice(0, -2))
    if (source.endsWith("s") && source.length > 2) add(source.slice(0, -1))
  }
  for (const value of [entry.english, entry.verbV1, entry.verbInfinitive, entry.verbV2, entry.verbV3, entry.verbV4, entry.verbV5]) {
    add(value)
    addInflectedCandidates(value)
  }
  return candidates
}

export async function previewMerriamWebsterLibraryEntry(entry, fetchImpl = fetch) {
  const word = clamp(entry?.english); const key = text(process.env.MERRIAM_WEBSTER_COLLEGIATE_API_KEY)
  if (!word || !key) return { ok: false, available: false, message: "Merriam-Webster Collegiate is unavailable; no Library data was changed." }
  const requestedPartOfSpeech = normalizeMwPartOfSpeech(entry?.partOfSpeech)
  const lookupWords = requestedPartOfSpeech === "verb" ? verbLookupCandidates(entry) : [normalizedMwLookupWord(word)]
  const allRecords = []
  let selectedRecords = []
  let selectedQuery = word
  let providerUnavailable = false
  for (const lookupWord of lookupWords) {
    const response = await fetchImpl(`${MW_BASE}/${encodeURIComponent(lookupWord)}?key=${encodeURIComponent(key)}`)
    if (!response.ok) {
      providerUnavailable = true
      continue
    }
    const payload = await response.json()
    const candidates = Array.isArray(payload) ? payload.filter((item) => item && typeof item === "object" && item.hwi) : []
    const normalizedWord = normalizedMwLookupWord(lookupWord).replace(/[^\p{L}\p{N}]+/gu, "")
    const matching = candidates.filter((item) => normalizedMwLookupWord(stripMw(item?.hwi?.hw)).replace(/[^\p{L}\p{N}]+/gu, "") === normalizedWord)
    const records = (matching.length ? matching : candidates).map(normalizeMwEntry)
    allRecords.push(...records)
    const matchingPartOfSpeech = requestedPartOfSpeech ? records.filter((record) => normalizeMwPartOfSpeech(record.partOfSpeech) === requestedPartOfSpeech) : records
    if (matchingPartOfSpeech.length) {
      selectedRecords = matchingPartOfSpeech
      selectedQuery = lookupWord
      break
    }
  }
  const uniqueRecords = [...new Map(allRecords.map((record) => [`${record.headword}\u0000${record.partOfSpeech}\u0000${record.index}`, record])).values()]
  if (!selectedRecords.length && providerUnavailable && !uniqueRecords.length) return { ok: false, available: false, message: "Merriam-Webster is unavailable; no Library data was changed." }
  if (!uniqueRecords.length) return { ok: false, available: false, message: "No Merriam-Webster entry was found; no Library data was changed." }
  const details = { source: "Merriam-Webster Collegiate", query: word, lookupQuery: selectedQuery, requestedPartOfSpeech: requestedPartOfSpeech || null, selectedEntryCount: selectedRecords.length, entryCount: uniqueRecords.length, entries: uniqueRecords }
  if (!selectedRecords.length) return { ok: false, available: true, message: `No Merriam-Webster ${requestedPartOfSpeech} entry was found; no Library data was changed.`, details }
  const primary = mergeMwRecords(selectedRecords)
  return { ok: true, available: true, fields: mwFields(primary), details }
}

export async function previewMerriamWebsterDictionaryEntryWithApiFallback(entry, fetchImpl = fetch, browserFetchImpl = fetchMerriamWebsterBrowserPage) {
  const dictionaryPreview = await previewMerriamWebsterDictionaryEntry(entry, fetchImpl, browserFetchImpl)
  if (dictionaryPreview.ok) return dictionaryPreview
  const apiPreview = await previewMerriamWebsterLibraryEntry(entry, fetchImpl)
  if (!apiPreview.ok) return { ...dictionaryPreview, message: `${dictionaryPreview.message || "Merriam-Webster Dictionary preview failed."} API backup also failed: ${apiPreview.message || "Merriam-Webster Collegiate is unavailable."}` }
  const lookupWord = clamp(apiPreview.details?.query || entry?.english)
  return {
    ...apiPreview,
    provider: "merriam-webster",
    sourceUrl: `${MERRIAM_WEBSTER_BASE_URL}${encodeURIComponent(lookupWord)}`,
    lookupWord,
    entries: apiPreview.details?.entries || [],
    fallback: "merriam-webster-collegiate-api",
  }
}

export async function applyMerriamWebsterLibraryEntry(id, actor = {}, payload = {}) {
  const preview = await previewMerriamWebsterLibraryEntry(payload.entry); if (!preview.ok) throw statusError(preview.message, 503)
  const client = await prisma(); const existing = await client.libraryEntry.findUnique({ where: { id } }); if (!existing) throw statusError("Library entry was not found", 404)
  const mode = lower(payload.mode); const chosen = Array.isArray(payload.fields) ? payload.fields : Object.keys(preview.fields)
  const proposed = {}
  for (const field of chosen) {
    if (!Object.hasOwn(preview.fields, field) || !preview.fields[field]) continue
    if (field === "originPath" && text(existing.originPath)) continue
    if (field === "originReferences") {
      const existingReferences = normalizeOriginReferences(existing.originReferences) || []
      const incomingReferences = normalizeOriginReferences(preview.fields.originReferences) || []
      proposed.originReferences = normalizeOriginReferences([...existingReferences, ...incomingReferences])
      continue
    }
    if (mode === "fill_missing" && text(existing[field])) continue
    proposed[field] = preview.fields[field]
  }
  const data = Object.fromEntries(Object.entries(proposed).filter(([field, value]) => JSON.stringify(activePayloadValue(existing[field], field)) !== JSON.stringify(activePayloadValue(value, field))))
  const capitalizationError = vocabularyEnglishCapitalizationError({ ...existing, ...data })
  if (capitalizationError) throw statusError(capitalizationError)
  if (!Object.keys(data).length) return { ok: true, entry: mapEntry(existing), appliedFields: [] }
  const updated = await client.$transaction(async (tx) => { const value = await tx.libraryEntry.update({ where: { id }, data: { ...data, lastEditedByName: clamp(actor.name) } }); await writeRevision(tx, value, "mw_import", actor.name, actor.role || "admin"); return value })
  return { ok: true, entry: mapEntry(updated), appliedFields: Object.keys(data) }
}

function dictionaryStatusError(message, statusCode = 400) {
  return statusError(message, statusCode)
}

function dictionaryApplyMode(value, provider) {
  const mode = lower(value)
  if (!["fill_missing", "selected", "replace_selected", "replace_all"].includes(mode)) throw dictionaryStatusError(`${provider.toUpperCase()} Apply requires fill_missing, selected, replace_selected, or replace_all mode`)
  return mode
}

function dictionarySelectedFields(payload, mode, previewFields, supportedFields, provider) {
  if (mode === "selected") {
    if (!Array.isArray(payload.fields)) throw dictionaryStatusError(`Selected ${provider.toUpperCase()} Apply requires a fields array`)
    return [...new Set(payload.fields.map((field) => text(field)).filter((field) => supportedFields.has(field)))]
  }
  if (mode === "replace_all") return [...supportedFields]
  if (mode === "replace_selected") {
    if (!Array.isArray(payload.fields)) throw dictionaryStatusError(`Destructive Replace Selected ${provider.toUpperCase()} Apply requires a fields array`)
    return [...new Set(payload.fields.map((field) => text(field)).filter((field) => supportedFields.has(field)))]
  }
  return [...supportedFields].filter((field) => Object.hasOwn(previewFields, field))
}

function dictionaryMediaSelection(payload, entries, mediaDialects) {
  const requested = payload?.audio && typeof payload.audio === "object" ? payload.audio : {}
  return Object.fromEntries(mediaDialects.map((dialect) => [dialect, requested[dialect] === undefined ? true : requested[dialect] === true && entries.some((entry) => Boolean(entry.audio?.[dialect]))]))
}

function dictionaryProposedFields(existing, preview, mode, selectedFields, provider) {
  const proposed = {}
  for (const field of selectedFields) {
    const incoming = preview.fields?.[field]
    if (mode === "replace_all" || mode === "replace_selected") {
      proposed[field] = incoming === null || incoming === undefined || incoming === "" ? null : incoming
      continue
    }
    if (incoming === null || incoming === undefined || incoming === "") continue
    if (mode === "fill_missing" && existing[field] && !(field === "grammarClassification" && !Object.keys(existing[field] || {}).length)) continue
    proposed[field] = incoming
  }
  proposed.dictionaryProvider = provider
  proposed.dictionarySourceUrl = preview.sourceUrl
  proposed.dictionaryMetadata = preview.fields?.dictionaryMetadata || null
  return proposed
}

async function applyDictionaryLibraryEntry({ id, actor = {}, payload = {}, fetchImpl = fetch, clientOverride = null, provider, previewLibraryEntry, supportedFields, mediaDialects, revisionAction }) {
  const client = clientOverride || await prisma()
  const existing = await client.libraryEntry.findUnique({ where: { id } })
  if (!existing) throw dictionaryStatusError("Library entry was not found", 404)
  const preview = await previewLibraryEntry(payload.entry || existing, fetchImpl)
  if (!preview.ok) throw dictionaryStatusError(preview.message, 503)
  const mode = dictionaryApplyMode(payload.mode || "fill_missing", provider)
  const selectedFields = dictionarySelectedFields(payload, mode, preview.fields, supportedFields, provider)
  const proposed = dictionaryProposedFields(existing, preview, mode, selectedFields, provider)
  const normalized = normalizeEntry({ ...existing, ...proposed }, { allowIncomplete: true })
  const data = Object.fromEntries([...supportedFields, "dictionaryProvider", "dictionarySourceUrl", "dictionaryMetadata"].filter((field) => Object.hasOwn(normalized, field) && JSON.stringify(activePayloadValue(existing[field], field)) !== JSON.stringify(activePayloadValue(normalized[field], field))).map((field) => [field, normalized[field]]))
  const mediaSelection = dictionaryMediaSelection(payload, preview.entries, mediaDialects)
  const downloads = []
  const finalized = []
  try {
    for (const dialect of mediaDialects) {
      if (!mediaSelection[dialect]) continue
      const sourceUrl = preview.entries.map((entry) => entry.audio?.[dialect]).find(Boolean)
      if (!sourceUrl) continue
      const download = await downloadLibraryAudio({ sourceUrl, entryId: id, dialect, provider, fetchImpl })
      downloads.push(download)
      finalized.push(await finalizeLibraryAudio(download))
    }
    const updated = await client.$transaction(async (tx) => {
      const value = Object.keys(data).length
        ? await tx.libraryEntry.update({ where: { id }, data: { ...data, lastEditedByName: text(actor.name) } })
        : existing
      for (const download of finalized) await upsertLibraryMediaAsset(tx, download, actor)
      if (Object.keys(data).length || finalized.length) await writeRevision(tx, value, revisionAction, actor.name, actor.role || "admin")
      return value
    })
    const mediaAssets = await client.libraryMediaAsset.findMany({ where: { entryId: id, provider }, orderBy: { dialect: "asc" } })
    return { ok: true, entry: mapEntry(updated), appliedFields: Object.keys(data), mediaAssets: mediaAssets.map((asset) => ({ id: asset.id, dialect: asset.dialect, mimeType: asset.mimeType, byteLength: asset.byteLength, sha256: asset.sha256 })), preview: { provider: preview.provider, sourceUrl: preview.sourceUrl, lookupWord: preview.lookupWord } }
  } catch (error) {
    await Promise.all(downloads.map((download) => discardLibraryAudio(download)))
    await Promise.all(finalized.filter((download) => download.createdFile).map((download) => removeLibraryAudio(download)))
    throw error
  }
}

export async function applyLdoceLibraryEntry(id, actor = {}, payload = {}, fetchImpl = fetch, clientOverride = null) {
  return applyDictionaryLibraryEntry({ id, actor, payload, fetchImpl, clientOverride, provider: "ldoce", previewLibraryEntry: previewLdoceLibraryEntry, supportedFields: LDOCE_APPLY_FIELDS, mediaDialects: LDOCE_MEDIA_DIALECTS, revisionAction: "ldoce_import" })
}

export async function applyOxfordLibraryEntry(id, actor = {}, payload = {}, fetchImpl = fetch, clientOverride = null) {
  return applyDictionaryLibraryEntry({ id, actor, payload, fetchImpl, clientOverride, provider: "oxford", previewLibraryEntry: previewOxfordLibraryEntry, supportedFields: OXFORD_APPLY_FIELDS, mediaDialects: OXFORD_MEDIA_DIALECTS, revisionAction: "oxford_import" })
}

export async function applyBritannicaLibraryEntry(id, actor = {}, payload = {}, fetchImpl = fetch, clientOverride = null) {
  return applyDictionaryLibraryEntry({ id, actor, payload, fetchImpl, clientOverride, provider: "britannica", previewLibraryEntry: previewBritannicaLibraryEntry, supportedFields: BRITANNICA_APPLY_FIELDS, mediaDialects: BRITANNICA_MEDIA_DIALECTS, revisionAction: "britannica_import" })
}

export async function applyMerriamWebsterDictionaryLibraryEntry(id, actor = {}, payload = {}, fetchImpl = fetch, clientOverride = null) {
  return applyDictionaryLibraryEntry({ id, actor, payload, fetchImpl, clientOverride, provider: "merriam-webster", previewLibraryEntry: previewMerriamWebsterDictionaryEntryWithApiFallback, supportedFields: MERRIAM_WEBSTER_DICTIONARY_APPLY_FIELDS, mediaDialects: MERRIAM_WEBSTER_DICTIONARY_MEDIA_DIALECTS, revisionAction: "merriam_webster_import" })
}
