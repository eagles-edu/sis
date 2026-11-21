import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { dictionary as cmuDictionary } from "cmu-pronouncing-dictionary"
import { closeSharedPrismaClient, getSharedPrismaClient } from "../src/infra/db/prisma-client.mjs"
import { resolveStandardStudentCredentials } from "../test/helpers/standard-portal-credentials.mjs"
import { renderKeepaliveCheckMetrics } from "../src/infra/observability/keepalive-check-metrics.mjs"
import { assertKeepaliveMonitorDatabase, resolveKeepaliveMonitorEnvironment } from "./keepalive-monitor-environment.mjs"

const METRICS_DIRECTORY = path.join(process.cwd(), "runtime-data/prometheus")
const CHECK_TIMEOUT_MS = 10000
const DICTIONARY_BUILDER_TIMEOUT_MS = 240000
const OPEN_REVIEW_STATUSES = ["pending_review", "legacy_pending_review"]
export const SYNTHETIC_VOCABULARY_CANDIDATES = Object.freeze([
  { english: "monitor", syllabication: "MON-i-tor" },
  { english: "canopy", syllabication: "CAN-o-py" },
  { english: "tomato", syllabication: "to-MA-to" },
  { english: "student", syllabication: "STU-dent" },
  { english: "parent", syllabication: "PAR-ent" },
  { english: "family", syllabication: "FAM-i-ly" },
  { english: "window", syllabication: "WIN-dow" },
  { english: "planet", syllabication: "PLAN-et" },
  { english: "garden", syllabication: "GAR-den" },
  { english: "button", syllabication: "BUT-ton" },
  { english: "pencil", syllabication: "PEN-cil" },
  { english: "lemon", syllabication: "LEM-on" },
  { english: "rabbit", syllabication: "RAB-bit" },
  { english: "ticket", syllabication: "TICK-et" },
  { english: "minute", syllabication: "MIN-ute" },
  { english: "market", syllabication: "MAR-ket" },
  { english: "sunset", syllabication: "SUN-set" },
  { english: "silver", syllabication: "SIL-ver" },
  { english: "river", syllabication: "RIV-er" },
  { english: "yellow", syllabication: "YEL-low" },
  { english: "flower", syllabication: "FLOW-er" },
  { english: "pocket", syllabication: "POCK-et" },
  { english: "basket", syllabication: "BAS-ket" },
])

