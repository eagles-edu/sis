// @ts-check
// server/exercise-mailer.mjs
import { createRequire } from "node:module"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { URL, fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const isDebugEnabled = () =>
  String(process.env.MAILER_DEBUG || "")
    .trim()
    .toLowerCase() === "true"

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeEnvText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

/** @param {unknown} value @returns {string} */
function normalizeLower(value) {
  return normalizeEnvText(value).toLowerCase()
}

function resolveDefaultEnvFilePath() {
  const explicitPath = normalizeEnvText(process.env.SIS_ENV_FILE)
  if (explicitPath) return path.resolve(process.cwd(), explicitPath)
  const nodeEnv = normalizeEnvText(process.env.NODE_ENV).toLowerCase()
  if (nodeEnv === "development") return path.resolve(process.cwd(), ".env.dev")
  if (nodeEnv === "test") return path.resolve(process.cwd(), ".env.test")
  return path.resolve(process.cwd(), ".env")
}

function loadEnvironmentFile() {
  let dotenv
  try {
    const mod = require("dotenv")
    dotenv = mod
  } catch (error) {
    const err = /** @type {StatusError} */ (error)
    if (err && err.code !== "MODULE_NOT_FOUND") throw error
    if (isDebugEnabled()) {
      console.warn("ℹ️  Optional dependency 'dotenv' not found; continuing without loading env file")
    }
    return ""
  }

  const envFilePath = resolveDefaultEnvFilePath()
  if (!fs.existsSync(envFilePath)) {
    if (isDebugEnabled()) {
      console.warn(`ℹ️  Env file not found at ${envFilePath}; continuing with process environment`)
    }
    return ""
  }

  const result = dotenv.config({ path: envFilePath })
  const loadResult = /** @type {{ error?: StatusError }} */ (result)
  if (loadResult?.error && loadResult.error.code !== "ENOENT") {
    throw loadResult.error
  }
  return envFilePath
}

loadEnvironmentFile()

/**
 * @typedef {import("node:http").IncomingMessage & {
 *   headers: Record<string, string | string[] | undefined>
 *   method?: string | null
 *   url?: string | null
 *   destroy: () => void
 * }} MailerRequest
 *
 * @typedef {import("node:http").ServerResponse} MailerResponse
 *
 * @typedef {{
 *   code?: string
 *   message?: string
 *   statusCode?: number
 * }} StatusError
 *
 * @typedef {{
 *   sourceSystem?: string
 *   sourceAttemptId?: string
 *   attemptId?: string
 *   quizAttemptId?: string
 *   moodleAttemptId?: string
 *   eaglesId?: string
 *   email?: string
 *   pageTitle?: string
 *   completedAt?: string
 *   correctCount?: number | string
 *   pendingCount?: number | string
 *   incorrectCount?: number | string
 *   totalQuestions?: number | string
 *   scorePercent?: number | string
 *   recipients?: unknown[]
 *   fields?: Record<string, unknown>
 *   cf?: Record<string, unknown>
 *   form?: Record<string, unknown>
 *   data?: Record<string, unknown>
 *   sourceFormId?: string
 *   sourceUrl?: string
 *   sourcePageUrl?: string
 *   sourceOrigin?: string
 *   sourceOriginLabel?: string
 *   sourceOriginHost?: string
 *   assignmentBundleJson?: unknown
 *   assignmentTemplateId?: string
 *   assignmentTemplateItemId?: string
 *   assignmentTitle?: string
 *   assignmentItemTitle?: string
 *   assignmentExerciseUrl?: string
 *   assignedAt?: string
 *   dueAt?: string
 *   level?: string
 *   submittedAt?: string
 *   [key: string]: unknown
 * }} SubmissionPayload
 *
 * @typedef {{
 *   eaglesId: string
 *   email: string
 *   sourceSystem: string
 *   sourceAttemptId: string
 *   pageTitle: string
 *   completedAt: string
 *   recipients: string[]
 *   correctCount: number
 *   pendingCount: number
 *   incorrectCount: number
 *   totalQuestions: number
 *   scorePercent: number
 *   sourceFormId: string
 *   sourceUrl: string
 *   sourcePageUrl: string
 *   sourceOrigin: string
 *   sourceOriginLabel: string
 *   sourceOriginHost: string
 *   assignmentBundleJson: unknown
 *   assignmentTemplateId: string
 *   assignmentTemplateItemId: string
 *   assignmentTitle: string
 *   assignmentItemTitle: string
 *   assignmentExerciseUrl: string
 *   assignedAt: string
 *   dueAt: string
 *   level: string
 * }} ValidatedPayload
 *
 * @typedef {{
 *   allowMissingEmail?: boolean
 * }} ValidatePayloadOptions
 *
 * @typedef {{
 *   to: string[]
 *   subject: string
 *   text: string
 *   html: string
 * }} EmailContent
 *
 * @typedef {{
 *   raw: string
 *   parsed: unknown
 * }} ParsedBodyResult
 *
 * @typedef {{
 *   enabled: boolean
 *   reason: string
 *   sourceRoot: string
 *   runtimeRoot: string
 *   sourceHtmlPath: string
 *   runtimeHtmlPath: string
 *   intervalMs: number | null
 *   lastCheckedAt: string | null
 *   lastMismatchAt: string | null
 *   lastSyncAt: string | null
 *   syncCount: number
 *   lastResult: string
 *   lastError: string
 * }} SelfHealStatus
 *
 * @typedef {{
 *   enabled: boolean
 *   reason: string
 *   sourceRoot: string
 *   runtimeRoot: string
 *   sourceHtmlPath?: string
 *   runtimeHtmlPath?: string
 *   intervalMs?: number | null
 * }} SelfHealConfig
 *
 * @typedef {{
 *   saved?: boolean
 *   shouldNotify?: boolean
 *   submissionId?: string
 *   incomingResultId?: string
 *   deduplicated?: boolean
 *   summary?: { scorePercent?: number }
 *   reason?: string
 * }} ExerciseStoreResult
 */

// Load SIS route/store modules after env hydration so their module-level config reads
// the intended env file values instead of shell defaults.
const {
  ensureSisConfigLoaded,
  getSisConfigMirrorHealthSnapshot,
} = await import("../src/modules/admin/sis-config-store.mjs")
await ensureSisConfigLoaded()
const { startStudentNewsAutoApprovalLoop } = await import("../src/modules/admin/student-news-auto-approval.mjs")

const {
  isExerciseStoreRequired,
  persistExerciseSubmission,
} = await import("../src/modules/exercises/exercise-store.mjs")
const {
  MOODLE_INTEGRATION_SOURCE,
  MOODLE_REQUEST_HEADER_SIGNATURE,
  MOODLE_REQUEST_HEADER_SOURCE,
  MOODLE_REQUEST_HEADER_TIMESTAMP,
  MOODLE_SIGNATURE_MAX_AGE_MS,
  verifyMoodleRequestSignature,
} = await import("../src/modules/exercises/moodle-sync.mjs")
const { persistStudentIntakeSubmission } = await import("../src/modules/intake/student-intake-store.mjs")
const {
  getStudentAdminRuntimeStatus,
  handleStudentAdminRequest,
  closeStudentAdminRuntimeResources,
  setStudentAdminRuntimeHealthProvider,
} = await import("./student-admin-routes.mjs")

/** @type {{ createTransport: (options: object) => import("nodemailer").Transporter } | null} */
let nodemailer = null

try {
  const mod = require("nodemailer")
  nodemailer = mod
} catch (error) {
  const err = /** @type {StatusError} */ (error)
  if (err && err.code !== "MODULE_NOT_FOUND") throw error
  if (isDebugEnabled()) {
    console.warn(
      "ℹ️  Optional dependency 'nodemailer' not found; provide a transporter or install it"
    )
  }
}

/* =========================
  Configuration & Defaults
   ========================= */

const DEV_RUNTIME_PORT = 8788
const LIVE_RUNTIME_PORT = 8787
const DEFAULT_PATH = process.env.EXERCISE_MAILER_PATH || "/api/exercise-submission"
const DEFAULT_INTAKE_PATH =
  process.env.EXERCISE_MAILER_INTAKE_PATH || "/api/student-intake-submission"
const CLOZE_WEB_SOURCE = "cloze-web"
const DEFAULT_HOST = process.env.EXERCISE_MAILER_HOST || "0.0.0.0"
const DOCS_URL_PREFIX = "/docs"
const DOCS_PUBLIC_ROOT = path.resolve(process.cwd(), "docs")
const WEB_ASSET_URL_PREFIX = "/web-asset"
const WEB_ASSET_PUBLIC_ROOT = path.resolve(process.cwd(), "web-asset")
const ROBOTS_TXT_BODY = [
  "User-agent: *",
  "Disallow: /admin",
  "Disallow: /parent",
  "Disallow: /student",
  "Disallow: /api/",
  "Disallow: /docs/",
  "",
].join("\n")
/** @type {Readonly<Record<string, string>>} */
const STATIC_MIME_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".dsl": "text/plain; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mmd": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".yaml": "application/yaml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
})

