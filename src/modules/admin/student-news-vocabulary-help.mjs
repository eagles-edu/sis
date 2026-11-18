import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import {
  normalizeVocabularySyllabication,
  vocabularyEntryError,
} from "./vocabulary-syllabication.mjs"

const MAX_WORD_LENGTH = 120
const MAX_SYLLABICATION_LENGTH = 180
const MAX_CHECK_MESSAGE_LENGTH = 1000
const MAX_DETAILS_LENGTH = 1000

function normalizeText(value, maxLength) {
  return String(value == null ? "" : value).trim().slice(0, maxLength)
}

function requestError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function publicRequest(row = {}) {
  return {
    id: String(row.id || ""),
    word: String(row.word || ""),
    syllabication: String(row.syllabication || ""),
    checkMessage: String(row.checkMessage || ""),
    additionalDetails: String(row.additionalDetails || ""),
    status: String(row.status || "open"),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt || ""),
    reviewedAt: row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : String(row.reviewedAt || ""),
    reviewedByUsername: String(row.reviewedByUsername || ""),
    student: row.student ? {
      eaglesId: String(row.student.eaglesId || ""),
      name: String(row.student.profile?.fullName || row.student.profile?.englishName || ""),
    } : null,
  }
}

export async function submitStudentNewsVocabularyHelpRequest(studentRefId, payload = {}) {
  const ownerId = normalizeText(studentRefId, 100)
  const submissionKey = normalizeText(payload.submissionKey, 80)
  const word = normalizeText(payload.word, MAX_WORD_LENGTH)
  const syllabication = normalizeText(payload.syllabication, MAX_SYLLABICATION_LENGTH)
  const checkMessage = normalizeText(payload.checkMessage, MAX_CHECK_MESSAGE_LENGTH)
  const additionalDetails = normalizeText(payload.additionalDetails, MAX_DETAILS_LENGTH)

  if (!ownerId) throw requestError("Student account is not linked to a student record.", 403)
  if (!submissionKey) throw requestError("Help request key is required.", 400)
  if (!word || !syllabication || !checkMessage) {
    throw requestError("Word, syllabication, and the Check result are required.", 400)
  }

  const prisma = await getSharedPrismaClient()
  try {
    const created = await prisma.studentNewsVocabularyHelpRequest.create({
      data: {
        submissionKey,
        studentRefId: ownerId,
        word,
        syllabication,
        checkMessage,
        additionalDetails: additionalDetails || null,
      },
      select: { id: true, status: true, createdAt: true },
    })
    return { ok: true, created: true, request: publicRequest(created) }
  } catch (error) {
    if (String(error?.code || "") !== "P2002") throw error
    const existing = await prisma.studentNewsVocabularyHelpRequest.findUnique({
      where: { submissionKey },
      select: {
        id: true,
        studentRefId: true,
        word: true,
        syllabication: true,
        checkMessage: true,
        additionalDetails: true,
        status: true,
        createdAt: true,
      },
    })
    if (
      !existing
      || existing.studentRefId !== ownerId
      || existing.word !== word
      || existing.syllabication !== syllabication
      || existing.checkMessage !== checkMessage
      || String(existing.additionalDetails || "") !== additionalDetails
    ) {
      throw requestError("This help request key was already used for another request.", 409)
    }
    return { ok: true, created: false, request: publicRequest(existing) }
  }
}

export async function listOpenStudentNewsVocabularyHelpRequests({ take = 200 } = {}) {
  const limit = Math.max(1, Math.min(500, Number.parseInt(String(take), 10) || 200))
  const prisma = await getSharedPrismaClient()
  const rows = await prisma.studentNewsVocabularyHelpRequest.findMany({
    where: { status: "open" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      word: true,
      syllabication: true,
      checkMessage: true,
      additionalDetails: true,
      status: true,
      createdAt: true,
      student: {
        select: {
          eaglesId: true,
          profile: { select: { fullName: true, englishName: true } },
        },
      },
    },
  })
  return rows.map(publicRequest)
}