export function assertMonitorEnvironment(environment = process.env) {
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

export function renderLibraryMetrics({
  environment = "dev",
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
  definitionSaveCheckSuccess,
  dictionaryBuilderCheckSuccess,
  dictionaryBuilderDefinitionProvidersAvailable,
  dictionaryBuilderDefinitionProvidersChecked,
  cleanupSuccess,
  openReviewCount,
  oldestOpenReviewAgeSeconds,
}) {
  const values = [
    ["sis_library_workflow_check_success", "Whether the latest Library workflow monitor passed.", success ? 1 : 0],
    ["sis_library_workflow_check_duration_seconds", "Duration of the latest Library workflow monitor.", durationSeconds],
    ["sis_library_workflow_last_check_timestamp_seconds", "Unix timestamp of the latest Library workflow monitor.", checkedAt],
    ["sis_library_workflow_last_success_timestamp_seconds", "Unix timestamp of the latest successful Library workflow monitor.", lastSuccessTimestamp],
    ["sis_library_api_available", "Whether the SIS health endpoint is available.", apiAvailable ? 1 : 0],
    ["sis_library_database_available", "Whether the Library database dependency is available.", databaseAvailable ? 1 : 0],
    ["sis_library_redis_available", "Whether the session Redis dependency is ready.", redisAvailable ? 1 : 0],
    ["sis_library_cmu_dictionary_available", "Whether the local CMU pronunciation dictionary is available.", cmuDictionaryAvailable ? 1 : 0],
    ["sis_library_mw_collegiate_key_configured", "Whether the Collegiate dictionary key is configured.", collegiateKeyConfigured ? 1 : 0],
    ["sis_library_mw_learners_key_configured", "Whether the Learners dictionary key is configured.", learnersKeyConfigured ? 1 : 0],
    ["sis_library_student_access_available", "Whether authenticated student Library access succeeded.", studentAccessAvailable ? 1 : 0],
    ["sis_library_admin_access_available", "Whether authenticated admin Library review access succeeded.", adminAccessAvailable ? 1 : 0],
    ["sis_library_save_check_success", "Whether a synthetic authenticated Library submission succeeded.", saveCheckSuccess ? 1 : 0],
    ["sis_library_review_check_success", "Whether a synthetic Library review and student result check succeeded.", reviewCheckSuccess ? 1 : 0],
    ["sis_library_definition_save_check_success", "Whether a synthetic Library definition was saved and matched after database readback.", definitionSaveCheckSuccess ? 1 : 0],
    ["sis_library_dictionary_builder_check_success", "Whether the authenticated Dictionary Builder provider check completed.", dictionaryBuilderCheckSuccess ? 1 : 0],
    ["sis_library_dictionary_builder_definition_providers_available", "Number of Dictionary Builder providers returning an available definition.", dictionaryBuilderDefinitionProvidersAvailable],
    ["sis_library_dictionary_builder_definition_providers_checked", "Number of Dictionary Builder providers checked for a definition.", dictionaryBuilderDefinitionProvidersChecked],
    ["sis_library_cleanup_success", "Whether the latest synthetic Library monitor records were removed.", cleanupSuccess ? 1 : 0],
    ["sis_library_open_review_contributions", "Number of Library contributions waiting for review.", openReviewCount],
    ["sis_library_oldest_open_review_age_seconds", "Age in seconds of the oldest Library contribution waiting for review.", oldestOpenReviewAgeSeconds],
  ]
  return values.flatMap(([name, help, value]) => [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    `${name}{environment="${environment}"} ${metricNumber(value)}`,
  ]).concat("").join("\n")
}

export function readLastSuccessTimestamp(metricsFile, environment = "dev") {
  if (!fs.existsSync(metricsFile)) return 0
  const contents = fs.readFileSync(metricsFile, "utf8")
  const match = contents.match(new RegExp(`^sis_library_workflow_last_success_timestamp_seconds\\{environment="${environment}"\\} ([0-9]+(?:\\.[0-9]+)?)$`, "mu"))
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

async function requestJson(fetchImpl, endpoint, { cookie = "", method = "GET", body, timeoutMs = CHECK_TIMEOUT_MS, origin = "http://127.0.0.1:8788" } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(`${origin}${endpoint}`, {
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

export function summarizeDictionaryBuilderDefinitionAvailability(preview) {
  const sources = Array.isArray(preview?.sources) ? preview.sources : []
  const statuses = sources
    .map((source) => source?.datumStatus?.definition?.status)
    .filter((status) => typeof status === "string" && status.length > 0 && status !== "not_offered")
  return {
    providersChecked: statuses.length,
    providersAvailable: statuses.filter((status) => status === "available").length,
  }
}

function sessionCookie(result, name) {
  if (!result.ok) return ""
  const match = result.setCookie.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`, "iu"))
  return match ? `${name}=${match[1]}` : ""
}

export function selectSyntheticVocabularyCandidate(existingKeys = [], dictionary = cmuDictionary, offset = 0) {
  const existing = new Set(existingKeys.map((key) => String(key || "").trim().toLocaleLowerCase("en-US")))
  const candidates = SYNTHETIC_VOCABULARY_CANDIDATES.filter((candidate) => Object.hasOwn(dictionary, candidate.english))
  if (!candidates.length) return null
  const start = Math.abs(Number.isInteger(offset) ? offset : 0) % candidates.length
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[(start + index) % candidates.length]
    if (!existing.has(candidate.english)) return candidate
  }
  return null
}

function libraryPayload(english, syllabication) {
  return {
    english,
    partOfSpeech: "noun",
    vietnamese: "monitor sample",
    syllabication,
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

export async function cleanupSynthetic(prisma, { studentRefId, sourceId, english, expectedCreatorName }) {
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
  if (english) {
    const entry = await prisma.libraryEntry.findUnique({
      where: { normalizedKey_partOfSpeech: { normalizedKey: english, partOfSpeech: "noun" } },
      select: { id: true, createdByName: true },
    })
    if (entry && ownsSyntheticEntry && entry.createdByName === expectedCreatorName) {
      await prisma.libraryEntryRevision.deleteMany({ where: { entryId: entry.id } })
      await prisma.libraryEntry.delete({ where: { id: entry.id } })
    }
  }
  const [remainingContributions, remainingEntry] = await Promise.all([
    studentRefId && sourceId
      ? prisma.libraryContribution.count({ where: { studentRefId, sourceKind: "student_new_words", sourceId } })
      : 0,
    english
      ? prisma.libraryEntry.findUnique({ where: { normalizedKey_partOfSpeech: { normalizedKey: english, partOfSpeech: "noun" } }, select: { id: true } })
      : null,
  ])
  return remainingContributions === 0 && !remainingEntry
}

export async function runLibraryWorkflowMonitor({
  environment = process.env,
  metricsFile = "",
  prismaClient = null,
  fetchImpl = fetch,
  clock = () => Date.now(),
} = {}) {
  const context = assertMonitorEnvironment(environment)
  metricsFile ||= path.join(METRICS_DIRECTORY, `library-workflow-${context.label}.prom`)
  const request = (endpoint, options = {}) => requestJson(fetchImpl, endpoint, { ...options, origin: context.origin })
  const started = clock()
  const prisma = prismaClient || await getSharedPrismaClient()
  const studentCredentials = resolveStandardStudentCredentials(environment)
  const adminUsername = String(environment.STUDENT_ADMIN_USER || "").trim()
  const adminPassword = String(environment.STUDENT_ADMIN_PASS || "")
  const stamp = randomUUID().replaceAll("-", "")
  const sourceId = `library-monitor-${stamp}`
  let english = ""
  let syllabication = ""
  let studentRefId = ""
  let apiAvailable = false
  let databaseAvailable = false
  let redisAvailable = false
  let cmuDictionaryAvailable = false
  let studentAccessAvailable = false
  let adminAccessAvailable = false
  let saveCheckSuccess = false
  let reviewCheckSuccess = false
  let definitionSaveCheckSuccess = false
  let dictionaryBuilderCheckSuccess = false
  let dictionaryBuilderDefinitionProvidersAvailable = 0
  let dictionaryBuilderDefinitionProvidersChecked = 0
  let cleanupSuccess = true
  let openReviewCount = 0
  let oldestOpenReviewAgeSeconds = 0
  let failure = false

  try {
    await assertKeepaliveMonitorDatabase(prisma, context)
    databaseAvailable = true
    const student = await prisma.student.findUnique({ where: { eaglesId: studentCredentials.user }, select: { id: true } })
    if (!student?.id || !studentCredentials.pass) throw new Error("Standard student account unavailable")
    studentRefId = student.id
    const candidateWords = SYNTHETIC_VOCABULARY_CANDIDATES.map(({ english: word }) => word)
    const existingEntries = await prisma.libraryEntry.findMany({
      where: { normalizedKey: { in: candidateWords }, partOfSpeech: "noun" },
      select: { normalizedKey: true },
    })
    const candidate = selectSyntheticVocabularyCandidate(
      existingEntries.map((entry) => entry.normalizedKey),
      cmuDictionary,
      Number.parseInt(stamp.slice(0, 8), 16),
    )
    if (!candidate) throw new Error("No unused validated synthetic Library word is available")
    english = candidate.english
    syllabication = candidate.syllabication
    const queue = await collectQueueMetrics(prisma, clock())
    openReviewCount = queue.openReviewCount
    oldestOpenReviewAgeSeconds = queue.oldestOpenReviewAgeSeconds

    const health = await request("/healthz")
    apiAvailable = health.ok && health.payload?.status === "ok"
    redisAvailable = Boolean(
      health.payload?.studentAdminRuntime?.sessionRedis?.redisConnected &&
      health.payload?.studentAdminRuntime?.sessionRedis?.redisReady,
    )
    cmuDictionaryAvailable = Object.keys(cmuDictionary || {}).length > 0

    const adminLogin = await request("/api/admin/auth/login", {
      method: "POST",
      body: { username: adminUsername, password: adminPassword },
    })
    const adminCookie = sessionCookie(adminLogin, "student_admin_sid")
    const studentLogin = await request("/api/student/auth/login", {
      method: "POST",
      body: { eaglesId: studentCredentials.user, password: studentCredentials.pass },
    })
    const studentCookie = sessionCookie(studentLogin, "student_portal_sid")

    const builderPreview = adminCookie
      ? await request("/api/admin/library/entries/new-canonical/dictionary-builder/preview", {
        cookie: adminCookie,
        method: "POST",
        body: { entry: { english: "monitor", partOfSpeech: "noun" } },
        timeoutMs: DICTIONARY_BUILDER_TIMEOUT_MS,
      })
      : { ok: false, payload: {} }
    const builderAvailability = summarizeDictionaryBuilderDefinitionAvailability(builderPreview.payload)
    dictionaryBuilderDefinitionProvidersAvailable = builderAvailability.providersAvailable
    dictionaryBuilderDefinitionProvidersChecked = builderAvailability.providersChecked
    dictionaryBuilderCheckSuccess = builderPreview.ok && Boolean(builderPreview.payload?.id) && builderAvailability.providersChecked > 0

    const adminQueue = adminCookie
      ? await request("/api/admin/library/queue?status=open_review", { cookie: adminCookie })
      : { ok: false, payload: {} }
    const studentLibrary = studentCookie
      ? await request(`/api/student/library?search=${encodeURIComponent(english)}&myWords=true`, { cookie: studentCookie })
      : { ok: false, payload: {} }
    adminAccessAvailable = adminQueue.ok && Array.isArray(adminQueue.payload?.items)
    studentAccessAvailable = studentLibrary.ok && Array.isArray(studentLibrary.payload?.items)
    if (!adminAccessAvailable || !studentAccessAvailable || !apiAvailable || !redisAvailable || !cmuDictionaryAvailable) {
      throw new Error("A required Library access dependency is unavailable")
    }

    const payload = libraryPayload(english, syllabication)
    const saved = await request("/api/student/library/submissions", {
      cookie: studentCookie,
      method: "POST",
      body: { sourceId, entry: payload },
    })
    const contributionId = String(saved.payload?.contribution?.id || "")
    saveCheckSuccess = saved.status === 201 && Boolean(contributionId) && saved.payload?.contribution?.status === "pending_review"
    if (!saveCheckSuccess) throw new Error("Synthetic Library save failed")

    const reviewed = await request(`/api/admin/library/contributions/${encodeURIComponent(contributionId)}/review`, {
      cookie: adminCookie,
      method: "POST",
      body: { approved: true, canonicalContributionId: contributionId, entry: payload },
    })
    const persistedEntry = await prisma.libraryEntry.findUnique({
      where: { normalizedKey_partOfSpeech: { normalizedKey: english.toLowerCase(), partOfSpeech: "noun" } },
      select: { definition: true },
    })
    definitionSaveCheckSuccess = reviewed.ok && reviewed.payload?.ok === true && persistedEntry?.definition === payload.definition
    const result = studentCookie
      ? await request(`/api/student/library?search=${encodeURIComponent(english)}&myWords=true`, { cookie: studentCookie })
      : { ok: false, payload: {} }
    reviewCheckSuccess = reviewed.ok && reviewed.payload?.ok === true && result.ok && result.payload?.items?.some((item) => item.english === english && item.isContribution !== true)
    if (!reviewCheckSuccess) throw new Error("Synthetic Library review result failed")
    if (!definitionSaveCheckSuccess) throw new Error("Synthetic Library definition persistence check failed")
  } catch {
    failure = true
  } finally {
    try {
      cleanupSuccess = await cleanupSynthetic(prisma, { studentRefId, sourceId, english, expectedCreatorName: adminUsername })
      if (!cleanupSuccess) failure = true
    } catch {
      cleanupSuccess = false
      failure = true
    }
    if (!prismaClient) await closeSharedPrismaClient()
  }

  const checkedAt = clock() / 1000
  const success = !failure && apiAvailable && databaseAvailable && redisAvailable && cmuDictionaryAvailable && studentAccessAvailable && adminAccessAvailable && saveCheckSuccess && reviewCheckSuccess && definitionSaveCheckSuccess && dictionaryBuilderCheckSuccess && dictionaryBuilderDefinitionProvidersAvailable > 0 && cleanupSuccess
  const lastSuccessTimestamp = success ? checkedAt : readLastSuccessTimestamp(metricsFile, context.label)
  const durationSeconds = (clock() - started) / 1000
  const studentLibrarySuccess = !failure && apiAvailable && databaseAvailable && redisAvailable && cmuDictionaryAvailable && studentAccessAvailable && adminAccessAvailable && saveCheckSuccess && reviewCheckSuccess && definitionSaveCheckSuccess && cleanupSuccess
  const dictionaryBuilderSuccess = dictionaryBuilderCheckSuccess && dictionaryBuilderDefinitionProvidersAvailable > 0
  const groupMetrics = renderKeepaliveCheckMetrics({
    environment: context.label,
    checkedAt,
    previousMetrics: fs.existsSync(metricsFile) ? fs.readFileSync(metricsFile, "utf8") : "",
    results: {
      student_library: {
        success: studentLibrarySuccess,
        durationSeconds,
        failureCode: cleanupSuccess ? (apiAvailable && databaseAvailable ? "workflow_failed" : "dependency_unavailable") : "cleanup_failed",
      },
      dictionary_builder: {
        success: dictionaryBuilderSuccess,
        durationSeconds,
        failureCode: dictionaryBuilderCheckSuccess ? "workflow_failed" : "dependency_unavailable",
      },
    },
  })
  const metrics = renderLibraryMetrics({
    environment: context.label,
    checkedAt,
    durationSeconds,
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
    definitionSaveCheckSuccess,
    dictionaryBuilderCheckSuccess,
    dictionaryBuilderDefinitionProvidersAvailable,
    dictionaryBuilderDefinitionProvidersChecked,
    cleanupSuccess,
    openReviewCount,
    oldestOpenReviewAgeSeconds,
  }) + groupMetrics
  writeMetricsAtomically(metricsFile, metrics)
  process.stdout.write(`library_workflow_monitor environment=${context.label} result=${success ? "pass" : "fail"} student_access=${studentAccessAvailable ? "up" : "down"} admin_access=${adminAccessAvailable ? "up" : "down"} save=${saveCheckSuccess ? "pass" : "fail"} definition_save=${definitionSaveCheckSuccess ? "pass" : "fail"} builder_check=${dictionaryBuilderCheckSuccess ? "pass" : "fail"} definition_providers=${dictionaryBuilderDefinitionProvidersAvailable}/${dictionaryBuilderDefinitionProvidersChecked} review=${reviewCheckSuccess ? "pass" : "fail"} cleanup=${cleanupSuccess ? "pass" : "fail"}\n`)
  return success
}

async function main() {
  try {
    process.exitCode = await runLibraryWorkflowMonitor() ? 0 : 1
  } catch {
    process.stderr.write("library_workflow_monitor result=fail reason=configuration_or_metrics_error\n")
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