// Multiple origins supported: comma separated string, exact match with scheme+host[:port]
/** @returns {string[]} */
function getOriginList() {
  return (process.env.EXERCISE_MAILER_ORIGIN || process.env.EXERCISE_MAILER_ORIGINS || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/** @param {string} origin @returns {boolean} */
function isLoopbackOrigin(origin) {
  const text = String(origin || "").trim()
  if (!text) return false
  try {
    const parsed = new URL(text)
    const protocol = String(parsed.protocol || "").trim().toLowerCase()
    if (protocol !== "http:" && protocol !== "https:") return false
    const hostname = String(parsed.hostname || "").trim().toLowerCase()
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  } catch (error) {
    void error
    return false
  }
}

/** @param {string} origin @returns {boolean} */
function isEaglesEduVnOrigin(origin) {
  const text = String(origin || "").trim()
  if (!text) return false
  try {
    const parsed = new URL(text)
    const protocol = String(parsed.protocol || "").trim().toLowerCase()
    if (protocol !== "http:" && protocol !== "https:") return false
    const hostname = String(parsed.hostname || "").trim().toLowerCase()
    return /^([a-z0-9-]+\.)*eagles\.edu\.vn$/.test(hostname)
  } catch (error) {
    void error
    return false
  }
}

/** @param {string[]} [origins=[]] @returns {boolean} */
function configuredOriginIncludesEaglesDomain(origins = []) {
  if (!Array.isArray(origins) || !origins.length) return false
  for (let i = 0; i < origins.length; i += 1) {
    if (isEaglesEduVnOrigin(origins[i])) return true
  }
  return false
}

// Toggle verbose logs
const MAILER_DEBUG = isDebugEnabled()

// Default recipients (comma-separated email list)
const DEFAULT_RECIPIENTS = (process.env.EXERCISE_MAILER_RECIPIENTS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean)
const MOODLE_QUIZ_SYNC_SHARED_SECRET =
  normalizeEnvText(process.env.MOODLE_QUIZ_SYNC_SHARED_SECRET) ||
  normalizeEnvText(process.env.MOODLE_SIS_QUIZ_SYNC_SECRET)

/* =========================
  Runtime Status (healthz)
   ========================= */

/** @type {{
 *   startedAt: string
 *   lastVerifyOk: boolean | null
 *   lastVerifyAt: string | null
 *   lastStoreOk: boolean | null
 *   lastStoreAt: string | null
 *   lastIntakeStoreOk: boolean | null
 *   lastIntakeStoreAt: string | null
 *   lastSendOk: boolean | null
 *   lastSendAt: string | null
 *   lastError: string | null
 * }} */
const STATUS = {
  startedAt: new Date().toISOString(),
  lastVerifyOk: null,
  lastVerifyAt: null,
  lastStoreOk: null,
  lastStoreAt: null,
  lastIntakeStoreOk: null,
  lastIntakeStoreAt: null,
  lastSendOk: null,
  lastSendAt: null,
  lastError: null,
}

const SELF_HEAL_RELATIVE_ADMIN_HTML = path.join("web-asset", "admin", "student-admin.html")
/** @type {SelfHealStatus} */
const SELF_HEAL_STATUS = {
  enabled: false,
  reason: "",
  sourceRoot: "",
  runtimeRoot: "",
  sourceHtmlPath: "",
  runtimeHtmlPath: "",
  intervalMs: null,
  lastCheckedAt: null,
  lastMismatchAt: null,
  lastSyncAt: null,
  syncCount: 0,
  lastResult: "disabled",
  lastError: "",
}
/** @type {Map<string, Promise<void>>} */
const SUBMISSION_LOCKS = new Map()
/** @type {Map<string, number>} */
const RECENT_SUBMISSION_NOTIFICATIONS = new Map()
const SUBMISSION_NOTIFICATION_DEDUP_WINDOW_MS = 30 * 1000

/* =========================
    Helpers
   ========================= */

/** @param {unknown} value @param {boolean} fallback @returns {boolean} */
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

/** @param {unknown} value @returns {string} */
function normalizeString(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

/** @param {unknown} value @returns {string} */
function normalizeExerciseSectionNotation(value) {
  const text = normalizeString(value)
  if (!text) return ""
  return text
    .replace(/\b\d+(?:\.\d+)+\b/gu, (token) => token.replace(/\./gu, " "))
    .replace(/\s+/gu, " ")
    .trim()
}

/** @param {string} candidatePath @param {string} rootPath @returns {boolean} */
function isPathWithinRoot(candidatePath, rootPath) {
  const candidate = path.resolve(candidatePath)
  const root = path.resolve(rootPath)
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

/** @param {string} filePath @returns {string} */
function resolveStaticContentType(filePath) {
  const ext = String(path.extname(filePath || "") || "").toLowerCase()
  return STATIC_MIME_TYPES[ext] || "application/octet-stream"
}

/** @param {string} pathname @param {string} urlPrefix @param {string} publicRoot @returns {string} */
function resolveScopedStaticFilePath(pathname, urlPrefix, publicRoot) {
  const normalizedPathname = normalizeString(pathname)
  if (!normalizedPathname.startsWith(urlPrefix)) return ""

  let relativePath = normalizedPathname.slice(urlPrefix.length)
  if (relativePath.startsWith("/")) relativePath = relativePath.slice(1)

  let decodedPath
  try {
    decodedPath = decodeURIComponent(relativePath)
  } catch (error) {
    void error
    return ""
  }

  const targetPath = path.resolve(publicRoot, decodedPath)
  if (!isPathWithinRoot(targetPath, publicRoot)) return ""
  return targetPath
}

/** @param {string} pathname @returns {string} */
function resolveDocsFilePath(pathname) {
  return resolveScopedStaticFilePath(pathname, DOCS_URL_PREFIX, DOCS_PUBLIC_ROOT)
}

/** @param {string} pathname @returns {string} */
function resolveWebAssetFilePath(pathname) {
  return resolveScopedStaticFilePath(pathname, WEB_ASSET_URL_PREFIX, WEB_ASSET_PUBLIC_ROOT)
}

/** @param {MailerRequest} request @param {MailerResponse} response @param {string} filePath @returns {boolean} */
function trySendStaticFile(request, response, filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false

  let targetPath = filePath
  let stat
  try {
    stat = fs.statSync(targetPath)
  } catch (error) {
    void error
    return false
  }

  if (stat.isDirectory()) {
    targetPath = path.join(targetPath, "index.html")
    if (!fs.existsSync(targetPath)) return false
    try {
      stat = fs.statSync(targetPath)
    } catch (error) {
      void error
      return false
    }
  }

  if (!stat.isFile()) return false

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": String(stat.size),
    "Content-Type": resolveStaticContentType(targetPath),
  })

  if (normalizeString(request.method).toUpperCase() === "HEAD") {
    response.end()
    return true
  }

  const stream = fs.createReadStream(targetPath)
  stream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
    }
    response.end("Unable to read file")
  })
  stream.pipe(response)
  return true
}

/** @param {MailerRequest} request @param {MailerResponse} response @param {string} pathname @returns {boolean} */
function handleDocsStaticRequest(request, response, pathname) {
  const method = normalizeString(request.method).toUpperCase()
  if (method !== "GET" && method !== "HEAD") return false

  const normalizedPathname = normalizeString(pathname)
  if (normalizedPathname === DOCS_URL_PREFIX) {
    response.writeHead(302, { Location: `${DOCS_URL_PREFIX}/` })
    response.end()
    return true
  }

  if (!normalizedPathname.startsWith(`${DOCS_URL_PREFIX}/`)) return false

  const filePath = resolveDocsFilePath(normalizedPathname)
  if (!filePath) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
    response.end("Invalid docs path")
    return true
  }

  if (trySendStaticFile(request, response, filePath)) return true

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
  response.end("Not Found")
  return true
}

