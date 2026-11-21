import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { closeSharedPrismaClient, getSharedPrismaClient } from "../src/infra/db/prisma-client.mjs"
import { validateVocabularyEntry } from "../src/modules/admin/vocabulary-syllabication.mjs"
import { resolveStudentNewsSubmissionWindow } from "../src/modules/admin/student-news-submissions.mjs"
import { resolveStandardStudentCredentials } from "../test/helpers/standard-portal-credentials.mjs"
import { renderKeepaliveCheckMetrics } from "../src/infra/observability/keepalive-check-metrics.mjs"
import { assertKeepaliveMonitorDatabase, resolveKeepaliveMonitorEnvironment } from "./keepalive-monitor-environment.mjs"

const METRICS_DIRECTORY = path.join(process.cwd(), "runtime-data/prometheus")
const OPEN_REVIEW_STATUSES = ["submitted", "revision-requested"]
const REQUEST_TIMEOUT_MS = 20000

export function assertNewsMonitorEnvironment(environment = process.env) {
  return resolveKeepaliveMonitorEnvironment(environment)
}

function metricNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new TypeError("Metric values must be finite non-negative numbers")
  return number.toFixed(6)
}

function timestampSeconds(value) {
  const date = value instanceof Date ? value : new Date(value || 0)
  const result = date.getTime() / 1000
  return Number.isFinite(result) && result > 0 ? result : 0
}

export function renderNewsWorkflowMetrics({
  environment = "dev",
  checkedAt,
  durationSeconds,
  checkDurationSeconds,
  checkSuccess,
  languageToolAvailable,
  languageToolCheckPerformed,
  checkHttpStatus,
  dictionaryAvailable,
  submissionSuccess,
  submissionHttpStatus,
  cleanupSuccess,
  apiAvailable,
  databaseAvailable,
  openReviewCount,
  oldestOpenReviewAgeSeconds,
  lastSuccessTimestamp,
}) {
  const values = [
    ["sis_news_workflow_check_success", "Whether the latest News workflow monitor passed.", checkSuccess ? 1 : 0],
    ["sis_news_workflow_check_duration_seconds", "Duration of the latest News workflow monitor.", durationSeconds],
    ["sis_news_workflow_last_check_timestamp_seconds", "Unix timestamp of the latest News workflow monitor.", checkedAt],
    ["sis_news_workflow_last_success_timestamp_seconds", "Unix timestamp of the latest successful News workflow monitor.", lastSuccessTimestamp],
    ["sis_news_api_available", "Whether the SIS health endpoint is available.", apiAvailable ? 1 : 0],
    ["sis_news_database_available", "Whether the SIS database is available.", databaseAvailable ? 1 : 0],
    ["sis_news_check_success", "Whether the authenticated synthetic Student News Check passed.", checkSuccess ? 1 : 0],
    ["sis_news_check_duration_seconds", "Duration of the authenticated synthetic Student News Check.", checkDurationSeconds],
    ["sis_news_check_http_status", "HTTP status returned by the latest synthetic Student News Check request.", checkHttpStatus],
    ["sis_news_language_tool_check_performed", "Whether LanguageTool was reached during the News Check.", languageToolCheckPerformed ? 1 : 0],
    ["sis_news_language_tool_available", "Whether LanguageTool completed during the News Check.", languageToolAvailable ? 1 : 0],
    ["sis_news_dictionary_available", "Whether the Merriam-Webster-backed vocabulary check was reachable.", dictionaryAvailable ? 1 : 0],
    ["sis_news_submission_success", "Whether the authenticated synthetic Student News submission succeeded.", submissionSuccess ? 1 : 0],
    ["sis_news_submission_failure", "Whether the latest authenticated synthetic Student News submission failed.", submissionSuccess ? 0 : 1],
    ["sis_news_submission_http_status", "HTTP status returned by the latest synthetic Student News submission request.", submissionHttpStatus],
    ["sis_news_cleanup_success", "Whether the synthetic Student News report was removed and verified.", cleanupSuccess ? 1 : 0],
    ["sis_news_open_review_reports", "Number of submitted Student News reports awaiting review.", openReviewCount],
    ["sis_news_oldest_open_review_age_seconds", "Age in seconds of the oldest submitted Student News report awaiting review.", oldestOpenReviewAgeSeconds],
  ]
  return values.flatMap(([name, help, value]) => [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    `${name}{environment="${environment}"} ${metricNumber(value)}`,
  ]).concat("").join("\n")
}

