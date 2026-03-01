// server/student-admin-routes.mjs

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import * as XLSX from "xlsx"
import {
  deleteIncomingExerciseResultById,
  getIncomingExerciseResultById,
  INCOMING_EXERCISE_RESULT_STATUS_ARCHIVED,
  INCOMING_EXERCISE_RESULT_STATUS_QUEUED,
  INCOMING_EXERCISE_RESULT_STATUS_TEMPORARY,
  listIncomingExerciseResults,
  resolveIncomingExerciseResultToStudent,
  setIncomingExerciseResultStatus,
} from "./exercise-store.mjs"
import {
  deleteAttendanceRecord,
  deleteGradeRecord,
  deleteParentClassReport,
  deleteStudent,
  findFamilyByEmergencyPhone,
  generateParentClassReportFromGrades,
  getAdminDashboardSummary,
  getStudentAdminFilterCacheStatus,
  getStudentById,
  importStudentsFromRows,
  isStudentAdminStoreEnabled,
  listExerciseTitles,
  listLevelAndSchoolFilters,
  listStudents,
  saveAttendanceRecord,
  saveGradeRecord,
  saveParentClassReport,
  saveStudent,
} from "./student-admin-store.mjs"
import {
  createAdminUser,
  deleteAdminUserById,
  findAdminUserForLogin,
  hasAdminUsersConfigured,
  listAdminUsers,
  updateAdminUserById,
} from "./student-admin-user-store.mjs"
import {
  buildReportCardFilename,
  generateStudentReportCardPdf,
} from "./student-report-card-pdf.mjs"
import { createStudentAdminSessionStore } from "./student-admin-session-store.mjs"
import { getSharedPrismaClient } from "./prisma-client-factory.mjs"

const ADMIN_PAGE_PATH = normalizePathPrefix(process.env.STUDENT_ADMIN_PAGE_PATH, "/admin/students")
const ADMIN_PAGE_DEFAULT_SLUG = "overview"
const ADMIN_PAGE_SECTIONS = [
  "overview",
  "student-admin",
  "profile",
  "attendance",
  "attendance-admin",
  "assignments",
  "assignments-data",
  "parent-tracking",
  "performance-data",
  "grades",
  "grades-data",
  "reports",
  "family",
  "users",
  "permissions",
  "settings",
]
const ADMIN_PAGE_SECTION_SET = new Set(ADMIN_PAGE_SECTIONS)
const ADMIN_PERMISSION_ROLES = ["admin", "teacher", "student", "parent"]
const ADMIN_API_PREFIX = normalizePathPrefix(process.env.STUDENT_ADMIN_API_PREFIX, "/api/admin")
const ADMIN_AUTH_PREFIX = `${ADMIN_API_PREFIX}/auth`
const ADMIN_USERS_PREFIX = `${ADMIN_API_PREFIX}/users`
const ADMIN_STUDENTS_PREFIX = `${ADMIN_API_PREFIX}/students`
const ADMIN_PERMISSIONS_PATH = `${ADMIN_API_PREFIX}/permissions`
const ADMIN_DASHBOARD_PATH = `${ADMIN_API_PREFIX}/dashboard`
const ADMIN_EXERCISE_TITLES_PATH = `${ADMIN_API_PREFIX}/exercise-titles`
const ADMIN_EXPORT_XLSX_PATH = `${ADMIN_API_PREFIX}/exports/xlsx`
const ADMIN_NOTIFY_EMAIL_PATH = `${ADMIN_API_PREFIX}/notifications/email`
const ADMIN_NOTIFY_BATCH_STATUS_PATH = `${ADMIN_API_PREFIX}/notifications/batch-status`
const ADMIN_INCOMING_EXERCISE_RESULTS_PATH = `${ADMIN_API_PREFIX}/exercise-results/incoming`
const ADMIN_USER_PATH_RE = new RegExp(`^${escapeRegex(ADMIN_USERS_PREFIX)}/([^/]+)$`)
const ADMIN_REPORT_CARD_PATH_RE = new RegExp(
  `^${escapeRegex(ADMIN_STUDENTS_PREFIX)}/([^/]+)/report-card\\.pdf$`
)
const ADMIN_STUDENT_PATH_RE = new RegExp(`^${escapeRegex(ADMIN_STUDENTS_PREFIX)}/([^/]+)$`)
const ADMIN_ATTENDANCE_PATH_RE = new RegExp(`^${escapeRegex(ADMIN_STUDENTS_PREFIX)}/([^/]+)/attendance$`)
const ADMIN_ATTENDANCE_DELETE_PATH_RE = new RegExp(
  `^${escapeRegex(ADMIN_STUDENTS_PREFIX)}/([^/]+)/attendance/([^/]+)$`
)
const ADMIN_GRADES_PATH_RE = new RegExp(`^${escapeRegex(ADMIN_STUDENTS_PREFIX)}/([^/]+)/grades$`)
const ADMIN_GRADE_DELETE_PATH_RE = new RegExp(
  `^${escapeRegex(ADMIN_STUDENTS_PREFIX)}/([^/]+)/grades/([^/]+)$`
)
const ADMIN_REPORTS_PATH_RE = new RegExp(`^${escapeRegex(ADMIN_STUDENTS_PREFIX)}/([^/]+)/reports$`)
const ADMIN_REPORTS_GENERATE_PATH_RE = new RegExp(
  `^${escapeRegex(ADMIN_STUDENTS_PREFIX)}/([^/]+)/reports/generate$`
)
const ADMIN_REPORTS_DELETE_PATH_RE = new RegExp(
  `^${escapeRegex(ADMIN_STUDENTS_PREFIX)}/([^/]+)/reports/([^/]+)$`
)
const ADMIN_HTML_PATH = path.resolve(process.cwd(), "web-asset/admin/student-admin.html")
const ADMIN_IMPORT_TEMPLATE_PATH = path.resolve(process.cwd(), "schemas/student-import-template.xlsx")
const ADMIN_PAGE_SECTION_PATH_RE = new RegExp(`^${escapeRegex(ADMIN_PAGE_PATH)}/([a-z0-9-]+)$`)

const SESSION_TTL_SECONDS = Math.max(
  60,
  Number.parseInt(String(process.env.STUDENT_ADMIN_SESSION_TTL_SECONDS || "28800"), 10) || 28800
)
const SESSION_COOKIE_NAME = normalizeText(process.env.STUDENT_ADMIN_SESSION_COOKIE_NAME) || "student_admin_sid"
const SESSION_COOKIE_PATH = normalizeText(process.env.STUDENT_ADMIN_SESSION_COOKIE_PATH) || "/"
const SESSION_COOKIE_SAME_SITE =
  normalizeText(process.env.STUDENT_ADMIN_SESSION_COOKIE_SAMESITE) || "Strict"
const SESSION_COOKIE_SECURE = resolveBoolean(
  process.env.STUDENT_ADMIN_SESSION_COOKIE_SECURE,
  normalizeText(process.env.NODE_ENV).toLowerCase() !== "test"
)
let ROLE_PERMISSIONS = null
const SESSION_STORE = createStudentAdminSessionStore({
  ttlSeconds: SESSION_TTL_SECONDS,
})

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizePathPrefix(value, fallback) {
  let normalized = normalizeText(value || fallback)
  if (!normalized) normalized = fallback
  if (!normalized.startsWith("/")) normalized = `/${normalized}`
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/, "")
  return normalized
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isPathWithinPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function resolveBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  const normalized = normalizeLower(value)
  if (!normalized) return fallback
  if (["true", "1", "yes", "on"].includes(normalized)) return true
  if (["false", "0", "no", "off"].includes(normalized)) return false
  return fallback
}

function isKnownRole(value) {
  return ADMIN_PERMISSION_ROLES.includes(normalizeLower(value))
}

function normalizeRoleName(value) {
  const role = normalizeLower(value)
  if (isKnownRole(role)) return role
  return "teacher"
}

function uniquePageList(values = [], fallback = []) {
  const normalized = Array.isArray(values)
    ? values
        .map((entry) => normalizeLower(entry))
        .filter((entry) => ADMIN_PAGE_SECTION_SET.has(entry))
    : []
  const selected = normalized.length ? normalized : fallback
  return Array.from(new Set(selected))
}

function createDefaultRolePermissions() {
  return {
    admin: {
      role: "admin",
      canRead: true,
      canWrite: true,
      canManageUsers: true,
      canManagePermissions: true,
      startPage: "overview",
      allowedPages: [...ADMIN_PAGE_SECTIONS],
    },
    teacher: {
      role: "teacher",
      canRead: true,
      canWrite: false,
      canManageUsers: false,
      canManagePermissions: false,
      startPage: "overview",
      allowedPages: ["overview", "profile", "attendance", "assignments", "parent-tracking", "grades", "reports", "family"],
    },
    student: {
      role: "student",
      canRead: true,
      canWrite: false,
      canManageUsers: false,
      canManagePermissions: false,
      startPage: "overview",
      allowedPages: ["overview", "profile", "reports"],
    },
    parent: {
      role: "parent",
      canRead: true,
      canWrite: false,
      canManageUsers: false,
      canManagePermissions: false,
      startPage: "family",
      allowedPages: ["overview", "family", "reports"],
    },
  }
}

const DEFAULT_ROLE_PERMISSIONS = createDefaultRolePermissions()

function normalizeRolePermission(role, source = {}, fallback = DEFAULT_ROLE_PERMISSIONS[role]) {
  const defaultPolicy = fallback || DEFAULT_ROLE_PERMISSIONS.teacher
  const allowedPages = uniquePageList(source.allowedPages, defaultPolicy.allowedPages)
  let startPage = normalizeLower(source.startPage)
  if (!startPage || !allowedPages.includes(startPage)) {
    startPage = allowedPages[0] || defaultPolicy.startPage || ADMIN_PAGE_DEFAULT_SLUG
  }

  return {
    role,
    canRead: resolveBoolean(source.canRead, defaultPolicy.canRead),
    canWrite: resolveBoolean(source.canWrite, defaultPolicy.canWrite),
    canManageUsers: resolveBoolean(source.canManageUsers, defaultPolicy.canManageUsers),
    canManagePermissions: resolveBoolean(source.canManagePermissions, defaultPolicy.canManagePermissions),
    startPage,
    allowedPages,
  }
}