/** @param {MailerRequest} request @param {MailerResponse} response @param {string} pathname @returns {boolean} */
function handleWebAssetStaticRequest(request, response, pathname) {
  const method = normalizeString(request.method).toUpperCase()
  if (method !== "GET" && method !== "HEAD") return false

  const normalizedPathname = normalizeString(pathname)
  if (!normalizedPathname.startsWith(`${WEB_ASSET_URL_PREFIX}/`)) return false

  const filePath = resolveWebAssetFilePath(normalizedPathname)
  if (!filePath) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
    response.end("Invalid web asset path")
    return true
  }

  if (trySendStaticFile(request, response, filePath)) return true

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
  response.end("Not Found")
  return true
}

/** @returns {string[]} */
function resolveLiveRuntimeRoots() {
  const configuredRoots = [
    normalizeString(process.env.SIS_LIVE_ROOTS),
    normalizeString(process.env.SIS_LIVE_ROOT) || "/home/admin.eagles.edu.vn/sis",
  ]
    .filter(Boolean)
    .flatMap((entry) =>
      String(entry)
        .split(",")
        .map((item) => normalizeString(item))
        .filter(Boolean)
    )
  return Array.from(new Set(configuredRoots.map((entry) => path.resolve(entry))))
}

/** @returns {string[]} */
function resolveDevRuntimeRoots() {
  const configuredRoots = [
    normalizeString(process.env.SIS_DEV_ROOTS),
    normalizeString(process.env.SIS_DEV_ROOT) || "/home/eagles/dockerz/sis",
  ]
    .filter(Boolean)
    .flatMap((entry) =>
      String(entry)
        .split(",")
        .map((item) => normalizeString(item))
        .filter(Boolean)
    )
  return Array.from(new Set(configuredRoots.map((entry) => path.resolve(entry))))
}

/** @param {string} candidatePath @param {string[]} [roots=[]] @returns {boolean} */
function isPathWithinAnyRoot(candidatePath, roots = []) {
  for (let i = 0; i < roots.length; i += 1) {
    if (isPathWithinRoot(candidatePath, roots[i])) return true
  }
  return false
}

function assertRuntimeEnvironmentSeparation() {
  const nodeEnv = normalizeString(process.env.NODE_ENV).toLowerCase()
  const cwd = path.resolve(process.cwd())
  if (nodeEnv === "development") {
    if (resolveBoolean(process.env.SIS_ALLOW_DEV_ON_LIVE_ROOT, false)) return
    const liveRoots = resolveLiveRuntimeRoots()
    for (let i = 0; i < liveRoots.length; i += 1) {
      if (isPathWithinRoot(cwd, liveRoots[i])) {
        throw new Error(
          `Refusing to start development runtime inside live root (${liveRoots[i]}). ` +
            "Use SIS_ALLOW_DEV_ON_LIVE_ROOT=true to override."
        )
      }
    }
    return
  }
  if (nodeEnv === "test") return
  if (resolveBoolean(process.env.SIS_ALLOW_LIVE_ON_DEV_ROOT, false)) return
  const devRoots = resolveDevRuntimeRoots()
  for (let i = 0; i < devRoots.length; i += 1) {
    if (isPathWithinRoot(cwd, devRoots[i])) {
      throw new Error(
        `Refusing to start live runtime inside dev root (${devRoots[i]}). ` +
          "Use NODE_ENV=development or set SIS_ALLOW_LIVE_ON_DEV_ROOT=true to override."
      )
    }
  }
}

function resolveExpectedMailerPort() {
  const nodeEnv = normalizeString(process.env.NODE_ENV).toLowerCase()
  return nodeEnv === "development" ? DEV_RUNTIME_PORT : LIVE_RUNTIME_PORT
}