function readLastSuccessTimestamp(metricsFile, environment = "dev") {
  if (!fs.existsSync(metricsFile)) return 0
  const contents = fs.readFileSync(metricsFile, "utf8")
  const match = contents.match(new RegExp(`^sis_news_workflow_last_success_timestamp_seconds\\{environment="${environment}"\\} ([0-9]+(?:\\.[0-9]+)?)$`, "mu"))
  return match ? Number(match[1]) : 0
}

export function writeNewsMetricsAtomically(metricsFile, contents) {
  const directory = path.dirname(metricsFile)
  fs.mkdirSync(directory, { recursive: true, mode: 0o750 })
  const temporaryFile = `${metricsFile}.${process.pid}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporaryFile, contents, { encoding: "utf8", flag: "wx", mode: 0o644 })
    fs.renameSync(temporaryFile, metricsFile)
  } catch (error) {
    fs.rmSync(temporaryFile, { force: true })
    throw error
  }
}

async function requestJson(fetchImpl, endpoint, { cookie = "", body, origin = "http://127.0.0.1:8788" } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const started = performance.now()
  try {
    const response = await fetchImpl(`${origin}${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({}))
    return {
      ok: response.ok,
      status: response.status,
      payload,
      setCookie: response.headers.get("set-cookie") || "",
      durationSeconds: Math.max(0, (performance.now() - started) / 1000),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function sessionCookie(result, name) {
  if (!result.ok) return ""
  const match = result.setCookie.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`, "iu"))
  return match ? `${name}=${match[1]}` : ""
}

export function resolveNewsMonitorReportDate(now = new Date()) {
  return resolveStudentNewsSubmissionWindow(now).reportDate
}

function syntheticReport(reportDate, sourceLink, articleTitle) {
  return {
    reportDate,
    sourceLink,
    articleTitle,
    byline: "SIS monitoring",
    articleDateline: "Published today at 9:00 AM ICT (GMT+7).",
    leadSynopsis: "Emergency teams opened a new support center after severe weather affected several neighborhoods.",
    actionActor: "Emergency teams",
    actionAffected: "Residents",
    actionWhere: "Coast City",
    actionWhat: "Emergency teams opened a support center for residents after severe weather affected the area.",
    actionWhy: "The center opened because heavy rain damaged homes and interrupted essential services.",
    biasAssessment: "The report relies on officials, so it may omit some residents' experiences.",
    vocabulary: [
      { partOfSpeech: "noun", english: "air-strike", vietnamese: "cuộc không kích", syllabication: "air-strike", definition: "An attack from aircraft.", esl: { countability: "countable", physicalQuality: "concrete", grammaticalNumber: "singular", primaryClassification: "compound" } },
      { partOfSpeech: "noun", english: "computer", vietnamese: "máy tính", syllabication: "com-PUT-er", definition: "An electronic device for processing data.", esl: { countability: "countable", physicalQuality: "concrete", grammaticalNumber: "singular", primaryClassification: "common" } },
      { partOfSpeech: "noun", english: "check-in", vietnamese: "thủ tục nhận phòng", syllabication: "check-in", definition: "The act of registering on arrival.", esl: { countability: "countable", physicalQuality: "abstract", grammaticalNumber: "singular", primaryClassification: "compound" } },
      { partOfSpeech: "adjective", english: "life-size", vietnamese: "kích thước thật", syllabication: "life-size", definition: "Having the same size as the real subject.", esl: { grammarClassification: { grammarSubtype: "attributive" } } },
      { partOfSpeech: "adverb", english: "step-by-step", vietnamese: "từng bước", syllabication: "step-by-step", definition: "Progressing one stage at a time.", esl: { grammarClassification: { grammarSubtype: "manner" } } },
    ],
  }
}

async function collectQueueMetrics(prisma, now) {
  const where = {
    submissionState: "submitted",
    reviewStatus: { in: OPEN_REVIEW_STATUSES },
    submittedAt: { not: null },
  }
  const [openReviewCount, oldestOpenReview] = await Promise.all([
    prisma.studentNewsReport.count({ where }),
    prisma.studentNewsReport.findFirst({ where, orderBy: { submittedAt: "asc" }, select: { submittedAt: true } }),
  ])
  const oldestSubmittedAt = timestampSeconds(oldestOpenReview?.submittedAt)
  return {
    openReviewCount,
    oldestOpenReviewAgeSeconds: oldestSubmittedAt ? Math.max(0, now / 1000 - oldestSubmittedAt) : 0,
  }
}

export function getLanguageToolCheckState(payload) {
  if (!payload || typeof payload !== "object") return { checked: false, available: false }
  const reports = payload.validation?.sentenceReports
  if (!reports || typeof reports !== "object" || Object.keys(reports).length === 0) return { checked: false, available: false }
  const statuses = Object.values(reports).map((report) => report?.languageToolStatus)
  return {
    checked: true,
    available: statuses.length > 0 && statuses.every((status) => status === "completed" || status === "disabled"),
  }
}

export async function runNewsWorkflowMonitor({
  environment = process.env,
  metricsFile = "",
  prismaClient = null,
  fetchImpl = fetch,
  clock = () => Date.now(),
} = {}) {
  const context = assertNewsMonitorEnvironment(environment)
  metricsFile ||= path.join(METRICS_DIRECTORY, `news-workflow-${context.label}.prom`)
  const request = (endpoint, options = {}) => requestJson(fetchImpl, endpoint, { ...options, origin: context.origin })
  const started = clock()
  const prisma = prismaClient || await getSharedPrismaClient()
  const studentCredentials = resolveStandardStudentCredentials(environment)
  const adminUsername = String(environment.STUDENT_ADMIN_USER || "").trim()
  const adminPassword = String(environment.STUDENT_ADMIN_PASS || "")
  const runId = randomUUID()
  const sourceLink = `https://news.example.invalid/articles/news-monitor-${runId}`
  const articleTitle = `Synthetic Student News monitoring report ${runId}`
  let reportId = ""
  let studentRefId = ""
  let apiAvailable = false
  let databaseAvailable = false
  let checkSuccess = false
  let checkDurationSeconds = 0
  let checkHttpStatus = 0
  let languageToolCheckPerformed = false
  let languageToolAvailable = false
  let dictionaryAvailable = false
  let submissionSuccess = false
  let submissionHttpStatus = 0
  let submissionMmrPassed = false
  let submissionDateSatisfied = false
  let submissionState = ""
  let submissionFailedFieldCount = 0
  let cleanupSuccess = true
  let openReviewCount = 0
  let oldestOpenReviewAgeSeconds = 0
  let failure = false

  try {
    await assertKeepaliveMonitorDatabase(prisma, context)
    databaseAvailable = true
    const student = await prisma.student.findUnique({ where: { eaglesId: studentCredentials.user }, select: { id: true } })
    if (!student?.id || !studentCredentials.pass || !adminUsername || !adminPassword) throw new Error("Configured monitor accounts unavailable")
    studentRefId = student.id
    const queue = await collectQueueMetrics(prisma, clock())
    openReviewCount = queue.openReviewCount
    oldestOpenReviewAgeSeconds = queue.oldestOpenReviewAgeSeconds

    const health = await request("/healthz")
    apiAvailable = health.ok && health.payload?.status === "ok"
    if (!apiAvailable) throw new Error("SIS API unavailable")

    const dictionaryProbe = await validateVocabularyEntry({ english: "computer", syllabication: "com-PUT-er" })
    dictionaryAvailable = !dictionaryProbe.warning

    const adminLogin = await request("/api/admin/auth/login", {
      body: { username: adminUsername, password: adminPassword },
    })
    const adminCookie = sessionCookie(adminLogin, "student_admin_sid")
    const studentLogin = await request("/api/student/auth/login", {
      body: { eaglesId: studentCredentials.user, password: studentCredentials.pass },
    })
    const studentCookie = sessionCookie(studentLogin, "student_portal_sid")
    if (!adminCookie || !studentCookie) throw new Error("Authenticated monitor session unavailable")
    const adminQueue = await request("/api/admin/news-reports?status=all&take=1", { cookie: adminCookie })
    if (!adminQueue.ok || !Array.isArray(adminQueue.payload?.items)) throw new Error("Authenticated News review access unavailable")

    const report = syntheticReport(resolveNewsMonitorReportDate(new Date(clock())), sourceLink, articleTitle)
    const checked = await request("/api/student/news-reports/check", { cookie: studentCookie, body: report })
    checkDurationSeconds = checked.durationSeconds
    checkHttpStatus = checked.status
    reportId = String(checked.payload?.item?.id || "").trim()
    checkSuccess = checked.ok && checked.payload?.saved === true && checked.payload?.mmrPassed === true && Boolean(reportId)
    const languageToolState = getLanguageToolCheckState(checked.payload)
    languageToolCheckPerformed = languageToolState.checked
    languageToolAvailable = languageToolState.available
    if (!checkSuccess) throw new Error("Synthetic News Check failed")
    report.reportId = reportId
    const submitted = await request("/api/student/news-reports", { cookie: studentCookie, body: report })
    submissionHttpStatus = submitted.status
    submissionMmrPassed = submitted.payload?.mmrPassed === true
    submissionDateSatisfied = submitted.payload?.dateSatisfied === true || submitted.payload?.reportDateLocked === true
    submissionState = ["draft", "ready", "submitted"].includes(submitted.payload?.submissionState) ? submitted.payload.submissionState : "unknown"
    submissionFailedFieldCount = Object.keys(submitted.payload?.mmrFailedFields || {}).length
    const submittedRow = await prisma.studentNewsReport.findUnique({
      where: { id: reportId },
      select: { submissionState: true, firstSubmittedAt: true, submittedAt: true },
    })
    submissionSuccess = submitted.ok && submitted.payload?.saved === true && submittedRow?.submissionState === "submitted" && Boolean(submittedRow?.firstSubmittedAt && submittedRow?.submittedAt)
    if (!submissionSuccess) throw new Error("Synthetic News submission failed")
  } catch {
    failure = true
  } finally {
    if (studentRefId) {
      try {
        await prisma.studentNewsReport.deleteMany({ where: { studentRefId, sourceLink, articleTitle } })
        const remaining = await prisma.studentNewsReport.count({ where: { studentRefId, sourceLink, articleTitle } })
        cleanupSuccess = remaining === 0
      } catch {
        cleanupSuccess = false
      }
    } else {
      cleanupSuccess = false
    }
    if (!cleanupSuccess) failure = true
    if (!prismaClient) await closeSharedPrismaClient()
  }

  const checkedAt = clock() / 1000
  const success = !failure && apiAvailable && databaseAvailable && checkSuccess && languageToolAvailable && dictionaryAvailable && submissionSuccess && cleanupSuccess
  const durationSeconds = (clock() - started) / 1000
  const groupMetrics = renderKeepaliveCheckMetrics({
    environment: context.label,
    checkedAt,
    previousMetrics: fs.existsSync(metricsFile) ? fs.readFileSync(metricsFile, "utf8") : "",
    results: {
      student_news: { success, durationSeconds, failureCode: cleanupSuccess ? "workflow_failed" : "cleanup_failed" },
    },
  })
  const metrics = renderNewsWorkflowMetrics({
    environment: context.label,
    checkedAt,
    durationSeconds,
    checkDurationSeconds,
    checkHttpStatus,
    checkSuccess,
    languageToolCheckPerformed,
    languageToolAvailable,
    dictionaryAvailable,
    submissionSuccess,
    submissionHttpStatus,
    cleanupSuccess,
    apiAvailable,
    databaseAvailable,
    openReviewCount,
    oldestOpenReviewAgeSeconds,
    lastSuccessTimestamp: success ? checkedAt : readLastSuccessTimestamp(metricsFile, context.label),
  }) + groupMetrics
  writeNewsMetricsAtomically(metricsFile, metrics)
  const languageToolState = !languageToolCheckPerformed ? "not_checked" : languageToolAvailable ? "up" : "down"
  process.stdout.write(`news_workflow_monitor environment=${context.label} result=${success ? "pass" : "fail"} check=${checkSuccess ? "pass" : "fail"} check_status=${checkHttpStatus} language_tool=${languageToolState} dictionary=${dictionaryAvailable ? "up" : "down"} submission=${submissionSuccess ? "pass" : "fail"} submission_status=${submissionHttpStatus} submission_mmr=${submissionMmrPassed ? "pass" : "fail"} submission_date=${submissionDateSatisfied ? "pass" : "fail"} submission_state=${submissionState} submission_failed_fields=${submissionFailedFieldCount} cleanup=${cleanupSuccess ? "pass" : "fail"}\n`)
  return success
}

async function main() {
  try {
    process.exitCode = await runNewsWorkflowMonitor() ? 0 : 1
  } catch {
    process.stderr.write("news_workflow_monitor result=fail reason=configuration_or_metrics_error\n")
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
