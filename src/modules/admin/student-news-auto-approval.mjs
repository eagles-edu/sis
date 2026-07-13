// @ts-check

import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { getNewsReportsConfigSync } from "./sis-config-store.mjs"
import { evaluateStudentNewsMinimumRequirements } from "./student-news-compliance.mjs"
import {
  isStudentNewsReportSchemaUnavailableError,
  isStudentNewsReviewSchemaUnavailableError,
  readStudentNewsFallbackEntries,
  upsertStudentNewsReportInFallbackStore,
} from "./student-news-fallback.mjs"

export const STUDENT_NEWS_AUTO_APPROVE_REVIEWED_BY = "system:auto-approve"
export const STUDENT_NEWS_AUTO_APPROVE_REVIEW_STATUS = "approved"
export const STUDENT_NEWS_AUTO_APPROVE_PENDING_STATUS = "submitted"
export const STUDENT_NEWS_AUTO_APPROVE_SUBMISSION_STATE = "submitted"
export const STUDENT_NEWS_AUTO_APPROVE_DEFAULT_DELAY_HOURS = 16
export const STUDENT_NEWS_AUTO_APPROVE_LOOP_INTERVAL_MS = 5 * 60 * 1000

const STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER = "[[SIS-AWAITING-RE-REVIEW]]"
const FIXED_TIME_ZONE_OFFSET_MINUTES = 7 * 60
const FIXED_TIME_ZONE_OFFSET_MS = FIXED_TIME_ZONE_OFFSET_MINUTES * 60 * 1000

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeNullableText(value) {
  const text = normalizeText(value)
  return text || null
}

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function parseDateOrNull(value) {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value
  const text = normalizeText(value)
  if (!text) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.valueOf()) ? null : parsed
}

/**
 * @param {unknown} value
 * @param {boolean} [fallback]
 * @returns {boolean}
 */
function normalizeBoolean(value, fallback = true) {
  const token = normalizeLower(value)
  if (!token) return fallback
  if (["true", "1", "yes", "on", "enabled"].includes(token)) return true
  if (["false", "0", "no", "off", "disabled"].includes(token)) return false
  return fallback
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || 0), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * @param {Record<string, unknown> | null | undefined} [value]
 * @returns {Record<string, unknown>}
 */
function normalizePlainObject(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return { ...value }
}

/**
 * @param {Date} value
 * @returns {Date}
 */