function parseConfiguredMailerPort() {
  const raw = normalizeEnvText(process.env.EXERCISE_MAILER_PORT)
  if (!raw) return null
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid EXERCISE_MAILER_PORT value: ${raw}`)
  }
  return parsed
}

function resolveRuntimeMailerPort() {
  const nodeEnv = normalizeString(process.env.NODE_ENV).toLowerCase()
  const configuredPort = parseConfiguredMailerPort()
  if (nodeEnv === "test") return configuredPort === null ? LIVE_RUNTIME_PORT : configuredPort
  const expectedPort = resolveExpectedMailerPort()
  if (configuredPort === null) return expectedPort
  if (configuredPort !== expectedPort) {
    const runtimeLabel = nodeEnv || "production"
    throw new Error(
      `Refusing to start ${runtimeLabel} runtime on EXERCISE_MAILER_PORT=${configuredPort}; expected ${expectedPort}.`
    )
  }
  return configuredPort
}

/** @param {SubmissionPayload & { sourceSystem?: string; sourceAttemptId?: string }} payload @returns {string} */
function buildSubmissionActorKey(payload) {
  const sourceSystem = normalizeLower(payload?.sourceSystem)
  const sourceAttemptId = normalizeString(payload?.sourceAttemptId)
  if (sourceAttemptId) {
    return `${sourceSystem || "source"}|${sourceAttemptId}`
  }
  const eaglesId = normalizeString(payload?.eaglesId || "(not provided)").toLowerCase()
  const email = normalizeString(payload?.email).toLowerCase() || "-"
  const pageTitle = normalizeExerciseSectionNotation(payload?.pageTitle || "Untitled exercise").toLowerCase()
  return `${eaglesId}|${email}|${pageTitle}`
}

/** @param {SubmissionPayload | ValidatedPayload} payload @returns {string} */
function buildSubmissionNotificationKey(payload) {
  const actorKey = buildSubmissionActorKey(payload)
  const completedAtMs = Date.parse(normalizeString(payload?.completedAt))
  const completedAtBucket = Number.isFinite(completedAtMs)
    ? Math.round(completedAtMs / 1000)
    : "unknown-time"
  return `${actorKey}|${completedAtBucket}`
}

/**
 * @param {string} sourceSystem
 * @returns {boolean}
 */
function isBrowserExerciseSource(sourceSystem) {
  return normalizeLower(sourceSystem) === CLOZE_WEB_SOURCE
}

function pruneExpiredSubmissionNotificationKeys(now = Date.now()) {
  const entries = Array.from(RECENT_SUBMISSION_NOTIFICATIONS.entries())
  for (let i = 0; i < entries.length; i += 1) {
    const [key, expiresAt] = entries[i]
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      RECENT_SUBMISSION_NOTIFICATIONS.delete(key)
    }
  }
}

/** @param {string} notificationKey @param {number} [now=Date.now()] @returns {boolean} */
function hasRecentSubmissionNotification(notificationKey, now = Date.now()) {
  pruneExpiredSubmissionNotificationKeys(now)
  const key = normalizeString(notificationKey)
  if (!key) return false
  const expiresAt = RECENT_SUBMISSION_NOTIFICATIONS.get(key)
  if (expiresAt === undefined) return false
  return Number.isFinite(expiresAt) && expiresAt > now
}

/** @param {string} notificationKey @param {number} [now=Date.now()] */
function markSubmissionNotificationSent(notificationKey, now = Date.now()) {
  const key = normalizeString(notificationKey)
  if (!key) return
  pruneExpiredSubmissionNotificationKeys(now)
  RECENT_SUBMISSION_NOTIFICATIONS.set(key, now + SUBMISSION_NOTIFICATION_DEDUP_WINDOW_MS)
}

/** @param {string} lockKey @param {() => Promise<unknown>} task */
async function withSubmissionLock(lockKey, task) {
  const key = normalizeString(lockKey) || "submission-lock"
  const prior = SUBMISSION_LOCKS.get(key) || Promise.resolve()
  /** @type {() => void} */
  let releaseCurrent = () => {}
  const current = new Promise((resolve) => {
    releaseCurrent = () => resolve(undefined)
  })
  SUBMISSION_LOCKS.set(key, current)

  await prior
  try {
    return await task()
  } finally {
    releaseCurrent()
    if (SUBMISSION_LOCKS.get(key) === current) SUBMISSION_LOCKS.delete(key)
  }
}

/** @returns {SelfHealConfig & { reason: string }} */
function resolveRuntimeSelfHealConfig() {
  // Opt-in only: avoid implicit cross-runtime coupling unless explicitly configured.
  const enabled = resolveBoolean(process.env.SIS_RUNTIME_SELF_HEAL_ENABLED, false)
  const runtimeRoot = path.resolve(
    normalizeString(process.env.SIS_RUNTIME_SELF_HEAL_RUNTIME_ROOT) || process.cwd()
  )

  const sourceRoot = normalizeString(process.env.SIS_RUNTIME_SELF_HEAL_SOURCE_ROOT)

  if (!enabled) {
    return { enabled: false, reason: "disabled-by-env", sourceRoot, runtimeRoot }
  }

  if (!sourceRoot) {
    return { enabled: false, reason: "missing-source-root", sourceRoot, runtimeRoot }
  }

  const resolvedSourceRoot = path.resolve(sourceRoot)
  const nodeEnv = normalizeString(process.env.NODE_ENV).toLowerCase()
  const allowDevSelfHealLiveRoot = resolveBoolean(process.env.SIS_ALLOW_DEV_SELF_HEAL_LIVE_ROOT, false)
  if (nodeEnv === "development" && !allowDevSelfHealLiveRoot) {
    const liveRoots = resolveLiveRuntimeRoots()
    const touchesLiveRoot =
      isPathWithinAnyRoot(resolvedSourceRoot, liveRoots) || isPathWithinAnyRoot(runtimeRoot, liveRoots)
    if (touchesLiveRoot) {
      return {
        enabled: false,
        reason: "blocked-live-root-in-dev",
        sourceRoot: resolvedSourceRoot,
        runtimeRoot,
      }
    }
  }

  const sourceHtmlPath = path.join(resolvedSourceRoot, SELF_HEAL_RELATIVE_ADMIN_HTML)
  const runtimeHtmlPath = path.join(runtimeRoot, SELF_HEAL_RELATIVE_ADMIN_HTML)

  if (!fs.existsSync(sourceHtmlPath)) {
    return {
      enabled: false,
      reason: "missing-source-html",
      sourceRoot: resolvedSourceRoot,
      runtimeRoot,
      sourceHtmlPath,
      runtimeHtmlPath,
    }
  }

  const intervalRaw = Number.parseInt(
    normalizeString(process.env.SIS_RUNTIME_SELF_HEAL_INTERVAL_MS) || "15000",
    10
  )
  const intervalMs = Number.isFinite(intervalRaw) && intervalRaw >= 1000 ? intervalRaw : 15000

  return {
    enabled: true,
    reason: "",
    sourceRoot: resolvedSourceRoot,
    runtimeRoot,
    sourceHtmlPath,
    runtimeHtmlPath,
    intervalMs,
  }
}

/** @param {SelfHealConfig & { reason?: string }} config */
function applyRuntimeSelfHealStatus(config) {
  SELF_HEAL_STATUS.enabled = Boolean(config?.enabled)
  SELF_HEAL_STATUS.reason = config?.reason || ""
  SELF_HEAL_STATUS.sourceRoot = config?.sourceRoot || ""
  SELF_HEAL_STATUS.runtimeRoot = config?.runtimeRoot || ""
  SELF_HEAL_STATUS.sourceHtmlPath = config?.sourceHtmlPath || ""
  SELF_HEAL_STATUS.runtimeHtmlPath = config?.runtimeHtmlPath || ""
  SELF_HEAL_STATUS.intervalMs = config?.enabled ? config?.intervalMs || null : null
  SELF_HEAL_STATUS.lastCheckedAt = null
  SELF_HEAL_STATUS.lastMismatchAt = null
  SELF_HEAL_STATUS.lastSyncAt = null
  SELF_HEAL_STATUS.syncCount = 0
  SELF_HEAL_STATUS.lastResult = config?.enabled ? "pending" : config?.reason || "disabled"
  SELF_HEAL_STATUS.lastError = ""
}

/** @param {SelfHealConfig & { reason?: string }} config */
function runRuntimeSelfHealCheck(config) {
  const checkedAt = new Date().toISOString()
  SELF_HEAL_STATUS.lastCheckedAt = checkedAt
  if (!config?.enabled) return

  try {
    const sourceHtmlPath = config.sourceHtmlPath || ""
    const runtimeHtmlPath = config.runtimeHtmlPath || ""
    const sourceBuffer = fs.readFileSync(sourceHtmlPath)
    let runtimeBuffer = null
    try {
      runtimeBuffer = fs.readFileSync(runtimeHtmlPath)
    } catch (error) {
      const err = /** @type {StatusError} */ (error)
      if (!err || err.code !== "ENOENT") throw error
    }

    const mismatch = !runtimeBuffer || !sourceBuffer.equals(runtimeBuffer)
    if (!mismatch) {
      SELF_HEAL_STATUS.lastResult = "in-sync"
      SELF_HEAL_STATUS.lastError = ""
      return
    }

    SELF_HEAL_STATUS.lastMismatchAt = checkedAt
    fs.mkdirSync(path.dirname(runtimeHtmlPath), { recursive: true })
    fs.writeFileSync(runtimeHtmlPath, sourceBuffer)
    SELF_HEAL_STATUS.lastSyncAt = new Date().toISOString()
    SELF_HEAL_STATUS.syncCount += 1
    SELF_HEAL_STATUS.lastResult = "synced"
    SELF_HEAL_STATUS.lastError = ""

    console.log(
      `[self-heal] synced ${runtimeHtmlPath} from ${sourceHtmlPath}`
    )
  } catch (error) {
    SELF_HEAL_STATUS.lastResult = "error"
    const err = error instanceof Error ? error : new Error(String(error))
    SELF_HEAL_STATUS.lastError = String(err.message || error)
    if (MAILER_DEBUG) {
      console.warn(`[self-heal] check failed: ${SELF_HEAL_STATUS.lastError}`)
    }
  }
}

/** @returns {{ stop: () => void }} */
function startRuntimeSelfHealLoop() {
  const config = resolveRuntimeSelfHealConfig()
  applyRuntimeSelfHealStatus(config)

  if (!config.enabled) {
    return { stop() {} }
  }

  runRuntimeSelfHealCheck(config)
  const intervalMs = config.intervalMs || 15000
  const timer = setInterval(() => {
    runRuntimeSelfHealCheck(config)
  }, intervalMs)
  if (typeof timer.unref === "function") timer.unref()

  return {
    stop() {
      clearInterval(timer)
    },
  }
}

/** @returns {SelfHealStatus} */
function getRuntimeSelfHealStatus() {
  return {
    enabled: SELF_HEAL_STATUS.enabled,
    reason: SELF_HEAL_STATUS.reason,
    sourceRoot: SELF_HEAL_STATUS.sourceRoot,
    runtimeRoot: SELF_HEAL_STATUS.runtimeRoot,
    sourceHtmlPath: SELF_HEAL_STATUS.sourceHtmlPath,
    runtimeHtmlPath: SELF_HEAL_STATUS.runtimeHtmlPath,
    intervalMs: SELF_HEAL_STATUS.intervalMs,
    lastCheckedAt: SELF_HEAL_STATUS.lastCheckedAt,
    lastMismatchAt: SELF_HEAL_STATUS.lastMismatchAt,
    lastSyncAt: SELF_HEAL_STATUS.lastSyncAt,
    syncCount: SELF_HEAL_STATUS.syncCount,
    lastResult: SELF_HEAL_STATUS.lastResult,
    lastError: SELF_HEAL_STATUS.lastError,
  }
}

/** @returns {Promise<Record<string, unknown>>} */
async function buildRuntimeHealthPayload() {
  const studentAdminRuntime = getStudentAdminRuntimeStatus()
  const maintenance = studentAdminRuntime?.maintenance || null
  return {
    status: "ok",
    startedAt: STATUS.startedAt,
    uptimeSeconds: Math.floor((Date.now() - Date.parse(STATUS.startedAt)) / 1000),
    lastVerifyOk: STATUS.lastVerifyOk,
    lastVerifyAt: STATUS.lastVerifyAt,
    lastStoreOk: STATUS.lastStoreOk,
    lastStoreAt: STATUS.lastStoreAt,
    lastIntakeStoreOk: STATUS.lastIntakeStoreOk,
    lastIntakeStoreAt: STATUS.lastIntakeStoreAt,
    lastSendOk: STATUS.lastSendOk,
    lastSendAt: STATUS.lastSendAt,
    lastError: STATUS.lastError,
    node: process.version,
    endpoint: DEFAULT_PATH,
    intakeEndpoint: DEFAULT_INTAKE_PATH,
    studentAdminRuntime,
    maintenance,
    sisConfigMirrorHealth: await getSisConfigMirrorHealthSnapshot(),
    runtimeSelfHeal: getRuntimeSelfHealStatus(),
  }
}

/** @param {unknown} value @returns {string[]} */
function coerceArray(value) {
  if (!value) return []
  const list = Array.isArray(value) ? value : [value]
  const result = []
  for (let i = 0; i < list.length; i += 1) {
    const entry = normalizeString(list[i])
    if (entry) result.push(entry)
  }
  return result
}

/** @param {number} code @returns {string} */
function fromCodePointSafe(code) {
  if (typeof code !== "number" || !Number.isFinite(code)) return ""
  try {
    return String.fromCodePoint(code)
  } catch (error) {
    void error
    if (code <= 0xffff) return String.fromCharCode(code)
    const adjusted = code - 0x10000
    const high = (adjusted >> 10) + 0xd800
    const low = (adjusted % 0x400) + 0xdc00
    return String.fromCharCode(high, low)
  }
}

/** @param {unknown} value @returns {string} */
function decodeCodePoints(value) {
  if (value === undefined || value === null) return ""
  let list
  if (Array.isArray(value)) list = value.slice()
  else if (typeof value === "string") list = value.split(/[^0-9]+/g)
  else list = [value]
  let result = ""
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i]
    if (token === "" || token === null || token === undefined) continue
    const num = typeof token === "number" ? token : Number.parseInt(String(token), 10)
    if (!Number.isFinite(num)) continue
    result += fromCodePointSafe(num)
  }
  return result.trim()
}

/** @param {unknown} hex @returns {string} */
function decodeUtf8Hex(hex) {
  if (!hex) return ""
  const normalized = String(hex)
    .trim()
    .replace(/[^0-9a-fA-F]/g, "")
    .toLowerCase()
  if (!normalized || normalized.length % 2 !== 0) return ""
  try {
    return Buffer.from(normalized, "hex").toString("utf8").trim()
  } catch (error) {
    void error
    return ""
  }
}

/** @param {unknown} token @returns {string} */
function decodeRecipientToken(token) {
  if (token === undefined || token === null) return ""
  if (typeof token === "string") return token.trim()
  if (typeof token === "number") return fromCodePointSafe(token)
  if (Array.isArray(token)) return decodeCodePoints(token)
  if (typeof token === "object") {
    const entry = /** @type {Record<string, unknown>} */ (token)
    if (typeof entry.email === "string") return entry.email.trim()
    if (typeof entry.value === "string") return entry.value.trim()
    if (typeof entry.utf8 === "string") return decodeUtf8Hex(entry.utf8)
    if (Array.isArray(entry.utf8)) return decodeCodePoints(entry.utf8)
    const codePoints =
      entry.codePoints ||
      entry.codepoints ||
      entry.code_point ||
      entry.codepoint ||
      entry.cp ||
      entry.points ||
      entry.codes
    if (codePoints != null) {
      const decoded = decodeCodePoints(codePoints)
      if (decoded) return decoded
    }
    if (typeof entry.bytes === "string") return decodeUtf8Hex(entry.bytes)
    if (Array.isArray(entry.bytes)) return decodeCodePoints(entry.bytes)
  }
  return ""
}

/** @param {unknown[]} list @returns {string[]} */
function decodeRecipients(list) {
  if (!Array.isArray(list)) return []
  const decoded = []
  for (let i = 0; i < list.length; i += 1) {
    const entry = decodeRecipientToken(list[i])
    if (!entry) continue
    const trimmed = entry.trim()
    if (!trimmed) continue
    decoded.push(trimmed)
  }
  return decoded
}

/** @param {string} value @returns {boolean} */
function isEmailLike(value) {
  if (typeof value !== "string") return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

/**
 * @param {{
 *   correctCount: number
 *   pendingCount: number
 *   incorrectCount: number
 *   totalQuestions: number
 *   scorePercent: number
 * }} metrics
 * @returns {string}
 */
function formatMetricSummary({ correctCount, pendingCount, incorrectCount, totalQuestions, scorePercent }) {
  const total = Number.parseInt(String(totalQuestions || 0), 10) || 0
  const correct = Number.parseInt(String(correctCount || 0), 10) || 0
  const pending = Number.parseInt(String(pendingCount || 0), 10) || 0
  const incorrect = Number.parseInt(String(incorrectCount || 0), 10) || 0
  const percent = Number.isFinite(Number(scorePercent)) ? Number(scorePercent).toFixed(2) : "0.00"
  return `${correct}/${total} (${percent}%) | pending=${pending} | incorrect=${incorrect}`
}

/**
 * @param {ValidatedPayload} payload
 * @returns {{ teacherEmail: EmailContent, learnerEmail: EmailContent | null }}
 */
function createEmail({
  email,
  eaglesId,
  pageTitle,
  completedAt,
  recipients,
  correctCount,
  pendingCount,
  incorrectCount,
  totalQuestions,
  scorePercent,
}) {
  const to = coerceArray(recipients)
  const trimmedEmail = isEmailLike(email) ? email.trim() : ""
  const submittedAt = completedAt || new Date().toISOString()
  const subjectBase = `Exercise submission${pageTitle ? ` — ${pageTitle}` : ""}`
  const teacherSubject = `${eaglesId ? `${eaglesId} ` : ""}${subjectBase}`

  const studentDisplayId = eaglesId || "(not provided)"
  const introIdentifier = eaglesId ? eaglesId : "Eagles ID (not provided)"
  const studentIdLine = `Eagles ID: ${studentDisplayId}`
  const studentEmailLine = trimmedEmail
    ? `Student email: ${trimmedEmail}`
    : "Student email: (not provided)"
  const scoreLine = `Score summary: ${formatMetricSummary({
    correctCount,
    pendingCount,
    incorrectCount,
    totalQuestions,
    scorePercent,
  })}`

  const textBody = [
    `${introIdentifier} just completed ${pageTitle || "an exercise"}.`,
    "",
    `Submitted at: ${submittedAt}`,
    studentEmailLine,
    studentIdLine,
    scoreLine,
  ].join("\n")

  const htmlBody = `
    <div>
      <p><strong>${introIdentifier}</strong> just completed <strong>${pageTitle || "an exercise"}</strong>.</p>
      <ul>
        <li><strong>Submitted at:</strong> ${submittedAt}</li>
        <li><strong>Student email:</strong> ${trimmedEmail || "(not provided)"}</li>
        <li><strong>Eagles ID:</strong> ${studentDisplayId}</li>
        <li><strong>Score summary:</strong> ${formatMetricSummary({
          correctCount,
          pendingCount,
          incorrectCount,
          totalQuestions,
          scorePercent,
        })}</li>
      </ul>
    </div>
  `

  const teacherEmail = {
    to,
    subject: teacherSubject,
    text: textBody,
    html: htmlBody,
  }

  let learnerEmail = null

  if (trimmedEmail) {
    const pageName = pageTitle || "your exercise"
    const learnerSubject = `Confirmation — ${pageTitle || "Exercise submission"}`
    const learnerText = [
      `Thanks for completing ${pageName}.`,
      "",
      `Submitted at: ${submittedAt}`,
      `Eagles ID: ${eaglesId || "(not provided)"}`,
      `Score summary: ${formatMetricSummary({
        correctCount,
        pendingCount,
        incorrectCount,
        totalQuestions,
        scorePercent,
      })}`,
      `Email: ${trimmedEmail}`,
    ].join("\n")

    const learnerHtml = `
      <div>
        <p>Thanks for completing <strong>${pageName}</strong>.</p>
        <ul>
          <li><strong>Submitted at:</strong> ${submittedAt}</li>
          <li><strong>Eagles ID:</strong> ${eaglesId || "(not provided)"}</li>
          <li><strong>Score summary:</strong> ${formatMetricSummary({
            correctCount,
            pendingCount,
            incorrectCount,
            totalQuestions,
            scorePercent,
          })}</li>
          <li><strong>Email:</strong> ${trimmedEmail}</li>
        </ul>
      </div>
    `

    learnerEmail = {
      to: [trimmedEmail],
      subject: learnerSubject,
      text: learnerText,
      html: learnerHtml,
    }
  }

  return { teacherEmail, learnerEmail }
}

/** @param {MailerRequest} request @returns {Promise<string>} */
function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = []
    request.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      chunks.push(buffer)
      const size = chunks.reduce((total, entry) => total + entry.length, 0)
      if (size > 1e6) {
        request.destroy()
        reject(new Error("Payload too large"))
      }
    })
    request.on("end", () => {
      resolve(chunks.length ? Buffer.concat(chunks).toString("utf8") : "")
    })
    request.on("error", reject)
  })
}

/** @param {MailerRequest} request @returns {Promise<unknown>} */
async function parseBody(request) {
  const raw = await readRequestBody(request)
  return raw ? JSON.parse(raw) : {}
}

/** @param {MailerRequest} request @returns {Promise<ParsedBodyResult>} */
async function parseBodyWithRaw(request) {
  const raw = await readRequestBody(request)
  return {
    raw,
    parsed: raw ? JSON.parse(raw) : {},
  }
}

/** @param {string} message @returns {StatusError & Error} */
function createBadRequestError(message) {
  const error = /** @type {StatusError & Error} */ (new Error(message))
  error.statusCode = 400
  return error
}

/** @param {unknown} value @param {string} fieldName @returns {number} */
function parseRequiredNonNegativeInteger(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createBadRequestError(`Invalid ${fieldName}`)
  }
  return parsed
}

/** @param {unknown} value @param {string} fieldName @returns {number} */
function parseRequiredPercent(value, fieldName) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw createBadRequestError(`Invalid ${fieldName}`)
  }
  return Number(parsed.toFixed(2))
}

/** @param {number} correctCount @param {number} totalQuestions @returns {number} */
function expectedScorePercent(correctCount, totalQuestions) {
  if (!Number.isFinite(totalQuestions) || totalQuestions <= 0) return 0
  return Number(((correctCount / totalQuestions) * 100).toFixed(2))
}

/** @param {SubmissionPayload} payload @param {ValidatePayloadOptions} [options={}] @returns {ValidatedPayload} */
function validatePayload(payload, options = {}) {
  if (!payload || typeof payload !== "object") throw createBadRequestError("Invalid payload")
  if (Object.prototype.hasOwnProperty.call(payload, "studentId")) {
    throw createBadRequestError("Unsupported field: studentId")
  }
  if (Object.prototype.hasOwnProperty.call(payload, "answers")) {
    throw createBadRequestError("Unsupported field: answers")
  }

  const eaglesId = normalizeString(payload?.eaglesId)
  if (!eaglesId) throw createBadRequestError("Missing eaglesId")

  const email = normalizeString(payload?.email)
  const allowMissingEmail = Boolean(options?.allowMissingEmail)
  if (!allowMissingEmail && !isEmailLike(email)) throw createBadRequestError("Invalid email")
  const sourceSystem = normalizeString(payload?.sourceSystem)
  const sourceAttemptId = normalizeString(payload?.sourceAttemptId)
  const sourceFormId = normalizeString(payload?.sourceFormId)
  const sourceUrl = normalizeString(payload?.sourceUrl)
  const sourcePageUrl = normalizeString(payload?.sourcePageUrl)
  const sourceOrigin = normalizeString(payload?.sourceOrigin)
  const sourceOriginLabel = normalizeString(payload?.sourceOriginLabel)
  const sourceOriginHost = normalizeString(payload?.sourceOriginHost)
  const assignmentBundleJson =
    payload?.assignmentBundleJson && typeof payload.assignmentBundleJson === "object"
      ? payload.assignmentBundleJson
      : null
  const assignmentTemplateId = normalizeString(payload?.assignmentTemplateId)
  const assignmentTemplateItemId = normalizeString(payload?.assignmentTemplateItemId)
  const assignmentTitle = normalizeString(payload?.assignmentTitle)
  const assignmentItemTitle = normalizeString(payload?.assignmentItemTitle)
  const assignmentExerciseUrl = normalizeString(payload?.assignmentExerciseUrl)
  const assignedAt = normalizeString(payload?.assignedAt)
  const dueAt = normalizeString(payload?.dueAt)
  const level = normalizeString(payload?.level)

  const rawPageTitle = normalizeString(payload?.pageTitle)
  if (!rawPageTitle) throw createBadRequestError("Missing pageTitle")
  const pageTitle = normalizeExerciseSectionNotation(rawPageTitle)

  const completedAt = normalizeString(payload?.completedAt)
  if (!completedAt || Number.isNaN(Date.parse(completedAt))) {
    throw createBadRequestError("Invalid completedAt")
  }

  const correctCount = parseRequiredNonNegativeInteger(payload?.correctCount, "correctCount")
  const pendingCount = parseRequiredNonNegativeInteger(payload?.pendingCount, "pendingCount")
  const incorrectCount = parseRequiredNonNegativeInteger(payload?.incorrectCount, "incorrectCount")
  const totalQuestions = parseRequiredNonNegativeInteger(payload?.totalQuestions, "totalQuestions")
  const scorePercent = parseRequiredPercent(payload?.scorePercent, "scorePercent")

  if (totalQuestions !== correctCount + pendingCount + incorrectCount) {
    throw createBadRequestError(
      "Invalid metrics: totalQuestions must equal correctCount + pendingCount + incorrectCount"
    )
  }
  const expectedPercent = expectedScorePercent(correctCount, totalQuestions)
  if (Math.abs(scorePercent - expectedPercent) > 0.01) {
    throw createBadRequestError("Invalid metrics: scorePercent mismatch")
  }

  return {
    eaglesId,
    email: isEmailLike(email) ? email : "",
    sourceSystem,
    sourceAttemptId,
    sourceFormId,
    sourceUrl,
    sourcePageUrl,
    sourceOrigin,
    sourceOriginLabel,
    sourceOriginHost,
    assignmentBundleJson,
    assignmentTemplateId,
    assignmentTemplateItemId,
    assignmentTitle,
    assignmentItemTitle,
    assignmentExerciseUrl,
    assignedAt,
    dueAt,
    level,
    pageTitle,
    completedAt,
    recipients: decodeRecipients(Array.isArray(payload.recipients) ? payload.recipients : []),
    correctCount,
    pendingCount,
    incorrectCount,
    totalQuestions,
    scorePercent,
  }
}

/** @param {MailerRequest} request @returns {boolean} */
function isMoodleSourceRequest(request) {
  const source = normalizeLower(request?.headers?.[MOODLE_REQUEST_HEADER_SOURCE])
  return source === MOODLE_INTEGRATION_SOURCE
}

/** @param {SubmissionPayload} [payload={}] @returns {SubmissionPayload & { sourceSystem: string; sourceAttemptId: string }} */
function normalizeMoodlePayload(payload = {}) {
  const sourceAttemptId = normalizeString(
    payload?.sourceAttemptId || payload?.attemptId || payload?.quizAttemptId || payload?.moodleAttemptId
  )
  return {
    ...payload,
    sourceSystem: MOODLE_INTEGRATION_SOURCE,
    sourceAttemptId,
  }
}

/** @param {SubmissionPayload} payload @returns {boolean} */
function hasIntakeFields(payload) {
  const skippedRootKeys = new Set([
    "sourceFormId",
    "sourceUrl",
    "sourcePageUrl",
    "submittedAt",
    "completedAt",
    "formId",
    "wrapperId",
  ])
  /** @param {Record<string, unknown>} map @returns {boolean} */
  const mapHasData = (map) => {
    const entries = Object.entries(map)
    for (let i = 0; i < entries.length; i += 1) {
      const [key, value] = entries[i]
      if (skippedRootKeys.has(key)) continue
      if (Array.isArray(value) && value.length > 0) return true
      if (value && typeof value === "object") {
        if (Object.keys(value).length > 0) return true
        continue
      }
      if (value !== undefined && value !== null && String(value).trim() !== "") return true
    }
    return false
  }

  /** @type {Record<string, unknown>[]} */
  const maps = []
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    maps.push(/** @type {Record<string, unknown>} */ (payload))
  }
  if (payload?.fields && typeof payload.fields === "object") {
    maps.push(/** @type {Record<string, unknown>} */ (payload.fields))
  }
  if (payload?.cf && typeof payload.cf === "object") {
    maps.push(/** @type {Record<string, unknown>} */ (payload.cf))
  }
  if (payload?.form && typeof payload.form === "object") {
    maps.push(/** @type {Record<string, unknown>} */ (payload.form))
  }
  if (payload?.data && typeof payload.data === "object") {
    maps.push(/** @type {Record<string, unknown>} */ (payload.data))
  }
  for (let i = 0; i < maps.length; i += 1) {
    if (mapHasData(maps[i])) return true
  }
  return false
}

/** @param {SubmissionPayload} payload @returns {SubmissionPayload} */
function validateIntakePayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid intake payload")
  if (!hasIntakeFields(payload)) throw new Error("Missing intake form fields")

  const sourceFormId =
    typeof payload.sourceFormId === "string" && payload.sourceFormId.trim()
      ? payload.sourceFormId.trim()
      : "cf3"
  const sourceUrl =
    typeof payload.sourceUrl === "string" && payload.sourceUrl.trim() ? payload.sourceUrl.trim() : ""
  const completedAt =
    typeof payload.submittedAt === "string" && payload.submittedAt.trim()
      ? payload.submittedAt
      : typeof payload.completedAt === "string" && payload.completedAt.trim()
        ? payload.completedAt
        : new Date().toISOString()

  return {
    ...payload,
    sourceFormId,
    sourceUrl,
    submittedAt: completedAt,
  }
}

/* =========================
    CORS
   ========================= */

/** @param {MailerRequest} request @param {MailerResponse} response */
function allowCors(request, response) {
  const reqOrigin = String(request.headers.origin || "").trim()
  const origins = getOriginList()
  const allowEaglesSubdomains = configuredOriginIncludesEaglesDomain(origins)
  let allowOrigin = "null"

  if (origins.includes("*")) {
    allowOrigin = "*"
  } else if (
    reqOrigin &&
    (origins.includes(reqOrigin) ||
      isLoopbackOrigin(reqOrigin) ||
      (allowEaglesSubdomains && isEaglesEduVnOrigin(reqOrigin)))
  ) {
    allowOrigin = reqOrigin // echo back allowed origin
  }

  response.setHeader("Vary", "Origin")
  response.setHeader("Access-Control-Allow-Origin", allowOrigin)
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
  response.setHeader("Access-Control-Allow-Headers", "Content-Type")
  // If you ever use cookies/credentials, uncomment and DO NOT use "*"
  // response.setHeader("Access-Control-Allow-Credentials", "true");
}

/* =========================
    SMTP Transport
   ========================= */

/** @param {unknown} value @returns {"" | "none" | "auth"} */
function resolveSmtpAuthMode(value) {
  const mode = normalizeEnvText(value).toLowerCase()
  if (!mode) return ""
  if (
    mode === "none" ||
    mode === "off" ||
    mode === "disabled" ||
    mode === "false" ||
    mode === "no" ||
    mode === "relay"
  ) {
    return "none"
  }
  if (
    mode === "auth" ||
    mode === "on" ||
    mode === "enabled" ||
    mode === "true" ||
    mode === "yes" ||
    mode === "login"
  ) {
    return "auth"
  }
  return ""
}

/** @returns {import("nodemailer").Transporter} */
function createTransport() {
  if (!nodemailer) {
    throw new Error(
      "nodemailer dependency is unavailable. Install it or pass in options.transporter."
    )
  }
  const host = process.env.SMTP_HOST || "smtp.gmail.com"
  const port = Number(process.env.SMTP_PORT || 465)
  const secure = resolveBoolean(process.env.SMTP_SECURE, port === 465)
  const user = normalizeEnvText(process.env.SMTP_USER)
  const pass = normalizeEnvText(process.env.SMTP_PASS)
  const configuredAuthMode = resolveSmtpAuthMode(process.env.SMTP_AUTH_MODE || process.env.SMTP_AUTH)
  const useAuth = configuredAuthMode
    ? configuredAuthMode === "auth"
    : Boolean(user || pass)

  if (useAuth && (!user || !pass)) {
    console.error(
      "❌ Missing SMTP credentials. Set SMTP_USER and SMTP_PASS, or disable auth with SMTP_AUTH_MODE=none."
    )
    process.exit(1)
  }

  if (MAILER_DEBUG) {
    console.log("SMTP config:", {
      host,
      port,
      secure,
      user,
      passLen: pass ? pass.length : 0,
      authMode: configuredAuthMode || (useAuth ? "auth" : "none"),
    })
  }

  /** @type {{
   *   host: string
   *   port: number
   *   secure: boolean
   *   logger: boolean
   *   debug: boolean
   *   auth?: { user: string, pass: string }
   * }} */
  const transportOptions = {
    host,
    port,
    secure,
    logger: MAILER_DEBUG,
    debug: MAILER_DEBUG,
  }
  if (useAuth) {
    transportOptions.auth = { user, pass }
  }

  const transporter = nodemailer.createTransport(transportOptions)

  // Verify once at startup (non-fatal if it fails; server can still start)
  transporter
    .verify()
    .then(() => {
      STATUS.lastVerifyOk = true
      STATUS.lastVerifyAt = new Date().toISOString()
      if (MAILER_DEBUG) console.log("✅ SMTP ready: verification OK")
    })
    .catch((err) => {
      STATUS.lastVerifyOk = false
      STATUS.lastVerifyAt = new Date().toISOString()
      const error = err instanceof Error ? err : new Error(String(err))
      STATUS.lastError = String(error.message || err)
      console.error("❌ SMTP verify failed:", STATUS.lastError)
    })

  return transporter
}

/* =========================
    Request Handler
   ========================= */

/** @param {MailerRequest} request @param {MailerResponse} response @param {import("nodemailer").Transporter} transporter */
async function handleRequest(request, response, transporter) {
  const { method } = request
  const url = new URL(request.url || "", `http://${request.headers.host || "localhost"}`)

  if ((method === "GET" || method === "HEAD") && url.pathname === "/robots.txt") {
    response.writeHead(200, {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(ROBOTS_TXT_BODY)),
    })
    response.end(method === "HEAD" ? undefined : ROBOTS_TXT_BODY)
    return
  }

  const webAssetHandled = handleWebAssetStaticRequest(request, response, url.pathname)
  if (webAssetHandled) return

  const adminHandled = await handleStudentAdminRequest(request, response)
  if (adminHandled) return

  const docsHandled = handleDocsStaticRequest(request, response, url.pathname)
  if (docsHandled) return

  // Health endpoint (no CORS needed, but harmless if included)
  if (method === "GET" && url.pathname === "/healthz") {
    const body = await buildRuntimeHealthPayload()
    allowCors(request, response)
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify(body))
    return
  }

  // Preflight
  if (method === "OPTIONS") {
    if (url.pathname === DEFAULT_PATH || url.pathname === DEFAULT_INTAKE_PATH) {
      allowCors(request, response)
      response.writeHead(204)
      response.end()
      return
    }
  }

  // Only POST on supported API paths
  if (
    method !== "POST" ||
    (url.pathname !== DEFAULT_PATH && url.pathname !== DEFAULT_INTAKE_PATH)
  ) {
    allowCors(request, response)
    response.writeHead(404, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ error: "Not Found" }))
    return
  }

  try {
    const moodleRequest = isMoodleSourceRequest(request)
    const payloadResult = moodleRequest ? await parseBodyWithRaw(request) : { raw: "", parsed: await parseBody(request) }
    const payload = /** @type {SubmissionPayload} */ (payloadResult.parsed)

    if (url.pathname === DEFAULT_INTAKE_PATH) {
      const validated = validateIntakePayload(payload)
      const storeResult = await persistStudentIntakeSubmission(validated)
      STATUS.lastIntakeStoreOk = Boolean(storeResult?.saved)
      STATUS.lastIntakeStoreAt = new Date().toISOString()

      if (MAILER_DEBUG) {
        console.log("Processed student intake submission:", {
          saved: Boolean(storeResult?.saved),
          reason: storeResult?.reason || "",
          studentId: storeResult?.studentId || "",
          intakeSubmissionId: storeResult?.intakeSubmissionId || "",
          requiredValidationOk: storeResult?.requiredValidationOk,
        })
      }

      allowCors(request, response)
      response.writeHead(204)
      response.end()
      return
    }

    if (moodleRequest) {
      if (!MOODLE_QUIZ_SYNC_SHARED_SECRET) {
        const error = /** @type {StatusError & Error} */ (new Error("Moodle quiz sync is not configured"))
        error.statusCode = 503
        throw error
      }

      const signatureCheck = verifyMoodleRequestSignature({
        source: request.headers[MOODLE_REQUEST_HEADER_SOURCE],
        timestamp: request.headers[MOODLE_REQUEST_HEADER_TIMESTAMP],
        signature: request.headers[MOODLE_REQUEST_HEADER_SIGNATURE],
        rawBody: payloadResult.raw,
        sharedSecret: MOODLE_QUIZ_SYNC_SHARED_SECRET,
        maxAgeMs: MOODLE_SIGNATURE_MAX_AGE_MS,
      })

      if (!signatureCheck.ok) {
        const error = /** @type {StatusError & Error} */ (new Error(
          signatureCheck.reason === "stale-request"
            ? "Moodle request is stale"
            : signatureCheck.reason === "missing-secret"
              ? "Moodle quiz sync is not configured"
              : "Moodle request signature is invalid"
        ))
        error.statusCode =
          signatureCheck.reason === "stale-request"
            ? 401
            : signatureCheck.reason === "missing-secret"
              ? 503
              : signatureCheck.reason === "invalid-timestamp"
                ? 400
                : 403
        throw error
      }
    }

    const normalizedPayload = moodleRequest ? normalizeMoodlePayload(payload) : payload
    const validated = validatePayload(normalizedPayload, {
      allowMissingEmail: moodleRequest,
    })
    const browserExerciseSource = isBrowserExerciseSource(validated.sourceSystem)
    const submissionActorKey = buildSubmissionActorKey(validated)

    await withSubmissionLock(submissionActorKey, async () => {
      /** @type {ExerciseStoreResult | null} */
      let storeResult = null
      let shouldSendTeacherNotification = !moodleRequest && !browserExerciseSource
      let shouldSendLearnerNotification = !moodleRequest && Boolean(normalizeEnvText(validated.email))

      try {
        storeResult = await persistExerciseSubmission(validated, {
          suppressNotifications: moodleRequest,
        })
        if (storeResult?.saved) {
          STATUS.lastStoreOk = true
          STATUS.lastStoreAt = new Date().toISOString()
          if (storeResult?.shouldNotify === false) {
            shouldSendTeacherNotification = false
            shouldSendLearnerNotification = false
          }
          if (MAILER_DEBUG) {
            console.log("Saved exercise submission:", {
              submissionId: storeResult.submissionId,
              incomingResultId: storeResult.incomingResultId,
              deduplicated: Boolean(storeResult.deduplicated),
              scorePercent: storeResult?.summary?.scorePercent,
            })
          }
        }
      } catch (storeError) {
        STATUS.lastStoreOk = false
        STATUS.lastStoreAt = new Date().toISOString()
        const error = storeError instanceof Error ? storeError : new Error(String(storeError))
        STATUS.lastError = String(error.message || storeError)
        if (isExerciseStoreRequired()) throw storeError
        console.warn("⚠️ Submission persisted to email only (database write failed):", STATUS.lastError)
      }

      if (!shouldSendTeacherNotification && !shouldSendLearnerNotification) {
        STATUS.lastSendOk = true
        STATUS.lastSendAt = new Date().toISOString()
        if (MAILER_DEBUG) {
          console.log("Suppressed duplicate exercise notification:", {
            incomingResultId: storeResult?.incomingResultId || "",
            deduplicated: Boolean(storeResult?.deduplicated),
          })
        }
        return
      }

      const notificationKey = buildSubmissionNotificationKey(validated)
      if (hasRecentSubmissionNotification(notificationKey)) {
        STATUS.lastSendOk = true
        STATUS.lastSendAt = new Date().toISOString()
        if (MAILER_DEBUG) {
          console.log("Suppressed duplicate exercise notification:", {
            reason: "already-notified",
            notificationKey,
          })
        }
        return
      }

      const emailData = createEmail(validated)
      const from = process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@eaglesvn.online"

      if (shouldSendTeacherNotification) {
        const teacherTo = emailData.teacherEmail.to.length
          ? emailData.teacherEmail.to
          : DEFAULT_RECIPIENTS

        if (!teacherTo.length) {
          throw new Error("No recipients configured")
        }

        if (MAILER_DEBUG) {
          console.log("Sending message →", {
            from,
            to: teacherTo,
            subject: emailData.teacherEmail.subject,
          })
        }

        await transporter.sendMail({
          from,
          to: teacherTo,
          subject: emailData.teacherEmail.subject,
          text: emailData.teacherEmail.text,
          html: emailData.teacherEmail.html,
          replyTo: validated.email || undefined,
        })
      }

      if (shouldSendLearnerNotification && emailData.learnerEmail) {
        await transporter.sendMail({
          from,
          to: emailData.learnerEmail.to,
          subject: emailData.learnerEmail.subject,
          text: emailData.learnerEmail.text,
          html: emailData.learnerEmail.html,
        })
      }

      markSubmissionNotificationSent(notificationKey)
      STATUS.lastSendOk = true
      STATUS.lastSendAt = new Date().toISOString()
      if (MAILER_DEBUG)
        console.log("✉️  Mail sent:", {
          teacherNotified: shouldSendTeacherNotification,
          learnerNotified: shouldSendLearnerNotification,
          subject: emailData.teacherEmail.subject,
          sourceSystem: normalizeEnvText(validated.sourceSystem) || "(none)",
        })
    })

    // CORS + 204 success
    allowCors(request, response)
    response.writeHead(204)
    response.end()
  } catch (error) {
    STATUS.lastSendOk = false
    STATUS.lastSendAt = new Date().toISOString()
    const err = error instanceof Error ? error : new Error(String(error))
    STATUS.lastError = String(err.message || error)
    const status =
      ((/** @type {StatusError} */ (err)).statusCode === 400) ||
      err.message === "Missing intake form fields" ||
      err.message === "Invalid intake payload"
        ? 400
        : 500
    if (MAILER_DEBUG) console.error("❌ Send failed:", STATUS.lastError)

    // CORS + JSON error
    allowCors(request, response)
    response.writeHead(status, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ error: err.message || "Submission failed" }))
  }
}

