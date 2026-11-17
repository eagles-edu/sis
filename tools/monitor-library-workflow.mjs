import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { closeSharedPrismaClient, getSharedPrismaClient } from "../src/infra/db/prisma-client.mjs"
import { resolveStandardStudentCredentials } from "../test/helpers/standard-portal-credentials.mjs"

const DEV_ORIGIN = "http://127.0.0.1:8788"
const METRICS_FILE = path.join(process.cwd(), "runtime-data/prometheus/library-workflow-dev.prom")
const CHECK_TIMEOUT_MS = 10000
const OPEN_REVIEW_STATUSES = ["pending_review", "legacy_pending_review"]

export function assertDevEnvironment(environment = process.env) {
  if (
    String(environment.NODE_ENV || "").trim() !== "development" ||
    String(environment.SIS_ENV_FILE || "").trim() !== ".env.dev" ||
    String(environment.DOTENV_CONFIG_PATH || "").trim() !== ".env.dev"
  ) throw new Error("Library workflow monitor requires the explicit development environment")
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

export function renderLibraryMetrics({
  checkedAt,
  durationSeconds,
  success,
  lastSuccessTimestamp,
  apiAvailable,
  databaseAvailable,
  redisAvailable,
  cmuDictionaryAvailable,
  collegiateKeyConfigured,
  learnersKeyConfigured,
  studentAccessAvailable,
  adminAccessAvailable,
  saveCheckSuccess,
  reviewCheckSuccess,
  cleanupSuccess,
  openReviewCount,
  oldestOpenReviewAgeSeconds,
}) {
  const values = [
    ["sis_library_workflow_check_success", "Whether the latest dev Library workflow monitor passed.", success ? 1 : 0],
    ["sis_library_workflow_check_duration_seconds", "Duration of the latest dev Library workflow monitor.", durationSeconds],
    ["sis_library_workflow_last_check_timestamp_seconds", "Unix timestamp of the latest dev Library workflow monitor.", checkedAt],
    ["sis_library_workflow_last_success_timestamp_seconds", "Unix timestamp of the latest successful dev Library workflow monitor.", lastSuccessTimestamp],
    ["sis_library_api_available", "Whether the dev SIS health endpoint is available.", apiAvailable ? 1 : 0],
    ["sis_library_database_available", "Whether the dev Library database dependency is available.", databaseAvailable ? 1 : 0],
    ["sis_library_redis_available", "Whether the dev session Redis dependency is ready.", redisAvailable ? 1 : 0],
    ["sis_library_cmu_dictionary_available", "Whether the local CMU pronunciation dictionary is available.", cmuDictionaryAvailable ? 1 : 0],
    ["sis_library_mw_collegiate_key_configured", "Whether the dev Collegiate dictionary key is configured.", collegiateKeyConfigured ? 1 : 0],
    ["sis_library_mw_learners_key_configured", "Whether the dev Learners dictionary key is configured.", learnersKeyConfigured ? 1 : 0],
    ["sis_library_student_access_available", "Whether authenticated dev student Library access succeeded.", studentAccessAvailable ? 1 : 0],
    ["sis_library_admin_access_available", "Whether authenticated dev admin Library review access succeeded.", adminAccessAvailable ? 1 : 0],
    ["sis_library_save_check_success", "Whether a synthetic authenticated dev Library submission succeeded.", saveCheckSuccess ? 1 : 0],
    ["sis_library_review_check_success", "Whether a synthetic dev Library review and student result check succeeded.", reviewCheckSuccess ? 1 : 0],
    ["sis_library_cleanup_success", "Whether the latest synthetic dev Library monitor records were removed.", cleanupSuccess ? 1 : 0],
    ["sis_library_open_review_contributions", "Number of dev Library contributions waiting for review.", openReviewCount],
    ["sis_library_oldest_open_review_age_seconds", "Age in seconds of the oldest dev Library contribution waiting for review.", oldestOpenReviewAgeSeconds],
  ]
  return values.flatMap(([name, help, value]) => [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    `${name}{environment="dev"} ${metricNumber(value)}`,
  ]).concat("").join("\n")
}

export function readLastSuccessTimestamp(metricsFile) {
  if (!fs.existsSync(metricsFile)) return 0
  const contents = fs.readFileSync(metricsFile, "utf8")
  const match = contents.match(/^sis_library_workflow_last_success_timestamp_seconds\{environment="dev"\} ([0-9]+(?:\.[0-9]+)?)$/mu)
  return match ? Number(match[1]) : 0
}

export function writeMetricsAtomically(metricsFile, contents) {
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

async function requestJson(fetchImpl, endpoint, { cookie = "", method = "GET", body } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  try {
    const response = await fetchImpl(`${DEV_ORIGIN}${endpoint}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({}))
    return { ok: response.ok, status: response.status, payload, setCookie: response.headers.get("set-cookie") || "" }
  } finally {
    clearTimeout(timeout)
  }
}

function sessionCookie(result, name) {
  if (!result.ok) return ""
  const match = result.setCookie.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`, "iu"))
  return match ? `${name}=${match[1]}` : ""
}

function libraryPayload(english) {
  return {
    english,
    partOfSpeech: "noun",
    vietnamese: "monitor sample",
    syllabication: english,
    definition: "Synthetic monitor contribution used to check Library saving and review.",
    countability: "countable",
    nounType: "common",
    nounNumber: "singular",
    physicalQuality: "concrete",
    grammaticalNumber: "singular",
    primaryClassification: "common",
  }
}

async function collectQueueMetrics(prisma, now) {
  const where = { status: { in: OPEN_REVIEW_STATUSES } }
  const [openReviewCount, oldestOpenReview] = await Promise.all([
    prisma.libraryContribution.count({ where }),
    prisma.libraryContribution.findFirst({ where, orderBy: { submittedAt: "asc" }, select: { submittedAt: true } }),
  ])
  const oldestSubmittedAt = timestampSeconds(oldestOpenReview?.submittedAt)
  return {
    openReviewCount,
    oldestOpenReviewAgeSeconds: oldestSubmittedAt ? Math.max(0, now / 1000 - oldestSubmittedAt) : 0,
  }
}

async function cleanupSynthetic(prisma, { studentRefId, sourceId, english, expectedCreatorName }) {
  let ownsSyntheticEntry = false
  if (studentRefId && sourceId) {
    const contributions = await prisma.libraryContribution.findMany({
      where: { studentRefId, sourceKind: "student_new_words", sourceId },
      select: { id: true },
    })
    const contributionIds = contributions.map((contribution) => contribution.id)
    if (contributionIds.length) {
      ownsSyntheticEntry = true
      await prisma.libraryContributionRevision.deleteMany({ where: { contributionId: { in: contributionIds } } })
      await prisma.libraryContribution.deleteMany({ where: { id: { in: contributionIds } } })
    }
  }
  if (ownsSyntheticEntry && english) {
    const entry = await prisma.libraryEntry.findUnique({
      where: { normalizedKey_partOfSpeech: { normalizedKey: english, partOfSpeech: "noun" } },
      select: { id: true, createdByName: true },
    })
    if (entry?.createdByName === expectedCreatorName) {
      await prisma.libraryEntryRevision.deleteMany({ where: { entryId: entry.id } })
      await prisma.libraryEntry.delete({ where: { id: entry.id } })
    }
  }
}

export async function runLibraryWorkflowMonitor({
  environment = process.env,
  metricsFile = METRICS_FILE,
  prismaClient = null,
  fetchImpl = fetch,
  clock = () => Date.now(),
} = {}) {
  assertDevEnvironment(environment)
  const started = clock()
  const prisma = prismaClient || await getSharedPrismaClient()
  const studentCredentials = resolveStandardStudentCredentials(environment)
  const adminUsername = String(environment.STUDENT_ADMIN_USER || "").trim()
  const adminPassword = String(environment.STUDENT_ADMIN_PASS || "")
  const stamp = randomUUID().replaceAll("-", "")
  const english = `librarymonitor${stamp}`
  const sourceId = `library-monitor-${stamp}`
  let studentRefId = ""
  let apiAvailable = false
  let databaseAvailable = false
  let redisAvailable = false
  let cmuDictionaryAvailable = false
  let studentAccessAvailable = false
  let adminAccessAvailable = false
  let saveCheckSuccess = false
  let reviewCheckSuccess = false
  let cleanupSuccess = true
  let openReviewCount = 0
  let oldestOpenReviewAgeSeconds = 0
  let failure = false

  try {
    const database = await prisma.$queryRaw`SELECT current_database() AS name`
    databaseAvailable = database[0]?.name === "sis_dev"
    if (!databaseAvailable) throw new Error("Unexpected database")
    const student = await prisma.student.findUnique({ where: { eaglesId: studentCredentials.user }, select: { id: true } })
    if (!student?.id || !studentCredentials.pass) throw new Error("Standard student account unavailable")
    studentRefId = student.id
    const existingEntry = await prisma.libraryEntry.findUnique({
      where: { normalizedKey_partOfSpeech: { normalizedKey: english, partOfSpeech: "noun" } },
      select: { id: true },
    })
    if (existingEntry) throw new Error("Synthetic monitor key already exists")
    const queue = await collectQueueMetrics(prisma, clock())
    openReviewCount = queue.openReviewCount
    oldestOpenReviewAgeSeconds = queue.oldestOpenReviewAgeSeconds

    const health = await requestJson(fetchImpl, "/healthz")
    apiAvailable = health.ok && health.payload?.status === "ok"
    redisAvailable = Boolean(
      health.payload?.studentAdminRuntime?.sessionRedis?.redisConnected &&
      health.payload?.studentAdminRuntime?.sessionRedis?.redisReady,
    )
    const dictionaryModule = await import("cmu-pronouncing-dictionary")
    cmuDictionaryAvailable = Object.keys(dictionaryModule.dictionary || {}).length > 0

    const adminLogin = await requestJson(fetchImpl, "/api/admin/auth/login", {
      method: "POST",
      body: { username: adminUsername, password: adminPassword },
    })
    const adminCookie = sessionCookie(adminLogin, "student_admin_sid")
    const studentLogin = await requestJson(fetchImpl, "/api/student/auth/login", {
      method: "POST",
      body: { eaglesId: studentCredentials.user, password: studentCredentials.pass },
    })
    const studentCookie = sessionCookie(studentLogin, "student_portal_sid")

    const adminQueue = adminCookie
      ? await requestJson(fetchImpl, "/api/admin/library/queue?status=open_review", { cookie: adminCookie })
      : { ok: false, payload: {} }
    const studentLibrary = studentCookie
      ? await requestJson(fetchImpl, `/api/student/library?search=${encodeURIComponent(english)}&myWords=true`, { cookie: studentCookie })
      : { ok: false, payload: {} }
    adminAccessAvailable = adminQueue.ok && Array.isArray(adminQueue.payload?.items)
    studentAccessAvailable = studentLibrary.ok && Array.isArray(studentLibrary.payload?.items)
    if (!adminAccessAvailable || !studentAccessAvailable || !apiAvailable || !redisAvailable || !cmuDictionaryAvailable) {
      throw new Error("A required Library access dependency is unavailable")
    }

    const payload = libraryPayload(english)
    const saved = await requestJson(fetchImpl, "/api/student/library/submissions", {
      cookie: studentCookie,
      method: "POST",
      body: { sourceId, entry: payload },
    })
    const contributionId = String(saved.payload?.contribution?.id || "")
    saveCheckSuccess = saved.status === 201 && Boolean(contributionId) && saved.payload?.contribution?.status === "pending_review"
    if (!saveCheckSuccess) throw new Error("Synthetic Library save failed")

    const reviewed = await requestJson(fetchImpl, `/api/admin/library/contributions/${encodeURIComponent(contributionId)}/review`, {
      cookie: adminCookie,
      method: "POST",
      body: { approved: true, canonicalContributionId: contributionId, entry: payload },
    })
    const result = studentCookie
      ? await requestJson(fetchImpl, `/api/student/library?search=${encodeURIComponent(english)}&myWords=true`, { cookie: studentCookie })
      : { ok: false, payload: {} }
    reviewCheckSuccess = reviewed.ok && reviewed.payload?.ok === true && result.ok && result.payload?.items?.some((item) => item.english === english && item.isContribution !== true)
    if (!reviewCheckSuccess) throw new Error("Synthetic Library review result failed")
  } catch {
    failure = true
  } finally {
    try {
      await cleanupSynthetic(prisma, { studentRefId, sourceId, english, expectedCreatorName: adminUsername })
    } catch {
      cleanupSuccess = false
      failure = true
    }
    if (!prismaClient) await closeSharedPrismaClient()
  }

  const checkedAt = clock() / 1000
  const success = !failure && apiAvailable && databaseAvailable && redisAvailable && cmuDictionaryAvailable && studentAccessAvailable && adminAccessAvailable && saveCheckSuccess && reviewCheckSuccess && cleanupSuccess
  const lastSuccessTimestamp = success ? checkedAt : readLastSuccessTimestamp(metricsFile)
  const metrics = renderLibraryMetrics({
    checkedAt,
    durationSeconds: (clock() - started) / 1000,
    success,
    lastSuccessTimestamp,
    apiAvailable,
    databaseAvailable,
    redisAvailable,
    cmuDictionaryAvailable,
    collegiateKeyConfigured: Boolean(String(environment.MERRIAM_WEBSTER_COLLEGIATE_API_KEY || "").trim()),
    learnersKeyConfigured: Boolean(String(environment.MERRIAM_WEBSTER_LEARNERS_API_KEY || "").trim()),
    studentAccessAvailable,
    adminAccessAvailable,
    saveCheckSuccess,
    reviewCheckSuccess,
    cleanupSuccess,
    openReviewCount,
    oldestOpenReviewAgeSeconds,
  })
  writeMetricsAtomically(metricsFile, metrics)
  process.stdout.write(`library_workflow_monitor environment=dev result=${success ? "pass" : "fail"} student_access=${studentAccessAvailable ? "up" : "down"} admin_access=${adminAccessAvailable ? "up" : "down"} save=${saveCheckSuccess ? "pass" : "fail"} review=${reviewCheckSuccess ? "pass" : "fail"} cleanup=${cleanupSuccess ? "pass" : "fail"}\n`)
  return success
}

async function main() {
  try {
    process.exitCode = await runLibraryWorkflowMonitor() ? 0 : 1
  } catch {
    process.stderr.write("library_workflow_monitor environment=dev result=fail reason=configuration_or_metrics_error\n")
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