function normalizeRolePermissionsPayload(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {}
  const normalized = {}

  ADMIN_PERMISSION_ROLES.forEach((role) => {
    normalized[role] = normalizeRolePermission(role, source[role], DEFAULT_ROLE_PERMISSIONS[role])
  })

  if (!normalized.admin.canManageUsers) normalized.admin.canManageUsers = true
  if (!normalized.admin.canManagePermissions) normalized.admin.canManagePermissions = true
  if (!normalized.admin.canRead) normalized.admin.canRead = true
  if (!normalized.admin.canWrite) normalized.admin.canWrite = true
  normalized.admin.allowedPages = uniquePageList(normalized.admin.allowedPages, DEFAULT_ROLE_PERMISSIONS.admin.allowedPages)
  DEFAULT_ROLE_PERMISSIONS.admin.allowedPages.forEach((pageSlug) => {
    if (!normalized.admin.allowedPages.includes(pageSlug)) normalized.admin.allowedPages.push(pageSlug)
  })
  if (!normalized.admin.allowedPages.includes(normalized.admin.startPage)) {
    normalized.admin.startPage = normalized.admin.allowedPages[0] || ADMIN_PAGE_DEFAULT_SLUG
  }

  return normalized
}

function loadRolePermissionsFromEnv() {
  const configured = normalizeText(process.env.STUDENT_ADMIN_ROLE_POLICIES_JSON)
  if (!configured) {
    return normalizeRolePermissionsPayload(DEFAULT_ROLE_PERMISSIONS)
  }

  try {
    const parsed = JSON.parse(configured)
    return normalizeRolePermissionsPayload(parsed)
  } catch (error) {
    console.warn(`STUDENT_ADMIN_ROLE_POLICIES_JSON parse failed: ${error.message}`)
    return normalizeRolePermissionsPayload(DEFAULT_ROLE_PERMISSIONS)
  }
}

function getRolePermissionsSnapshot() {
  if (!ROLE_PERMISSIONS) ROLE_PERMISSIONS = loadRolePermissionsFromEnv()
  return JSON.parse(JSON.stringify(ROLE_PERMISSIONS))
}

function getRolePolicy(role) {
  if (!ROLE_PERMISSIONS) ROLE_PERMISSIONS = loadRolePermissionsFromEnv()
  const normalizedRole = normalizeRoleName(role)
  return ROLE_PERMISSIONS[normalizedRole] || ROLE_PERMISSIONS.teacher || DEFAULT_ROLE_PERMISSIONS.teacher
}

function canManageUsers(sessionOrPolicy) {
  const policy =
    sessionOrPolicy && typeof sessionOrPolicy === "object" && Object.prototype.hasOwnProperty.call(sessionOrPolicy, "role")
      ? getRolePolicy(sessionOrPolicy.role)
      : sessionOrPolicy
  return resolveBoolean(policy?.canManageUsers, false)
}

function canManagePermissions(sessionOrPolicy) {
  const policy =
    sessionOrPolicy && typeof sessionOrPolicy === "object" && Object.prototype.hasOwnProperty.call(sessionOrPolicy, "role")
      ? getRolePolicy(sessionOrPolicy.role)
      : sessionOrPolicy
  return resolveBoolean(policy?.canManagePermissions, false)
}

function getOriginList() {
  return (process.env.EXERCISE_MAILER_ORIGIN || process.env.EXERCISE_MAILER_ORIGINS || "*")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function isLoopbackOrigin(origin) {
  const text = normalizeText(origin)
  if (!text) return false
  try {
    const parsed = new URL(text)
    const protocol = normalizeLower(parsed.protocol)
    if (protocol !== "http:" && protocol !== "https:") return false
    const hostname = normalizeLower(parsed.hostname)
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  } catch (error) {
    void error
    return false
  }
}

function allowCors(request, response) {
  const reqOrigin = normalizeText(request.headers.origin)
  const origins = getOriginList()
  let allowOrigin = "null"

  if (origins.includes("*")) allowOrigin = "*"
  else if (reqOrigin && (origins.includes(reqOrigin) || isLoopbackOrigin(reqOrigin))) allowOrigin = reqOrigin

  response.setHeader("Vary", "Origin")
  response.setHeader("Access-Control-Allow-Origin", allowOrigin)
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
  if (allowOrigin !== "*") {
    response.setHeader("Access-Control-Allow-Credentials", "true")
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
  })
  response.end(`${JSON.stringify(payload)}\n`)
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
  })
  response.end(html)
}

function injectAdminRuntimeConfig(html, pageSlug) {
  const runtimeConfig = `<script>window.__SIS_ADMIN_API_PREFIX=${JSON.stringify(ADMIN_API_PREFIX)};window.__SIS_ADMIN_PAGE_PATH=${JSON.stringify(ADMIN_PAGE_PATH)};window.__SIS_ADMIN_PAGE_SLUG=${JSON.stringify(pageSlug || ADMIN_PAGE_DEFAULT_SLUG)};window.__SIS_ADMIN_PAGE_SECTIONS=${JSON.stringify(ADMIN_PAGE_SECTIONS)};window.__SIS_ADMIN_PERMISSION_ROLES=${JSON.stringify(ADMIN_PERMISSION_ROLES)};window.__SIS_ADMIN_PERMISSIONS_PATH=${JSON.stringify(ADMIN_PERMISSIONS_PATH)};window.__SIS_ADMIN_DASHBOARD_PATH=${JSON.stringify(ADMIN_DASHBOARD_PATH)};window.__SIS_ADMIN_EXERCISE_TITLES_PATH=${JSON.stringify(ADMIN_EXERCISE_TITLES_PATH)};window.__SIS_ADMIN_NOTIFY_EMAIL_PATH=${JSON.stringify(ADMIN_NOTIFY_EMAIL_PATH)};window.__SIS_ADMIN_NOTIFY_BATCH_STATUS_PATH=${JSON.stringify(ADMIN_NOTIFY_BATCH_STATUS_PATH)};window.__SIS_ADMIN_INCOMING_EXERCISE_RESULTS_PATH=${JSON.stringify(ADMIN_INCOMING_EXERCISE_RESULTS_PATH)};</script>`
  if (html.includes("</head>")) {
    return html.replace("</head>", `  ${runtimeConfig}\n</head>`)
  }
  return `${runtimeConfig}\n${html}`
}

function resolveAdminPageSlug(pathname) {
  if (pathname === ADMIN_PAGE_PATH) return ADMIN_PAGE_DEFAULT_SLUG
  const match = pathname.match(ADMIN_PAGE_SECTION_PATH_RE)
  if (!match) return ""
  const slug = normalizeLower(match[1])
  if (!ADMIN_PAGE_SECTION_SET.has(slug)) return ""
  return slug
}

export function getStudentAdminRuntimeStatus() {
  return {
    pagePath: ADMIN_PAGE_PATH,
    apiPrefix: ADMIN_API_PREFIX,
    permissionsPath: ADMIN_PERMISSIONS_PATH,
    dashboardPath: ADMIN_DASHBOARD_PATH,
    exerciseTitlesPath: ADMIN_EXERCISE_TITLES_PATH,
    exportXlsxPath: ADMIN_EXPORT_XLSX_PATH,
    notifyEmailPath: ADMIN_NOTIFY_EMAIL_PATH,
    notifyBatchStatusPath: ADMIN_NOTIFY_BATCH_STATUS_PATH,
    incomingExerciseResultsPath: ADMIN_INCOMING_EXERCISE_RESULTS_PATH,
    notifyBatchQueue: getEmailBatchQueueRuntimeStatus(),
    pageDefaultSlug: ADMIN_PAGE_DEFAULT_SLUG,
    pageSections: [...ADMIN_PAGE_SECTIONS],
    permissionRoles: [...ADMIN_PERMISSION_ROLES],
    rolePermissions: getRolePermissionsSnapshot(),
    sessionDriver: SESSION_STORE.driver,
    sessionTtlSeconds: SESSION_TTL_SECONDS,
    sessionCookieName: SESSION_COOKIE_NAME,
    filterCache: getStudentAdminFilterCacheStatus(),
  }
}

function sendPdf(response, filename, payloadBuffer) {
  response.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(payloadBuffer.length),
    "Cache-Control": "no-store",
  })
  response.end(payloadBuffer)
}

function sendXlsx(response, filename, payloadBuffer) {
  response.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(payloadBuffer.length),
    "Cache-Control": "no-store",
  })
  response.end(payloadBuffer)
}

function sanitizeDownloadFilename(value, fallback = "export.xlsx") {
  const text = normalizeText(value)
  const normalized = text
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!normalized) return fallback
  if (normalized.toLowerCase().endsWith(".xlsx")) return normalized
  return `${normalized}.xlsx`
}

