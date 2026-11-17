import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { closeSharedPrismaClient, getSharedPrismaClient } from "../src/infra/db/prisma-client.mjs"
import { validateVocabularyEntry } from "../src/modules/admin/vocabulary-syllabication.mjs"
import { resolveStandardStudentCredentials } from "../test/helpers/standard-portal-credentials.mjs"

const DEV_ORIGIN = "http://127.0.0.1:8788"
const METRICS_FILE = path.join(process.cwd(), "runtime-data/prometheus/news-workflow-dev.prom")
const OPEN_REVIEW_STATUSES = ["submitted", "revision-requested"]
const REQUEST_TIMEOUT_MS = 20000

export function assertNewsMonitorDevEnvironment(environment = process.env) {
  if (
    String(environment.NODE_ENV || "").trim() !== "development" ||
    String(environment.SIS_ENV_FILE || "").trim() !== ".env.dev" ||
    String(environment.DOTENV_CONFIG_PATH || "").trim() !== ".env.dev"
  ) throw new Error("News workflow monitor requires the explicit development environment")
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
  checkedAt,
  durationSeconds,
  checkDurationSeconds,
  checkSuccess,
  languageToolAvailable,
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
    ["sis_news_workflow_check_success", "Whether the latest dev News workflow monitor passed.", checkSuccess ? 1 : 0],
    ["sis_news_workflow_check_duration_seconds", "Duration of the latest dev News workflow monitor.", durationSeconds],
    ["sis_news_workflow_last_check_timestamp_seconds", "Unix timestamp of the latest dev News workflow monitor.", checkedAt],
    ["sis_news_workflow_last_success_timestamp_seconds", "Unix timestamp of the latest successful dev News workflow monitor.", lastSuccessTimestamp],
    ["sis_news_api_available", "Whether the dev SIS health endpoint is available.", apiAvailable ? 1 : 0],
    ["sis_news_database_available", "Whether the SIS dev database is available.", databaseAvailable ? 1 : 0],
    ["sis_news_check_success", "Whether the authenticated synthetic Student News Check passed.", checkSuccess ? 1 : 0],
    ["sis_news_check_duration_seconds", "Duration of the authenticated synthetic Student News Check.", checkDurationSeconds],
    ["sis_news_language_tool_available", "Whether LanguageTool completed during the dev News Check.", languageToolAvailable ? 1 : 0],
    ["sis_news_dictionary_available", "Whether the Merriam-Webster-backed vocabulary check was reachable in dev.", dictionaryAvailable ? 1 : 0],
    ["sis_news_submission_success", "Whether the authenticated synthetic Student News submission succeeded.", submissionSuccess ? 1 : 0],
    ["sis_news_submission_failure", "Whether the latest authenticated synthetic Student News submission failed.", submissionSuccess ? 0 : 1],
    ["sis_news_submission_http_status", "HTTP status returned by the latest synthetic Student News submission request.", submissionHttpStatus],
    ["sis_news_cleanup_success", "Whether the synthetic dev Student News report was removed and verified.", cleanupSuccess ? 1 : 0],
    ["sis_news_open_review_reports", "Number of submitted dev Student News reports awaiting review.", openReviewCount],
    ["sis_news_oldest_open_review_age_seconds", "Age in seconds of the oldest submitted dev Student News report awaiting review.", oldestOpenReviewAgeSeconds],
  ]
  return values.flatMap(([name, help, value]) => [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    `${name}{environment="dev"} ${metricNumber(value)}`,
  ]).concat("").join("\n")
}