export async function resolveStudentNewsVocabularyHelpRequest(requestId, reviewedByUsername) {
  const id = normalizeText(requestId, 120)
  const reviewer = normalizeText(reviewedByUsername, 120)
  if (!id || !reviewer) throw requestError("Help request and reviewer are required.", 400)
  const prisma = await getSharedPrismaClient()
  const now = new Date()
  const update = await prisma.studentNewsVocabularyHelpRequest.updateMany({
    where: { id, status: "open" },
    data: { status: "resolved", reviewedAt: now, reviewedByUsername: reviewer },
  })
  if (update.count > 0) return { ok: true, resolved: true, alreadyResolved: false }

  const existing = await prisma.studentNewsVocabularyHelpRequest.findUnique({
    where: { id },
    select: { status: true },
  })
  if (!existing) throw requestError("Vocabulary help request was not found.", 404)
  if (existing.status === "resolved") {
    return { ok: true, resolved: true, alreadyResolved: true }
  }
  throw requestError("Vocabulary help request is not open.", 409)
}

export async function approveStudentNewsVocabularyOverride(requestId, reviewedByUsername, syllabication) {
  const id = normalizeText(requestId, 120)
  const reviewer = normalizeText(reviewedByUsername, 120)
  const prisma = await getSharedPrismaClient()
  const request = await prisma.studentNewsVocabularyHelpRequest.findUnique({
    where: { id },
    select: { id: true, word: true, status: true },
  })
  if (!request) throw requestError("Vocabulary help request was not found.", 404)
  if (request.status !== "open") throw requestError("Vocabulary help request is not open.", 409)
  if (!reviewer) throw requestError("Reviewer is required.", 400)
  const word = normalizeText(request.word, MAX_WORD_LENGTH)
  const approvedSyllabication = normalizeVocabularySyllabication(syllabication)
  const englishWords = word.toLocaleLowerCase("en-US").split(/\s+/u).filter(Boolean)
  const syllabicationWords = approvedSyllabication.split(/\s+/u).filter(Boolean)
  if (englishWords.length !== syllabicationWords.length) throw requestError("Override syllabication must match each word in the report.", 400)
  const overrides = []
  for (let index = 0; index < englishWords.length; index += 1) {
    const englishWord = englishWords[index]
    const wordSyllabication = syllabicationWords[index]
    const validationError = vocabularyEntryError({ english: englishWord, syllabication: wordSyllabication })
    if (validationError) throw requestError(`Override syllabication is invalid: ${validationError}`, 400)
    const englishKey = englishWord.normalize("NFD").replace(/\p{M}+/gu, "").toLocaleLowerCase("en-US")
    const override = await prisma.studentNewsVocabularyOverride.upsert({
      where: { englishKey },
      create: {
        englishKey,
        english: englishWord,
        syllabication: wordSyllabication,
        approvedByUsername: reviewer,
        sourceRequestId: id,
      },
      update: {
        english: englishWord,
        syllabication: wordSyllabication,
        approvedByUsername: reviewer,
        sourceRequestId: id,
      },
      select: { english: true, syllabication: true, approvedByUsername: true, updatedAt: true },
    })
    overrides.push(publicOverride(override))
  }
  await prisma.studentNewsVocabularyHelpRequest.update({
    where: { id },
    data: { status: "resolved", reviewedAt: new Date(), reviewedByUsername: reviewer },
  })
  return { ok: true, overrides }
}

function publicOverride(row = {}) {
  return {
    english: String(row.english || ""),
    syllabication: String(row.syllabication || ""),
    approvedByUsername: String(row.approvedByUsername || ""),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt || ""),
  }
}

export async function getStudentNewsVocabularyOverride(english) {
  const word = normalizeText(english, MAX_WORD_LENGTH)
  if (!word) return null
  const englishKey = word.normalize("NFD").replace(/\p{M}+/gu, "").toLocaleLowerCase("en-US")
  const prisma = await getSharedPrismaClient()
  const override = await prisma.studentNewsVocabularyOverride.findUnique({
    where: { englishKey },
    select: { english: true, syllabication: true, approvedByUsername: true, updatedAt: true },
  })
  return override ? publicOverride(override) : null
}