function normalizeWorksheetName(value, fallback = "Export") {
  const text = normalizeText(value)
    .replace(/[:\\/?*\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const picked = text || fallback
  return picked.slice(0, 31) || fallback
}

function normalizeExportCellValue(value) {
  if (value === undefined || value === null) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  try {
    return JSON.stringify(value)
  } catch (error) {
    void error
    return String(value)
  }
}

function buildXlsxFromPayload(payload = {}) {
  const columnsRaw = Array.isArray(payload?.columns) ? payload.columns : []
  const rowsRaw = Array.isArray(payload?.rows) ? payload.rows : []
  if (!columnsRaw.length) {
    const error = new Error("columns are required for XLSX export")
    error.statusCode = 400
    throw error
  }
  if (!rowsRaw.length) {
    const error = new Error("rows are required for XLSX export")
    error.statusCode = 400
    throw error
  }
  if (columnsRaw.length > 80 || rowsRaw.length > 20000) {
    const error = new Error("XLSX export exceeds allowed size")
    error.statusCode = 400
    throw error
  }

  const columns = columnsRaw.map((column) => {
    const key = normalizeText(column?.key)
    const label = normalizeText(column?.label) || key
    if (!key) {
      const error = new Error("Each XLSX export column requires a key")
      error.statusCode = 400
      throw error
    }
    return {
      key,
      label: label.slice(0, 120),
    }
  })

  const worksheetRows = rowsRaw.map((row) => {
    const source = row && typeof row === "object" ? row : {}
    const normalizedRow = {}
    columns.forEach((column) => {
      normalizedRow[column.label] = normalizeExportCellValue(source[column.key])
    })
    return normalizedRow
  })

  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.json_to_sheet(worksheetRows, {
    header: columns.map((column) => column.label),
  })
  XLSX.utils.book_append_sheet(workbook, worksheet, normalizeWorksheetName(payload?.sheetName, "Export"))
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" })
  return {
    filename: sanitizeDownloadFilename(payload?.filename, "export.xlsx"),
    buffer,
  }
}

function parseDelimitedRows(text, delimiter) {
  const rows = []
  let row = []
  let value = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === delimiter) {
      row.push(value)
      value = ""
      continue
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1
      row.push(value)
      value = ""
      if (row.some((cell) => normalizeText(cell))) rows.push(row)
      row = []
      continue
    }

    value += char
  }

  if (value || row.length) {
    row.push(value)
    if (row.some((cell) => normalizeText(cell))) rows.push(row)
  }

  return rows
}

function matrixToRows(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 1) return []
  const headers = matrix[0].map((cell) => normalizeText(cell))
  const rows = []
  for (let i = 1; i < matrix.length; i += 1) {
    const line = matrix[i]
    if (!Array.isArray(line)) continue
    const row = {}
    headers.forEach((header, index) => {
      row[header || `col_${index + 1}`] = normalizeText(line[index] || "")
    })
    rows.push(row)
  }
  return rows
}

function detectSpreadsheetFormat(fileName, explicitFormat) {
  const format = normalizeLower(explicitFormat)
  if (["xlsx", "xls", "csv", "tsv"].includes(format)) return format
  const lowerName = normalizeLower(fileName)
  if (lowerName.endsWith(".xlsx")) return "xlsx"
  if (lowerName.endsWith(".xls")) return "xls"
  if (lowerName.endsWith(".tsv")) return "tsv"
  return "csv"
}

export function parseSpreadsheetRowsFromUploadPayload(payload = {}) {
  if (Array.isArray(payload.rows)) return payload.rows

  const fileName = normalizeText(payload.fileName)
  const format = detectSpreadsheetFormat(fileName, payload.format)
  const base64Data = normalizeText(payload.fileDataBase64)
  if (!base64Data) {
    const error = new Error("Import payload must include rows or fileDataBase64")
    error.statusCode = 400
    throw error
  }

  const fileBuffer = Buffer.from(base64Data, "base64")
  if (!fileBuffer.length) {
    const error = new Error("Uploaded spreadsheet is empty")
    error.statusCode = 400
    throw error
  }

  if (format === "xlsx" || format === "xls") {
    const workbook = XLSX.read(fileBuffer, { type: "buffer" })
    const firstSheetName = Array.isArray(workbook.SheetNames) ? workbook.SheetNames[0] : ""
    if (!firstSheetName) {
      const error = new Error("Spreadsheet has no sheets")
      error.statusCode = 400
      throw error
    }
    const sheet = workbook.Sheets[firstSheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false })
    if (!Array.isArray(rows) || !rows.length) {
      const error = new Error("Spreadsheet has no data rows")
      error.statusCode = 400
      throw error
    }
    return rows
  }

  const text = fileBuffer.toString("utf8")
  const delimiter = format === "tsv" ? "\t" : ","
  const matrix = parseDelimitedRows(text, delimiter)
  const rows = matrixToRows(matrix)
  if (!rows.length) {
    const error = new Error("Spreadsheet has no data rows")
    error.statusCode = 400
    throw error
  }
  return rows
}

function verifyScryptPassword(password, hashValue) {
  const hashText = normalizeText(hashValue)
  const parts = hashText.split("$")
  if (parts.length !== 3 || parts[0] !== "scrypt") return false

  const saltHex = parts[1]
  const digestHex = parts[2]

  if (!saltHex || !digestHex) return false

  const expected = Buffer.from(digestHex, "hex")
  const derived = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length)

  if (expected.length !== derived.length) return false
  return crypto.timingSafeEqual(expected, derived)
}

function timingSafeEqualText(leftValue, rightValue) {
  const left = Buffer.from(normalizeText(leftValue))
  const right = Buffer.from(normalizeText(rightValue))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

function verifyPassword(plainText, hashValue, candidate) {
  if (normalizeText(hashValue)) return verifyScryptPassword(candidate, hashValue)
  if (!normalizeText(plainText)) return false
  return timingSafeEqualText(candidate, plainText)
}

function buildConfiguredAccounts() {
  const accounts = []

  const adminUser = normalizeText(process.env.STUDENT_ADMIN_USER) || "admin"
  const adminPass = normalizeText(process.env.STUDENT_ADMIN_PASS)
  const adminHash = normalizeText(process.env.STUDENT_ADMIN_PASSWORD_HASH)
  if (adminUser && (adminPass || adminHash)) {
    accounts.push({
      username: adminUser,
      role: "admin",
      password: adminPass,
      passwordHash: adminHash,
    })
  }

  const teacherUser = normalizeText(process.env.STUDENT_TEACHER_USER)
  const teacherPass = normalizeText(process.env.STUDENT_TEACHER_PASS)
  const teacherHash = normalizeText(process.env.STUDENT_TEACHER_PASSWORD_HASH)
  if (teacherUser && (teacherPass || teacherHash)) {
    accounts.push({
      username: teacherUser,
      role: "teacher",
      password: teacherPass,
      passwordHash: teacherHash,
    })
  }

  const studentUser = normalizeText(process.env.STUDENT_STUDENT_USER)
  const studentPass = normalizeText(process.env.STUDENT_STUDENT_PASS)
  const studentHash = normalizeText(process.env.STUDENT_STUDENT_PASSWORD_HASH)
  if (studentUser && (studentPass || studentHash)) {
    accounts.push({
      username: studentUser,
      role: "student",
      password: studentPass,
      passwordHash: studentHash,
    })
  }

  const parentUser = normalizeText(process.env.STUDENT_PARENT_USER)
  const parentPass = normalizeText(process.env.STUDENT_PARENT_PASS)
  const parentHash = normalizeText(process.env.STUDENT_PARENT_PASSWORD_HASH)
  if (parentUser && (parentPass || parentHash)) {
    accounts.push({
      username: parentUser,
      role: "parent",
      password: parentPass,
      passwordHash: parentHash,
    })
  }

  const jsonText = normalizeText(process.env.STUDENT_ADMIN_ACCOUNTS_JSON)
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText)
      if (Array.isArray(parsed)) {
        parsed.forEach((entry) => {
          const username = normalizeText(entry?.username)
          const role = normalizeLower(entry?.role) || "teacher"
          const password = normalizeText(entry?.password)
          const passwordHash = normalizeText(entry?.passwordHash)
          if (!username || (!password && !passwordHash)) return
          accounts.push({ username, role: normalizeRoleName(role), password, passwordHash })
        })
      }
    } catch (error) {
      console.warn(`STUDENT_ADMIN_ACCOUNTS_JSON parse failed: ${error.message}`)
    }
  }

  return accounts
}

async function verifyCredentials(username, password) {
  const requestedUser = normalizeText(username)
  const inputPassword = normalizeText(password)

  if (isStudentAdminStoreEnabled()) {
    const dbUser = await findAdminUserForLogin(requestedUser)
    if (dbUser) {
      if (!verifyPassword("", dbUser.passwordHash, inputPassword)) return null
      return {
        username: dbUser.username,
        role: normalizeRoleName(dbUser.role),
      }
    }
  }

  const accounts = buildConfiguredAccounts()

  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i]
    if (!timingSafeEqualText(requestedUser, account.username)) continue
    if (!verifyPassword(account.password, account.passwordHash, inputPassword)) return null
    return {
      username: account.username,
      role: normalizeRoleName(account.role),
    }
  }

  return null
}

function parseCookies(cookieHeader) {
  const cookieMap = {}
  const raw = normalizeText(cookieHeader)
  if (!raw) return cookieMap

  raw.split(";").forEach((segment) => {
    const [nameRaw, ...rest] = segment.split("=")
    const name = normalizeText(nameRaw)
    if (!name) return
    const valueRaw = rest.join("=")
    try {
      cookieMap[name] = decodeURIComponent(valueRaw || "")
    } catch (error) {
      void error
      cookieMap[name] = valueRaw || ""
    }
  })

  return cookieMap
}

function normalizeSameSite(value) {
  const normalized = normalizeLower(value)
  if (normalized === "lax") return "Lax"
  if (normalized === "none") return "None"
  return "Strict"
}

function makeSessionCookieValue(sessionId, maxAgeSeconds) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    `Path=${SESSION_COOKIE_PATH}`,
    "HttpOnly",
    `SameSite=${normalizeSameSite(SESSION_COOKIE_SAME_SITE)}`,
  ]

  if (SESSION_COOKIE_SECURE) parts.push("Secure")
  if (Number.isInteger(maxAgeSeconds)) {
    parts.push(`Max-Age=${Math.max(0, maxAgeSeconds)}`)
    parts.push(`Expires=${new Date(Date.now() + Math.max(0, maxAgeSeconds) * 1000).toUTCString()}`)
  }

  return parts.join("; ")
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", makeSessionCookieValue("", 0))
}

function readSessionIdFromRequest(request) {
  const cookies = parseCookies(request.headers.cookie)
  return normalizeText(cookies[SESSION_COOKIE_NAME] || "")
}

async function requireAuthenticatedSession(request, response) {
  const sessionId = readSessionIdFromRequest(request)
  if (!sessionId) {
    const error = new Error("Unauthorized")
    error.statusCode = 401
    throw error
  }

  const session = await SESSION_STORE.touchSession(sessionId)
  if (!session) {
    clearSessionCookie(response)
    const error = new Error("Unauthorized")
    error.statusCode = 401
    throw error
  }

  response.setHeader("Set-Cookie", makeSessionCookieValue(sessionId, SESSION_TTL_SECONDS))
  return session
}