function readLastSuccessTimestamp(metricsFile) {
  if (!fs.existsSync(metricsFile)) return 0
  const contents = fs.readFileSync(metricsFile, "utf8")
  const match = contents.match(/^sis_news_workflow_last_success_timestamp_seconds\{environment="dev"\} ([0-9]+(?:\.[0-9]+)?)$/mu)
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

async function requestJson(fetchImpl, endpoint, { cookie = "", body } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const started = performance.now()
  try {
    const response = await fetchImpl(`${DEV_ORIGIN}${endpoint}`, {
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

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
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

function languageToolSucceeded(payload) {
  if (!payload || typeof payload !== "object") return false
  const reports = payload.validation?.sentenceReports
  if (!reports || typeof reports !== "object") return false
  const statuses = Object.values(reports).map((report) => report?.languageToolStatus).filter(Boolean)
  return statuses.length > 0 && statuses.every((status) => status === "completed" || status === "disabled")
}

export async function runNewsWorkflowMonitor({
  environment = process.env,
  metricsFile = METRICS_FILE,
  prismaClient = null,
  fetchImpl = fetch,
  clock = () => Date.now(),
} = {}) {
  assertNewsMonitorDevEnvironment(environment)
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
    const database = await prisma.$queryRaw`SELECT current_database() AS name`
    databaseAvailable = database[0]?.name === "sis_dev"
    if (!databaseAvailable) throw new Error("Unexpected database")
    const student = await prisma.student.findUnique({ where: { eaglesId: studentCredentials.user }, select: { id: true } })
    if (!student?.id || !studentCredentials.pass || !adminUsername || !adminPassword) throw new Error("Configured dev accounts unavailable")
    studentRefId = student.id
    const queue = await collectQueueMetrics(prisma, clock())
    openReviewCount = queue.openReviewCount
    oldestOpenReviewAgeSeconds = queue.oldestOpenReviewAgeSeconds

    const health = await requestJson(fetchImpl, "/healthz")
    apiAvailable = health.ok && health.payload?.status === "ok"
    if (!apiAvailable) throw new Error("Dev SIS API unavailable")

    const dictionaryProbe = await validateVocabularyEntry({ english: "computer", syllabication: "com-PUT-er" })
    dictionaryAvailable = !dictionaryProbe.warning

    const adminLogin = await requestJson(fetchImpl, "/api/admin/auth/login", {
      body: { username: adminUsername, password: adminPassword },
    })
    const adminCookie = sessionCookie(adminLogin, "student_admin_sid")
    const studentLogin = await requestJson(fetchImpl, "/api/student/auth/login", {
      body: { eaglesId: studentCredentials.user, password: studentCredentials.pass },
    })
    const studentCookie = sessionCookie(studentLogin, "student_portal_sid")
    if (!adminCookie || !studentCookie) throw new Error("Authenticated dev monitor session unavailable")
    const adminQueue = await requestJson(fetchImpl, "/api/admin/news-reports?status=all&take=1", { cookie: adminCookie })
    if (!adminQueue.ok || !Array.isArray(adminQueue.payload?.items)) throw new Error("Authenticated dev News review access unavailable")

    const report = syntheticReport(localDateKey(new Date(clock())), sourceLink, articleTitle)
    const checked = await requestJson(fetchImpl, "/api/student/news-reports/check", { cookie: studentCookie, body: report })
    checkDurationSeconds = checked.durationSeconds
    reportId = String(checked.payload?.item?.id || "").trim()
    checkSuccess = checked.ok && checked.payload?.saved === true && checked.payload?.mmrPassed === true && Boolean(reportId)
    languageToolAvailable = checked.ok && languageToolSucceeded(checked.payload)
    if (!checkSuccess) throw new Error("Synthetic News Check failed")
    report.reportId = reportId
    const submitted = await requestJson(fetchImpl, "/api/student/news-reports", { cookie: studentCookie, body: report })
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
  const metrics = renderNewsWorkflowMetrics({
    checkedAt,
    durationSeconds: (clock() - started) / 1000,
    checkDurationSeconds,
    checkSuccess,
    languageToolAvailable,
    dictionaryAvailable,
    submissionSuccess,
    submissionHttpStatus,
    cleanupSuccess,
    apiAvailable,
    databaseAvailable,
    openReviewCount,
    oldestOpenReviewAgeSeconds,
    lastSuccessTimestamp: success ? checkedAt : readLastSuccessTimestamp(metricsFile),
  })
  writeNewsMetricsAtomically(metricsFile, metrics)
  process.stdout.write(`news_workflow_monitor environment=dev result=${success ? "pass" : "fail"} check=${checkSuccess ? "pass" : "fail"} language_tool=${languageToolAvailable ? "up" : "down"} dictionary=${dictionaryAvailable ? "up" : "down"} submission=${submissionSuccess ? "pass" : "fail"} submission_status=${submissionHttpStatus} submission_mmr=${submissionMmrPassed ? "pass" : "fail"} submission_date=${submissionDateSatisfied ? "pass" : "fail"} submission_state=${submissionState} submission_failed_fields=${submissionFailedFieldCount} cleanup=${cleanupSuccess ? "pass" : "fail"}\n`)
  return success
}

async function main() {
  try {
    process.exitCode = await runNewsWorkflowMonitor() ? 0 : 1
  } catch {
    process.stderr.write("news_workflow_monitor environment=dev result=fail reason=configuration_or_metrics_error\n")
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