/* =========================
    Server Bootstrap
   ========================= */

/**
 * @param {{
 *   transporter?: import("nodemailer").Transporter
 *   port?: number | string | null
 *   host?: string | null
 * }} [options={}]
 */
export function startExerciseMailer(options = {}) {
  assertRuntimeEnvironmentSeparation()
  const transporter = options.transporter || createTransport()
  const hasExplicitPort = options.port !== undefined && options.port !== null
  const port = hasExplicitPort ? Number(options.port) : resolveRuntimeMailerPort()
  const host =
    options.host === undefined || options.host === null ? DEFAULT_HOST : String(options.host)
  const selfHealLoop = startRuntimeSelfHealLoop()
  const studentNewsAutoApprovalLoop = startStudentNewsAutoApprovalLoop()
  setStudentAdminRuntimeHealthProvider(() => buildRuntimeHealthPayload())

  const server = http.createServer((request, response) => {
    handleRequest(request, response, transporter).catch((error) => {
      // Ensure CORS even on unexpected errors
      allowCors(request, response)
      response.writeHead(500, { "Content-Type": "application/json" })
      const err = error instanceof Error ? error : new Error(String(error))
      response.end(JSON.stringify({ error: err.message || "Submission failed" }))
    })
  })

  server.listen(port, host, () => {
    const boundAddress = server.address()
    const boundHost =
      boundAddress && typeof boundAddress === "object" && "address" in boundAddress
        ? boundAddress.address
        : host
    const boundPort =
      boundAddress && typeof boundAddress === "object" && "port" in boundAddress
        ? boundAddress.port
        : port
    const extra = MAILER_DEBUG ? " (MAILER_DEBUG=true)" : ""
    console.log(
      `exercise-mailer listening on ${boundHost}:${boundPort} at ${DEFAULT_PATH} and ${DEFAULT_INTAKE_PATH} (health: /healthz)${extra}`
    )
  })

  server.once("close", () => {
    void closeStudentAdminRuntimeResources().catch(() => {})
    if (selfHealLoop && typeof selfHealLoop.stop === "function") {
      selfHealLoop.stop()
    }
    if (studentNewsAutoApprovalLoop && typeof studentNewsAutoApprovalLoop.stop === "function") {
      studentNewsAutoApprovalLoop.stop()
    }
  })

  return server
}

const modulePath = fileURLToPath(import.meta.url)
const entryArg = process.argv[1] ? path.resolve(process.argv[1]) : ""
const invokedDirectly = entryArg && entryArg === modulePath

if (invokedDirectly) {
  startExerciseMailer()
}