function canTeacherWriteParentTrackingPath(pathname, method) {
  if (method !== "POST") return false
  if (pathname === ADMIN_NOTIFY_EMAIL_PATH) return true
  if (ADMIN_REPORTS_PATH_RE.test(pathname)) return true
  return false
}

function enforceRoleAccess(session, method, pathname) {
  const policy = getRolePolicy(session?.role)
  if (!policy.canRead) {
    const error = new Error("Forbidden")
    error.statusCode = 403
    throw error
  }
  if (method !== "GET" && !policy.canWrite) {
    const isTeacher = normalizeRoleName(session?.role) === "teacher"
    if (isTeacher && canTeacherWriteParentTrackingPath(pathname, method)) {
      return policy
    }
    const error = new Error("Forbidden")
    error.statusCode = 403
    throw error
  }
  return policy
}

function assertCanManageUsers(policy) {
  if (canManageUsers(policy)) return
  const error = new Error("Forbidden")
  error.statusCode = 403
  throw error
}

function assertCanManagePermissions(policy) {
  if (canManagePermissions(policy)) return
  const error = new Error("Forbidden")
  error.statusCode = 403
  throw error
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let raw = ""
    request.on("data", (chunk) => {
      raw += chunk
      if (raw.length > 8e6) {
        request.destroy()
        reject(new Error("Payload too large"))
      }
    })
    request.on("end", () => {
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    request.on("error", reject)
  })
}

function withError(response, request, error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500
  const message = normalizeText(error?.message) || "Request failed"
  allowCors(request, response)
  sendJson(response, statusCode, { error: message })
}

async function handleLogin(request, response) {
  const payload = await parseBody(request)
  const username = normalizeText(payload.username)
  const password = normalizeText(payload.password)

  const principal = await verifyCredentials(username, password)
  if (!principal) {
    const error = new Error("Invalid username or password")
    error.statusCode = 401
    throw error
  }

  const session = await SESSION_STORE.createSession(principal)
  if (!session?.id) {
    const error = new Error("Unable to establish admin session")
    error.statusCode = 500
    throw error
  }

  response.setHeader("Set-Cookie", makeSessionCookieValue(session.id, SESSION_TTL_SECONDS))
  const rolePolicy = getRolePolicy(session.role)
  sendJson(response, 200, {
    authenticated: true,
    user: {
      username: session.username,
      role: session.role,
    },
    rolePolicy,
    expiresAt: session.expiresAt,
    sessionTtlSeconds: SESSION_TTL_SECONDS,
    sessionDriver: SESSION_STORE.driver,
  })
}

async function handleMe(request, response) {
  const session = await requireAuthenticatedSession(request, response)
  const rolePolicy = getRolePolicy(session.role)
  sendJson(response, 200, {
    authenticated: true,
    user: {
      username: session.username,
      role: session.role,
    },
    rolePolicy,
    expiresAt: session.expiresAt,
    sessionTtlSeconds: SESSION_TTL_SECONDS,
    sessionDriver: SESSION_STORE.driver,
  })
}

async function handleLogout(request, response) {
  const sessionId = readSessionIdFromRequest(request)
  if (sessionId) {
    await SESSION_STORE.deleteSession(sessionId)
  }
  clearSessionCookie(response)
  sendJson(response, 200, { authenticated: false, ok: true })
}

async function handlePermissionsGet(response, session) {
  const role = normalizeRoleName(session?.role)
  sendJson(response, 200, {
    role,
    rolePolicy: getRolePolicy(role),
    roles: getRolePermissionsSnapshot(),
    pageSections: [...ADMIN_PAGE_SECTIONS],
    editable: canManagePermissions(session),
  })
}

async function handlePermissionsPut(request, response, policy) {
  assertCanManagePermissions(policy)
  const payload = await parseBody(request)
  const nextPermissions = normalizeRolePermissionsPayload(payload?.roles || payload)
  ROLE_PERMISSIONS = nextPermissions
  sendJson(response, 200, {
    ok: true,
    roles: getRolePermissionsSnapshot(),
  })
}

async function assertCredentialsConfigured() {
  const accounts = buildConfiguredAccounts()
  if (accounts.length > 0) return

  if (isStudentAdminStoreEnabled()) {
    const hasUsers = await hasAdminUsersConfigured()
    if (hasUsers) return
  }

  {
    const error = new Error("Student admin credentials are not configured")
    error.statusCode = 503
    throw error
  }
}

function assertStoreEnabled() {
  if (isStudentAdminStoreEnabled()) return
  const error = new Error("Student admin store is disabled")
  error.statusCode = 503
  throw error
}

function isEmailLike(value) {
  const text = normalizeLower(value)
  if (!text) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
}

function normalizeRecipientList(value) {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((entry) => normalizeLower(entry))
        .filter((entry) => isEmailLike(entry))
    )
  )
}

let nodemailerModule = null

async function getNodemailer() {
  if (nodemailerModule) return nodemailerModule
  try {
    const mod = await import("nodemailer")
    nodemailerModule = mod?.default || mod
    return nodemailerModule
  } catch (error) {
    const wrapped = new Error("nodemailer is not available in runtime")
    wrapped.statusCode = 503
    throw wrapped
  }
}

function smtpConfigFromEnv() {
  const host = normalizeText(process.env.SMTP_HOST || "smtp.gmail.com")
  const port = Number.parseInt(String(process.env.SMTP_PORT || "465"), 10) || 465
  const secure = resolveBoolean(process.env.SMTP_SECURE, port === 465)
  const user = normalizeText(process.env.SMTP_USER)
  const pass = normalizeText(process.env.SMTP_PASS)
  const from = normalizeText(process.env.SMTP_FROM || user)
  if (!host || !user || !pass || !from) {
    const error = new Error("SMTP is not configured for assignment announcements")
    error.statusCode = 503
    throw error
  }
  return { host, port, secure, user, pass, from }
}

const WEEKEND_BATCH_WINDOWS = Object.freeze([
  { day: 6, hour: 12, minute: 0, label: "Sat 12:00" },
  { day: 6, hour: 15, minute: 30, label: "Sat 15:30" },
  { day: 6, hour: 18, minute: 0, label: "Sat 18:00" },
  { day: 6, hour: 20, minute: 15, label: "Sat 20:15" },
  { day: 0, hour: 12, minute: 0, label: "Sun 12:00" },
  { day: 0, hour: 15, minute: 30, label: "Sun 15:30" },
  { day: 0, hour: 18, minute: 0, label: "Sun 18:00" },
  { day: 0, hour: 20, minute: 15, label: "Sun 20:15" },
])
const NOTIFICATION_QUEUE_TYPE_PARENT_REPORT = "parent-report"
const NOTIFICATION_QUEUE_TYPE_ANNOUNCEMENT = "announcement"
const NOTIFICATION_QUEUE_STATUS_QUEUED = "queued"
const NOTIFICATION_QUEUE_STATUS_HOLD = "hold"
const NOTIFICATION_QUEUE_STATUS_SENT = "sent"
const EMAIL_QUEUE_BACKEND_MODE = (() => {
  const mode = normalizeLower(process.env.STUDENT_ADMIN_NOTIFY_QUEUE_BACKEND || "auto")
  if (mode === "database" || mode === "db" || mode === "postgres" || mode === "postgresql") return "database"
  if (mode === "memory" || mode === "in-memory") return "memory"
  return normalizeText(process.env.DATABASE_URL) ? "database" : "memory"
})()
const EMAIL_BATCH_QUEUE_LIMIT = Math.max(
  10,
  Number.parseInt(String(process.env.STUDENT_ADMIN_NOTIFY_BATCH_QUEUE_LIMIT || "4000"), 10) || 4000
)
const EMAIL_BATCH_QUEUE = []
let EMAIL_BATCH_LAST_RUN_AT = ""
let EMAIL_BATCH_LAST_RESULT = "idle"
let EMAIL_BATCH_LAST_ERROR = ""
let EMAIL_BATCH_LAST_KNOWN_SIZE = 0
let EMAIL_QUEUE_DB_DISABLED = EMAIL_QUEUE_BACKEND_MODE !== "database"
let EMAIL_QUEUE_DB_WARNED = false

function nowIso() {
  return new Date().toISOString()
}

function createQueueId(prefix = "notify") {
  const head = normalizeLower(prefix).replace(/[^a-z0-9]/g, "") || "notify"
  return `${head}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`
}

function normalizeQueueType(value) {
  const queueType = normalizeLower(value)
  if (queueType === NOTIFICATION_QUEUE_TYPE_PARENT_REPORT) return NOTIFICATION_QUEUE_TYPE_PARENT_REPORT
  return NOTIFICATION_QUEUE_TYPE_ANNOUNCEMENT
}

function normalizeQueueStatus(value) {
  const status = normalizeLower(value)
  if (status === NOTIFICATION_QUEUE_STATUS_HOLD) return NOTIFICATION_QUEUE_STATUS_HOLD
  if (status === NOTIFICATION_QUEUE_STATUS_SENT) return NOTIFICATION_QUEUE_STATUS_SENT
  return NOTIFICATION_QUEUE_STATUS_QUEUED
}

function weekendBatchScheduleLabel() {
  return WEEKEND_BATCH_WINDOWS.map((entry) => entry.label).join(", ")
}

function parseIsoDateTime(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = new Date(text)
  if (Number.isNaN(parsed.valueOf())) return null
  return parsed
}

function nextWeekendBatchDispatchAt(value = new Date()) {
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(now.valueOf())) return null

  for (let offset = 0; offset < 14; offset += 1) {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 0, 0, 0, 0)
    const dayOfWeek = dayStart.getDay()
    if (dayOfWeek !== 0 && dayOfWeek !== 6) continue

    for (let i = 0; i < WEEKEND_BATCH_WINDOWS.length; i += 1) {
      const slot = WEEKEND_BATCH_WINDOWS[i]
      if (slot.day !== dayOfWeek) continue
      const candidate = new Date(
        dayStart.getFullYear(),
        dayStart.getMonth(),
        dayStart.getDate(),
        slot.hour,
        slot.minute,
        0,
        0
      )
      if (candidate > now) return candidate
    }
  }

  return null
}

