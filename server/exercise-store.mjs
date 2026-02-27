// server/exercise-store.mjs

import { getSharedPrismaClient } from "./prisma-client-factory.mjs"

function resolveBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return fallback
    if (["true", "1", "yes"].includes(normalized)) return true
    if (["false", "0", "no"].includes(normalized)) return false
  }
  return fallback
}

function normalizeString(value) {
  if (typeof value !== "string") return ""
  return value.trim()
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase()
}

function isStoreEnabled() {
  const hasDatabaseUrl = Boolean(normalizeString(process.env.DATABASE_URL))
  return resolveBoolean(process.env.EXERCISE_STORE_ENABLED, hasDatabaseUrl)
}

export function isExerciseStoreRequired() {
  return resolveBoolean(process.env.EXERCISE_STORE_REQUIRED, false)
}

let prismaClientPromise = null

async function getPrismaClient() {
  if (!isStoreEnabled()) return null
  if (prismaClientPromise) return prismaClientPromise

  prismaClientPromise = getSharedPrismaClient()

  try {
    return await prismaClientPromise
  } catch (error) {
    prismaClientPromise = null
    throw error
  }
}

function slugify(value) {
  const raw = normalizeLower(value)
  if (!raw) return "untitled-exercise"
  return raw
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
}

function parseCompletedAt(value) {
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.valueOf())) return parsed
  }
  return new Date()
}

function summarizeAnswers(answers) {
  const list = Array.isArray(answers) ? answers : []
  let correctCount = 0
  let pendingCount = 0
  let incorrectCount = 0

  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i]
    const status = normalizeLower(entry?.status)
    const needsReview = entry?.needsReview === true
    if (status === "correct") {
      correctCount += 1
      continue
    }
    if (status === "pending" || needsReview) {
      pendingCount += 1
      continue
    }
    incorrectCount += 1
  }

  const totalQuestions = list.length
  const scorePercent =
    totalQuestions > 0 ? Number(((correctCount / totalQuestions) * 100).toFixed(2)) : 0

  return {
    totalQuestions,
    correctCount,
    pendingCount,
    incorrectCount,
    scorePercent,
  }
}

function buildStudentKey(studentId, email) {
  const cleanId = normalizeLower(studentId)
  if (cleanId) return `sid:${cleanId}`
  const cleanEmail = normalizeLower(email)
  if (cleanEmail) return `email:${cleanEmail}`
  return "anonymous"
}

function normalizeRecipients(value) {
  if (!Array.isArray(value)) return null
  const cleaned = value
    .map((entry) => normalizeString(entry))
    .filter(Boolean)
  return cleaned.length ? cleaned : null
}

function normalizeAnswers(value) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const answers = Array.isArray(entry?.answers)
      ? entry.answers.map((answer) => (answer == null ? "" : String(answer)))
      : []
    return {
      id: entry?.id == null ? "" : String(entry.id),
      answers,
      status: normalizeLower(entry?.status),
      needsReview: entry?.needsReview === true,
    }
  })
}

export async function persistExerciseSubmission(payload) {
  if (!isStoreEnabled()) return { saved: false, reason: "disabled" }

  const prisma = await getPrismaClient()
  if (!prisma) return { saved: false, reason: "disabled" }

  const submittedStudentId = normalizeString(payload?.studentId)
  const submittedEmail = normalizeString(payload?.email)
  const pageTitle = normalizeString(payload?.pageTitle) || "Untitled exercise"
  const completedAt = parseCompletedAt(payload?.completedAt)
  const recipientsJson = normalizeRecipients(payload?.recipients)
  const answersJson = normalizeAnswers(payload?.answers)
  const summary = summarizeAnswers(answersJson)
  const studentKey = buildStudentKey(submittedStudentId, submittedEmail)
  const exerciseSlug = slugify(pageTitle)

  const created = await prisma.$transaction(async (tx) => {
    const student = await tx.student.upsert({
      where: { externalKey: studentKey },
      update: {
        studentId: submittedStudentId || null,
        email: submittedEmail || null,
      },
      create: {
        externalKey: studentKey,
        studentId: submittedStudentId || null,
        email: submittedEmail || null,
      },
    })

    const exercise = await tx.exercise.upsert({
      where: { slug: exerciseSlug },
      update: {
        title: pageTitle,
      },
      create: {
        slug: exerciseSlug,
        title: pageTitle,
      },
    })

    return tx.exerciseSubmission.create({
      data: {
        studentRefId: student.id,
        exerciseRefId: exercise.id,
        submittedStudentId: submittedStudentId || "(not provided)",
        submittedEmail: submittedEmail || null,
        completedAt,
        totalQuestions: summary.totalQuestions,
        correctCount: summary.correctCount,
        pendingCount: summary.pendingCount,
        incorrectCount: summary.incorrectCount,
        scorePercent: summary.scorePercent,
        answersJson,
        recipientsJson,
      },
    })
  })

  return {
    saved: true,
    submissionId: created.id,
    summary,
  }
}