function shiftToFixedTimeZone(value) {
  return new Date(value.getTime() + FIXED_TIME_ZONE_OFFSET_MS)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function toLocalIsoDate(value) {
  const date = value instanceof Date ? value : parseDateOrNull(value)
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return ""
  const shifted = shiftToFixedTimeZone(date)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0")
  const day = String(shifted.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeStudentNewsReviewStatus(value) {
  const token = normalizeLower(value)
  if (
    token === "revision-requested"
    || token === "revision_requested"
    || token === "revision"
    || token === "revise"
    || token === "request-revision"
    || token === "request_revision"
  ) {
    return "revision-requested"
  }
  if (token === "approved" || token === "approve") return "approved"
  return "submitted"
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeStudentNewsSubmissionState(value) {
  const token = normalizeLower(value)
  if (token === "draft") return "draft"
  if (token === "ready") return "ready"
  return "submitted"
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function resolveStudentNewsAwaitingReReview(value) {
  return normalizeText(value).includes(STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stripAwaitingReReviewMarker(value) {
  return normalizeText(String(value || "").replaceAll(STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER, ""))
}

/**
 * @param {Record<string, unknown> | null | undefined} [source]
 * @returns {{ autoApproveEnabled: boolean, autoApproveDelayHours: number }}
 */
export function normalizeStudentNewsAutoApprovalConfig(source = {}) {
  const candidate = normalizePlainObject(source)
  return {
    autoApproveEnabled: normalizeBoolean(
      candidate.autoApproveEnabled
      ?? candidate.autoApproveMmrReports
      ?? candidate.autoApprovalEnabled
      ?? candidate.mmrAutoApproveEnabled,
      true
    ),
    autoApproveDelayHours: normalizePositiveInt(
      candidate.autoApproveDelayHours
      ?? candidate.autoApprovalDelayHours
      ?? candidate.mmrAutoApproveDelayHours,
      STUDENT_NEWS_AUTO_APPROVE_DEFAULT_DELAY_HOURS
    ),
  }
}

/**
 * @returns {{ autoApproveEnabled: boolean, autoApproveDelayHours: number }}
 */
export function getStudentNewsAutoApprovalConfigSync() {
  return normalizeStudentNewsAutoApprovalConfig(getNewsReportsConfigSync())
}

/**
 * @param {Record<string, unknown> | null | undefined} [report]
 * @returns {Record<string, unknown>}
 */
export function buildStudentNewsValidationPayload(report = {}) {
  return {
    sourceLink: normalizeText(report?.sourceLink),
    articleTitle: normalizeText(report?.articleTitle),
    byline: normalizeText(report?.byline),
    articleDateline: normalizeText(report?.articleDateline),
    leadSynopsis: normalizeText(report?.leadSynopsis),
    actionActor: normalizeText(report?.actionActor),
    actionAffected: normalizeText(report?.actionAffected),
    actionWhere: normalizeText(report?.actionWhere),
    actionWhat: normalizeText(report?.actionWhat),
    actionWhy: normalizeText(report?.actionWhy),
    biasAssessment: normalizeText(report?.biasAssessment),
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} [report]
 * @param {{ autoApproveEnabled: boolean, autoApproveDelayHours: number }} [config]
 * @returns {Date | null}
 */
export function resolveStudentNewsAutoApproveDueAt(report = {}, config = getStudentNewsAutoApprovalConfigSync()) {
  const normalizedConfig = normalizeStudentNewsAutoApprovalConfig(config)
  if (!normalizedConfig.autoApproveEnabled) return null
  const baseSubmittedAt =
    parseDateOrNull(report?.lastSubmittedAt)
    || parseDateOrNull(report?.firstSubmittedAt)
    || parseDateOrNull(report?.submittedAt)
  if (!(baseSubmittedAt instanceof Date) || Number.isNaN(baseSubmittedAt.valueOf())) return null
  return new Date(baseSubmittedAt.getTime() + (normalizedConfig.autoApproveDelayHours * 60 * 60 * 1000))
}

/**
 * @param {Record<string, unknown> | null | undefined} [report]
 * @param {{
 *   now?: unknown,
 *   validationConfig?: Record<string, unknown>,
 *   config?: Record<string, unknown>,
 * }} [options]
 * @returns {Promise<{
 *   enabled: boolean,
 *   candidate: boolean,
 *   due: boolean,
 *   dueAt: string,
 *   mmrPassed: boolean,
 *   skipReason: string,
 * }>}
 */
export async function evaluateStudentNewsAutoApprovalState(report = {}, { now = new Date(), validationConfig = {}, config = {} } = {}) {
  const normalizedConfig = normalizeStudentNewsAutoApprovalConfig(
    Object.keys(normalizePlainObject(config)).length ? config : getNewsReportsConfigSync()
  )
  if (!normalizedConfig.autoApproveEnabled) {
    return {
      enabled: false,
      candidate: false,
      due: false,
      dueAt: "",
      mmrPassed: false,
      skipReason: "disabled",
    }
  }

  const reviewStatus = normalizeStudentNewsReviewStatus(report?.reviewStatus)
  if (reviewStatus !== STUDENT_NEWS_AUTO_APPROVE_PENDING_STATUS) {
    return {
      enabled: true,
      candidate: false,
      due: false,
      dueAt: "",
      mmrPassed: false,
      skipReason: "reviewed",
    }
  }

  if (resolveStudentNewsAwaitingReReview(report?.reviewNote)) {
    return {
      enabled: true,
      candidate: false,
      due: false,
      dueAt: "",
      mmrPassed: false,
      skipReason: "awaiting-re-review",
    }
  }

  const submissionState = normalizeStudentNewsSubmissionState(report?.submissionState)
  if (submissionState !== STUDENT_NEWS_AUTO_APPROVE_SUBMISSION_STATE) {
    return {
      enabled: true,
      candidate: false,
      due: false,
      dueAt: "",
      mmrPassed: false,
      skipReason: "not-submitted",
    }
  }

  const dueAt = resolveStudentNewsAutoApproveDueAt(report, normalizedConfig)
  if (!(dueAt instanceof Date) || Number.isNaN(dueAt.valueOf())) {
    return {
      enabled: true,
      candidate: false,
      due: false,
      dueAt: "",
      mmrPassed: false,
      skipReason: "missing-submitted-at",
    }
  }

  const minimumRequirements = await evaluateStudentNewsMinimumRequirements(
    buildStudentNewsValidationPayload(report),
    { validationConfig }
  )
  const mmrPassed = minimumRequirements.passed === true
  const nowDate = parseDateOrNull(now) || new Date()
  return {
    enabled: true,
    candidate: mmrPassed,
    due: mmrPassed && dueAt.getTime() <= nowDate.getTime(),
    dueAt: dueAt.toISOString(),
    mmrPassed,
    skipReason: mmrPassed ? "" : "mmr-failed",
  }
}

/**
 * @returns {Record<string, unknown>}
 */
export function buildStudentNewsAutoApprovalSelect() {
  return {
    id: true,
    studentRefId: true,
    reportDate: true,
    sourceLink: true,
    articleTitle: true,
    byline: true,
    articleDateline: true,
    leadSynopsis: true,
    actionActor: true,
    actionAffected: true,
    actionWhere: true,
    actionWhat: true,
    actionWhy: true,
    biasAssessment: true,
    vocabularyJson: true,
    submissionState: true,
    submittedAt: true,
    firstSubmittedAt: true,
    lastSubmittedAt: true,
    editableUntil: true,
    reviewStatus: true,
    reviewNote: true,
    validationIssuesJson: true,
    reviewedByUsername: true,
    reviewedAt: true,
  }
}

/**
 * @param {unknown} prisma
 * @param {string} delegateName
 * @param {string} methodName
 * @returns {boolean}
 */
function hasPrismaDelegateMethod(prisma, delegateName, methodName) {
  const typedPrisma = /** @type {Record<string, Record<string, unknown>> | null | undefined} */ (prisma)
  const delegate = typedPrisma?.[delegateName]
  return Boolean(delegate && typeof delegate[methodName] === "function")
}

/**
 * @param {{
 *   reportId?: unknown,
 *   studentRefId?: unknown,
 *   take?: unknown,
 * }} [options]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function loadStudentNewsAutoApprovalCandidates({ reportId = "", studentRefId = "", take = 500 } = {}) {
  const prisma = await getSharedPrismaClient()
  const id = normalizeText(reportId)
  const studentId = normalizeText(studentRefId)
  const limit = Math.max(1, Number.parseInt(String(take || 500), 10) || 500)
  const where = {
    reviewStatus: STUDENT_NEWS_AUTO_APPROVE_PENDING_STATUS,
    submissionState: STUDENT_NEWS_AUTO_APPROVE_SUBMISSION_STATE,
  }
  if (id) where.id = id
  if (studentId) where.studentRefId = studentId

  /** @type {Array<Record<string, unknown>>} */
  let rows = []
  let fallbackOnly = false
  if (hasPrismaDelegateMethod(prisma, "studentNewsReport", "findMany")) {
    try {
      rows = await prisma.studentNewsReport.findMany({
        where,
        select: buildStudentNewsAutoApprovalSelect(),
        orderBy: [{ submittedAt: "asc" }, { reportDate: "asc" }],
        take: limit,
      })
    } catch (error) {
      if (
        isStudentNewsReportSchemaUnavailableError(error)
        || isStudentNewsReviewSchemaUnavailableError(error)
      ) {
        fallbackOnly = true
      } else {
        throw error
      }
    }
  } else {
    fallbackOnly = true
  }

  if (!fallbackOnly) return rows

  return readStudentNewsFallbackEntries()
    .filter((entry) => !id || normalizeText(entry?.id) === id)
    .filter((entry) => !studentId || normalizeText(entry?.studentRefId) === studentId)
    .filter(
      (entry) =>
        normalizeStudentNewsReviewStatus(entry?.reviewStatus) === STUDENT_NEWS_AUTO_APPROVE_PENDING_STATUS
        && normalizeStudentNewsSubmissionState(entry?.submissionState) === STUDENT_NEWS_AUTO_APPROVE_SUBMISSION_STATE
    )
    .slice(0, limit)
}

/**
 * @param {Record<string, unknown>} report
 * @param {Date} reviewedAt
 * @returns {Record<string, unknown>}
 */
function buildStudentNewsAutoApprovalUpdateData(report, reviewedAt) {
  return {
    reviewStatus: STUDENT_NEWS_AUTO_APPROVE_REVIEW_STATUS,
    reviewNote: normalizeNullableText(stripAwaitingReReviewMarker(report?.reviewNote)),
    reviewedByUsername: STUDENT_NEWS_AUTO_APPROVE_REVIEWED_BY,
    reviewedAt,
  }
}

/**
 * @param {Record<string, unknown>} report
 * @param {Date} reviewedAt
 * @returns {Promise<boolean>}
 */
async function updateStudentNewsAutoApprovedReport(report, reviewedAt) {
  const prisma = await getSharedPrismaClient()
  const id = normalizeText(report?.id)
  const updateData = buildStudentNewsAutoApprovalUpdateData(report, reviewedAt)
  if (id && hasPrismaDelegateMethod(prisma, "studentNewsReport", "update")) {
    try {
      await prisma.studentNewsReport.update({
        where: { id },
        data: updateData,
      })
      return true
    } catch (error) {
      if (
        !isStudentNewsReportSchemaUnavailableError(error)
        && !isStudentNewsReviewSchemaUnavailableError(error)
        && normalizeText(error?.code).toUpperCase() !== "P2025"
      ) {
        throw error
      }
    }
  }

  const studentRefId = normalizeText(report?.studentRefId)
  const reportDate = parseDateOrNull(report?.reportDate)
  const reportDateKey = reportDate instanceof Date && !Number.isNaN(reportDate.valueOf())
    ? toLocalIsoDate(reportDate)
    : normalizeText(report?.reportDate).slice(0, 10)
  if (!studentRefId || !reportDateKey) return false

  upsertStudentNewsReportInFallbackStore(studentRefId, reportDateKey, {
    ...report,
    id,
    reviewStatus: updateData.reviewStatus,
    reviewNote: updateData.reviewNote,
    reviewedByUsername: updateData.reviewedByUsername,
    reviewedAt: reviewedAt.toISOString(),
  })
  return true
}

/**
 * @param {{
 *   reportId?: unknown,
 *   studentRefId?: unknown,
 *   now?: unknown,
 *   take?: unknown,
 *   validationConfig?: Record<string, unknown>,
 * }} [options]
 * @returns {Promise<{
 *   scanned: number,
 *   approved: number,
 *   candidateIds: string[],
 *   pendingIds: string[],
 * }>}
 */
export async function reconcileStudentNewsAutoApprovals({
  reportId = "",
  studentRefId = "",
  now = new Date(),
  take = 500,
  validationConfig = {},
} = {}) {
  const config = getStudentNewsAutoApprovalConfigSync()
  if (!config.autoApproveEnabled) {
    return {
      scanned: 0,
      approved: 0,
      candidateIds: [],
      pendingIds: [],
    }
  }

  const rows = await loadStudentNewsAutoApprovalCandidates({ reportId, studentRefId, take })
  const reviewedAt = parseDateOrNull(now) || new Date()
  let approved = 0
  /** @type {string[]} */
  const candidateIds = []
  /** @type {string[]} */
  const pendingIds = []

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const state = await evaluateStudentNewsAutoApprovalState(row, {
      now: reviewedAt,
      validationConfig,
      config,
    })
    if (!state.candidate) continue
    const rowId = normalizeText(row?.id)
    if (rowId) candidateIds.push(rowId)
    if (!state.due) {
      if (rowId) pendingIds.push(rowId)
      continue
    }
    const saved = await updateStudentNewsAutoApprovedReport(row, reviewedAt)
    if (saved) approved += 1
  }

  return {
    scanned: rows.length,
    approved,
    candidateIds,
    pendingIds,
  }
}

/**
 * @param {{ intervalMs?: unknown, onError?: ((error: unknown) => void) | null }} [options]
 * @returns {{ stop: () => void }}
 */
export function startStudentNewsAutoApprovalLoop({ intervalMs = STUDENT_NEWS_AUTO_APPROVE_LOOP_INTERVAL_MS, onError = null } = {}) {
  const pollMs = Math.max(60 * 1000, Number.parseInt(String(intervalMs || 0), 10) || STUDENT_NEWS_AUTO_APPROVE_LOOP_INTERVAL_MS)
  const run = () => {
    reconcileStudentNewsAutoApprovals().catch((error) => {
      if (typeof onError === "function") {
        onError(error)
        return
      }
      console.error(`[student-news-auto-approval] ${normalizeText(error?.message || error)}`)
    })
  }

  run()
  const timer = setInterval(run, pollMs)
  if (typeof timer.unref === "function") timer.unref()
  return {
    stop() {
      clearInterval(timer)
    },
  }
}