function normalizeDeliveryMode(value) {
  const mode = normalizeLower(value)
  if (mode === "weekend-batch" || mode === "batch") return "weekend-batch"
  return "immediate"
}

function normalizeAnnouncementPayload(payload = {}) {
  const recipients = normalizeRecipientList(payload.recipients)
  if (!recipients.length) {
    const error = new Error("At least one valid recipient email is required")
    error.statusCode = 400
    throw error
  }

  return {
    recipients,
    assignmentTitle: normalizeText(payload.assignmentTitle) || "Assignment update",
    exerciseTitle: normalizeText(payload.exerciseTitle),
    dueAt: normalizeText(payload.dueAt),
    level: normalizeText(payload.level),
    message: normalizeText(payload.message),
    senderName: normalizeText(payload.senderName) || "Eagles Student Admin",
  }
}

function mapQueueRecord(record = {}) {
  return {
    id: normalizeText(record.id),
    queueType: normalizeQueueType(record.queueType),
    status: normalizeQueueStatus(record.status),
    deliveryMode: normalizeDeliveryMode(record.deliveryMode),
    recipients: normalizeRecipientList(record.recipients),
    assignmentTitle: normalizeText(record.assignmentTitle) || "Assignment update",
    exerciseTitle: normalizeText(record.exerciseTitle),
    dueAt: normalizeText(record.dueAt),
    level: normalizeText(record.level),
    message: normalizeText(record.message),
    senderName: normalizeText(record.senderName) || "Eagles Student Admin",
    queuedByUsername: normalizeText(record.queuedByUsername),
    reviewedByUsername: normalizeText(record.reviewedByUsername),
    queuedAt: normalizeText(record.queuedAt || record.createdAt),
    scheduledFor: normalizeText(record.scheduledFor),
    sentAt: normalizeText(record.sentAt),
    attempts: Number.parseInt(String(record.attempts || 0), 10) || 0,
    lastError: normalizeText(record.lastError),
    payloadJson: record.payloadJson || null,
  }
}

function queueStatusFilter(statuses = []) {
  const normalized = Array.from(
    new Set((Array.isArray(statuses) ? statuses : []).map((entry) => normalizeQueueStatus(entry)))
  )
  return normalized
}

async function getNotificationQueuePrismaClient() {
  if (EMAIL_QUEUE_DB_DISABLED) return null
  try {
    const prisma = await getSharedPrismaClient()
    if (!prisma || !prisma.adminNotificationQueue) {
      EMAIL_QUEUE_DB_DISABLED = true
      if (!EMAIL_QUEUE_DB_WARNED) {
        EMAIL_QUEUE_DB_WARNED = true
        console.warn("admin notification queue falling back to memory: prisma model unavailable")
      }
      return null
    }
    return prisma
  } catch (error) {
    EMAIL_QUEUE_DB_DISABLED = true
    if (!EMAIL_QUEUE_DB_WARNED) {
      EMAIL_QUEUE_DB_WARNED = true
      console.warn(`admin notification queue falling back to memory: ${error.message}`)
    }
    return null
  }
}

function isQueueTableMissingError(error) {
  const code = normalizeUpper(error?.code)
  if (code === "P2021") return true
  const message = normalizeLower(error?.message || error)
  return message.includes("adminnotificationqueue")
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase()
}

function markQueueDatabaseFallback(error) {
  EMAIL_QUEUE_DB_DISABLED = true
  EMAIL_BATCH_LAST_ERROR = normalizeText(error?.message || error)
  if (!EMAIL_QUEUE_DB_WARNED) {
    EMAIL_QUEUE_DB_WARNED = true
    console.warn(`admin notification queue falling back to memory: ${EMAIL_BATCH_LAST_ERROR}`)
  }
}

async function runQueueDbOperation(handler, fallbackHandler) {
  const prisma = await getNotificationQueuePrismaClient()
  if (!prisma) return fallbackHandler()
  try {
    return await handler(prisma)
  } catch (error) {
    if (isQueueTableMissingError(error)) {
      markQueueDatabaseFallback(error)
      return fallbackHandler()
    }
    throw error
  }
}

function buildQueuedAnnouncementEntry(payload = {}, options = {}) {
  const normalizedPayload = normalizeAnnouncementPayload(payload)
  const now = new Date()
  const scheduledAt = nextWeekendBatchDispatchAt(now)
  if (!scheduledAt) {
    const error = new Error("Unable to compute next weekend batch time")
    error.statusCode = 503
    throw error
  }
  return {
    id: createQueueId("notify"),
    queueType: normalizeQueueType(payload.queueType),
    status: NOTIFICATION_QUEUE_STATUS_QUEUED,
    deliveryMode: normalizeDeliveryMode(payload.deliveryMode),
    recipients: normalizedPayload.recipients,
    assignmentTitle: normalizedPayload.assignmentTitle,
    exerciseTitle: normalizedPayload.exerciseTitle,
    level: normalizedPayload.level,
    dueAt: normalizedPayload.dueAt,
    message: normalizedPayload.message,
    senderName: normalizedPayload.senderName,
    queuedByUsername: normalizeText(options.queuedByUsername || payload.queuedByUsername),
    reviewedByUsername: "",
    queuedAt: now.toISOString(),
    scheduledFor: scheduledAt.toISOString(),
    sentAt: "",
    attempts: 0,
    lastError: "",
    payloadJson: payload && typeof payload === "object" ? payload : {},
  }
}

function memoryQueueFilteredItems({ queueType = "", includeSent = false, statuses = [] } = {}) {
  const normalizedQueueType = normalizeQueueType(queueType)
  const statusFilter = queueStatusFilter(statuses)
  return EMAIL_BATCH_QUEUE.filter((entry) => {
    if (queueType && normalizeQueueType(entry.queueType) !== normalizedQueueType) return false
    const status = normalizeQueueStatus(entry.status)
    if (statusFilter.length) return statusFilter.includes(status)
    if (!includeSent && status === NOTIFICATION_QUEUE_STATUS_SENT) return false
    return true
  })
}

async function countQueuedAnnouncements({ queueType = "", includeSent = false, statuses = [] } = {}) {
  return runQueueDbOperation(
    async (prisma) => {
      const where = {}
      if (queueType) where.queueType = normalizeQueueType(queueType)
      const statusFilter = queueStatusFilter(statuses)
      if (statusFilter.length) where.status = { in: statusFilter }
      else if (!includeSent) where.status = { not: NOTIFICATION_QUEUE_STATUS_SENT }
      return prisma.adminNotificationQueue.count({ where })
    },
    async () => memoryQueueFilteredItems({ queueType, includeSent, statuses }).length
  )
}

async function listQueuedAnnouncements({ queueType = "", take = 10, includeSent = false, statuses = [] } = {}) {
  const limit = Math.max(1, Math.min(Number.parseInt(String(take || 10), 10) || 10, 1000))
  const total = await countQueuedAnnouncements({ queueType, includeSent, statuses })
  const items = await runQueueDbOperation(
    async (prisma) => {
      const where = {}
      if (queueType) where.queueType = normalizeQueueType(queueType)
      const statusFilter = queueStatusFilter(statuses)
      if (statusFilter.length) where.status = { in: statusFilter }
      else if (!includeSent) where.status = { not: NOTIFICATION_QUEUE_STATUS_SENT }
      const rows = await prisma.adminNotificationQueue.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      })
      return rows.map((row) =>
        mapQueueRecord({
          ...row,
          queuedAt: row.createdAt?.toISOString?.() || "",
          scheduledFor: row.scheduledFor?.toISOString?.() || "",
          sentAt: row.sentAt?.toISOString?.() || "",
        })
      )
    },
    async () =>
      memoryQueueFilteredItems({ queueType, includeSent, statuses })
        .slice()
        .sort((left, right) => normalizeText(right.queuedAt).localeCompare(normalizeText(left.queuedAt)))
        .slice(0, limit)
        .map((entry) => mapQueueRecord(entry))
  )

  EMAIL_BATCH_LAST_KNOWN_SIZE = total
  return {
    total,
    items,
    hasMore: total > items.length,
  }
}

function buildAnnouncementEmailContent(payload = {}) {
  const assignmentTitle = normalizeText(payload.assignmentTitle) || "Assignment update"
  const exerciseTitle = normalizeText(payload.exerciseTitle)
  const dueAt = normalizeText(payload.dueAt)
  const level = normalizeText(payload.level)
  const customMessage = normalizeText(payload.message)
  const sender = normalizeText(payload.senderName) || "Eagles Student Admin"

  const subjectParts = [assignmentTitle]
  if (exerciseTitle) subjectParts.push(`(${exerciseTitle})`)
  const subject = subjectParts.join(" ").trim()

  const lines = [
    `${sender} announcement`,
    "",
    `Assignment: ${assignmentTitle}`,
    exerciseTitle ? `Exercise: ${exerciseTitle}` : "",
    level ? `Level/Class: ${level}` : "",
    dueAt ? `Due: ${dueAt}` : "",
    "",
    customMessage || "Please review and complete this assignment.",
  ].filter(Boolean)

  const htmlLines = lines
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .join("<br>")

  return {
    subject,
    lines,
    htmlLines,
  }
}

async function sendAnnouncementEmail(payload = {}) {
  const normalizedPayload = normalizeAnnouncementPayload(payload)
  const emailContent = buildAnnouncementEmailContent(normalizedPayload)

  const nodemailer = await getNodemailer()
  const smtp = smtpConfigFromEnv()
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  })

  await transporter.sendMail({
    from: smtp.from,
    to: smtp.from,
    bcc: normalizedPayload.recipients,
    subject: emailContent.subject,
    text: emailContent.lines.join("\n"),
    html: `<p>${emailContent.htmlLines}</p>`,
  })

  return {
    ok: true,
    sent: normalizedPayload.recipients.length,
    subject: emailContent.subject,
    deliveryMode: "immediate",
  }
}

