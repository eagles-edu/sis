// server/exercise-mailer.mjs
import { createRequire } from "node:module"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { URL, fileURLToPath } from "node:url"
import { isExerciseStoreRequired, persistExerciseSubmission } from "./exercise-store.mjs"
import { persistStudentIntakeSubmission } from "./student-intake-store.mjs"
import {
  getStudentAdminRuntimeStatus,
  handleStudentAdminRequest,
} from "./student-admin-routes.mjs"

const require = createRequire(import.meta.url)
const isDebugEnabled = () =>
  String(process.env.MAILER_DEBUG || "")
    .trim()
    .toLowerCase() === "true"

try {
  require("dotenv/config")
} catch (error) {
  if (error && error.code !== "MODULE_NOT_FOUND") throw error
  if (isDebugEnabled()) {
    console.warn("ℹ️  Optional dependency 'dotenv' not found; continuing without loading .env file")
  }
}

let nodemailer = null

try {
  const mod = require("nodemailer")
  nodemailer = mod?.default || mod
} catch (error) {
  if (error && error.code !== "MODULE_NOT_FOUND") throw error
  if (isDebugEnabled()) {
    console.warn(
      "ℹ️  Optional dependency 'nodemailer' not found; provide a transporter or install it"
    )
  }
}

/* =========================
  Configuration & Defaults
   ========================= */

const DEFAULT_PORT = Number(process.env.EXERCISE_MAILER_PORT || 8787)
const DEFAULT_PATH = process.env.EXERCISE_MAILER_PATH || "/api/exercise-submission"
const DEFAULT_INTAKE_PATH =
  process.env.EXERCISE_MAILER_INTAKE_PATH || "/api/student-intake-submission"
const DEFAULT_HOST = process.env.EXERCISE_MAILER_HOST || "0.0.0.0"

