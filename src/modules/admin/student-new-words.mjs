import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"

const MAX_WORDS = 500
const MAX_TEXT = 5000
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

function normalizeSyllabication(value) {
  const vowels = { a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý" }
  return text(value).split("-").filter(Boolean).map((part) => {
    const stressed = /[A-Z]/u.test(part)
    const chars = Array.from(part.toLocaleLowerCase("en-US"))
    if (stressed && !chars.some((char) => /[áéíóúý]/u.test(char))) {
      const vowelIndex = chars.findIndex((char) => vowels[char])
      if (vowelIndex >= 0) chars[vowelIndex] = vowels[chars[vowelIndex]]
    }
    return chars.join("")
  }).join("-")
}

function localDateKey(value) {
  const date = value ? new Date(value) : null
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return ""
  return new Date(date.getTime() + FIXED_TIME_ZONE_OFFSET_MS).toISOString().slice(0, 10)
}

function normalizeWord(row = {}) {
  const english = text(row.english).normalize("NFC")
  return {
    partOfSpeech: text(row.partOfSpeech).toLowerCase().slice(0, 40),
    english: english.slice(0, 240),
    englishKey: wordKey(english).slice(0, 240),
    vietnamese: text(row.vietnamese).slice(0, 240),
    syllabication: normalizeSyllabication(row.syllabication).slice(0, 240),
    definition: text(row.definition).slice(0, MAX_TEXT),
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
    syllabication: text(row.syllabication),
    definition: text(row.definition),
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
    select: { id: true, reportDate: true, vocabularyJson: true },
    orderBy: { reportDate: "asc" },
  })
  const existing = await prisma.studentNewWord.findMany({ where: { studentRefId } })
  const keys = new Set(existing.map((row) => row.englishKey))
  const seededReports = new Set(existing.map((row) => text(row.sourceReportId)).filter(Boolean))
  for (const report of reports) {
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

export async function listStudentNewWords(studentRefId) {
  const prisma = await getPrisma()
  await seedFromNewsReports(prisma, studentRefId)
  const rows = await prisma.studentNewWord.findMany({
    where: { studentRefId },
    orderBy: [{ sourceReportDate: "asc" }, { english: "asc" }],
  })
  return { ok: true, items: rows.map(mapWord) }
}

export async function saveStudentNewWords(studentRefId, value) {
  const prisma = await getPrisma()
  const source = Array.isArray(value) ? value : []
  const deduped = new Map()
  source.slice(0, MAX_WORDS).forEach((row) => {
    const word = normalizeWord(row)
    if (word.englishKey) deduped.set(word.englishKey, word)
  })
  const words = Array.from(deduped.values())
  const existing = await prisma.studentNewWord.findMany({ where: { studentRefId }, select: { id: true } })
  const incomingIds = new Set(source.slice(0, MAX_WORDS).map((row) => text(row?.id)).filter(Boolean))
  await prisma.$transaction(async (tx) => {
    await tx.studentNewWord.deleteMany({
      where: { studentRefId, id: { notIn: Array.from(incomingIds) } },
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
  return listStudentNewWords(studentRefId)
}