async function queueAnnouncementEmail(payload = {}, options = {}) {
  const totalUnsent = await countQueuedAnnouncements()
  if (totalUnsent >= EMAIL_BATCH_QUEUE_LIMIT) {
    const error = new Error("Weekend email batch queue is full")
    error.statusCode = 503
    throw error
  }

  const entry = buildQueuedAnnouncementEntry(payload, options)
  const saved = await runQueueDbOperation(
    async (prisma) => {
      const created = await prisma.adminNotificationQueue.create({
        data: {
          id: entry.id,
          queueType: entry.queueType,
          status: entry.status,
          deliveryMode: entry.deliveryMode,
          recipients: entry.recipients,
          assignmentTitle: entry.assignmentTitle,
          exerciseTitle: entry.exerciseTitle || null,
          level: entry.level || null,
          dueAt: entry.dueAt || null,
          message: entry.message || null,
          senderName: entry.senderName || null,
          queuedByUsername: entry.queuedByUsername || null,
          reviewedByUsername: null,
          scheduledFor: parseIsoDateTime(entry.scheduledFor),
          sentAt: null,
          attempts: 0,
          lastError: null,
          payloadJson: entry.payloadJson || null,
        },
      })
      return mapQueueRecord({
        ...created,
        queuedAt: created.createdAt?.toISOString?.() || entry.queuedAt,
        scheduledFor: created.scheduledFor?.toISOString?.() || entry.scheduledFor,
      })
    },
    async () => {
      EMAIL_BATCH_QUEUE.push(entry)
      return mapQueueRecord(entry)
    }
  )
  EMAIL_BATCH_LAST_KNOWN_SIZE = totalUnsent + 1

  return {
    ok: true,
    queued: true,
    deliveryMode: "weekend-batch",
    queueId: saved.id,
    queuedAt: saved.queuedAt,
    scheduledFor: saved.scheduledFor,
    queueSize: EMAIL_BATCH_LAST_KNOWN_SIZE,
    schedule: weekendBatchScheduleLabel(),
  }
}

async function getEmailBatchQueueStatus(queueType = "") {
  const listed = await listQueuedAnnouncements({
    queueType,
    take: 500,
    includeSent: false,
  })
  const nextScheduledFor = listed.items.reduce((earliest, entry) => {
    const candidate = parseIsoDateTime(entry.scheduledFor)
    if (!candidate) return earliest
    if (!earliest || candidate < earliest) return candidate
    return earliest
  }, null)

  return {
    queueSize: listed.total,
    nextScheduledFor: nextScheduledFor ? nextScheduledFor.toISOString() : "",
    schedule: weekendBatchScheduleLabel(),
    backend: EMAIL_QUEUE_DB_DISABLED ? "memory" : EMAIL_QUEUE_BACKEND_MODE,
    lastRunAt: EMAIL_BATCH_LAST_RUN_AT,
    lastResult: EMAIL_BATCH_LAST_RESULT,
    lastError: EMAIL_BATCH_LAST_ERROR,
    processing: false,
  }
}

function getEmailBatchQueueRuntimeStatus() {
  return {
    queueSize: EMAIL_BATCH_LAST_KNOWN_SIZE,
    nextScheduledFor: "",
    schedule: weekendBatchScheduleLabel(),
    backend: EMAIL_QUEUE_DB_DISABLED ? "memory" : EMAIL_QUEUE_BACKEND_MODE,
    lastRunAt: EMAIL_BATCH_LAST_RUN_AT,
    lastResult: EMAIL_BATCH_LAST_RESULT,
    lastError: EMAIL_BATCH_LAST_ERROR,
    processing: false,
  }
}

async function updateQueuedAnnouncement(queueId, updates = {}, options = {}) {
  const id = normalizeText(queueId)
  if (!id) {
    const error = new Error("queueId is required")
    error.statusCode = 400
    throw error
  }
  const normalized = {
    status: updates.status !== undefined ? normalizeQueueStatus(updates.status) : undefined,
    assignmentTitle:
      updates.assignmentTitle !== undefined
        ? normalizeText(updates.assignmentTitle) || "Assignment update"
        : undefined,
    exerciseTitle: updates.exerciseTitle !== undefined ? normalizeText(updates.exerciseTitle) : undefined,
    level: updates.level !== undefined ? normalizeText(updates.level) : undefined,
    dueAt: updates.dueAt !== undefined ? normalizeText(updates.dueAt) : undefined,
    message: updates.message !== undefined ? normalizeText(updates.message) : undefined,
    recipients: updates.recipients !== undefined ? normalizeRecipientList(updates.recipients) : undefined,
    reviewedByUsername:
      updates.reviewedByUsername !== undefined
        ? normalizeText(updates.reviewedByUsername)
        : normalizeText(options.reviewedByUsername),
    scheduledFor: updates.scheduledFor !== undefined ? parseIsoDateTime(updates.scheduledFor) : undefined,
    lastError: updates.lastError !== undefined ? normalizeText(updates.lastError) : undefined,
    sentAt: updates.sentAt !== undefined ? parseIsoDateTime(updates.sentAt) : undefined,
    attempts:
      updates.attempts !== undefined ? Number.parseInt(String(updates.attempts), 10) || 0 : undefined,
  }

  return runQueueDbOperation(
    async (prisma) => {
      const patch = {}
      if (normalized.status !== undefined) patch.status = normalized.status
      if (normalized.assignmentTitle !== undefined) patch.assignmentTitle = normalized.assignmentTitle
      if (normalized.exerciseTitle !== undefined) patch.exerciseTitle = normalized.exerciseTitle || null
      if (normalized.level !== undefined) patch.level = normalized.level || null
      if (normalized.dueAt !== undefined) patch.dueAt = normalized.dueAt || null
      if (normalized.message !== undefined) patch.message = normalized.message || null
      if (normalized.recipients !== undefined) patch.recipients = normalized.recipients
      if (normalized.reviewedByUsername !== undefined) patch.reviewedByUsername = normalized.reviewedByUsername || null
      if (normalized.scheduledFor !== undefined) patch.scheduledFor = normalized.scheduledFor
      if (normalized.lastError !== undefined) patch.lastError = normalized.lastError || null
      if (normalized.sentAt !== undefined) patch.sentAt = normalized.sentAt
      if (normalized.attempts !== undefined) patch.attempts = normalized.attempts
      const updated = await prisma.adminNotificationQueue.update({
        where: { id },
        data: patch,
      })
      return mapQueueRecord({
        ...updated,
        queuedAt: updated.createdAt?.toISOString?.() || "",
        scheduledFor: updated.scheduledFor?.toISOString?.() || "",
        sentAt: updated.sentAt?.toISOString?.() || "",
      })
    },
    async () => {
      const index = EMAIL_BATCH_QUEUE.findIndex((entry) => normalizeText(entry.id) === id)
      if (index < 0) {
        const error = new Error("Queue item not found")
        error.statusCode = 404
        throw error
      }
      const current = mapQueueRecord(EMAIL_BATCH_QUEUE[index])
      const updated = {
        ...current,
        ...(normalized.status !== undefined ? { status: normalized.status } : {}),
        ...(normalized.assignmentTitle !== undefined ? { assignmentTitle: normalized.assignmentTitle } : {}),
        ...(normalized.exerciseTitle !== undefined ? { exerciseTitle: normalized.exerciseTitle } : {}),
        ...(normalized.level !== undefined ? { level: normalized.level } : {}),
        ...(normalized.dueAt !== undefined ? { dueAt: normalized.dueAt } : {}),
        ...(normalized.message !== undefined ? { message: normalized.message } : {}),
        ...(normalized.recipients !== undefined ? { recipients: normalized.recipients } : {}),
        ...(normalized.reviewedByUsername !== undefined ? { reviewedByUsername: normalized.reviewedByUsername } : {}),
        ...(normalized.scheduledFor !== undefined
          ? { scheduledFor: normalized.scheduledFor ? normalized.scheduledFor.toISOString() : "" }
          : {}),
        ...(normalized.lastError !== undefined ? { lastError: normalized.lastError } : {}),
        ...(normalized.sentAt !== undefined
          ? { sentAt: normalized.sentAt ? normalized.sentAt.toISOString() : "" }
          : {}),
        ...(normalized.attempts !== undefined ? { attempts: normalized.attempts } : {}),
      }
      EMAIL_BATCH_QUEUE[index] = updated
      return mapQueueRecord(updated)
    }
  )
}

async function sendAllQueuedAnnouncements({ queueType = "", reviewedByUsername = "" } = {}) {
  const source = await listQueuedAnnouncements({
    queueType: queueType || NOTIFICATION_QUEUE_TYPE_PARENT_REPORT,
    includeSent: false,
    statuses: [NOTIFICATION_QUEUE_STATUS_QUEUED],
    take: 1000,
  })

  let sent = 0
  let failed = 0

  for (let i = 0; i < source.items.length; i += 1) {
    const item = source.items[i]
    try {
      await sendAnnouncementEmail({
        recipients: item.recipients,
        assignmentTitle: item.assignmentTitle,
        exerciseTitle: item.exerciseTitle,
        dueAt: item.dueAt,
        level: item.level,
        message: item.message,
        senderName: item.senderName,
      })
      await updateQueuedAnnouncement(
        item.id,
        {
          status: NOTIFICATION_QUEUE_STATUS_SENT,
          sentAt: nowIso(),
          lastError: "",
          attempts: (Number.parseInt(String(item.attempts || 0), 10) || 0) + 1,
        },
        { reviewedByUsername }
      )
      sent += 1
    } catch (error) {
      await updateQueuedAnnouncement(
        item.id,
        {
          status: NOTIFICATION_QUEUE_STATUS_QUEUED,
          lastError: normalizeText(error?.message || error),
          attempts: (Number.parseInt(String(item.attempts || 0), 10) || 0) + 1,
        },
        { reviewedByUsername }
      )
      failed += 1
    }
  }

  EMAIL_BATCH_LAST_RUN_AT = nowIso()
  EMAIL_BATCH_LAST_RESULT = `manual-send sent=${sent} failed=${failed}`
  EMAIL_BATCH_LAST_ERROR = failed ? "Some queued parent reports failed to send." : ""

  return {
    ok: true,
    queueType: queueType || NOTIFICATION_QUEUE_TYPE_PARENT_REPORT,
    processed: source.items.length,
    sent,
    failed,
  }
}

