#!/usr/bin/env node
import { getSharedPrismaClient } from "../src/infra/db/prisma-client.mjs"
import {
  isProperNounVocabularyEntry,
  normalizeVocabularyEnglishText,
  vocabularyEnglishCapitalizationError,
} from "../src/modules/admin/vocabulary-syllabication.mjs"

const apply = process.argv.includes("--apply")
const unsupported = process.argv.slice(2).filter((argument) => argument !== "--apply" && argument !== "--check")
if (unsupported.length) throw new Error("Usage: node tools/normalize-vocabulary-english-capitalization.mjs [--check|--apply]")

function text(value) {
  return String(value == null ? "" : value).trim()
}

function normalizeKey(value) {
  return normalizeVocabularyEnglishText(value)
    .toLocaleLowerCase("en-US")
    .replace(/[’']/gu, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

function normalizedEntry(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value, changed: false, unresolvedProperNoun: false }
  const english = normalizeVocabularyEnglishText(value.english)
  if (!english) return { value, changed: false, unresolvedProperNoun: false }
  if (isProperNounVocabularyEntry(value)) {
    return {
      value: { ...value, english },
      changed: english !== value.english,
      unresolvedProperNoun: Boolean(vocabularyEnglishCapitalizationError({ ...value, english })),
    }
  }
  const normalizedEnglish = english.toLocaleLowerCase("en-US")
  return { value: { ...value, english: normalizedEnglish }, changed: normalizedEnglish !== value.english, unresolvedProperNoun: false }
}

function normalizeVocabularyRows(value) {
  if (!Array.isArray(value)) return { value, changed: false, unresolvedProperNouns: 0 }
  let changed = false
  let unresolvedProperNouns = 0
  const normalized = value.map((row) => {
    const result = normalizedEntry(row)
    changed ||= result.changed
    unresolvedProperNouns += Number(result.unresolvedProperNoun)
    return result.value
  })
  return { value: normalized, changed, unresolvedProperNouns }
}

function assertNoLibraryKeyCollision(entries = []) {
  const pairs = new Map()
  for (const entry of entries) {
    const result = normalizedEntry(entry)
    const pair = `${normalizeKey(result.value.english)}|${text(result.value.partOfSpeech).toLocaleLowerCase("en-US")}`
    if (!pair || pair === "|") continue
    const existingId = pairs.get(pair)
    if (existingId && existingId !== entry.id) throw new Error(`Normalization would merge Library entries ${existingId} and ${entry.id}; no data was changed.`)
    pairs.set(pair, entry.id)
  }
}

const prisma = await getSharedPrismaClient()
try {
  const [studentNewWords, reports, libraryEntries, contributions] = await Promise.all([
    prisma.studentNewWord.findMany({ select: { id: true, english: true, englishKey: true, partOfSpeech: true, eslJson: true } }),
    prisma.studentNewsReport.findMany({ select: { id: true, vocabularyJson: true } }),
    prisma.libraryEntry.findMany(),
    prisma.libraryContribution.findMany({ select: { id: true, entryId: true, studentRefId: true, contributorName: true, sourceKind: true, sourceId: true, payloadJson: true, status: true, submittedAt: true, dueAt: true, canonicalizedAt: true } }),
  ])
  assertNoLibraryKeyCollision(libraryEntries)

  const wordUpdates = studentNewWords.map((word) => {
    const result = normalizedEntry({ ...word, esl: word.eslJson })
    const englishKey = normalizeVocabularyEnglishText(result.value.english).toLocaleLowerCase("en-US")
    return { ...word, result, englishKey, changed: result.changed || englishKey !== word.englishKey }
  }).filter((row) => row.changed)
  const reportUpdates = reports.map((report) => ({ ...report, result: normalizeVocabularyRows(report.vocabularyJson) })).filter((row) => row.result.changed)
  const entryUpdates = libraryEntries.map((entry) => {
    const result = normalizedEntry(entry)
    const normalizedKey = normalizeKey(result.value.english)
    return { ...entry, result, normalizedKey, changed: result.changed || normalizedKey !== entry.normalizedKey }
  }).filter((row) => row.changed)
  const contributionUpdates = contributions.map((contribution) => ({ ...contribution, result: normalizedEntry(contribution.payloadJson) })).filter((row) => row.result.changed)
  const unresolvedProperNouns = [
    ...studentNewWords.map((word) => normalizedEntry({ ...word, esl: word.eslJson })),
    ...reports.map((report) => normalizeVocabularyRows(report.vocabularyJson)).flatMap((result) => Array.from({ length: result.unresolvedProperNouns }, () => ({ unresolvedProperNoun: true }))),
    ...libraryEntries.map(normalizedEntry),
    ...contributions.map((contribution) => normalizedEntry(contribution.payloadJson)),
  ].reduce((total, result) => total + Number(result.unresolvedProperNoun), 0)

  const summary = {
    mode: apply ? "apply" : "check",
    studentNewWords: wordUpdates.length,
    studentNewsReports: reportUpdates.length,
    libraryEntries: entryUpdates.length,
    libraryContributions: contributionUpdates.length,
    unresolvedProperNouns,
    immutableAuditSnapshotsPreserved: true,
  }
  if (!apply) {
    console.log(JSON.stringify(summary, null, 2))
    process.exitCode = unresolvedProperNouns ? 2 : 0
  } else {
    await prisma.$transaction(async (tx) => {
      for (const row of wordUpdates) {
        await tx.studentNewWord.update({ where: { id: row.id }, data: { english: row.result.value.english, englishKey: row.englishKey } })
      }
      for (const row of reportUpdates) {
        await tx.studentNewsReport.update({ where: { id: row.id }, data: { vocabularyJson: row.result.value } })
      }
      for (const row of entryUpdates) {
        const updated = await tx.libraryEntry.update({ where: { id: row.id }, data: { english: row.result.value.english, normalizedKey: row.normalizedKey, lastEditedByName: "Vocabulary capitalization normalizer" } })
        await tx.libraryEntryRevision.create({ data: { entryId: updated.id, action: "capitalization_normalized", actorName: "Vocabulary capitalization normalizer", actorRole: "system", snapshotJson: updated } })
      }
      for (const row of contributionUpdates) {
        const updated = await tx.libraryContribution.update({ where: { id: row.id }, data: { payloadJson: row.result.value } })
        await tx.libraryContributionRevision.create({ data: {
          contributionId: updated.id,
          action: "capitalization_normalized",
          snapshotJson: {
            id: updated.id,
            entryId: updated.entryId || "",
            studentRefId: updated.studentRefId || "",
            contributorName: updated.contributorName || "",
            sourceKind: updated.sourceKind || "",
            sourceId: updated.sourceId || "",
            payloadJson: updated.payloadJson,
            status: updated.status || "",
            submittedAt: updated.submittedAt?.toISOString?.() || "",
            dueAt: updated.dueAt?.toISOString?.() || "",
            canonicalizedAt: updated.canonicalizedAt?.toISOString?.() || "",
          },
        } })
      }
    }, { maxWait: 30000, timeout: 120000 })
    console.log(JSON.stringify(summary, null, 2))
    if (unresolvedProperNouns) process.exitCode = 2
  }
} finally {
  await prisma.$disconnect()
}