// Multiple origins supported: comma separated string, exact match with scheme+host[:port]
function getOriginList() {
  return (process.env.EXERCISE_MAILER_ORIGIN || process.env.EXERCISE_MAILER_ORIGINS || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

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

// Toggle verbose logs
const MAILER_DEBUG = isDebugEnabled()

// Default recipients (comma-separated email list)
const DEFAULT_RECIPIENTS = (process.env.EXERCISE_MAILER_RECIPIENTS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean)

/* =========================
  Runtime Status (healthz)
   ========================= */

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
const SELF_HEAL_STATUS = {
  enabled: false,
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

/* =========================
    Helpers
   ========================= */

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
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

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

function applyRuntimeSelfHealStatus(config) {
  SELF_HEAL_STATUS.enabled = Boolean(config?.enabled)
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

function runRuntimeSelfHealCheck(config) {
  const checkedAt = new Date().toISOString()
  SELF_HEAL_STATUS.lastCheckedAt = checkedAt
  if (!config?.enabled) return

  try {
    const sourceBuffer = fs.readFileSync(config.sourceHtmlPath)
    let runtimeBuffer = null
    try {
      runtimeBuffer = fs.readFileSync(config.runtimeHtmlPath)
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error
    }

    const mismatch = !runtimeBuffer || !sourceBuffer.equals(runtimeBuffer)
    if (!mismatch) {
      SELF_HEAL_STATUS.lastResult = "in-sync"
      SELF_HEAL_STATUS.lastError = ""
      return
    }

    SELF_HEAL_STATUS.lastMismatchAt = checkedAt
    fs.mkdirSync(path.dirname(config.runtimeHtmlPath), { recursive: true })
    fs.writeFileSync(config.runtimeHtmlPath, sourceBuffer)
    SELF_HEAL_STATUS.lastSyncAt = new Date().toISOString()
    SELF_HEAL_STATUS.syncCount += 1
    SELF_HEAL_STATUS.lastResult = "synced"
    SELF_HEAL_STATUS.lastError = ""

    console.log(
      `[self-heal] synced ${config.runtimeHtmlPath} from ${config.sourceHtmlPath}`
    )
  } catch (error) {
    SELF_HEAL_STATUS.lastResult = "error"
    SELF_HEAL_STATUS.lastError = String(error?.message || error)
    if (MAILER_DEBUG) {
      console.warn(`[self-heal] check failed: ${SELF_HEAL_STATUS.lastError}`)
    }
  }
}

function startRuntimeSelfHealLoop() {
  const config = resolveRuntimeSelfHealConfig()
  applyRuntimeSelfHealStatus(config)

  if (!config.enabled) {
    return { stop() {} }
  }

  runRuntimeSelfHealCheck(config)
  const timer = setInterval(() => {
    runRuntimeSelfHealCheck(config)
  }, config.intervalMs)
  if (typeof timer.unref === "function") timer.unref()

  return {
    stop() {
      clearInterval(timer)
    },
  }
}

function getRuntimeSelfHealStatus() {
  return {
    enabled: SELF_HEAL_STATUS.enabled,
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

function coerceArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  return [value].filter(Boolean)
}

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

function decodeCodePoints(value) {
  if (value === undefined || value === null) return ""
  let list = []
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

function decodeRecipientToken(token) {
  if (token === undefined || token === null) return ""
  if (typeof token === "string") return token.trim()
  if (typeof token === "number") return fromCodePointSafe(token)
  if (Array.isArray(token)) return decodeCodePoints(token)
  if (typeof token === "object") {
    if (typeof token.email === "string") return token.email.trim()
    if (typeof token.value === "string") return token.value.trim()
    if (typeof token.utf8 === "string") return decodeUtf8Hex(token.utf8)
    if (Array.isArray(token.utf8)) return decodeCodePoints(token.utf8)
    const codePoints =
      token.codePoints ||
      token.codepoints ||
      token.code_point ||
      token.codepoint ||
      token.cp ||
      token.points ||
      token.codes
    if (codePoints != null) {
      const decoded = decodeCodePoints(codePoints)
      if (decoded) return decoded
    }
    if (typeof token.bytes === "string") return decodeUtf8Hex(token.bytes)
    if (Array.isArray(token.bytes)) return decodeCodePoints(token.bytes)
  }
  return ""
}

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

function formatAnswers(answers) {
  if (!Array.isArray(answers) || !answers.length) return "(no answers recorded)"
  const rows = answers.map((entry) => {
    const id = entry && entry.id ? String(entry.id) : "?"
    const values = Array.isArray(entry?.answers) ? entry.answers : []
    const formattedValues = values
      .map((value, index) => `  ${index + 1}. ${value || "(blank)"}`)
      .join("\n")
    return `Question ${id}:\n${formattedValues || "  (no responses)"}`
  })
  return rows.join("\n\n")
}

function isEmailLike(value) {
  if (typeof value !== "string") return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

function createEmail({ email, studentId, pageTitle, completedAt, recipients, answers }) {
  const to = coerceArray(recipients)
  const trimmedEmail = isEmailLike(email) ? email.trim() : ""
  const submittedAt = completedAt || new Date().toISOString()
  const subjectBase = `Exercise submission${pageTitle ? ` — ${pageTitle}` : ""}`
  const teacherSubject = `${studentId ? `${studentId} ` : ""}${subjectBase}`

  const studentDisplayId = studentId || "(not provided)"
  const introIdentifier = studentId ? studentId : "Student ID (not provided)"
  const studentIdLine = `Student ID: ${studentDisplayId}`
  const studentEmailLine = trimmedEmail
    ? `Student email: ${trimmedEmail}`
    : "Student email: (not provided)"

  const textBody = [
    `${introIdentifier} just completed ${pageTitle || "an exercise"}.`,
    "",
    `Submitted at: ${submittedAt}`,
    studentEmailLine,
    studentIdLine,
    "",
    formatAnswers(answers),
  ].join("\n")

  const htmlAnswers = Array.isArray(answers)
    ? answers
        .map((entry) => {
          const id = entry && entry.id ? String(entry.id) : "?"
          const values = Array.isArray(entry?.answers) ? entry.answers : []
          const items = values
            .map(
              (value, index) =>
                `<li><strong>${index + 1}.</strong> ${value || "<em>(blank)</em>"}</li>`
            )
            .join("")
          return `<section><h3>Question ${id}</h3><ol>${items || "<li><em>(no responses)</em></li>"}</ol></section>`
        })
        .join("")
    : "<p><em>No answers recorded.</em></p>"

  const htmlBody = `
    <div>
      <p><strong>${introIdentifier}</strong> just completed <strong>${pageTitle || "an exercise"}</strong>.</p>
      <ul>
        <li><strong>Submitted at:</strong> ${submittedAt}</li>
        <li><strong>Student email:</strong> ${trimmedEmail || "(not provided)"}</li>
        <li><strong>Student ID:</strong> ${studentDisplayId}</li>
      </ul>
      ${htmlAnswers}
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
      `Student ID: ${studentId || "(not provided)"}`,
      `Email: ${trimmedEmail}`,
    ].join("\n")

    const learnerHtml = `
      <div>
        <p>Thanks for completing <strong>${pageName}</strong>.</p>
        <ul>
          <li><strong>Submitted at:</strong> ${submittedAt}</li>
          <li><strong>Student ID:</strong> ${studentId || "(not provided)"}</li>
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

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let raw = ""
    request.on("data", (chunk) => {
      raw += chunk
      if (raw.length > 1e6) {
        request.destroy()
        reject(new Error("Payload too large"))
      }
    })
    request.on("end", () => {
      try {
        const parsed = raw ? JSON.parse(raw) : {}
        resolve(parsed)
      } catch (error) {
        reject(error)
      }
    })
    request.on("error", reject)
  })
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid payload")
  const email = typeof payload.email === "string" ? payload.email.trim() : ""
  const studentId = typeof payload.studentId === "string" ? payload.studentId.trim() : ""
  const answers = Array.isArray(payload.answers) ? payload.answers : []
  if (!answers.length) throw new Error("Missing answers")
  return {
    email,
    studentId,
    pageTitle: typeof payload.pageTitle === "string" ? payload.pageTitle.trim() : "",
    completedAt:
      typeof payload.completedAt === "string" ? payload.completedAt : new Date().toISOString(),
    recipients: decodeRecipients(Array.isArray(payload.recipients) ? payload.recipients : []),
    answers,
  }
}

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

  const maps = []
  if (payload && typeof payload === "object") maps.push(payload)
  if (payload?.fields && typeof payload.fields === "object") maps.push(payload.fields)
  if (payload?.cf && typeof payload.cf === "object") maps.push(payload.cf)
  if (payload?.form && typeof payload.form === "object") maps.push(payload.form)
  if (payload?.data && typeof payload.data === "object") maps.push(payload.data)
  for (let i = 0; i < maps.length; i += 1) {
    if (mapHasData(maps[i])) return true
  }
  return false
}

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

function allowCors(request, response) {
  const reqOrigin = String(request.headers.origin || "").trim()
  const origins = getOriginList()
  let allowOrigin = "null"

  if (origins.includes("*")) {
    allowOrigin = "*"
  } else if (reqOrigin && (origins.includes(reqOrigin) || isLoopbackOrigin(reqOrigin))) {
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

function createTransport() {
  if (!nodemailer) {
    throw new Error(
      "nodemailer dependency is unavailable. Install it or pass in options.transporter."
    )
  }
  const host = process.env.SMTP_HOST || "smtp.gmail.com"
  const port = Number(process.env.SMTP_PORT || 465)
  const secure = resolveBoolean(process.env.SMTP_SECURE, port === 465)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  // Fail fast: creds must exist for Gmail/App Password flow
  if (!user || !pass) {
    console.error("❌ Missing SMTP credentials. Set SMTP_USER and SMTP_PASS in environment.")
    process.exit(1)
  }

  if (MAILER_DEBUG) {
    console.log("SMTP config:", {
      host,
      port,
      secure,
      user,
      passLen: pass ? pass.length : 0,
    })
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    logger: MAILER_DEBUG,
    debug: MAILER_DEBUG,
  })

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
      STATUS.lastError = String(err?.message || err)
      console.error("❌ SMTP verify failed:", STATUS.lastError)
    })

  return transporter
}

/* =========================
    Request Handler
   ========================= */

async function handleRequest(request, response, transporter) {
  const { method } = request
  const url = new URL(request.url || "", `http://${request.headers.host || "localhost"}`)

  const adminHandled = await handleStudentAdminRequest(request, response)
  if (adminHandled) return

  // Health endpoint (no CORS needed, but harmless if included)
  if (method === "GET" && url.pathname === "/healthz") {
    const studentAdminRuntime = getStudentAdminRuntimeStatus()
    const body = {
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
      runtimeSelfHeal: getRuntimeSelfHealStatus(),
    }
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
    const payload = await parseBody(request)

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

    const validated = validatePayload(payload)

    try {
      const storeResult = await persistExerciseSubmission(validated)
      if (storeResult?.saved) {
        STATUS.lastStoreOk = true
        STATUS.lastStoreAt = new Date().toISOString()
        if (MAILER_DEBUG) {
          console.log("Saved exercise submission:", {
            submissionId: storeResult.submissionId,
            scorePercent: storeResult?.summary?.scorePercent,
          })
        }
      }
    } catch (storeError) {
      STATUS.lastStoreOk = false
      STATUS.lastStoreAt = new Date().toISOString()
      STATUS.lastError = String(storeError?.message || storeError)
      if (isExerciseStoreRequired()) throw storeError
      console.warn("⚠️ Submission persisted to email only (database write failed):", STATUS.lastError)
    }

    const emailData = createEmail(validated)
    const teacherTo = emailData.teacherEmail.to.length
      ? emailData.teacherEmail.to
      : DEFAULT_RECIPIENTS

    if (!teacherTo.length) {
      throw new Error("No recipients configured")
    }
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@eaglesvn.online"

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

    if (emailData.learnerEmail) {
      await transporter.sendMail({
        from,
        to: emailData.learnerEmail.to,
        subject: emailData.learnerEmail.subject,
        text: emailData.learnerEmail.text,
        html: emailData.learnerEmail.html,
      })
    }

    STATUS.lastSendOk = true
    STATUS.lastSendAt = new Date().toISOString()
    if (MAILER_DEBUG)
      console.log("✉️  Mail sent:", {
        to: teacherTo,
        subject: emailData.teacherEmail.subject,
        learnerNotified: Boolean(emailData.learnerEmail),
      })

    // CORS + 204 success
    allowCors(request, response)
    response.writeHead(204)
    response.end()
  } catch (error) {
    STATUS.lastSendOk = false
    STATUS.lastSendAt = new Date().toISOString()
    STATUS.lastError = String(error?.message || error)
    const status =
      error.message === "Missing answers" ||
      error.message === "Missing intake form fields" ||
      error.message === "Invalid intake payload"
        ? 400
        : 500
    if (MAILER_DEBUG) console.error("❌ Send failed:", STATUS.lastError)

    // CORS + JSON error
    allowCors(request, response)
    response.writeHead(status, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ error: error.message || "Submission failed" }))
  }
}

/* =========================
    Server Bootstrap
   ========================= */

export function startExerciseMailer(options = {}) {
  const transporter = options.transporter || createTransport()
  const port =
    options.port === undefined || options.port === null ? DEFAULT_PORT : Number(options.port)
  const host =
    options.host === undefined || options.host === null ? DEFAULT_HOST : String(options.host)
  const selfHealLoop = startRuntimeSelfHealLoop()

  const server = http.createServer((request, response) => {
    handleRequest(request, response, transporter).catch((error) => {
      // Ensure CORS even on unexpected errors
      allowCors(request, response)
      response.writeHead(500, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: error.message || "Submission failed" }))
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
    if (selfHealLoop && typeof selfHealLoop.stop === "function") {
      selfHealLoop.stop()
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