async function handleApiRequest(request, response, pathname, url) {
  const { method } = request
  const legacyLoginPath = `${ADMIN_API_PREFIX}/login`
  const loginPath = `${ADMIN_AUTH_PREFIX}/login`
  const logoutPath = `${ADMIN_AUTH_PREFIX}/logout`
  const mePath = `${ADMIN_AUTH_PREFIX}/me`

  if (method === "POST" && (pathname === loginPath || pathname === legacyLoginPath)) {
    await assertCredentialsConfigured()
    await handleLogin(request, response)
    return true
  }

  if (method === "POST" && pathname === logoutPath) {
    await handleLogout(request, response)
    return true
  }

  if (method === "GET" && pathname === mePath) {
    await handleMe(request, response)
    return true
  }

  const session = await requireAuthenticatedSession(request, response)
  const rolePolicy = enforceRoleAccess(session, method, pathname)

  if (pathname === ADMIN_PERMISSIONS_PATH) {
    if (method === "GET") {
      await handlePermissionsGet(response, session)
      return true
    }

    if (method === "PUT") {
      await handlePermissionsPut(request, response, rolePolicy)
      return true
    }
  }

  if (method === "GET" && pathname === ADMIN_DASHBOARD_PATH) {
    assertStoreEnabled()
    const data = await getAdminDashboardSummary()
    if (canManageUsers(rolePolicy)) {
      const parentQueue = await listQueuedAnnouncements({
        queueType: NOTIFICATION_QUEUE_TYPE_PARENT_REPORT,
        includeSent: false,
        take: 10,
      })
      data.parentReportQueue = {
        total: parentQueue.total,
        hasMore: parentQueue.hasMore,
        items: parentQueue.items,
      }
    }
    sendJson(response, 200, data)
    return true
  }

  if (method === "GET" && pathname === ADMIN_EXERCISE_TITLES_PATH) {
    assertStoreEnabled()
    const result = await listExerciseTitles({
      query: url.searchParams.get("q") || "",
      take: url.searchParams.get("take") || "200",
    })
    sendJson(response, 200, result)
    return true
  }

  if (method === "GET" && pathname === ADMIN_INCOMING_EXERCISE_RESULTS_PATH) {
    const statusesParam = normalizeText(url.searchParams.get("statuses"))
    const statuses = statusesParam
      ? statusesParam
          .split(",")
          .map((entry) => normalizeText(entry))
          .filter(Boolean)
      : []

    const listed = await listIncomingExerciseResults({
      statuses,
      take: url.searchParams.get("take") || "50",
      showAll: resolveBoolean(url.searchParams.get("showAll"), false),
      query: url.searchParams.get("q") || "",
    })

    sendJson(response, 200, {
      ok: true,
      ...listed,
    })
    return true
  }

  if (method === "POST" && pathname === ADMIN_INCOMING_EXERCISE_RESULTS_PATH) {
    assertCanManageUsers(rolePolicy)
    const payload = await parseBody(request)
    const action = normalizeLower(payload?.action)
    const incomingResultId = normalizeText(payload?.incomingResultId)
    const reviewedByUsername = normalizeText(session?.username)
    const notes =
      Object.prototype.hasOwnProperty.call(payload || {}, "notes")
        ? normalizeText(payload?.notes)
        : undefined
    const reviewPatch =
      notes === undefined
        ? { reviewedByUsername }
        : { reviewedByUsername, notes }

    if (action === "save-temp" || action === "temporary" || action === "temp") {
      const item = await setIncomingExerciseResultStatus(
        incomingResultId,
        INCOMING_EXERCISE_RESULT_STATUS_TEMPORARY,
        reviewPatch
      )
      sendJson(response, 200, { ok: true, action: "save-temp", item })
      return true
    }

    if (action === "archive") {
      const item = await setIncomingExerciseResultStatus(
        incomingResultId,
        INCOMING_EXERCISE_RESULT_STATUS_ARCHIVED,
        reviewPatch
      )
      sendJson(response, 200, { ok: true, action: "archive", item })
      return true
    }

    if (action === "requeue") {
      const item = await setIncomingExerciseResultStatus(
        incomingResultId,
        INCOMING_EXERCISE_RESULT_STATUS_QUEUED,
        reviewPatch
      )
      sendJson(response, 200, { ok: true, action: "requeue", item })
      return true
    }

    if (action === "delete") {
      const result = await deleteIncomingExerciseResultById(incomingResultId)
      sendJson(response, 200, { ok: true, action: "delete", ...result })
      return true
    }

    if (action === "match" || action === "resolve") {
      const studentRefId = normalizeText(payload?.studentRefId)
      if (!studentRefId) {
        const error = new Error("studentRefId is required")
        error.statusCode = 400
        throw error
      }
      const resolved = await resolveIncomingExerciseResultToStudent(incomingResultId, studentRefId, {
        ...reviewPatch,
      })
      sendJson(response, 200, { ok: true, action: "match", ...resolved })
      return true
    }

    if (action === "create-account") {
      const incoming = await getIncomingExerciseResultById(incomingResultId)
      const fallbackStudentId = normalizeText(incoming?.submittedStudentId)
      const requestedStudentId = normalizeText(payload?.studentId || fallbackStudentId)
      const studentId = requestedStudentId && requestedStudentId !== "(not provided)" ? requestedStudentId : ""
      if (!studentId) {
        const error = new Error("studentId is required to create account")
        error.statusCode = 400
        throw error
      }

      const studentEmail = normalizeText(payload?.email || incoming?.submittedEmail)
      const fullName = normalizeText(payload?.fullName)
      const saved = await saveStudent({
        studentId,
        email: studentEmail,
        profile: {
          sourceFormId: "incoming-exercise-result",
          sourceUrl: "exercise-submission",
          fullName,
          studentEmail: studentEmail,
        },
      })

      const targetStudentRefId = normalizeText(saved?.student?.id)
      if (!targetStudentRefId) {
        const error = new Error("Unable to create or update student account")
        error.statusCode = 500
        throw error
      }

      const resolved = await resolveIncomingExerciseResultToStudent(incomingResultId, targetStudentRefId, {
        ...reviewPatch,
      })

      sendJson(response, 200, {
        ok: true,
        action: "create-account",
        student: saved.student,
        ...resolved,
      })
      return true
    }

    {
      const error = new Error("Unsupported incoming exercise-result action")
      error.statusCode = 400
      throw error
    }
  }

  if (method === "GET" && pathname === ADMIN_NOTIFY_BATCH_STATUS_PATH) {
    const queueType = normalizeQueueType(url.searchParams.get("queueType") || NOTIFICATION_QUEUE_TYPE_PARENT_REPORT)
    const take = Math.max(1, Math.min(Number.parseInt(String(url.searchParams.get("take") || "10"), 10) || 10, 1000))
    const showAll = resolveBoolean(url.searchParams.get("showAll"), false)
    const statusesParam = normalizeText(url.searchParams.get("statuses"))
    const statuses = statusesParam
      ? statusesParam
          .split(",")
          .map((entry) => normalizeText(entry))
          .filter(Boolean)
      : []
    const listed = await listQueuedAnnouncements({
      queueType,
      includeSent: showAll,
      statuses,
      take,
    })
    const status = await getEmailBatchQueueStatus(queueType)
    sendJson(response, 200, {
      ok: true,
      queueType,
      showAll,
      total: listed.total,
      hasMore: listed.hasMore,
      items: listed.items,
      ...status,
    })
    return true
  }

  if (method === "POST" && pathname === ADMIN_NOTIFY_BATCH_STATUS_PATH) {
    assertCanManageUsers(rolePolicy)
    const payload = await parseBody(request)
    const action = normalizeLower(payload?.action)
    const queueId = normalizeText(payload?.queueId)
    const queueType = normalizeQueueType(payload?.queueType || NOTIFICATION_QUEUE_TYPE_PARENT_REPORT)

    if (action === "sendall" || action === "send-all") {
      const result = await sendAllQueuedAnnouncements({
        queueType,
        reviewedByUsername: normalizeText(session?.username),
      })
      sendJson(response, 200, result)
      return true
    }

    if (action === "hold") {
      const updated = await updateQueuedAnnouncement(
        queueId,
        {
          status: NOTIFICATION_QUEUE_STATUS_HOLD,
        },
        { reviewedByUsername: normalizeText(session?.username) }
      )
      sendJson(response, 200, { ok: true, action: "hold", item: updated })
      return true
    }

    if (action === "requeue") {
      const scheduledAt = nextWeekendBatchDispatchAt(new Date())
      const updated = await updateQueuedAnnouncement(
        queueId,
        {
          status: NOTIFICATION_QUEUE_STATUS_QUEUED,
          scheduledFor: scheduledAt ? scheduledAt.toISOString() : "",
          sentAt: "",
          lastError: "",
        },
        { reviewedByUsername: normalizeText(session?.username) }
      )
      sendJson(response, 200, { ok: true, action: "requeue", item: updated })
      return true
    }

    if (action === "edit") {
      const recipientInput = Array.isArray(payload?.recipients)
        ? payload.recipients
        : normalizeText(payload?.recipients)
            .split(",")
            .map((entry) => normalizeText(entry))
            .filter(Boolean)
      const updated = await updateQueuedAnnouncement(
        queueId,
        {
          assignmentTitle: payload?.assignmentTitle,
          exerciseTitle: payload?.exerciseTitle,
          dueAt: payload?.dueAt,
          level: payload?.level,
          message: payload?.message,
          recipients: recipientInput,
          status: payload?.status || NOTIFICATION_QUEUE_STATUS_QUEUED,
        },
        { reviewedByUsername: normalizeText(session?.username) }
      )
      sendJson(response, 200, { ok: true, action: "edit", item: updated })
      return true
    }

    {
      const error = new Error("Unsupported batch action")
      error.statusCode = 400
      throw error
    }
  }

  if (method === "POST" && pathname === ADMIN_NOTIFY_EMAIL_PATH) {
    const payload = await parseBody(request)
    const deliveryMode = normalizeDeliveryMode(payload?.deliveryMode)
    const queueType = normalizeQueueType(payload?.queueType || NOTIFICATION_QUEUE_TYPE_ANNOUNCEMENT)
    if (!rolePolicy.canWrite) {
      const teacherQueueAllowed =
        deliveryMode === "weekend-batch" && queueType === NOTIFICATION_QUEUE_TYPE_PARENT_REPORT
      if (!teacherQueueAllowed) {
        const error = new Error("Forbidden")
        error.statusCode = 403
        throw error
      }
    }
    const result =
      deliveryMode === "weekend-batch"
        ? await queueAnnouncementEmail(payload, { queuedByUsername: normalizeText(session?.username) })
        : await sendAnnouncementEmail(payload)
    sendJson(response, 200, result)
    return true
  }

  if (method === "POST" && pathname === ADMIN_EXPORT_XLSX_PATH) {
    const payload = await parseBody(request)
    const exportBundle = buildXlsxFromPayload(payload)
    sendXlsx(response, exportBundle.filename, exportBundle.buffer)
    return true
  }

  if (method === "GET" && pathname === `${ADMIN_STUDENTS_PREFIX}/import-template.xlsx`) {
    if (!fs.existsSync(ADMIN_IMPORT_TEMPLATE_PATH)) {
      const error = new Error("Import template not found")
      error.statusCode = 404
      throw error
    }
    const fileBuffer = fs.readFileSync(ADMIN_IMPORT_TEMPLATE_PATH)
    sendXlsx(response, "student-import-template.xlsx", fileBuffer)
    return true
  }

  if (method === "GET" && pathname === `${ADMIN_API_PREFIX}/filters`) {
    assertStoreEnabled()
    const data = await listLevelAndSchoolFilters()
    sendJson(response, 200, data)
    return true
  }

  if (method === "GET" && pathname === ADMIN_STUDENTS_PREFIX) {
    assertStoreEnabled()
    const data = await listStudents({
      query: url.searchParams.get("q") || "",
      level: url.searchParams.get("level") || "",
      school: url.searchParams.get("school") || "",
      take: url.searchParams.get("take") || "250",
    })
    sendJson(response, 200, data)
    return true
  }

  if (method === "POST" && pathname === ADMIN_STUDENTS_PREFIX) {
    assertStoreEnabled()
    const payload = await parseBody(request)
    const result = await saveStudent(payload)
    sendJson(response, 200, result)
    return true
  }

  if (method === "POST" && pathname === `${ADMIN_STUDENTS_PREFIX}/import`) {
    assertStoreEnabled()
    const payload = await parseBody(request)
    const rows = parseSpreadsheetRowsFromUploadPayload(payload)
    const result = await importStudentsFromRows(rows)
    sendJson(response, 200, result)
    return true
  }

  if (method === "GET" && pathname === `${ADMIN_API_PREFIX}/family`) {
    assertStoreEnabled()
    const phone = url.searchParams.get("phone") || ""
    const result = await findFamilyByEmergencyPhone(phone)
    sendJson(response, 200, result)
    return true
  }

  if (pathname === ADMIN_USERS_PREFIX) {
    assertStoreEnabled()
    assertCanManageUsers(rolePolicy)

    if (method === "GET") {
      const result = await listAdminUsers({
        query: url.searchParams.get("q") || "",
        role: url.searchParams.get("role") || "",
      })
      sendJson(response, 200, result)
      return true
    }

    if (method === "POST") {
      const payload = await parseBody(request)
      const result = await createAdminUser(payload)
      sendJson(response, 200, result)
      return true
    }
  }

  const adminUserPathMatch = pathname.match(ADMIN_USER_PATH_RE)
  if (adminUserPathMatch) {
    assertStoreEnabled()
    assertCanManageUsers(rolePolicy)
    const userId = decodeURIComponent(adminUserPathMatch[1])

    if (method === "PUT") {
      const payload = await parseBody(request)
      const result = await updateAdminUserById(userId, payload)
      sendJson(response, 200, result)
      return true
    }

    if (method === "DELETE") {
      const result = await deleteAdminUserById(userId, {
        currentUsername: session.username,
      })
      sendJson(response, 200, result)
      return true
    }
  }

  const reportCardPathMatch = pathname.match(ADMIN_REPORT_CARD_PATH_RE)
  if (reportCardPathMatch && method === "GET") {
    assertStoreEnabled()
    const studentRefId = decodeURIComponent(reportCardPathMatch[1])
    const className = normalizeText(url.searchParams.get("className") || "")
    const schoolYear = normalizeText(url.searchParams.get("schoolYear") || "")
    const quarter = normalizeText(url.searchParams.get("quarter") || "")

    const student = await getStudentById(studentRefId)
    const pdfBuffer = await generateStudentReportCardPdf(student, {
      className,
      schoolYear,
      quarter,
    })
    const filename = buildReportCardFilename(student, {
      className,
      schoolYear,
      quarter,
    })
    sendPdf(response, filename, pdfBuffer)
    return true
  }

  const studentPathMatch = pathname.match(ADMIN_STUDENT_PATH_RE)
  if (studentPathMatch) {
    assertStoreEnabled()
    const studentRefId = decodeURIComponent(studentPathMatch[1])

    if (method === "GET") {
      const student = await getStudentById(studentRefId)
      sendJson(response, 200, student)
      return true
    }

    if (method === "PUT") {
      const payload = await parseBody(request)
      const result = await saveStudent(payload, studentRefId)
      sendJson(response, 200, result)
      return true
    }

    if (method === "DELETE") {
      const result = await deleteStudent(studentRefId)
      sendJson(response, 200, result)
      return true
    }
  }

  const attendancePathMatch = pathname.match(ADMIN_ATTENDANCE_PATH_RE)
  if (attendancePathMatch && method === "POST") {
    assertStoreEnabled()
    const studentRefId = decodeURIComponent(attendancePathMatch[1])
    const payload = await parseBody(request)
    const record = await saveAttendanceRecord(studentRefId, payload)
    const student = await getStudentById(studentRefId)
    sendJson(response, 200, { record, student })
    return true
  }

  const attendanceDeleteMatch = pathname.match(ADMIN_ATTENDANCE_DELETE_PATH_RE)
  if (attendanceDeleteMatch && method === "DELETE") {
    assertStoreEnabled()
    const studentRefId = decodeURIComponent(attendanceDeleteMatch[1])
    const recordId = decodeURIComponent(attendanceDeleteMatch[2])
    const result = await deleteAttendanceRecord(studentRefId, recordId)
    const student = await getStudentById(studentRefId)
    sendJson(response, 200, { ...result, student })
    return true
  }

  const gradePathMatch = pathname.match(ADMIN_GRADES_PATH_RE)
  if (gradePathMatch && method === "POST") {
    assertStoreEnabled()
    const studentRefId = decodeURIComponent(gradePathMatch[1])
    const payload = await parseBody(request)
    const record = await saveGradeRecord(studentRefId, payload)
    const student = await getStudentById(studentRefId)
    sendJson(response, 200, { record, student })
    return true
  }

  const gradeDeleteMatch = pathname.match(ADMIN_GRADE_DELETE_PATH_RE)
  if (gradeDeleteMatch && method === "DELETE") {
    assertStoreEnabled()
    const studentRefId = decodeURIComponent(gradeDeleteMatch[1])
    const recordId = decodeURIComponent(gradeDeleteMatch[2])
    const result = await deleteGradeRecord(studentRefId, recordId)
    const student = await getStudentById(studentRefId)
    sendJson(response, 200, { ...result, student })
    return true
  }

  const reportPathMatch = pathname.match(ADMIN_REPORTS_PATH_RE)
  if (reportPathMatch && method === "POST") {
    assertStoreEnabled()
    const studentRefId = decodeURIComponent(reportPathMatch[1])
    const payload = await parseBody(request)
    const report = await saveParentClassReport(studentRefId, payload)
    const student = await getStudentById(studentRefId)
    sendJson(response, 200, { report, student })
    return true
  }

  const reportGenerateMatch = pathname.match(ADMIN_REPORTS_GENERATE_PATH_RE)
  if (reportGenerateMatch && method === "POST") {
    assertStoreEnabled()
    const studentRefId = decodeURIComponent(reportGenerateMatch[1])
    const payload = await parseBody(request)
    const report = await generateParentClassReportFromGrades(studentRefId, payload)
    const student = await getStudentById(studentRefId)
    sendJson(response, 200, { report, student })
    return true
  }

  const reportDeleteMatch = pathname.match(ADMIN_REPORTS_DELETE_PATH_RE)
  if (reportDeleteMatch && method === "DELETE") {
    assertStoreEnabled()
    const studentRefId = decodeURIComponent(reportDeleteMatch[1])
    const reportId = decodeURIComponent(reportDeleteMatch[2])
    const result = await deleteParentClassReport(studentRefId, reportId)
    const student = await getStudentById(studentRefId)
    sendJson(response, 200, { ...result, student })
    return true
  }

  return false
}

export async function handleStudentAdminRequest(request, response) {
  const method = normalizeText(request.method).toUpperCase()
  const host = normalizeText(request.headers.host) || "localhost"
  const url = new URL(request.url || "/", `http://${host}`)
  const pathname = url.pathname

  const pageSlug = resolveAdminPageSlug(pathname)
  if (method === "GET" && pageSlug) {
    const html = injectAdminRuntimeConfig(fs.readFileSync(ADMIN_HTML_PATH, "utf8"), pageSlug)
    sendHtml(response, 200, html)
    return true
  }

  if (!isPathWithinPrefix(pathname, ADMIN_API_PREFIX)) return false

  allowCors(request, response)

  if (method === "OPTIONS") {
    response.writeHead(204)
    response.end()
    return true
  }

  try {
    const handled = await handleApiRequest(request, response, pathname, url)
    if (!handled) {
      sendJson(response, 404, { error: "Admin endpoint not found" })
    }
    return true
  } catch (error) {
    withError(response, request, error)
    return true
  }
}
