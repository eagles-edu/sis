import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { normalizeVocabularySyllabication, validateVocabularyEntry } from "./vocabulary-syllabication.mjs"

const MAX_WORDS = 500
const FIXED_TIME_ZONE_OFFSET_MS = 7 * 60 * 60 * 1000

function text(value) {
  return String(value == null ? "" : value).trim()
}

function wordKey(value) {
  return text(value).normalize("NFC").toLocaleLowerCase("en-US")
}

function syllableCount(value) {
  const parts = text(value).split("-").filter(Boolean)
  return parts.length || (text(value) ? 1 : 0)
}

function localDateKey(value) {
  const date = value ? new Date(value) : null
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return ""
  return new Date(date.getTime() + FIXED_TIME_ZONE_OFFSET_MS).toISOString().slice(0, 10)
}

function isCheckedNewsReport(report = {}) {
  const state = text(report.submissionState).toLowerCase()
  return Boolean(
    text(report.mmrPassedAt)
    || text(report.dateSatisfiedAt)
    || state === "ready"
    || (state === "submitted" && text(report.firstSubmittedAt)),
  )
}

function normalizeWord(row = {}) {
  const english = text(row.english).normalize("NFC")
  return {
    partOfSpeech: text(row.partOfSpeech).toLowerCase().slice(0, 40),
    english: english.slice(0, 240),
    englishKey: wordKey(english).slice(0, 240),
    vietnamese: text(row.vietnamese).slice(0, 240),
    syllabication: normalizeVocabularySyllabication(row.syllabication).slice(0, 240),
    definition: text(row.definition),
    eslJson: row.esl && typeof row.esl === "object" ? row.esl : (row.eslJson && typeof row.eslJson === "object" ? row.eslJson : null),
    syllableCount: syllableCount(row.syllabication),
  }
}

function mapWord(row = {}) {
  return {
    id: text(row.id),
    sourceReportId: text(row.sourceReportId),
    partOfSpeech: text(row.partOfSpeech),
    english: text(row.english),
    vietnamese: text(row.vietnamese),
    syllabication: normalizeVocabularySyllabication(row.syllabication),
    definition: text(row.definition),
    esl: row.eslJson && typeof row.eslJson === "object" ? row.eslJson : {},
    syllableCount: Number(row.syllableCount) || syllableCount(row.syllabication),
    sourceReportDate: localDateKey(row.sourceReportDate),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : "",
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : "",
  }
}

async function getPrisma() {
  return getSharedPrismaClient()
}

async function seedFromNewsReports(prisma, studentRefId) {
  const reports = await prisma.studentNewsReport.findMany({
    where: { studentRefId },
    select: {
      id: true,
      reportDate: true,
      vocabularyJson: true,
      submissionState: true,
      mmrPassedAt: true,
      dateSatisfiedAt: true,
      firstSubmittedAt: true,
    },
    orderBy: { reportDate: "asc" },
  })
  const ineligibleReportIds = reports
    .filter((report) => !isCheckedNewsReport(report))
    .map((report) => text(report.id))
    .filter(Boolean)
  if (ineligibleReportIds.length) {
    await prisma.studentNewWord.deleteMany({
      where: { studentRefId, archivedAt: null, sourceReportId: { in: ineligibleReportIds } },
    })
  }
  const eligibleReports = reports.filter(isCheckedNewsReport)
  const existing = await prisma.studentNewWord.findMany({ where: { studentRefId, archivedAt: null } })
  const keys = new Set(existing.map((row) => row.englishKey))
  const seededReports = new Set(existing.map((row) => text(row.sourceReportId)).filter(Boolean))
  for (const report of eligibleReports) {
    if (seededReports.has(text(report.id))) continue
    const rows = Array.isArray(report.vocabularyJson) ? report.vocabularyJson : []
    for (const raw of rows) {
      const word = normalizeWord(raw)
      if (!word.englishKey || keys.has(word.englishKey)) continue
      await prisma.studentNewWord.create({
        data: {
          ...word,
          studentRefId,
          sourceReportId: text(report.id),
          sourceReportDate: report.reportDate,
        },
      })
      keys.add(word.englishKey)
    }
  }
}

export { isCheckedNewsReport }

export async function listStudentNewWords(studentRefId) {
  const prisma = await getPrisma()
  await seedFromNewsReports(prisma, studentRefId)
  const rows = await prisma.studentNewWord.findMany({
    where: { studentRefId, archivedAt: null },
    orderBy: [{ sourceReportDate: "asc" }, { english: "asc" }],
  })
  return { ok: true, items: rows.map(mapWord) }
}

export async function saveStudentNewWords(studentRefId, value) {
  const prisma = await getPrisma()
  const source = Array.isArray(value) ? value : []
  const existing = await prisma.studentNewWord.findMany({
    where: { studentRefId, archivedAt: null },
    select: { id: true, englishKey: true, partOfSpeech: true, english: true, vietnamese: true, syllabication: true, definition: true, eslJson: true },
  })
  const validationResults = await Promise.all(source.map(async (row, index) => {
    const result = await validateVocabularyEntry(row)
    return { index, ...result }
  }))
  const invalid = validationResults.find((entry) => entry?.message)
  if (invalid) {
    const error = new Error(`Word ${invalid.index + 1}: ${invalid.message}`)
    error.statusCode = 400
    throw error
  }
  const existingByEnglishKey = new Map(existing.map((row) => [text(row.englishKey), row]))
  const duplicate = source.slice(0, MAX_WORDS).map((row, index) => {
    const englishKey = wordKey(row?.english).slice(0, 240)
    const existingRow = existingByEnglishKey.get(englishKey)
    if (!englishKey || !existingRow || text(existingRow.id) === text(row?.id)) return null
    return { index, message: "This English word already exists in your New Words list." }
  }).find((entry) => entry)
  if (duplicate) {
    const error = new Error(`Word ${duplicate.index + 1}: ${duplicate.message}`)
    error.statusCode = 400
    throw error
  }
  const deduped = new Map()
  source.slice(0, MAX_WORDS).forEach((row) => {
    const word = normalizeWord(row)
    if (word.englishKey) deduped.set(word.englishKey, word)
  })
  const words = Array.from(deduped.values())
  const incomingIds = new Set(source.slice(0, MAX_WORDS).map((row) => text(row?.id)).filter(Boolean))
  try {
    await prisma.$transaction(async (tx) => {
      await tx.studentNewWord.deleteMany({
        where: { studentRefId, archivedAt: null, id: { notIn: Array.from(incomingIds) } },
      })
      for (const word of words) {
        const sourceRow = source.find((row) => wordKey(row?.english) === word.englishKey)
        const id = text(sourceRow?.id)
        if (id && existing.some((row) => row.id === id)) {
          await tx.studentNewWord.update({ where: { id }, data: word })
        } else {
          await tx.studentNewWord.create({ data: { ...word, studentRefId } })
        }
      }
    })
  } catch (error) {
    if (error?.code === "P2002" || /Unique constraint failed.*englishKey/u.test(String(error?.message || ""))) {
      const duplicateError = new Error("New Words contains a duplicate English word.")
      duplicateError.statusCode = 400
      throw duplicateError
    }
    throw error
  }
  const result = await listStudentNewWords(studentRefId)
  return {
    ...result,
    warnings: validationResults
      .filter((entry) => entry?.warning)
      .map((entry) => ({ index: entry.index, message: entry.warning })),
  }
}
