// server/student-admin-routes.mjs

import crypto from "node:crypto"
import { spawn } from "node:child_process"
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
  approveParentClassReport,
  createStudentPointsAdjustment,
  decodeParentReportCommentBundle,
  deleteAttendanceRecord,
  deleteGradeRecord,
  deleteParentClassReport,
  deleteStudent,
  findFamilyByEmergencyPhone,
  generateParentClassReportFromGrades,
  getAdminDashboardSummary,
  getNextStudentNumber,
  getSchoolPointsYtdSummary,
  getStudentAdminFilterCacheStatus,
  getStudentById,
  importStudentsFromRows,
  isStudentAdminStoreEnabled,
  listStudentNewsCalendar,
  listStudentNewsReportsForReview,
  listStudentPointsLedger,
  listStudentPointsSnapshots,
  listExerciseTitles,
  listLevelAndSchoolFilters,
  listStudents,
  reviewStudentNewsReport,
  saveAttendanceRecord,
  saveGradeRecord,
  saveParentClassReport,
  saveStudentNewsReport,
  setStudentPointsTotal,
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
const ADMIN_POINTS_PAGE_PATH = normalizePathPrefix(
  process.env.STUDENT_POINTS_PAGE_PATH,
  "/admin/students/points-management"
)
const PARENT_PORTAL_PAGE_PATH = normalizePathPrefix(process.env.STUDENT_PARENT_PORTAL_PAGE_PATH, "/parent/portal")
const STUDENT_PORTAL_PAGE_PATH = normalizePathPrefix(process.env.STUDENT_STUDENT_PORTAL_PAGE_PATH, "/student/portal")
const ADMIN_PAGE_DEFAULT_SLUG = "overview"
const ADMIN_PAGE_SECTIONS = [
  "overview",
  "queue-hub",
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
  "news-reports",
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
const ADMIN_NEXT_STUDENT_NUMBER_PATH = `${ADMIN_STUDENTS_PREFIX}/next-student-number`
const ADMIN_PERMISSIONS_PATH = `${ADMIN_API_PREFIX}/permissions`
const ADMIN_UI_SETTINGS_PATH = `${ADMIN_API_PREFIX}/settings/ui`
const ADMIN_DASHBOARD_PATH = `${ADMIN_API_PREFIX}/dashboard`
const ADMIN_QUEUE_HUB_PATH = `${ADMIN_API_PREFIX}/queue-hub`
const ADMIN_NEWS_REPORTS_PATH = `${ADMIN_API_PREFIX}/news-reports`
const ADMIN_EXERCISE_TITLES_PATH = `${ADMIN_API_PREFIX}/exercise-titles`
const ADMIN_EXPORT_XLSX_PATH = `${ADMIN_API_PREFIX}/exports/xlsx`
const ADMIN_NOTIFY_EMAIL_PATH = `${ADMIN_API_PREFIX}/notifications/email`
const ADMIN_NOTIFY_BATCH_STATUS_PATH = `${ADMIN_API_PREFIX}/notifications/batch-status`
const ADMIN_INCOMING_EXERCISE_RESULTS_PATH = `${ADMIN_API_PREFIX}/exercise-results/incoming`
const ADMIN_PROFILE_SUBMISSIONS_PATH = `${ADMIN_API_PREFIX}/profile-submissions`
const ADMIN_RUNTIME_HEALTH_PATH = `${ADMIN_API_PREFIX}/runtime/health`
const ADMIN_SERVICE_CONTROL_PATH = `${ADMIN_API_PREFIX}/runtime/service-control`
const ADMIN_POINTS_SUMMARY_PATH = `${ADMIN_API_PREFIX}/points/summary`
const ADMIN_POINTS_STUDENTS_PATH = `${ADMIN_API_PREFIX}/points/students`
const ADMIN_POINTS_LEDGER_PATH = `${ADMIN_API_PREFIX}/points/ledger`
const ADMIN_POINTS_ADJUSTMENTS_PATH = `${ADMIN_API_PREFIX}/points/adjustments`
const ADMIN_ASSIGNMENT_ANNOUNCEMENT_PREVIEW_CREATE_PATH =
  `${ADMIN_API_PREFIX}/assignment-announcements/volatile`
const PARENT_API_PREFIX = normalizePathPrefix(process.env.STUDENT_PARENT_API_PREFIX, "/api/parent")
const PARENT_AUTH_PREFIX = `${PARENT_API_PREFIX}/auth`
const PARENT_CHILDREN_PATH = `${PARENT_API_PREFIX}/children`
const PARENT_DASHBOARD_PATH = `${PARENT_API_PREFIX}/dashboard`
const STUDENT_API_PREFIX = normalizePathPrefix(process.env.STUDENT_STUDENT_API_PREFIX, "/api/student")
const STUDENT_AUTH_PREFIX = `${STUDENT_API_PREFIX}/auth`
const STUDENT_DASHBOARD_PATH = `${STUDENT_API_PREFIX}/dashboard`
const STUDENT_NEWS_REPORTS_PATH = `${STUDENT_API_PREFIX}/news-reports`
const STUDENT_NEWS_CALENDAR_PATH = `${STUDENT_API_PREFIX}/news-reports/calendar`
const ASSIGNMENT_ANNOUNCEMENT_PREVIEW_PATH = normalizePathPrefix(
  process.env.STUDENT_ADMIN_ASSIGNMENT_ANNOUNCEMENT_PREVIEW_PATH,
  "/assignment-announcements/volatile"
)
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
const ADMIN_PROFILE_SUBMISSION_PATH_RE = new RegExp(`^${escapeRegex(ADMIN_PROFILE_SUBMISSIONS_PATH)}/([^/]+)$`)
const ADMIN_NEWS_REPORT_PATH_RE = new RegExp(`^${escapeRegex(ADMIN_NEWS_REPORTS_PATH)}/([^/]+)$`)
const ADMIN_HTML_PATH = path.resolve(process.cwd(), "web-asset/admin/student-admin.html")
const ADMIN_POINTS_HTML_PATH = path.resolve(process.cwd(), "web-asset/admin/student-points.html")
const PARENT_PORTAL_HTML_PATH = path.resolve(process.cwd(), "web-asset/parent/parent-portal.html")
const STUDENT_PORTAL_HTML_PATH = path.resolve(process.cwd(), "web-asset/student/student-portal.html")
const ADMIN_IMPORT_TEMPLATE_PATH = path.resolve(process.cwd(), "schemas/student-import-template.xlsx")
const ADMIN_UI_SETTINGS_FILE_PATH = path.resolve(
  process.cwd(),
  normalizeText(process.env.STUDENT_ADMIN_UI_SETTINGS_FILE) || "runtime-data/admin-ui-settings.json"
)
const ADMIN_UI_SETTINGS_MAX_BYTES = Math.max(
  1024,
  Number.parseInt(String(process.env.STUDENT_ADMIN_UI_SETTINGS_MAX_BYTES || 1024 * 1024), 10) || 1024 * 1024
)
const ADMIN_PAGE_SECTION_PATH_RE = new RegExp(`^${escapeRegex(ADMIN_PAGE_PATH)}/([a-z0-9-]+)$`)
const ASSIGNMENT_ANNOUNCEMENT_PREVIEW_PATH_RE = new RegExp(
  `^${escapeRegex(ASSIGNMENT_ANNOUNCEMENT_PREVIEW_PATH)}/([a-f0-9]{24})$`
)
const ADMIN_POINTS_STUDENT_PATH_RE = new RegExp(`^${escapeRegex(ADMIN_POINTS_STUDENTS_PATH)}/([^/]+)/points$`)
const PARENT_CHILD_PROFILE_PATH_RE = new RegExp(`^${escapeRegex(PARENT_CHILDREN_PATH)}/([^/]+)/profile$`)
const PARENT_CHILD_PROFILE_DRAFT_PATH_RE = new RegExp(`^${escapeRegex(PARENT_CHILDREN_PATH)}/([^/]+)/profile-draft$`)
const PARENT_CHILD_PROFILE_SUBMIT_PATH_RE = new RegExp(`^${escapeRegex(PARENT_CHILDREN_PATH)}/([^/]+)/profile-submit$`)

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
const PARENT_SESSION_TTL_SECONDS = Math.max(
  60,
  Number.parseInt(String(process.env.STUDENT_PARENT_SESSION_TTL_SECONDS || "28800"), 10) || 28800
)
const PARENT_SESSION_COOKIE_NAME = normalizeText(process.env.STUDENT_PARENT_SESSION_COOKIE_NAME) || "parent_portal_sid"
const PARENT_SESSION_COOKIE_PATH = normalizeText(process.env.STUDENT_PARENT_SESSION_COOKIE_PATH) || "/"
const PARENT_SESSION_COOKIE_SAME_SITE =
  normalizeText(process.env.STUDENT_PARENT_SESSION_COOKIE_SAMESITE)
  || normalizeText(process.env.STUDENT_ADMIN_SESSION_COOKIE_SAMESITE)
  || "Strict"
const PARENT_SESSION_COOKIE_SECURE = resolveBoolean(
  process.env.STUDENT_PARENT_SESSION_COOKIE_SECURE,
  resolveBoolean(process.env.STUDENT_ADMIN_SESSION_COOKIE_SECURE, normalizeText(process.env.NODE_ENV).toLowerCase() !== "test")
)
const STUDENT_SESSION_TTL_SECONDS = Math.max(
  60,
  Number.parseInt(String(process.env.STUDENT_STUDENT_SESSION_TTL_SECONDS || "86400"), 10) || 86400
)
const STUDENT_SESSION_COOKIE_NAME = normalizeText(process.env.STUDENT_STUDENT_SESSION_COOKIE_NAME) || "student_portal_sid"
const STUDENT_SESSION_COOKIE_PATH = normalizeText(process.env.STUDENT_STUDENT_SESSION_COOKIE_PATH) || "/"
const STUDENT_SESSION_COOKIE_SAME_SITE =
  normalizeText(process.env.STUDENT_STUDENT_SESSION_COOKIE_SAMESITE)
  || normalizeText(process.env.STUDENT_ADMIN_SESSION_COOKIE_SAMESITE)
  || "Strict"
const STUDENT_SESSION_COOKIE_SECURE = resolveBoolean(
  process.env.STUDENT_STUDENT_SESSION_COOKIE_SECURE,
  resolveBoolean(process.env.STUDENT_ADMIN_SESSION_COOKIE_SECURE, normalizeText(process.env.NODE_ENV).toLowerCase() !== "test")
)
const SERVICE_CONTROL_ENABLED = resolveBoolean(process.env.STUDENT_ADMIN_SERVICE_CONTROL_ENABLED, true)
const EXERCISE_MAILER_SERVICE_NAME =
  normalizeText(process.env.EXERCISE_MAILER_SYSTEMD_SERVICE) || "exercise-mailer.service"
const SERVICE_CONTROL_STATUS_TIMEOUT_MS = 5000
const SERVICE_CONTROL_RESTART_TIMEOUT_MS = 12000
const ASSIGNMENT_ANNOUNCEMENT_PREVIEW_TTL_MINUTES = Math.max(
  1,
  Number.parseInt(String(process.env.STUDENT_ADMIN_ASSIGNMENT_ANNOUNCEMENT_PREVIEW_TTL_MINUTES || "480"), 10) || 480
)
const ASSIGNMENT_ANNOUNCEMENT_PREVIEW_TTL_MS = ASSIGNMENT_ANNOUNCEMENT_PREVIEW_TTL_MINUTES * 60 * 1000
const ASSIGNMENT_ANNOUNCEMENT_PREVIEW_STORE = new Map()
let ROLE_PERMISSIONS = null
const SESSION_STORE = createStudentAdminSessionStore({
  ttlSeconds: SESSION_TTL_SECONDS,
})
const PARENT_SESSION_STORE = createStudentAdminSessionStore({
  ttlSeconds: PARENT_SESSION_TTL_SECONDS,
})
const STUDENT_SESSION_STORE = createStudentAdminSessionStore({
  ttlSeconds: STUDENT_SESSION_TTL_SECONDS,
})
const PARENT_PROFILE_QUEUE_STATUS_DRAFT = "draft"
const PARENT_PROFILE_QUEUE_STATUS_SUBMITTED = "submitted"
const PARENT_PROFILE_QUEUE_STATUS_APPROVED = "approved"
const PARENT_PROFILE_QUEUE_STATUS_REJECTED = "rejected"
const PARENT_PROFILE_QUEUE_ALLOWED_STATUSES = new Set([
  PARENT_PROFILE_QUEUE_STATUS_DRAFT,
  PARENT_PROFILE_QUEUE_STATUS_SUBMITTED,
  PARENT_PROFILE_QUEUE_STATUS_APPROVED,
  PARENT_PROFILE_QUEUE_STATUS_REJECTED,
])
const PARENT_PROFILE_IMMUTABLE_FIELDS = new Set(["eaglesId", "studentNumber"])
const PARENT_PROFILE_ARRAY_FIELDS = new Set([
  "genderSelections",
  "languagesAtHome",
  "learningDisorders",
  "covidShotHistory",
  "feverMedicineAllowed",
])
const PARENT_PROFILE_INTEGER_FIELDS = new Set([
  "exercisePoints",
  "birthOrder",
  "siblingBrothers",
  "siblingSisters",
])
const PARENT_PROFILE_BOOLEAN_FIELDS = new Set([
  "requiredValidationOk",
])
const PARENT_PROFILE_EDITABLE_FIELDS = new Set([
  "sourceFormId",
  "sourceUrl",
  "fullName",
  "englishName",
  "memberSince",
  "exercisePoints",
  "parentsId",
  "photoUrl",
  "genderSelections",
  "studentPhone",
  "studentEmail",
  "hobbies",
  "dobText",
  "birthOrder",
  "siblingBrothers",
  "siblingSisters",
  "ethnicity",
  "languagesAtHome",
  "otherLanguage",
  "schoolName",
  "currentGrade",
  "currentSchoolGrade",
  "motherName",
  "motherEmail",
  "motherPhone",
  "motherEmergencyContact",
  "motherMessenger",
  "fatherName",
  "fatherEmail",
  "fatherPhone",
  "fatherEmergencyContact",
  "fatherMessenger",
  "streetAddress",
  "newAddress",
  "wardDistrict",
  "city",
  "postCode",
  "hasGlasses",
  "hadEyeExam",
  "lastEyeExamDateText",
  "prescriptionMedicine",
  "prescriptionDetails",
  "learningDisorders",
  "learningDisorderDetails",
  "drugAllergies",
  "foodEnvironmentalAllergies",
  "vaccinesChildhoodUpToDate",
  "hadCovidPositive",
  "covidNegativeDateText",
  "covidShotAlready",
  "covidVaccinesUpToDate",
  "covidShotHistory",
  "mostRecentCovidShotDate",
  "feverMedicineAllowed",
  "whiteOilAllowed",
  "signatureFullName",
  "signatureEmail",
  "extraComments",
  "requiredValidationOk",
  "rawFormPayload",
  "normalizedFormPayload",
])
const QUEUE_HUB_PANEL_IDS = [
  "queued-performance-reports",
  "unmatched-exercise-submissions",
  "current-assignments-pending",
  "overdue-homework",
  "attendance-risk",
  "news-report-review",
  "pending-profile-submissions",
]
const PARENT_PORTAL_MEMORY = {
  accounts: new Map(),
  links: [],
  submissions: [],
  fieldLocks: [],
}
let PARENT_PORTAL_DB_DISABLED = false
let PARENT_PORTAL_DB_WARNED = false
let STUDENT_PORTAL_DB_DISABLED = false
let STUDENT_PORTAL_DB_WARNED = false
let runtimeHealthProvider = null

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  const text = String(value)
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return withoutBom.trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase()
}

function normalizeInteger(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizePositiveInteger(value) {
  const parsed = normalizeInteger(value)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return parsed
}

function normalizeAliasToken(value) {
  const raw = normalizeLower(value)
  if (!raw) return ""
  let safe = raw
  try {
    safe = safe.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  } catch (error) {
    void error
  }
  return safe.replace(/[^a-z0-9]+/g, "")
}

function normalizeGenderSelectionValue(value) {
  const token = normalizeAliasToken(value)
  if (!token) return ""
  if (token === "m" || token === "male" || token === "nam" || token === "boy" || token === "man") return "male"
  if (token === "f" || token === "female" || token === "nu" || token === "girl" || token === "woman") return "female"
  if (token === "nonbinary" || token === "nonbin" || token === "nb") return "non-binary"
  return normalizeLower(value)
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

function escapeHtml(value) {
  return normalizeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
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
      canWrite: true,
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
  if (!normalized.teacher.canRead) normalized.teacher.canRead = true
  if (!normalized.teacher.canWrite) normalized.teacher.canWrite = true

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

function canManageSettings(sessionOrPolicy) {
  const policy =
    sessionOrPolicy && typeof sessionOrPolicy === "object" && Object.prototype.hasOwnProperty.call(sessionOrPolicy, "role")
      ? getRolePolicy(sessionOrPolicy.role)
      : sessionOrPolicy
  return canManageUsers(policy) || canManagePermissions(policy)
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

  if (origins.includes("*")) allowOrigin = reqOrigin || "*"
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
  const runtimeConfig = `<script>window.__SIS_ADMIN_API_PREFIX=${JSON.stringify(ADMIN_API_PREFIX)};window.__SIS_ADMIN_PAGE_PATH=${JSON.stringify(ADMIN_PAGE_PATH)};window.__SIS_ADMIN_PAGE_SLUG=${JSON.stringify(pageSlug || ADMIN_PAGE_DEFAULT_SLUG)};window.__SIS_ADMIN_PAGE_SECTIONS=${JSON.stringify(ADMIN_PAGE_SECTIONS)};window.__SIS_ADMIN_PERMISSION_ROLES=${JSON.stringify(ADMIN_PERMISSION_ROLES)};window.__SIS_ADMIN_PERMISSIONS_PATH=${JSON.stringify(ADMIN_PERMISSIONS_PATH)};window.__SIS_ADMIN_UI_SETTINGS_PATH=${JSON.stringify(ADMIN_UI_SETTINGS_PATH)};window.__SIS_ADMIN_DASHBOARD_PATH=${JSON.stringify(ADMIN_DASHBOARD_PATH)};window.__SIS_ADMIN_QUEUE_HUB_PATH=${JSON.stringify(ADMIN_QUEUE_HUB_PATH)};window.__SIS_ADMIN_NEWS_REPORTS_PATH=${JSON.stringify(ADMIN_NEWS_REPORTS_PATH)};window.__SIS_ADMIN_EXERCISE_TITLES_PATH=${JSON.stringify(ADMIN_EXERCISE_TITLES_PATH)};window.__SIS_ADMIN_NOTIFY_EMAIL_PATH=${JSON.stringify(ADMIN_NOTIFY_EMAIL_PATH)};window.__SIS_ADMIN_NOTIFY_BATCH_STATUS_PATH=${JSON.stringify(ADMIN_NOTIFY_BATCH_STATUS_PATH)};window.__SIS_ADMIN_INCOMING_EXERCISE_RESULTS_PATH=${JSON.stringify(ADMIN_INCOMING_EXERCISE_RESULTS_PATH)};window.__SIS_ADMIN_PROFILE_SUBMISSIONS_PATH=${JSON.stringify(ADMIN_PROFILE_SUBMISSIONS_PATH)};window.__SIS_ADMIN_RUNTIME_HEALTH_PATH=${JSON.stringify(ADMIN_RUNTIME_HEALTH_PATH)};window.__SIS_ADMIN_SERVICE_CONTROL_PATH=${JSON.stringify(ADMIN_SERVICE_CONTROL_PATH)};window.__SIS_ADMIN_ASSIGNMENT_ANNOUNCEMENT_PREVIEW_CREATE_PATH=${JSON.stringify(ADMIN_ASSIGNMENT_ANNOUNCEMENT_PREVIEW_CREATE_PATH)};window.__SIS_ADMIN_ASSIGNMENT_ANNOUNCEMENT_PREVIEW_PATH=${JSON.stringify(ASSIGNMENT_ANNOUNCEMENT_PREVIEW_PATH)};window.__SIS_ADMIN_ASSIGNMENT_ANNOUNCEMENT_PREVIEW_TTL_MINUTES=${JSON.stringify(ASSIGNMENT_ANNOUNCEMENT_PREVIEW_TTL_MINUTES)};</script>`
  if (html.includes("</head>")) {
    return html.replace("</head>", `  ${runtimeConfig}\n</head>`)
  }
  return `${runtimeConfig}\n${html}`
}

function injectParentRuntimeConfig(html) {
  const runtimeConfig = `<script>window.__SIS_PARENT_API_PREFIX=${JSON.stringify(PARENT_API_PREFIX)};window.__SIS_PARENT_AUTH_PREFIX=${JSON.stringify(PARENT_AUTH_PREFIX)};window.__SIS_PARENT_CHILDREN_PATH=${JSON.stringify(PARENT_CHILDREN_PATH)};window.__SIS_PARENT_DASHBOARD_PATH=${JSON.stringify(PARENT_DASHBOARD_PATH)};</script>`
  if (html.includes("</head>")) {
    return html.replace("</head>", `  ${runtimeConfig}\n</head>`)
  }
  return `${runtimeConfig}\n${html}`
}

function injectAdminPointsRuntimeConfig(html) {
  const runtimeConfig = `<script>window.__SIS_ADMIN_API_PREFIX=${JSON.stringify(ADMIN_API_PREFIX)};window.__SIS_ADMIN_AUTH_PREFIX=${JSON.stringify(ADMIN_AUTH_PREFIX)};window.__SIS_ADMIN_POINTS_SUMMARY_PATH=${JSON.stringify(ADMIN_POINTS_SUMMARY_PATH)};window.__SIS_ADMIN_POINTS_STUDENTS_PATH=${JSON.stringify(ADMIN_POINTS_STUDENTS_PATH)};window.__SIS_ADMIN_POINTS_LEDGER_PATH=${JSON.stringify(ADMIN_POINTS_LEDGER_PATH)};window.__SIS_ADMIN_POINTS_ADJUSTMENTS_PATH=${JSON.stringify(ADMIN_POINTS_ADJUSTMENTS_PATH)};</script>`
  if (html.includes("</head>")) {
    return html.replace("</head>", `  ${runtimeConfig}\n</head>`)
  }
  return `${runtimeConfig}\n${html}`
}

function injectStudentPortalRuntimeConfig(html) {
  const runtimeConfig = `<script>window.__SIS_STUDENT_API_PREFIX=${JSON.stringify(STUDENT_API_PREFIX)};window.__SIS_STUDENT_AUTH_PREFIX=${JSON.stringify(STUDENT_AUTH_PREFIX)};window.__SIS_STUDENT_DASHBOARD_PATH=${JSON.stringify(STUDENT_DASHBOARD_PATH)};window.__SIS_STUDENT_NEWS_REPORTS_PATH=${JSON.stringify(STUDENT_NEWS_REPORTS_PATH)};window.__SIS_STUDENT_NEWS_CALENDAR_PATH=${JSON.stringify(STUDENT_NEWS_CALENDAR_PATH)};</script>`
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
    uiSettingsPath: ADMIN_UI_SETTINGS_PATH,
    dashboardPath: ADMIN_DASHBOARD_PATH,
    queueHubPath: ADMIN_QUEUE_HUB_PATH,
    newsReportsPath: ADMIN_NEWS_REPORTS_PATH,
    exerciseTitlesPath: ADMIN_EXERCISE_TITLES_PATH,
    exportXlsxPath: ADMIN_EXPORT_XLSX_PATH,
    notifyEmailPath: ADMIN_NOTIFY_EMAIL_PATH,
    notifyBatchStatusPath: ADMIN_NOTIFY_BATCH_STATUS_PATH,
    incomingExerciseResultsPath: ADMIN_INCOMING_EXERCISE_RESULTS_PATH,
    profileSubmissionsPath: ADMIN_PROFILE_SUBMISSIONS_PATH,
    runtimeHealthPath: ADMIN_RUNTIME_HEALTH_PATH,
    serviceControlPath: ADMIN_SERVICE_CONTROL_PATH,
    assignmentAnnouncementPreviewCreatePath: ADMIN_ASSIGNMENT_ANNOUNCEMENT_PREVIEW_CREATE_PATH,
    assignmentAnnouncementPreviewPath: ASSIGNMENT_ANNOUNCEMENT_PREVIEW_PATH,
    assignmentAnnouncementPreviewTtlMinutes: ASSIGNMENT_ANNOUNCEMENT_PREVIEW_TTL_MINUTES,
    pointsPagePath: ADMIN_POINTS_PAGE_PATH,
    pointsSummaryPath: ADMIN_POINTS_SUMMARY_PATH,
    pointsStudentsPath: ADMIN_POINTS_STUDENTS_PATH,
    pointsLedgerPath: ADMIN_POINTS_LEDGER_PATH,
    pointsAdjustmentsPath: ADMIN_POINTS_ADJUSTMENTS_PATH,
    parentPortalPagePath: PARENT_PORTAL_PAGE_PATH,
    parentApiPrefix: PARENT_API_PREFIX,
    parentDashboardPath: PARENT_DASHBOARD_PATH,
    parentChildrenPath: PARENT_CHILDREN_PATH,
    parentAuthPrefix: PARENT_AUTH_PREFIX,
    studentPortalPagePath: STUDENT_PORTAL_PAGE_PATH,
    studentApiPrefix: STUDENT_API_PREFIX,
    studentAuthPrefix: STUDENT_AUTH_PREFIX,
    studentDashboardPath: STUDENT_DASHBOARD_PATH,
    studentNewsReportsPath: STUDENT_NEWS_REPORTS_PATH,
    studentNewsCalendarPath: STUDENT_NEWS_CALENDAR_PATH,
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

export function setStudentAdminRuntimeHealthProvider(provider) {
  runtimeHealthProvider = typeof provider === "function" ? provider : null
}

async function resolveAdminRuntimeHealthPayload() {
  if (typeof runtimeHealthProvider === "function") {
    const payload = await Promise.resolve(runtimeHealthProvider())
    if (payload && typeof payload === "object") return payload
  }

  return {
    status: "ok",
    startedAt: "",
    uptimeSeconds: 0,
    lastVerifyOk: null,
    lastVerifyAt: "",
    lastStoreOk: null,
    lastStoreAt: "",
    lastIntakeStoreOk: null,
    lastIntakeStoreAt: "",
    lastSendOk: null,
    lastSendAt: "",
    lastError: "",
    node: process.version,
    studentAdminRuntime: getStudentAdminRuntimeStatus(),
    runtimeSelfHeal: {
      enabled: false,
      lastResult: "unavailable",
      syncCount: 0,
      lastError: "runtime health provider unavailable",
    },
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

function decodeUtf8BufferStrict(buffer, contextLabel = "Payload") {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer)
    return decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded
  } catch (error) {
    void error
    const decodeError = new Error(`${contextLabel} must be UTF-8 encoded`)
    decodeError.statusCode = 400
    throw decodeError
  }
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

function normalizeRowObjectKeys(row = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return {}
  const normalized = {}
  Object.entries(row).forEach(([key, value]) => {
    const normalizedKey = normalizeText(key)
    if (!normalizedKey) return
    normalized[normalizedKey] = value
  })
  return normalized
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

const STUDENT_IMPORT_ROW_SIGNAL_KEYS = [
  "studentNumber",
  "eaglesId",
  "fullNameStudent",
  "fullName",
  "englishName",
  "password",
  "parentsId",
  "classLevel",
  "studentPhone",
  "studentEmail",
]

function hasOwnPropertySafe(target, key) {
  return Object.prototype.hasOwnProperty.call(target || {}, key)
}

function isLikelyStudentImportRow(row = {}) {
  const signalKeysPresent = STUDENT_IMPORT_ROW_SIGNAL_KEYS.some((key) => hasOwnPropertySafe(row, key))
  if (signalKeysPresent) {
    return STUDENT_IMPORT_ROW_SIGNAL_KEYS.some((key) => normalizeText(row?.[key]))
  }
  return Object.values(row || {}).some((value) => normalizeText(value))
}

function normalizeWorkbookRows(rows = []) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => (row && typeof row === "object" ? row : {}))
    .filter((row) => isLikelyStudentImportRow(row))
}

function countRowsWithFieldValue(rows = [], fieldName = "") {
  const key = normalizeText(fieldName)
  if (!key || !Array.isArray(rows)) return 0
  return rows.reduce((count, row) => {
    const value = normalizeText(row?.[key])
    return value ? count + 1 : count
  }, 0)
}

function countRowsWithIdentityPair(rows = []) {
  if (!Array.isArray(rows)) return 0
  return rows.reduce((count, row) => {
    const studentNumber = normalizeText(row?.studentNumber)
    const eaglesId = normalizeText(row?.eaglesId)
    return studentNumber && eaglesId ? count + 1 : count
  }, 0)
}

function resolvePreferredWorkbookSheetName(workbook, preferredSheetName = "") {
  const sheetNames = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : []
  if (!sheetNames.length) return ""

  const preferred = normalizeText(preferredSheetName)
  if (!preferred) return ""

  const exactMatch = sheetNames.find((entry) => normalizeText(entry) === preferred)
  if (exactMatch) return exactMatch

  const loweredPreferred = normalizeLower(preferred)
  return (
    sheetNames.find((entry) => normalizeLower(entry) === loweredPreferred)
    || ""
  )
}

function chooseWorkbookDataSheet(workbook, preferredSheetName = "") {
  const sheetNames = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : []
  if (!sheetNames.length) return { sheetName: "", rows: [] }

  const preferred = resolvePreferredWorkbookSheetName(workbook, preferredSheetName)
  if (preferred) {
    const sheet = workbook.Sheets[preferred]
    const rows = normalizeWorkbookRows(XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }))
    return { sheetName: preferred, rows }
  }

  const candidates = sheetNames
    .map((sheetName, index) => {
      const sheet = workbook.Sheets[sheetName]
      const rows = normalizeWorkbookRows(XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }))
      const rowCount = Array.isArray(rows) ? rows.length : 0
      const identityPairCount = countRowsWithIdentityPair(rows)
      const studentNumberCount = countRowsWithFieldValue(rows, "studentNumber")
      const eaglesIdCount = countRowsWithFieldValue(rows, "eaglesId")

      // Prioritize sheets that look most like import data rather than templates/examples.
      const score = identityPairCount * 1000 + studentNumberCount * 20 + eaglesIdCount * 5 + rowCount
      return {
        index,
        sheetName,
        rows,
        rowCount,
        score,
        identityPairCount,
        studentNumberCount,
        eaglesIdCount,
      }
    })
    .filter((entry) => entry.rowCount > 0)

  if (!candidates.length) return { sheetName: sheetNames[0], rows: [] }

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    if (right.identityPairCount !== left.identityPairCount) return right.identityPairCount - left.identityPairCount
    if (right.studentNumberCount !== left.studentNumberCount) return right.studentNumberCount - left.studentNumberCount
    if (right.eaglesIdCount !== left.eaglesIdCount) return right.eaglesIdCount - left.eaglesIdCount
    if (right.rowCount !== left.rowCount) return right.rowCount - left.rowCount
    return left.index - right.index
  })

  const best = candidates[0]
  return { sheetName: best.sheetName, rows: best.rows }
}

export function parseSpreadsheetRowsFromUploadPayload(payload = {}) {
  if (Array.isArray(payload.rows)) {
    const rows = normalizeWorkbookRows(payload.rows.map((row) => normalizeRowObjectKeys(row)))
    if (!rows.length) {
      const error = new Error("Spreadsheet has no data rows")
      error.statusCode = 400
      throw error
    }
    return rows
  }

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

    const selected = chooseWorkbookDataSheet(workbook, payload.sheetName)
    const rows = Array.isArray(selected.rows) ? selected.rows : []
    if (!Array.isArray(rows) || !rows.length) {
      const error = new Error("Spreadsheet has no data rows")
      error.statusCode = 400
      throw error
    }
    return rows
  }

  const text = decodeUtf8BufferStrict(fileBuffer, "Uploaded CSV/TSV data")
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

function parseAccountUsernameList(value) {
  return normalizeText(value)
    .split(/[\s,;]+/g)
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
}

function parseConfiguredAccountsJson(value, { defaultRole = "teacher", envName = "accounts" } = {}) {
  const jsonText = normalizeText(value)
  if (!jsonText) return []

  try {
    const parsed = JSON.parse(jsonText)
    if (!Array.isArray(parsed)) return []
    const accounts = []
    parsed.forEach((entry) => {
      const username = normalizeText(entry?.username)
      const role = normalizeLower(entry?.role) || defaultRole
      const password = normalizeText(entry?.password)
      const passwordHash = normalizeText(entry?.passwordHash)
      if (!username || (!password && !passwordHash)) return
      accounts.push({
        username,
        role: normalizeRoleName(role),
        password,
        passwordHash,
      })
    })
    return accounts
  } catch (error) {
    console.warn(`${envName} parse failed: ${error.message}`)
    return []
  }
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

  const teacherAccounts = parseConfiguredAccountsJson(process.env.STUDENT_TEACHER_ACCOUNTS_JSON, {
    defaultRole: "teacher",
    envName: "STUDENT_TEACHER_ACCOUNTS_JSON",
  })
  if (teacherAccounts.length > 0) {
    accounts.push(...teacherAccounts)
  }

  const teacherPass = normalizeText(process.env.STUDENT_TEACHER_PASS)
  const teacherHash = normalizeText(process.env.STUDENT_TEACHER_PASSWORD_HASH)
  const teacherCredentialsProvided = Boolean(teacherPass || teacherHash)
  if (teacherCredentialsProvided) {
    const teacherUsernames = new Set()
    parseAccountUsernameList(process.env.STUDENT_TEACHER_USER).forEach((entry) => teacherUsernames.add(entry))
    parseAccountUsernameList(process.env.STUDENT_TEACHER_USERS).forEach((entry) => teacherUsernames.add(entry))
    if (teacherUsernames.size === 0) teacherUsernames.add("teacher")
    teacherUsernames.forEach((username) => {
      accounts.push({
        username,
        role: "teacher",
        password: teacherPass,
        passwordHash: teacherHash,
      })
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

  const jsonAccounts = parseConfiguredAccountsJson(process.env.STUDENT_ADMIN_ACCOUNTS_JSON, {
    defaultRole: "teacher",
    envName: "STUDENT_ADMIN_ACCOUNTS_JSON",
  })
  if (jsonAccounts.length > 0) {
    accounts.push(...jsonAccounts)
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

function makeParentSessionCookieValue(sessionId, maxAgeSeconds) {
  const parts = [
    `${PARENT_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    `Path=${PARENT_SESSION_COOKIE_PATH}`,
    "HttpOnly",
    `SameSite=${normalizeSameSite(PARENT_SESSION_COOKIE_SAME_SITE)}`,
  ]

  if (PARENT_SESSION_COOKIE_SECURE) parts.push("Secure")
  if (Number.isInteger(maxAgeSeconds)) {
    parts.push(`Max-Age=${Math.max(0, maxAgeSeconds)}`)
    parts.push(`Expires=${new Date(Date.now() + Math.max(0, maxAgeSeconds) * 1000).toUTCString()}`)
  }

  return parts.join("; ")
}

function clearParentSessionCookie(response) {
  response.setHeader("Set-Cookie", makeParentSessionCookieValue("", 0))
}

function readParentSessionIdFromRequest(request) {
  const cookies = parseCookies(request.headers.cookie)
  return normalizeText(cookies[PARENT_SESSION_COOKIE_NAME] || "")
}

async function requireAuthenticatedParentSession(request, response) {
  const sessionId = readParentSessionIdFromRequest(request)
  if (!sessionId) {
    const error = new Error("Unauthorized")
    error.statusCode = 401
    throw error
  }

  const session = await PARENT_SESSION_STORE.touchSession(sessionId)
  if (!session) {
    clearParentSessionCookie(response)
    const error = new Error("Unauthorized")
    error.statusCode = 401
    throw error
  }

  response.setHeader("Set-Cookie", makeParentSessionCookieValue(sessionId, PARENT_SESSION_TTL_SECONDS))
  return session
}

function makeStudentSessionCookieValue(sessionId, maxAgeSeconds) {
  const parts = [
    `${STUDENT_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    `Path=${STUDENT_SESSION_COOKIE_PATH}`,
    "HttpOnly",
    `SameSite=${normalizeSameSite(STUDENT_SESSION_COOKIE_SAME_SITE)}`,
  ]

  if (STUDENT_SESSION_COOKIE_SECURE) parts.push("Secure")
  if (Number.isInteger(maxAgeSeconds)) {
    parts.push(`Max-Age=${Math.max(0, maxAgeSeconds)}`)
    parts.push(`Expires=${new Date(Date.now() + Math.max(0, maxAgeSeconds) * 1000).toUTCString()}`)
  }

  return parts.join("; ")
}

function clearStudentSessionCookie(response) {
  response.setHeader("Set-Cookie", makeStudentSessionCookieValue("", 0))
}

function readStudentSessionIdFromRequest(request) {
  const cookies = parseCookies(request.headers.cookie)
  return normalizeText(cookies[STUDENT_SESSION_COOKIE_NAME] || "")
}

async function requireAuthenticatedStudentSession(request, response) {
  const sessionId = readStudentSessionIdFromRequest(request)
  if (!sessionId) {
    const error = new Error("Unauthorized")
    error.statusCode = 401
    throw error
  }

  const session = await STUDENT_SESSION_STORE.touchSession(sessionId)
  if (!session) {
    clearStudentSessionCookie(response)
    const error = new Error("Unauthorized")
    error.statusCode = 401
    throw error
  }

  response.setHeader("Set-Cookie", makeStudentSessionCookieValue(sessionId, STUDENT_SESSION_TTL_SECONDS))
  return session
}

function canTeacherWriteDataEntryPath(pathname, method) {
  if (method !== "POST") return false
  if (pathname === ADMIN_NOTIFY_EMAIL_PATH) return true
  if (ADMIN_ATTENDANCE_PATH_RE.test(pathname)) return true
  if (ADMIN_GRADES_PATH_RE.test(pathname)) return true
  if (ADMIN_REPORTS_PATH_RE.test(pathname)) return true
  if (ADMIN_REPORTS_GENERATE_PATH_RE.test(pathname)) return true
  return false
}

function enforceRoleAccess(session, method, pathname) {
  const policy = getRolePolicy(session?.role)
  if (!policy.canRead) {
    const error = new Error("Forbidden")
    error.statusCode = 403
    throw error
  }
  const role = normalizeRoleName(session?.role)
  if (method !== "GET") {
    if (role === "teacher") {
      if (canTeacherWriteDataEntryPath(pathname, method)) return policy
      const error = new Error("Forbidden")
      error.statusCode = 403
      throw error
    }
  }
  if (method !== "GET" && !policy.canWrite) {
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

function assertCanManageSettings(policy) {
  if (canManageSettings(policy)) return
  const error = new Error("Forbidden")
  error.statusCode = 403
  throw error
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let totalBytes = 0
    request.on("data", (chunk) => {
      const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8")
      totalBytes += chunkBuffer.length
      if (totalBytes > 8e6) {
        const error = new Error("Payload too large")
        error.statusCode = 413
        request.destroy()
        reject(error)
        return
      }
      chunks.push(chunkBuffer)
    })
    request.on("end", () => {
      if (!chunks.length) {
        resolve({})
        return
      }
      let raw = ""
      try {
        raw = decodeUtf8BufferStrict(Buffer.concat(chunks), "Request payload")
      } catch (error) {
        reject(error)
        return
      }
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        const parseError = new Error("Invalid JSON payload")
        parseError.statusCode = 400
        reject(parseError)
      }
    })
    request.on("error", reject)
  })
}

function normalizeUiSettingsPayload(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {}
  const candidate = Object.prototype.hasOwnProperty.call(source, "uiSettings") ? source.uiSettings : source
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {}
  try {
    return JSON.parse(JSON.stringify(candidate))
  } catch (error) {
    void error
    return {}
  }
}

function readPersistedUiSettings() {
  if (!fs.existsSync(ADMIN_UI_SETTINGS_FILE_PATH)) {
    return {
      uiSettings: null,
      updatedAt: "",
      updatedBy: "",
      filePath: ADMIN_UI_SETTINGS_FILE_PATH,
    }
  }

  try {
    const raw = fs.readFileSync(ADMIN_UI_SETTINGS_FILE_PATH, "utf8")
    if (!normalizeText(raw)) {
      return {
        uiSettings: null,
        updatedAt: "",
        updatedBy: "",
        filePath: ADMIN_UI_SETTINGS_FILE_PATH,
      }
    }

    const parsed = JSON.parse(raw)
    const wrapped =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, "uiSettings")
    const uiSettings = wrapped ? normalizeUiSettingsPayload({ uiSettings: parsed.uiSettings }) : normalizeUiSettingsPayload(parsed)
    const normalizedUpdatedBy = normalizeText(parsed?.updatedBy)

    return {
      uiSettings,
      updatedAt: normalizeText(parsed?.updatedAt),
      updatedBy: normalizedUpdatedBy || "",
      filePath: ADMIN_UI_SETTINGS_FILE_PATH,
    }
  } catch (error) {
    const wrapped = new Error("Unable to read persisted admin UI settings")
    wrapped.statusCode = 500
    throw wrapped
  }
}

function writePersistedUiSettings(payload = {}, updatedByUsername = "") {
  const uiSettings = normalizeUiSettingsPayload(payload)
  const updatedAt = nowIso()
  const updatedBy = normalizeText(updatedByUsername) || null
  const persisted = {
    uiSettings,
    updatedAt,
    updatedBy,
  }
  const encoded = JSON.stringify(persisted, null, 2)
  const encodedBytes = Buffer.byteLength(encoded, "utf8")
  if (encodedBytes > ADMIN_UI_SETTINGS_MAX_BYTES) {
    const error = new Error("uiSettings payload is too large")
    error.statusCode = 413
    throw error
  }

  fs.mkdirSync(path.dirname(ADMIN_UI_SETTINGS_FILE_PATH), { recursive: true })
  const tmpPath = `${ADMIN_UI_SETTINGS_FILE_PATH}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmpPath, encoded, "utf8")
  fs.renameSync(tmpPath, ADMIN_UI_SETTINGS_FILE_PATH)

  return {
    uiSettings,
    updatedAt,
    updatedBy: updatedBy || "",
    filePath: ADMIN_UI_SETTINGS_FILE_PATH,
  }
}

function truncateCommandOutput(value, maxLength = 500) {
  const text = normalizeText(value)
  if (!text) return ""
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function firstOutputLine(...parts) {
  for (let i = 0; i < parts.length; i += 1) {
    const text = normalizeText(parts[i])
    if (!text) continue
    const firstLine = text.split(/\r?\n/, 1)[0]
    if (firstLine) return firstLine
  }
  return ""
}

function runCommand(command, args = [], timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false
    let timedOut = false
    let stdout = ""
    let stderr = ""
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    const finalize = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, Math.max(1000, timeoutMs))

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk || "")
      if (stdout.length > 4000) stdout = stdout.slice(0, 4000)
    })

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk || "")
      if (stderr.length > 4000) stderr = stderr.slice(0, 4000)
    })

    child.on("error", (error) => {
      clearTimeout(timer)
      finalize({
        ok: false,
        exitCode: null,
        signal: "",
        timedOut: false,
        stdout: truncateCommandOutput(stdout),
        stderr: truncateCommandOutput(error?.message || stderr),
        errorCode: normalizeText(error?.code),
      })
    })

    child.on("close", (code, signal) => {
      clearTimeout(timer)
      finalize({
        ok: code === 0 && !timedOut,
        exitCode: Number.isInteger(code) ? code : null,
        signal: normalizeText(signal),
        timedOut,
        stdout: truncateCommandOutput(stdout),
        stderr: truncateCommandOutput(stderr),
        errorCode: "",
      })
    })
  })
}

function normalizeHttpUrl(value) {
  const text = normalizeText(value)
  if (!text) return ""
  try {
    const parsed = new URL(text)
    const protocol = normalizeLower(parsed.protocol)
    if (protocol !== "http:" && protocol !== "https:") return ""
    return parsed.toString()
  } catch (error) {
    void error
    return ""
  }
}

function normalizeAssignmentAnnouncementPreviewItems(value) {
  const source = Array.isArray(value) ? value : []
  const normalized = source
    .map((entry) => {
      const item = entry && typeof entry === "object" ? entry : {}
      return {
        title: normalizeText(item.title || item.exerciseTitle || item.name || item.label),
        url: normalizeHttpUrl(item.url || item.link || item.href || item.exerciseUrl),
      }
    })
    .filter((entry) => entry.title || entry.url)

  return Array.from(
    new Map(
      normalized.map((entry) => {
        const key = `${normalizeLower(entry.title)}|${normalizeLower(entry.url)}`
        return [key, entry]
      })
    ).values()
  )
}

function normalizeAssignmentAnnouncementPreviewPayload(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {}
  return {
    assignmentTitle: normalizeText(source.assignmentTitle || source.exerciseTitle) || "Assignment update",
    level: normalizeText(source.level),
    assignedAt: normalizeText(source.assignedAt || source.dateAssigned),
    dueAt: normalizeText(source.dueAt || source.dueDate),
    message: normalizeText(source.message),
    items: normalizeAssignmentAnnouncementPreviewItems(source.items),
  }
}

function cleanupAssignmentAnnouncementPreviews(nowMs = Date.now()) {
  ASSIGNMENT_ANNOUNCEMENT_PREVIEW_STORE.forEach((entry, token) => {
    if (!entry || !Number.isFinite(entry.expiresAtMs) || entry.expiresAtMs <= nowMs) {
      ASSIGNMENT_ANNOUNCEMENT_PREVIEW_STORE.delete(token)
    }
  })
}

function createAssignmentAnnouncementPreview(payload = {}) {
  cleanupAssignmentAnnouncementPreviews()
  const nowMs = Date.now()
  const normalized = normalizeAssignmentAnnouncementPreviewPayload(payload)
  const token = crypto.randomBytes(12).toString("hex")
  const entry = {
    token,
    createdAt: new Date(nowMs).toISOString(),
    expiresAtMs: nowMs + ASSIGNMENT_ANNOUNCEMENT_PREVIEW_TTL_MS,
    ttlMinutes: ASSIGNMENT_ANNOUNCEMENT_PREVIEW_TTL_MINUTES,
    ...normalized,
  }
  ASSIGNMENT_ANNOUNCEMENT_PREVIEW_STORE.set(token, entry)
  return entry
}

function readAssignmentAnnouncementPreview(token) {
  cleanupAssignmentAnnouncementPreviews()
  const key = normalizeLower(token)
  if (!/^[a-f0-9]{24}$/.test(key)) return null
  const entry = ASSIGNMENT_ANNOUNCEMENT_PREVIEW_STORE.get(key)
  if (!entry) return null
  if (!Number.isFinite(entry.expiresAtMs) || entry.expiresAtMs <= Date.now()) {
    ASSIGNMENT_ANNOUNCEMENT_PREVIEW_STORE.delete(key)
    return null
  }
  return entry
}

function resolveRequestOrigin(request) {
  const forwardedProtoRaw = normalizeText(request.headers["x-forwarded-proto"])
  const forwardedHostRaw = normalizeText(request.headers["x-forwarded-host"])
  const forwardedProto = normalizeLower(forwardedProtoRaw.split(",")[0])
  const forwardedHost = normalizeText(forwardedHostRaw.split(",")[0])
  const secureBySocket = Boolean(request.socket && request.socket.encrypted)
  const protocol = forwardedProto === "https" || secureBySocket ? "https" : "http"
  const host = forwardedHost || normalizeText(request.headers.host) || "localhost"
  return `${protocol}://${host}`
}

function buildAssignmentAnnouncementPreviewUrl(request, token) {
  return `${resolveRequestOrigin(request)}${ASSIGNMENT_ANNOUNCEMENT_PREVIEW_PATH}/${encodeURIComponent(token)}`
}

function previewDisplayDate(value) {
  const text = normalizeText(value)
  if (!text) return "-"
  const parsed = new Date(text)
  if (Number.isNaN(parsed.valueOf())) return text
  return parsed.toISOString().replace("T", " ").replace(".000Z", "Z")
}

function sendAssignmentAnnouncementPreviewExpired(response) {
  sendHtml(
    response,
    410,
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Preview expired</title></head><body><h1>Preview expired</h1><p>This volatile assignment preview is no longer available.</p></body></html>"
  )
}

function sendAssignmentAnnouncementPreview(response, entry) {
  const items = Array.isArray(entry.items) ? entry.items : []
  const itemsHtml = items.length
    ? items
        .map((item) => {
          const title = escapeHtml(item.title || "Exercise")
          const href = normalizeHttpUrl(item.url)
          if (href) {
            return `<li><strong>${title}</strong><br><a class=\"live-link\" href=\"${escapeHtml(href)}\" target=\"_blank\" rel=\"noopener noreferrer\">${escapeHtml(href)}</a></li>`
          }
          return `<li><strong>${title}</strong></li>`
        })
        .join("")
    : "<li>No exercise links available.</li>"
  const messageHtml = escapeHtml(entry.message)
  const expiresAtIso = new Date(Number(entry.expiresAtMs) || Date.now()).toISOString()

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Assignment announcement preview</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #1f2a3a; line-height: 1.45; }
    .card { border: 1px solid #cad4e3; border-radius: 10px; padding: 16px; max-width: 900px; }
    h1 { margin: 0 0 8px; }
    .meta { color: #5f6d87; font-size: 13px; margin-bottom: 12px; }
    #ttlNotice { font-weight: 700; color: #124685; margin: 8px 0 12px; }
    #ttlNotice.expired { color: #b3262d; }
    ol { padding-left: 18px; }
    .message { white-space: pre-wrap; border-top: 1px dashed #cad4e3; margin-top: 14px; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(entry.assignmentTitle)}</h1>
    <div class="meta">Level: ${escapeHtml(entry.level || "-")} | Assigned: ${escapeHtml(previewDisplayDate(entry.assignedAt))} | Due: ${escapeHtml(previewDisplayDate(entry.dueAt))}</div>
    <div class="meta">Created: ${escapeHtml(previewDisplayDate(entry.createdAt))} | Expires: ${escapeHtml(previewDisplayDate(expiresAtIso))}</div>
    <div id="ttlNotice">Expires in ${escapeHtml(String(entry.ttlMinutes || ASSIGNMENT_ANNOUNCEMENT_PREVIEW_TTL_MINUTES))} minute(s).</div>
    <h2>Assignment items</h2>
    <ol>${itemsHtml}</ol>
    ${messageHtml ? `<h2>Announcement</h2><div class="message">${messageHtml}</div>` : ""}
  </div>
  <script>
    (() => {
      const expiresAtMs = ${Number(entry.expiresAtMs) || 0}
      const ttlNotice = document.getElementById("ttlNotice")
      const links = Array.from(document.querySelectorAll(".live-link"))
      const update = () => {
        if (!ttlNotice) return
        const remainingMs = expiresAtMs - Date.now()
        if (remainingMs <= 0) {
          ttlNotice.textContent = "This volatile preview has expired."
          ttlNotice.className = "expired"
          links.forEach((link) => {
            link.removeAttribute("href")
            link.textContent = "expired"
          })
          return
        }
        const mins = Math.max(1, Math.ceil(remainingMs / 60000))
        ttlNotice.textContent = "Expires in " + mins + " minute(s)."
      }
      update()
      window.setInterval(update, 30000)
    })()
  </script>
</body>
</html>`

  sendHtml(response, 200, html)
}

async function getExerciseMailerServiceControlStatus() {
  if (!SERVICE_CONTROL_ENABLED) {
    return {
      ok: false,
      enabled: false,
      available: false,
      service: EXERCISE_MAILER_SERVICE_NAME,
      status: "disabled",
      detail: "Service control disabled by env.",
      checkedAt: new Date().toISOString(),
    }
  }

  const statusResult = await runCommand(
    "systemctl",
    ["is-active", EXERCISE_MAILER_SERVICE_NAME],
    SERVICE_CONTROL_STATUS_TIMEOUT_MS
  )
  const checkedAt = new Date().toISOString()
  let serviceStatus = normalizeLower(firstOutputLine(statusResult.stdout, statusResult.stderr))
  let detail = firstOutputLine(statusResult.stdout, statusResult.stderr)

  if (statusResult.errorCode === "ENOENT") {
    serviceStatus = "unsupported"
    detail = "systemctl is unavailable on this runtime."
  } else if (statusResult.timedOut) {
    serviceStatus = "unknown"
    detail = "systemctl status check timed out."
  } else if (!serviceStatus) {
    serviceStatus = statusResult.ok ? "active" : "unknown"
  }

  if (!detail) {
    detail = statusResult.ok
      ? `service=${EXERCISE_MAILER_SERVICE_NAME} is active`
      : `service=${EXERCISE_MAILER_SERVICE_NAME} status unavailable`
  }

  const normalizedStatus =
    serviceStatus === "active" ||
    serviceStatus === "inactive" ||
    serviceStatus === "failed" ||
    serviceStatus === "activating" ||
    serviceStatus === "deactivating" ||
    serviceStatus === "unknown" ||
    serviceStatus === "unsupported"
      ? serviceStatus
      : "unknown"

  return {
    ok: statusResult.ok,
    enabled: true,
    available: normalizedStatus !== "unsupported",
    service: EXERCISE_MAILER_SERVICE_NAME,
    status: normalizedStatus,
    detail,
    checkedAt,
    command: {
      exitCode: statusResult.exitCode,
      timedOut: statusResult.timedOut,
      stdout: statusResult.stdout,
      stderr: statusResult.stderr,
      errorCode: statusResult.errorCode,
    },
  }
}

async function restartExerciseMailerServiceControl() {
  if (!SERVICE_CONTROL_ENABLED) {
    const status = await getExerciseMailerServiceControlStatus()
    return {
      ok: false,
      action: "restart",
      ...status,
      detail: "Service control disabled by env.",
    }
  }

  const restartResult = await runCommand(
    "sudo",
    ["-n", "systemctl", "restart", EXERCISE_MAILER_SERVICE_NAME],
    SERVICE_CONTROL_RESTART_TIMEOUT_MS
  )

  const status = await getExerciseMailerServiceControlStatus()
  const restartLine = firstOutputLine(restartResult.stderr, restartResult.stdout)
  const restartOk = restartResult.ok && status.status === "active"

  const detail = restartOk
    ? `Restarted ${EXERCISE_MAILER_SERVICE_NAME}; status=${status.status}.`
    : restartLine ||
      status.detail ||
      `Failed to restart ${EXERCISE_MAILER_SERVICE_NAME}.`

  return {
    ok: restartOk,
    action: "restart",
    ...status,
    detail,
    restart: {
      exitCode: restartResult.exitCode,
      timedOut: restartResult.timedOut,
      stdout: restartResult.stdout,
      stderr: restartResult.stderr,
      errorCode: restartResult.errorCode,
    },
  }
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
  const authMode = resolveSmtpAuthMode(process.env.SMTP_AUTH_MODE || process.env.SMTP_AUTH)
  const useAuth = authMode ? authMode === "auth" : Boolean(user || pass)
  const from = normalizeText(process.env.SMTP_FROM || user)
  if (!host || !from) {
    const error = new Error("SMTP is not configured for assignment announcements")
    error.statusCode = 503
    throw error
  }
  if (useAuth && (!user || !pass)) {
    const error = new Error("SMTP auth requires SMTP_USER and SMTP_PASS")
    error.statusCode = 503
    throw error
  }
  return { host, port, secure, user, pass, from, useAuth, authMode: authMode || (useAuth ? "auth" : "none") }
}

function resolveSmtpAuthMode(value) {
  const mode = normalizeLower(value)
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

const FIXED_TIME_ZONE_OFFSET_MINUTES = 7 * 60
const FIXED_TIME_ZONE_OFFSET_MS = FIXED_TIME_ZONE_OFFSET_MINUTES * 60 * 1000

function shiftToFixedTimeZone(value) {
  return new Date(value.getTime() + FIXED_TIME_ZONE_OFFSET_MS)
}

function shiftFromFixedTimeZone(value) {
  return new Date(value.getTime() - FIXED_TIME_ZONE_OFFSET_MS)
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
  const shiftedNow = shiftToFixedTimeZone(now)

  for (let offset = 0; offset < 14; offset += 1) {
    const dayStart = new Date(
      Date.UTC(
        shiftedNow.getUTCFullYear(),
        shiftedNow.getUTCMonth(),
        shiftedNow.getUTCDate() + offset,
        0,
        0,
        0,
        0
      )
    )
    const dayOfWeek = dayStart.getUTCDay()
    if (dayOfWeek !== 0 && dayOfWeek !== 6) continue

    for (let i = 0; i < WEEKEND_BATCH_WINDOWS.length; i += 1) {
      const slot = WEEKEND_BATCH_WINDOWS[i]
      if (slot.day !== dayOfWeek) continue
      const candidateShifted = new Date(
        Date.UTC(
          dayStart.getUTCFullYear(),
          dayStart.getUTCMonth(),
          dayStart.getUTCDate(),
          slot.hour,
          slot.minute,
          0,
          0
        )
      )
      const candidate = shiftFromFixedTimeZone(candidateShifted)
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

function normalizeAnnouncementPayload(payload = {}, options = {}) {
  const allowEmptyRecipients = Boolean(options.allowEmptyRecipients)
  const recipients = normalizeRecipientList(payload.recipients)
  if (!recipients.length && !allowEmptyRecipients) {
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
  const queueType = normalizeQueueType(payload.queueType)
  const normalizedPayload = normalizeAnnouncementPayload(payload, {
    allowEmptyRecipients: queueType === NOTIFICATION_QUEUE_TYPE_PARENT_REPORT,
  })
  const now = new Date()
  const scheduledAt = nextWeekendBatchDispatchAt(now)
  if (!scheduledAt) {
    const error = new Error("Unable to compute next weekend batch time")
    error.statusCode = 503
    throw error
  }
  return {
    id: createQueueId("notify"),
    queueType,
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
  const transportOptions = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
  }
  if (smtp.useAuth) {
    transportOptions.auth = {
      user: smtp.user,
      pass: smtp.pass,
    }
  }
  const transporter = nodemailer.createTransport(transportOptions)

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

async function approveQueuedParentReportIfPresent(item = {}, reviewedByUsername = "") {
  const payload = item?.payloadJson && typeof item.payloadJson === "object" ? item.payloadJson : {}
  const reportId = normalizeText(payload?.reportId || item?.reportId)
  if (!reportId) return null
  return approveParentClassReport(reportId, {
    approvedByUsername: normalizeText(reviewedByUsername),
    participationPointsAward: payload?.participationPointsAward,
  })
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
      if (normalizeQueueType(item.queueType) === NOTIFICATION_QUEUE_TYPE_PARENT_REPORT) {
        await approveQueuedParentReportIfPresent(item, reviewedByUsername)
      }
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

function buildEaglesRefId(studentRefId = "") {
  const normalized = normalizeText(studentRefId)
  if (!normalized) return ""
  const digest = crypto.createHash("sha1").update(normalized).digest("hex")
  return `erf-${digest.slice(0, 16)}`
}

function normalizeQueueHubPanelOrder(input = []) {
  const source = Array.isArray(input) ? input : []
  const selected = source
    .map((entry) => normalizeText(entry))
    .filter((entry) => QUEUE_HUB_PANEL_IDS.includes(entry))
  const merged = [...new Set(selected)]
  QUEUE_HUB_PANEL_IDS.forEach((id) => {
    if (!merged.includes(id)) merged.push(id)
  })
  return merged
}

function isParentPortalTableMissingError(error) {
  const code = normalizeUpper(error?.code)
  if (code === "P2021") return true
  const message = normalizeLower(error?.message || error)
  return (
    message.includes("parentportalaccount")
    || message.includes("parentportalstudentlink")
    || message.includes("parentprofilesubmissionqueue")
    || message.includes("parentprofilefieldlock")
  )
}

function isStudentPortalTableMissingError(error) {
  const code = normalizeUpper(error?.code)
  if (code === "P2021") return true
  const message = normalizeLower(error?.message || error)
  return message.includes("studentportalaccount")
}

function markParentPortalDbFallback(error) {
  PARENT_PORTAL_DB_DISABLED = true
  if (!PARENT_PORTAL_DB_WARNED) {
    PARENT_PORTAL_DB_WARNED = true
    console.warn(`parent portal persistence falling back to memory: ${normalizeText(error?.message || error)}`)
  }
}

async function getParentPortalPrismaClient() {
  if (PARENT_PORTAL_DB_DISABLED) return null
  try {
    const prisma = await getSharedPrismaClient()
    if (
      !prisma
      || !prisma.parentPortalAccount
      || !prisma.parentPortalStudentLink
      || !prisma.parentProfileSubmissionQueue
      || !prisma.parentProfileFieldLock
    ) {
      markParentPortalDbFallback(new Error("Prisma parent portal models unavailable"))
      return null
    }
    return prisma
  } catch (error) {
    markParentPortalDbFallback(error)
    return null
  }
}

async function runParentPortalDbOperation(handler, fallbackHandler) {
  const prisma = await getParentPortalPrismaClient()
  if (!prisma) return fallbackHandler()
  try {
    return await handler(prisma)
  } catch (error) {
    if (isParentPortalTableMissingError(error)) {
      markParentPortalDbFallback(error)
      return fallbackHandler()
    }
    throw error
  }
}

function markStudentPortalDbFallback(error) {
  STUDENT_PORTAL_DB_DISABLED = true
  if (!STUDENT_PORTAL_DB_WARNED) {
    STUDENT_PORTAL_DB_WARNED = true
    console.warn(`student portal persistence falling back to env: ${normalizeText(error?.message || error)}`)
  }
}

async function getStudentPortalPrismaClient() {
  if (STUDENT_PORTAL_DB_DISABLED || !isStudentAdminStoreEnabled()) return null
  try {
    const prisma = await getSharedPrismaClient()
    if (!prisma || !prisma.studentPortalAccount) {
      markStudentPortalDbFallback(new Error("Prisma student portal models unavailable"))
      return null
    }
    return prisma
  } catch (error) {
    markStudentPortalDbFallback(error)
    return null
  }
}

async function runStudentPortalDbOperation(handler, fallbackHandler) {
  const prisma = await getStudentPortalPrismaClient()
  if (!prisma) return fallbackHandler()
  try {
    return await handler(prisma)
  } catch (error) {
    if (isStudentPortalTableMissingError(error)) {
      markStudentPortalDbFallback(error)
      return fallbackHandler()
    }
    throw error
  }
}

function parseParentPortalAccountsJson(value) {
  const raw = normalizeText(value)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => ({
        parentsId: normalizeText(entry?.parentsId || entry?.username),
        password: normalizeText(entry?.password),
        passwordHash: normalizeText(entry?.passwordHash),
        status: normalizeLower(entry?.status) || "active",
      }))
      .filter((entry) => entry.parentsId && (entry.password || entry.passwordHash))
  } catch (error) {
    console.warn(`STUDENT_PARENT_PORTAL_ACCOUNTS_JSON parse failed: ${error.message}`)
    return []
  }
}

function configuredParentPortalAccounts() {
  const accounts = parseParentPortalAccountsJson(process.env.STUDENT_PARENT_PORTAL_ACCOUNTS_JSON)
  const fallbackParentsId = normalizeText(process.env.STUDENT_PARENT_USER)
  const fallbackPassword = normalizeText(process.env.STUDENT_PARENT_PASS)
  const fallbackPasswordHash = normalizeText(process.env.STUDENT_PARENT_PASSWORD_HASH)
  if (fallbackParentsId && (fallbackPassword || fallbackPasswordHash)) {
    accounts.push({
      parentsId: fallbackParentsId,
      password: fallbackPassword,
      passwordHash: fallbackPasswordHash,
      status: "active",
    })
  }
  return accounts
}

async function verifyParentPortalCredentials(parentsId, password) {
  const requestedParentsId = normalizeText(parentsId)
  const inputPassword = normalizeText(password)
  if (!requestedParentsId || !inputPassword) return null

  const dbResult = await runParentPortalDbOperation(
    async (prisma) => {
      const account = await prisma.parentPortalAccount.findUnique({
        where: { parentsId: requestedParentsId },
      })
      if (!account) return null
      if (normalizeLower(account.status) !== "active") return null
      if (!verifyPassword("", account.passwordHash, inputPassword)) return null
      return {
        accountId: account.id,
        parentsId: account.parentsId,
        source: "database",
      }
    },
    async () => {
      const accounts = configuredParentPortalAccounts()
      for (let i = 0; i < accounts.length; i += 1) {
        const account = accounts[i]
        if (!timingSafeEqualText(requestedParentsId, account.parentsId)) continue
        if (normalizeLower(account.status) !== "active") return null
        if (!verifyPassword(account.password, account.passwordHash, inputPassword)) return null
        return {
          accountId: `env:${account.parentsId}`,
          parentsId: account.parentsId,
          source: "env",
        }
      }
      return null
    }
  )

  return dbResult
}

function parseStudentPortalAccountsJson(value) {
  const raw = normalizeText(value)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => ({
        eaglesId: normalizeText(entry?.eaglesId || entry?.username),
        password: normalizeText(entry?.password),
        passwordHash: normalizeText(entry?.passwordHash),
        studentRefId: normalizeText(entry?.studentRefId),
        status: normalizeLower(entry?.status) || "active",
      }))
      .filter((entry) => entry.eaglesId && (entry.password || entry.passwordHash))
  } catch (error) {
    console.warn(`STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON parse failed: ${error.message}`)
    return []
  }
}

function configuredStudentPortalAccounts() {
  const accounts = parseStudentPortalAccountsJson(process.env.STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON)
  const fallbackEaglesId = normalizeText(process.env.STUDENT_STUDENT_USER)
  const fallbackPassword = normalizeText(process.env.STUDENT_STUDENT_PASS)
  const fallbackPasswordHash = normalizeText(process.env.STUDENT_STUDENT_PASSWORD_HASH)
  const fallbackStudentRefId = normalizeText(process.env.STUDENT_STUDENT_REF_ID)
  if (fallbackEaglesId && (fallbackPassword || fallbackPasswordHash)) {
    accounts.push({
      eaglesId: fallbackEaglesId,
      password: fallbackPassword,
      passwordHash: fallbackPasswordHash,
      studentRefId: fallbackStudentRefId,
      status: "active",
    })
  }
  return accounts
}

async function verifyStudentPortalCredentials(eaglesId, password) {
  const requestedEaglesId = normalizeText(eaglesId)
  const inputPassword = normalizeText(password)
  if (!requestedEaglesId || !inputPassword) return null

  const dbResult = await runStudentPortalDbOperation(
    async (prisma) => {
      const account = await prisma.studentPortalAccount.findUnique({
        where: { eaglesId: requestedEaglesId },
      })
      if (!account) return null
      if (normalizeLower(account.status) !== "active") return null
      if (!verifyPassword("", account.passwordHash, inputPassword)) return null

      let mappedStudent = null
      if (!normalizeText(account.studentRefId) && isStudentAdminStoreEnabled()) {
        mappedStudent = await findStudentByEaglesIdForParent(requestedEaglesId)
      }
      const studentRefId = normalizeText(account.studentRefId || mappedStudent?.studentRefId)
      if (!studentRefId && isStudentAdminStoreEnabled()) return null
      return {
        eaglesId: requestedEaglesId,
        studentRefId,
        accountId: account.id,
        source: "database",
      }
    },
    async () => {
      const accounts = configuredStudentPortalAccounts()
      for (let i = 0; i < accounts.length; i += 1) {
        const account = accounts[i]
        if (!timingSafeEqualText(requestedEaglesId, account.eaglesId)) continue
        if (normalizeLower(account.status) !== "active") return null
        if (!verifyPassword(account.password, account.passwordHash, inputPassword)) return null

        let mappedStudent = null
        if (!normalizeText(account.studentRefId) && isStudentAdminStoreEnabled()) {
          mappedStudent = await findStudentByEaglesIdForParent(requestedEaglesId)
        }
        const studentRefId = normalizeText(account.studentRefId || mappedStudent?.studentRefId)
        if (!studentRefId && isStudentAdminStoreEnabled()) return null
        return {
          eaglesId: requestedEaglesId,
          studentRefId,
          accountId: `env:${account.eaglesId}`,
          source: "env",
        }
      }
      return null
    }
  )

  return dbResult
}

async function resolveStudentPortalSessionStudentRefId(session = {}) {
  const sessionStudentRefId = normalizeText(session?.studentRefId)
  const eaglesId = normalizeText(session?.eaglesId || session?.username)
  if (!eaglesId) return sessionStudentRefId

  // In DB-backed mode, trust canonical eaglesId -> student mapping over stale env/session ids.
  if (isStudentAdminStoreEnabled()) {
    const mappedStudent = await findStudentByEaglesIdForParent(eaglesId)
    const mappedStudentRefId = normalizeText(mappedStudent?.studentRefId)
    if (mappedStudentRefId) return mappedStudentRefId
    return ""
  }

  const account = configuredStudentPortalAccounts().find(
    (entry) => normalizeLower(entry?.eaglesId) === normalizeLower(eaglesId)
  )
  const configuredStudentRefId = normalizeText(account?.studentRefId)
  if (configuredStudentRefId) return configuredStudentRefId
  return sessionStudentRefId
}

function mapStudentToParentChildSummary(student = {}) {
  const profile = student?.profile && typeof student.profile === "object" ? student.profile : {}
  const studentRefId = normalizeText(student?.id)
  return {
    eaglesId: normalizeText(student?.eaglesId),
    eaglesRefId: buildEaglesRefId(studentRefId),
    studentRefId,
    studentNumber: Number.parseInt(String(student?.studentNumber || ""), 10) || null,
    fullName: normalizeText(profile?.fullName || profile?.englishName),
    englishName: normalizeText(profile?.englishName),
    currentGrade: normalizeText(profile?.currentGrade),
    parentsId: normalizeText(profile?.parentsId),
    profile,
  }
}

async function listParentLinkedStudents({ parentsId = "", parentAccountId = "" } = {}) {
  const normalizedParentsId = normalizeText(parentsId)
  if (!normalizedParentsId) return []

  return runParentPortalDbOperation(
    async (prisma) => {
      const linkedRows = parentAccountId
        ? await prisma.parentPortalStudentLink.findMany({
            where: { parentAccountId: normalizeText(parentAccountId) },
            select: {
              student: {
                select: {
                  id: true,
                  eaglesId: true,
                  studentNumber: true,
                  profile: true,
                },
              },
            },
          })
        : []
      const linkedStudents = linkedRows
        .map((row) => row?.student)
        .filter(Boolean)
      if (linkedStudents.length) {
        return linkedStudents.map((student) => mapStudentToParentChildSummary(student))
      }

      const rows = await prisma.studentProfile.findMany({
        where: { parentsId: normalizedParentsId },
        select: {
          studentRefId: true,
          fullName: true,
          englishName: true,
          currentGrade: true,
          parentsId: true,
          student: {
            select: {
              id: true,
              eaglesId: true,
              studentNumber: true,
              profile: true,
            },
          },
        },
      })

      const mapped = rows
        .map((row) => row?.student)
        .filter(Boolean)
        .map((student) => mapStudentToParentChildSummary(student))
      return mapped.sort((left, right) => normalizeText(left.fullName).localeCompare(normalizeText(right.fullName)))
    },
    async () => []
  )
}

function normalizeParentProfilePatch(rawPatch) {
  const source = rawPatch && typeof rawPatch === "object" && !Array.isArray(rawPatch) ? rawPatch : {}
  const normalizedPatch = {}

  Object.entries(source).forEach(([key, rawValue]) => {
    const fieldKey = normalizeText(key)
    if (!fieldKey || !PARENT_PROFILE_EDITABLE_FIELDS.has(fieldKey)) return
    if (PARENT_PROFILE_IMMUTABLE_FIELDS.has(fieldKey)) return

    const isWrapped = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) && Object.prototype.hasOwnProperty.call(rawValue, "touched")
    const touched = isWrapped ? resolveBoolean(rawValue.touched, false) : true
    if (!touched) return

    const candidateValue = isWrapped ? rawValue.value : rawValue
    if (PARENT_PROFILE_ARRAY_FIELDS.has(fieldKey)) {
      const arr = Array.isArray(candidateValue)
        ? candidateValue.map((entry) => normalizeText(entry)).filter(Boolean)
        : normalizeText(candidateValue)
            .split(",")
            .map((entry) => normalizeText(entry))
            .filter(Boolean)
      if (fieldKey === "genderSelections") {
        const normalizedGenderValues = arr
          .map((entry) => normalizeGenderSelectionValue(entry))
          .filter(Boolean)
        normalizedPatch[fieldKey] = normalizedGenderValues.length ? [normalizedGenderValues[0]] : []
        return
      }
      normalizedPatch[fieldKey] = arr
      return
    }
    if (PARENT_PROFILE_INTEGER_FIELDS.has(fieldKey)) {
      normalizedPatch[fieldKey] = normalizePositiveInteger(candidateValue)
      return
    }
    if (PARENT_PROFILE_BOOLEAN_FIELDS.has(fieldKey)) {
      normalizedPatch[fieldKey] = resolveBoolean(candidateValue, false)
      return
    }
    if (fieldKey === "rawFormPayload" || fieldKey === "normalizedFormPayload") {
      normalizedPatch[fieldKey] = candidateValue && typeof candidateValue === "object" ? candidateValue : {}
      return
    }
    normalizedPatch[fieldKey] = normalizeText(candidateValue)
  })

  return normalizedPatch
}

function buildProfileDiffSnapshot(currentProfile = {}, patch = {}) {
  const profile = currentProfile && typeof currentProfile === "object" ? currentProfile : {}
  const changedFields = []
  Object.entries(patch).forEach(([key, value]) => {
    const previous = profile?.[key]
    const left = JSON.stringify(previous ?? null)
    const right = JSON.stringify(value ?? null)
    if (left === right) return
    changedFields.push({
      fieldKey: key,
      from: previous ?? null,
      to: value ?? null,
    })
  })
  return {
    changedCount: changedFields.length,
    changedFields,
  }
}

async function listParentProfileFieldLocks(studentRefId) {
  const id = normalizeText(studentRefId)
  if (!id) return []
  return runParentPortalDbOperation(
    async (prisma) => {
      const rows = await prisma.parentProfileFieldLock.findMany({
        where: {
          studentRefId: id,
          locked: true,
        },
      })
      return rows.map((row) => normalizeText(row.fieldKey)).filter(Boolean)
    },
    async () =>
      PARENT_PORTAL_MEMORY.fieldLocks
        .filter((row) => normalizeText(row.studentRefId) === id && resolveBoolean(row.locked, false))
        .map((row) => normalizeText(row.fieldKey))
  )
}

function mapParentProfileSubmissionRecord(record = {}) {
  return {
    id: normalizeText(record.id),
    parentAccountId: normalizeText(record.parentAccountId),
    studentRefId: normalizeText(record.studentRefId),
    status: PARENT_PROFILE_QUEUE_ALLOWED_STATUSES.has(normalizeText(record.status))
      ? normalizeText(record.status)
      : PARENT_PROFILE_QUEUE_STATUS_DRAFT,
    draftPayloadJson: record.draftPayloadJson && typeof record.draftPayloadJson === "object" ? record.draftPayloadJson : {},
    adminEditedPayloadJson:
      record.adminEditedPayloadJson && typeof record.adminEditedPayloadJson === "object" ? record.adminEditedPayloadJson : null,
    diffPayloadJson: record.diffPayloadJson && typeof record.diffPayloadJson === "object" ? record.diffPayloadJson : {},
    failurePoint: normalizeText(record.failurePoint),
    rejectionReason: normalizeText(record.rejectionReason),
    comment: normalizeText(record.comment),
    submittedAt: normalizeText(record.submittedAt),
    reviewedAt: normalizeText(record.reviewedAt),
    reviewedByUsername: normalizeText(record.reviewedByUsername),
    createdAt: normalizeText(record.createdAt),
    updatedAt: normalizeText(record.updatedAt),
  }
}

async function saveParentProfileDraftSubmission({
  parentAccountId = "",
  studentRefId = "",
  draftPayloadJson = {},
  diffPayloadJson = {},
  comment = "",
}) {
  const normalizedParentAccountId = normalizeText(parentAccountId)
  const normalizedStudentRefId = normalizeText(studentRefId)
  const normalizedComment = normalizeText(comment)

  return runParentPortalDbOperation(
    async (prisma) => {
      const latestDraft = await prisma.parentProfileSubmissionQueue.findFirst({
        where: {
          parentAccountId: normalizedParentAccountId,
          studentRefId: normalizedStudentRefId,
          status: PARENT_PROFILE_QUEUE_STATUS_DRAFT,
        },
        orderBy: { updatedAt: "desc" },
      })
      const now = new Date()
      if (latestDraft) {
        const updated = await prisma.parentProfileSubmissionQueue.update({
          where: { id: latestDraft.id },
          data: {
            draftPayloadJson,
            diffPayloadJson,
            comment: normalizedComment || null,
            failurePoint: null,
            rejectionReason: null,
          },
        })
        return mapParentProfileSubmissionRecord({
          ...updated,
          submittedAt: updated.submittedAt?.toISOString?.() || "",
          reviewedAt: updated.reviewedAt?.toISOString?.() || "",
          createdAt: updated.createdAt?.toISOString?.() || now.toISOString(),
          updatedAt: updated.updatedAt?.toISOString?.() || now.toISOString(),
        })
      }
      const created = await prisma.parentProfileSubmissionQueue.create({
        data: {
          parentAccountId: normalizedParentAccountId,
          studentRefId: normalizedStudentRefId,
          status: PARENT_PROFILE_QUEUE_STATUS_DRAFT,
          draftPayloadJson,
          diffPayloadJson,
          comment: normalizedComment || null,
        },
      })
      return mapParentProfileSubmissionRecord({
        ...created,
        submittedAt: "",
        reviewedAt: "",
        createdAt: created.createdAt?.toISOString?.() || now.toISOString(),
        updatedAt: created.updatedAt?.toISOString?.() || now.toISOString(),
      })
    },
    async () => {
      const nowIsoText = nowIso()
      const existingIndex = PARENT_PORTAL_MEMORY.submissions.findIndex(
        (row) =>
          normalizeText(row.parentAccountId) === normalizedParentAccountId
          && normalizeText(row.studentRefId) === normalizedStudentRefId
          && normalizeText(row.status) === PARENT_PROFILE_QUEUE_STATUS_DRAFT
      )
      if (existingIndex >= 0) {
        const updated = {
          ...PARENT_PORTAL_MEMORY.submissions[existingIndex],
          draftPayloadJson,
          diffPayloadJson,
          comment: normalizedComment,
          failurePoint: "",
          rejectionReason: "",
          updatedAt: nowIsoText,
        }
        PARENT_PORTAL_MEMORY.submissions[existingIndex] = updated
        return mapParentProfileSubmissionRecord(updated)
      }
      const created = {
        id: createQueueId("ppq"),
        parentAccountId: normalizedParentAccountId,
        studentRefId: normalizedStudentRefId,
        status: PARENT_PROFILE_QUEUE_STATUS_DRAFT,
        draftPayloadJson,
        adminEditedPayloadJson: null,
        diffPayloadJson,
        failurePoint: "",
        rejectionReason: "",
        comment: normalizedComment,
        submittedAt: "",
        reviewedAt: "",
        reviewedByUsername: "",
        createdAt: nowIsoText,
        updatedAt: nowIsoText,
      }
      PARENT_PORTAL_MEMORY.submissions.push(created)
      return mapParentProfileSubmissionRecord(created)
    }
  )
}

async function setParentProfileSubmissionSubmitted({ parentAccountId = "", studentRefId = "", comment = "" }) {
  const normalizedParentAccountId = normalizeText(parentAccountId)
  const normalizedStudentRefId = normalizeText(studentRefId)
  const normalizedComment = normalizeText(comment)

  return runParentPortalDbOperation(
    async (prisma) => {
      const latestDraft = await prisma.parentProfileSubmissionQueue.findFirst({
        where: {
          parentAccountId: normalizedParentAccountId,
          studentRefId: normalizedStudentRefId,
          status: PARENT_PROFILE_QUEUE_STATUS_DRAFT,
        },
        orderBy: { updatedAt: "desc" },
      })
      if (!latestDraft) return null
      const submittedAt = new Date()
      const updated = await prisma.parentProfileSubmissionQueue.update({
        where: { id: latestDraft.id },
        data: {
          status: PARENT_PROFILE_QUEUE_STATUS_SUBMITTED,
          submittedAt,
          comment: normalizedComment || latestDraft.comment || null,
          failurePoint: null,
          rejectionReason: null,
        },
      })
      return mapParentProfileSubmissionRecord({
        ...updated,
        submittedAt: updated.submittedAt?.toISOString?.() || "",
        reviewedAt: updated.reviewedAt?.toISOString?.() || "",
        createdAt: updated.createdAt?.toISOString?.() || "",
        updatedAt: updated.updatedAt?.toISOString?.() || "",
      })
    },
    async () => {
      const index = PARENT_PORTAL_MEMORY.submissions.findIndex(
        (row) =>
          normalizeText(row.parentAccountId) === normalizedParentAccountId
          && normalizeText(row.studentRefId) === normalizedStudentRefId
          && normalizeText(row.status) === PARENT_PROFILE_QUEUE_STATUS_DRAFT
      )
      if (index < 0) return null
      const nowIsoText = nowIso()
      const updated = {
        ...PARENT_PORTAL_MEMORY.submissions[index],
        status: PARENT_PROFILE_QUEUE_STATUS_SUBMITTED,
        submittedAt: nowIsoText,
        comment: normalizedComment || normalizeText(PARENT_PORTAL_MEMORY.submissions[index].comment),
        failurePoint: "",
        rejectionReason: "",
        updatedAt: nowIsoText,
      }
      PARENT_PORTAL_MEMORY.submissions[index] = updated
      return mapParentProfileSubmissionRecord(updated)
    }
  )
}

async function listParentProfileSubmissions({
  statuses = [],
  parentAccountId = "",
  take = 50,
} = {}) {
  const normalizedStatuses = Array.from(
    new Set((Array.isArray(statuses) ? statuses : []).map((entry) => normalizeText(entry)).filter(Boolean))
  ).filter((entry) => PARENT_PROFILE_QUEUE_ALLOWED_STATUSES.has(entry))
  const limit = Math.max(1, Math.min(Number.parseInt(String(take || 50), 10) || 50, 500))
  const normalizedParentAccountId = normalizeText(parentAccountId)

  return runParentPortalDbOperation(
    async (prisma) => {
      const where = {}
      if (normalizedStatuses.length) where.status = { in: normalizedStatuses }
      if (normalizedParentAccountId) where.parentAccountId = normalizedParentAccountId
      const rows = await prisma.parentProfileSubmissionQueue.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      })
      return rows.map((row) =>
        mapParentProfileSubmissionRecord({
          ...row,
          submittedAt: row.submittedAt?.toISOString?.() || "",
          reviewedAt: row.reviewedAt?.toISOString?.() || "",
          createdAt: row.createdAt?.toISOString?.() || "",
          updatedAt: row.updatedAt?.toISOString?.() || "",
        })
      )
    },
    async () => {
      const rows = PARENT_PORTAL_MEMORY.submissions
        .filter((row) => {
          const status = normalizeText(row.status)
          if (normalizedStatuses.length && !normalizedStatuses.includes(status)) return false
          if (normalizedParentAccountId && normalizeText(row.parentAccountId) !== normalizedParentAccountId) return false
          return true
        })
        .sort((left, right) => normalizeText(right.createdAt).localeCompare(normalizeText(left.createdAt)))
        .slice(0, limit)
      return rows.map((row) => mapParentProfileSubmissionRecord(row))
    }
  )
}

async function getParentProfileSubmissionById(submissionId) {
  const id = normalizeText(submissionId)
  if (!id) return null
  return runParentPortalDbOperation(
    async (prisma) => {
      const row = await prisma.parentProfileSubmissionQueue.findUnique({ where: { id } })
      if (!row) return null
      return mapParentProfileSubmissionRecord({
        ...row,
        submittedAt: row.submittedAt?.toISOString?.() || "",
        reviewedAt: row.reviewedAt?.toISOString?.() || "",
        createdAt: row.createdAt?.toISOString?.() || "",
        updatedAt: row.updatedAt?.toISOString?.() || "",
      })
    },
    async () => {
      const row = PARENT_PORTAL_MEMORY.submissions.find((entry) => normalizeText(entry.id) === id)
      return row ? mapParentProfileSubmissionRecord(row) : null
    }
  )
}

async function updateParentProfileSubmissionById(submissionId, patch = {}) {
  const id = normalizeText(submissionId)
  if (!id) return null
  const normalizedPatch = patch && typeof patch === "object" ? patch : {}
  return runParentPortalDbOperation(
    async (prisma) => {
      const data = {}
      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "status")) data.status = normalizeText(normalizedPatch.status)
      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "draftPayloadJson")) {
        data.draftPayloadJson = normalizedPatch.draftPayloadJson
      }
      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "adminEditedPayloadJson")) {
        data.adminEditedPayloadJson = normalizedPatch.adminEditedPayloadJson
      }
      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "diffPayloadJson")) data.diffPayloadJson = normalizedPatch.diffPayloadJson
      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "failurePoint")) data.failurePoint = normalizeText(normalizedPatch.failurePoint) || null
      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "rejectionReason")) data.rejectionReason = normalizeText(normalizedPatch.rejectionReason) || null
      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "reviewedByUsername")) data.reviewedByUsername = normalizeText(normalizedPatch.reviewedByUsername) || null
      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "reviewedAt")) data.reviewedAt = parseIsoDateTime(normalizedPatch.reviewedAt) || null
      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "submittedAt")) data.submittedAt = parseIsoDateTime(normalizedPatch.submittedAt) || null
      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "comment")) data.comment = normalizeText(normalizedPatch.comment) || null

      const updated = await prisma.parentProfileSubmissionQueue.update({
        where: { id },
        data,
      })
      return mapParentProfileSubmissionRecord({
        ...updated,
        submittedAt: updated.submittedAt?.toISOString?.() || "",
        reviewedAt: updated.reviewedAt?.toISOString?.() || "",
        createdAt: updated.createdAt?.toISOString?.() || "",
        updatedAt: updated.updatedAt?.toISOString?.() || "",
      })
    },
    async () => {
      const index = PARENT_PORTAL_MEMORY.submissions.findIndex((entry) => normalizeText(entry.id) === id)
      if (index < 0) return null
      const updated = {
        ...PARENT_PORTAL_MEMORY.submissions[index],
        ...normalizedPatch,
        updatedAt: nowIso(),
      }
      PARENT_PORTAL_MEMORY.submissions[index] = updated
      return mapParentProfileSubmissionRecord(updated)
    }
  )
}

async function findStudentByEaglesIdForParent(eaglesId) {
  const requested = normalizeText(eaglesId)
  if (!requested) return null
  try {
    const prisma = await getSharedPrismaClient()
    if (!prisma || !prisma.student) return null
    const student = await prisma.student.findUnique({
      where: { eaglesId: requested },
      select: {
        id: true,
        eaglesId: true,
        studentNumber: true,
        profile: true,
      },
    })
    if (!student) return null
    return mapStudentToParentChildSummary(student)
  } catch (error) {
    if (isParentPortalTableMissingError(error)) return null
    throw error
  }
}

function buildChildDashboardSnapshot({
  child = {},
  attendanceRows = [],
  gradeRows = [],
  reportRows = [],
} = {}) {
  const details = buildChildDashboardDetails({
    attendanceRows,
    gradeRows,
    reportRows,
  })
  const attendance = {
    total: attendanceRows.length,
    present: attendanceRows.filter((row) => normalizeLower(row?.status) === "present").length,
    absent: attendanceRows.filter((row) => normalizeLower(row?.status) === "absent").length,
    late: attendanceRows.filter((row) => normalizeLower(row?.status) === "late").length,
    excused: attendanceRows.filter((row) => normalizeLower(row?.status) === "excused").length,
  }
  const now = new Date()
  const assignments = {
    total: gradeRows.length,
    completed: gradeRows.filter((row) => row?.homeworkCompleted === true || Boolean(row?.submittedAt)).length,
    overdue: gradeRows.filter((row) => {
      if (row?.homeworkCompleted === true || row?.submittedAt) return false
      const dueAt = parseIsoDateTime(row?.dueAt)
      if (!dueAt) return false
      return dueAt < now
    }).length,
    pending: gradeRows.filter((row) => row?.homeworkCompleted !== true && !row?.submittedAt).length,
  }
  const averageScore = (() => {
    const values = gradeRows
      .map((row) => {
        const score = Number.parseFloat(String(row?.score))
        const maxScore = Number.parseFloat(String(row?.maxScore))
        if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return null
        return (score / maxScore) * 100
      })
      .filter((entry) => Number.isFinite(entry))
    if (!values.length) return null
    const total = values.reduce((sum, entry) => sum + entry, 0)
    return Number((total / values.length).toFixed(2))
  })()
  const performance = {
    averageScorePercent: averageScore,
    reportCount: reportRows.length,
    latestReportAt: reportRows.length ? normalizeText(reportRows[0]?.generatedAt) : "",
  }
  return {
    eaglesId: normalizeText(child?.eaglesId),
    eaglesRefId: normalizeText(child?.eaglesRefId),
    studentNumber: Number.parseInt(String(child?.studentNumber || ""), 10) || null,
    fullName: normalizeText(child?.fullName),
    englishName: normalizeText(child?.englishName),
    currentGrade: normalizeText(child?.currentGrade),
    attendance,
    assignments,
    grades: {
      total: gradeRows.length,
      averageScorePercent: averageScore,
    },
    performance,
    details,
  }
}

function startOfPortalWeek(value) {
  const date = parseIsoDateTime(value)
  if (!date) return null
  const shifted = shiftToFixedTimeZone(new Date(date.getTime()))
  shifted.setUTCHours(0, 0, 0, 0)
  shifted.setUTCDate(shifted.getUTCDate() - shifted.getUTCDay())
  return shiftFromFixedTimeZone(shifted)
}

function addPortalDays(value, days = 0) {
  const date = value instanceof Date ? new Date(value.getTime()) : null
  if (!date) return null
  const shifted = shiftToFixedTimeZone(date)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shiftFromFixedTimeZone(shifted)
}

function toPortalDateKey(value) {
  const date = value instanceof Date ? value : parseIsoDateTime(value)
  if (!date) return ""
  const shifted = shiftToFixedTimeZone(date)
  const year = String(shifted.getUTCFullYear())
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0")
  const day = String(shifted.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function toIsoOrEmpty(value) {
  return value?.toISOString?.() || ""
}

function toFiniteNumberOrNull(value, digits = 2) {
  const parsed = Number.parseFloat(String(value))
  if (!Number.isFinite(parsed)) return null
  return Number(parsed.toFixed(digits))
}

function toGradeScorePercent(row = {}) {
  const score = Number.parseFloat(String(row?.score))
  const maxScore = Number.parseFloat(String(row?.maxScore))
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return null
  return Number(((score / maxScore) * 100).toFixed(2))
}

function resolveGradeRecordStatus(row = {}, now = new Date()) {
  if (row?.homeworkCompleted === true || row?.submittedAt) return "completed"
  const dueAt = parseIsoDateTime(row?.dueAt)
  if (dueAt && dueAt < now) return "overdue"
  return "pending"
}

function serializeAttendanceRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({
      id: normalizeText(row?.id) || `attendance-${index}-${toPortalDateKey(row?.attendanceDate)}`,
      className: normalizeText(row?.className),
      level: normalizeText(row?.level),
      schoolYear: normalizeText(row?.schoolYear),
      quarter: normalizeText(row?.quarter),
      attendanceDate: toPortalDateKey(row?.attendanceDate),
      status: normalizeLower(row?.status) || "present",
      comments: normalizeText(row?.comments),
    }))
    .filter((row) => row.attendanceDate)
}

function serializeGradeRows(rows = [], now = new Date()) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const dueAt = parseIsoDateTime(row?.dueAt)
      const submittedAt = parseIsoDateTime(row?.submittedAt)
      return {
        id: normalizeText(row?.id) || `grade-${index}-${toPortalDateKey(dueAt || submittedAt)}`,
        className: normalizeText(row?.className),
        level: normalizeText(row?.level),
        schoolYear: normalizeText(row?.schoolYear),
        quarter: normalizeText(row?.quarter),
        assignmentName: normalizeText(row?.assignmentName),
        dueAt: toIsoOrEmpty(dueAt),
        dueDate: toPortalDateKey(dueAt),
        submittedAt: toIsoOrEmpty(submittedAt),
        submittedDate: toPortalDateKey(submittedAt),
        score: toFiniteNumberOrNull(row?.score),
        maxScore: toFiniteNumberOrNull(row?.maxScore),
        scorePercent: toGradeScorePercent(row),
        homeworkCompleted: row?.homeworkCompleted === true,
        homeworkOnTime: row?.homeworkOnTime === true,
        behaviorScore: toFiniteNumberOrNull(row?.behaviorScore, 0),
        participationScore: toFiniteNumberOrNull(row?.participationScore, 0),
        inClassScore: toFiniteNumberOrNull(row?.inClassScore, 0),
        comments: normalizeText(row?.comments),
        status: resolveGradeRecordStatus(row, now),
      }
    })
    .filter((row) => row.assignmentName)
}

function serializeReportRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const generatedAt = parseIsoDateTime(row?.generatedAt)
      const approvedAt = parseIsoDateTime(row?.approvedAt)
      const decoded = decodeParentReportCommentBundle(row?.comments)
      return {
        id: normalizeText(row?.id) || `report-${index}-${toPortalDateKey(generatedAt)}`,
        className: normalizeText(row?.className),
        level: normalizeText(row?.level),
        schoolYear: normalizeText(row?.schoolYear),
        quarter: normalizeText(row?.quarter),
        generatedAt: toIsoOrEmpty(generatedAt),
        generatedDate: toPortalDateKey(generatedAt),
        approvedAt: toIsoOrEmpty(approvedAt),
        homeworkCompletionRate: toFiniteNumberOrNull(row?.homeworkCompletionRate),
        homeworkOnTimeRate: toFiniteNumberOrNull(row?.homeworkOnTimeRate),
        behaviorScore: toFiniteNumberOrNull(row?.behaviorScore),
        participationScore: toFiniteNumberOrNull(row?.participationScore),
        inClassScore: toFiniteNumberOrNull(row?.inClassScore),
        participationPointsAward: Number.parseInt(String(row?.participationPointsAward || ""), 10) || 0,
        approvedByUsername: normalizeText(row?.approvedByUsername),
        comments: normalizeText(decoded.comment),
      }
    })
    .filter((row) => row.generatedDate)
}

function buildChildDashboardDetails({
  attendanceRows = [],
  gradeRows = [],
  reportRows = [],
} = {}) {
  const assignmentHistory = serializeGradeRows(gradeRows, new Date())
  const gradeHistory = assignmentHistory.filter((row) => row.status === "completed" || row.scorePercent !== null)
  return {
    attendanceHistory: serializeAttendanceRows(attendanceRows).slice(0, 90),
    assignmentHistory: assignmentHistory.slice(0, 48),
    currentHomework: assignmentHistory.filter((row) => row.status === "pending").slice(0, 24),
    overdueHomework: assignmentHistory.filter((row) => row.status === "overdue").slice(0, 24),
    gradeHistory: gradeHistory.slice(0, 36),
    reportArchive: serializeReportRows(reportRows).slice(0, 24),
  }
}

export function buildStudentPortalCalendarTracks({ now = new Date(), gradeRows = [], reportRows = [] } = {}) {
  const nowDate = parseIsoDateTime(now) || new Date()
  const homework = (Array.isArray(gradeRows) ? gradeRows : [])
    .filter((row) => {
      if (row?.homeworkCompleted === true || row?.submittedAt) return false
      return Boolean(parseIsoDateTime(row?.dueAt))
    })
    .sort((left, right) => {
      const leftTime = parseIsoDateTime(left?.dueAt)?.getTime?.() || 0
      const rightTime = parseIsoDateTime(right?.dueAt)?.getTime?.() || 0
      return leftTime - rightTime
    })
    .slice(0, 18)
    .map((row, index) => {
      const dueAt = parseIsoDateTime(row?.dueAt)
      const weekStart = startOfPortalWeek(dueAt)
      const weekEndExclusive = addPortalDays(weekStart, 7)
      return {
        id: normalizeText(row?.id) || `homework-${index}-${toPortalDateKey(dueAt)}`,
        title: normalizeText(row?.assignmentName) || normalizeText(row?.className) || "Current homework track",
        className: normalizeText(row?.className),
        dueDate: toPortalDateKey(dueAt),
        startDate: toPortalDateKey(weekStart),
        endDate: toPortalDateKey(weekEndExclusive),
        overdue: Boolean(dueAt && dueAt < nowDate),
      }
    })
    .filter((row) => row.startDate && row.endDate && row.dueDate)

  const review = (Array.isArray(reportRows) ? reportRows : [])
    .filter((row) => Boolean(parseIsoDateTime(row?.generatedAt)))
    .sort((left, right) => {
      const leftTime = parseIsoDateTime(left?.generatedAt)?.getTime?.() || 0
      const rightTime = parseIsoDateTime(right?.generatedAt)?.getTime?.() || 0
      return rightTime - leftTime
    })
    .slice(0, 16)
    .map((row, index) => {
      const generatedAt = parseIsoDateTime(row?.generatedAt)
      const weekStart = startOfPortalWeek(generatedAt)
      const weekEndExclusive = addPortalDays(weekStart, 7)
      return {
        id: normalizeText(row?.id) || `review-${index}-${toPortalDateKey(generatedAt)}`,
        title: normalizeText(row?.className) || "Notes review track",
        quarter: normalizeText(row?.quarter),
        startDate: toPortalDateKey(weekStart),
        endDate: toPortalDateKey(weekEndExclusive),
        generatedDate: toPortalDateKey(generatedAt),
      }
    })
    .filter((row) => row.startDate && row.endDate && row.generatedDate)

  return { homework, review }
}

async function buildParentDashboardPayload(session = {}) {
  const linkedChildren = await listParentLinkedStudents({
    parentsId: normalizeText(session?.parentsId),
    parentAccountId: normalizeText(session?.accountId),
  })
  const childIds = linkedChildren.map((entry) => normalizeText(entry.studentRefId)).filter(Boolean)
  if (!childIds.length) {
    return {
      ok: true,
      generatedAt: nowIso(),
      children: [],
    }
  }

  try {
    const prisma = await getSharedPrismaClient()
    const [attendanceRows, gradeRows, reportRows] = await Promise.all([
      prisma.studentAttendance.findMany({
        where: { studentRefId: { in: childIds } },
        orderBy: { attendanceDate: "desc" },
      }),
      prisma.studentGradeRecord.findMany({
        where: { studentRefId: { in: childIds } },
        orderBy: { dueAt: "desc" },
      }),
      prisma.parentClassReport.findMany({
        where: { studentRefId: { in: childIds } },
        orderBy: { generatedAt: "desc" },
      }),
    ])

    const groupedAttendance = new Map()
    const groupedGrades = new Map()
    const groupedReports = new Map()
    attendanceRows.forEach((row) => {
      const id = normalizeText(row?.studentRefId)
      if (!groupedAttendance.has(id)) groupedAttendance.set(id, [])
      groupedAttendance.get(id).push(row)
    })
    gradeRows.forEach((row) => {
      const id = normalizeText(row?.studentRefId)
      if (!groupedGrades.has(id)) groupedGrades.set(id, [])
      groupedGrades.get(id).push(row)
    })
    reportRows.forEach((row) => {
      const id = normalizeText(row?.studentRefId)
      if (!groupedReports.has(id)) groupedReports.set(id, [])
      groupedReports.get(id).push(row)
    })

    return {
      ok: true,
      generatedAt: nowIso(),
      children: linkedChildren.map((child) =>
        buildChildDashboardSnapshot({
          child,
          attendanceRows: groupedAttendance.get(child.studentRefId) || [],
          gradeRows: groupedGrades.get(child.studentRefId) || [],
          reportRows: groupedReports.get(child.studentRefId) || [],
        })
      ),
    }
  } catch (error) {
    const wrapped = new Error("Unable to load parent dashboard")
    wrapped.statusCode = 503
    throw wrapped
  }
}

async function buildStudentDashboardPayload({ studentRefId = "", eaglesId = "" } = {}) {
  const id = normalizeText(studentRefId)
  if (!id) {
    const error = new Error("studentRefId is required")
    error.statusCode = 400
    throw error
  }

  try {
    const prisma = await getSharedPrismaClient()
    const newsAggregatePromise =
      prisma?.studentNewsReport && typeof prisma.studentNewsReport.aggregate === "function"
        ? prisma.studentNewsReport.aggregate({
            where: { studentRefId: id },
            _count: { _all: true },
            _max: { submittedAt: true },
          })
        : Promise.resolve({
            _count: { _all: 0 },
            _max: { submittedAt: null },
          })
    const [student, attendanceRows, gradeRows, reportRows, pointsLedger, newsAggregate] = await Promise.all([
      prisma.student.findUnique({
        where: { id },
        select: {
          id: true,
          eaglesId: true,
          studentNumber: true,
          profile: true,
        },
      }),
      prisma.studentAttendance.findMany({
        where: { studentRefId: id },
        orderBy: { attendanceDate: "desc" },
      }),
      prisma.studentGradeRecord.findMany({
        where: { studentRefId: id },
        orderBy: { dueAt: "desc" },
      }),
      prisma.parentClassReport.findMany({
        where: { studentRefId: id },
        orderBy: { generatedAt: "desc" },
      }),
      listStudentPointsLedger(id, { take: 1 }),
      newsAggregatePromise,
    ])

    const mappedChild = mapStudentToParentChildSummary(student || { id, eaglesId })
    const child = {
      ...mappedChild,
      eaglesId: normalizeText(mappedChild.eaglesId) || normalizeText(eaglesId),
    }
    const dashboard = buildChildDashboardSnapshot({
      child,
      attendanceRows,
      gradeRows,
      reportRows,
    })
    const pointsSummary = pointsLedger?.summary && typeof pointsLedger.summary === "object"
      ? pointsLedger.summary
      : {}
    const submittedCount = Number.parseInt(String(newsAggregate?._count?._all || 0), 10) || 0
    const latestSubmittedAt = newsAggregate?._max?.submittedAt?.toISOString?.() || ""
    const calendarTracks = buildStudentPortalCalendarTracks({
      gradeRows,
      reportRows,
    })

    return {
      ok: true,
      generatedAt: nowIso(),
      child: {
        ...dashboard,
        studentNumber: child.studentNumber,
        fullName: child.fullName,
        englishName: child.englishName,
        currentGrade: child.currentGrade,
      },
      points: {
        totalPoints: Number.parseInt(String(pointsSummary.totalPoints || 0), 10) || 0,
        scheduledOnTimeCount: Number.parseInt(String(pointsSummary.scheduledOnTimeCount || 0), 10) || 0,
        electiveCount: Number.parseInt(String(pointsSummary.electiveCount || 0), 10) || 0,
        approvedReportCount: Number.parseInt(String(pointsSummary.approvedReportCount || 0), 10) || 0,
        adjustmentTotal: Number.parseInt(String(pointsSummary.adjustmentTotal || 0), 10) || 0,
        lastActivityAt: normalizeText(pointsSummary.lastActivityAt),
      },
      calendarTracks,
      newsReports: {
        submittedCount,
        latestSubmittedAt,
      },
    }
  } catch (error) {
    const wrapped = new Error("Unable to load student dashboard")
    wrapped.statusCode = 503
    throw wrapped
  }
}

async function buildQueueHubPayload() {
  assertStoreEnabled()
  const dashboard = await getAdminDashboardSummary()
  const [parentQueue, incomingQueue, submissions, newsReviewQueue] = await Promise.all([
    listQueuedAnnouncements({
      queueType: NOTIFICATION_QUEUE_TYPE_PARENT_REPORT,
      includeSent: false,
      take: 20,
    }),
    listIncomingExerciseResults({
      statuses: [INCOMING_EXERCISE_RESULT_STATUS_QUEUED],
      take: 20,
      showAll: false,
    }),
    listParentProfileSubmissions({
      statuses: [PARENT_PROFILE_QUEUE_STATUS_SUBMITTED],
      take: 20,
    }),
    (async () => {
      try {
        const prisma = await getSharedPrismaClient()
        const now = new Date()
        const start = new Date(now)
        start.setHours(0, 0, 0, 0)
        start.setDate(start.getDate() - 180)
        const rows = await prisma.studentNewsReport.findMany({
          where: {
            reportDate: {
              gte: start,
              lte: now,
            },
          },
          orderBy: [{ submittedAt: "desc" }, { reportDate: "desc" }],
          take: 500,
          select: {
            id: true,
            studentRefId: true,
            reportDate: true,
            submittedAt: true,
            reviewStatus: true,
            articleTitle: true,
            sourceLink: true,
            student: {
              select: {
                id: true,
                eaglesId: true,
                studentNumber: true,
                profile: {
                  select: {
                    fullName: true,
                    englishName: true,
                    currentGrade: true,
                  },
                },
              },
            },
          },
        })

        const startOfNewsWeek = (value) => {
          const parsed = parseIsoDateTime(value)
          if (!parsed) return null
          const shifted = shiftToFixedTimeZone(new Date(parsed.getTime()))
          shifted.setUTCHours(0, 0, 0, 0)
          const diffToMonday = (shifted.getUTCDay() + 6) % 7
          shifted.setUTCDate(shifted.getUTCDate() - diffToMonday)
          return shiftFromFixedTimeZone(shifted)
        }
        const endOfNewsWeek = (weekStartDate) => {
          const startDate = weekStartDate instanceof Date ? weekStartDate : null
          if (!startDate || Number.isNaN(startDate.valueOf())) return null
          const shifted = shiftToFixedTimeZone(new Date(startDate.getTime()))
          shifted.setUTCDate(shifted.getUTCDate() + 6)
          return shiftFromFixedTimeZone(shifted)
        }
        const groupedByWeekSet = new Map()
        rows.forEach((row) => {
          const studentRefId = normalizeText(row?.studentRefId)
          const student = row?.student && typeof row.student === "object" ? row.student : {}
          const eaglesId = normalizeText(student?.eaglesId)
          const weekStartDate = startOfNewsWeek(row?.reportDate)
          const weekStart = toPortalDateKey(weekStartDate)
          if (!weekStart) return
          const weekEnd = toPortalDateKey(endOfNewsWeek(weekStartDate))
          const key = `${studentRefId || eaglesId || normalizeText(row?.id)}:${weekStart}`
          if (!key) return

          const existing = groupedByWeekSet.get(key) || {
            id: `news-week-set:${key}`,
            studentRefId,
            eaglesId,
            studentNumber: Number.parseInt(String(student?.studentNumber || ""), 10) || null,
            fullName: normalizeText(student?.profile?.fullName || student?.profile?.englishName),
            englishName: normalizeText(student?.profile?.englishName),
            level: normalizeText(student?.profile?.currentGrade),
            weekStart,
            weekEnd,
            reportCount: 0,
            submittedCount: 0,
            approvedCount: 0,
            revisionRequestedCount: 0,
            latestReportId: "",
            latestReportDate: "",
            latestSubmittedAt: "",
            latestReviewStatus: "",
            latestArticleTitle: "",
            latestSourceLink: "",
            setStatus: "submitted",
            _reportDates: new Set(),
          }
          const reportDateKey = toPortalDateKey(row?.reportDate)
          if (reportDateKey) existing._reportDates.add(reportDateKey)
          const status = normalizeLower(row?.reviewStatus)
          if (status === "approved") existing.approvedCount += 1
          else if (status === "revision-requested") existing.revisionRequestedCount += 1
          else existing.submittedCount += 1

          const submittedAtIso = row?.submittedAt?.toISOString?.() || ""
          const latestSubmittedAtIso = normalizeText(existing.latestSubmittedAt)
          if (!latestSubmittedAtIso || submittedAtIso > latestSubmittedAtIso) {
            existing.latestReportId = normalizeText(row?.id)
            existing.latestReportDate = row?.reportDate?.toISOString?.()?.slice?.(0, 10) || ""
            existing.latestSubmittedAt = submittedAtIso
            existing.latestReviewStatus = normalizeText(row?.reviewStatus)
            existing.latestArticleTitle = normalizeText(row?.articleTitle)
            existing.latestSourceLink = normalizeText(row?.sourceLink)
          }
          groupedByWeekSet.set(key, existing)
        })

        const weekSets = Array.from(groupedByWeekSet.values())
          .map((entry) => {
            const reportDates = entry?._reportDates instanceof Set ? entry._reportDates : new Set()
            const reportCount = Math.max(0, reportDates.size)
            const setStatus = reportCount < 7
              ? "incomplete"
              : entry?.revisionRequestedCount > 0
              ? "revision-requested"
              : reportCount >= 7 && entry?.approvedCount >= reportCount
                ? "approved"
                : "submitted"
            const { _reportDates, ...safeEntry } = entry || {}
            void _reportDates
            return {
              ...safeEntry,
              reportCount,
              setStatus,
            }
          })
        const sortedItems = weekSets
          .sort((left, right) => {
            const byWeek = normalizeText(right?.weekStart).localeCompare(normalizeText(left?.weekStart))
            if (byWeek !== 0) return byWeek
            return normalizeText(right?.latestSubmittedAt).localeCompare(normalizeText(left?.latestSubmittedAt))
          })
        const items = sortedItems.slice(0, 200)

        return {
          total: sortedItems.length,
          items,
        }
      } catch (error) {
        void error
        return {
          total: 0,
          items: [],
        }
      }
    })(),
  ])

  let overdueItems = []
  try {
    const prisma = await getSharedPrismaClient()
    overdueItems = await prisma.studentGradeRecord.findMany({
      where: {
        dueAt: { lt: new Date() },
        OR: [
          { homeworkCompleted: false },
          { homeworkCompleted: null },
          { submittedAt: null },
        ],
      },
      orderBy: { dueAt: "asc" },
      take: 50,
      select: {
        id: true,
        studentRefId: true,
        className: true,
        assignmentName: true,
        dueAt: true,
        submittedAt: true,
        student: {
          select: {
            eaglesId: true,
            studentNumber: true,
            profile: {
              select: {
                fullName: true,
                englishName: true,
              },
            },
          },
        },
      },
    })
  } catch (error) {
    void error
    overdueItems = []
  }

  const panelOrder = normalizeQueueHubPanelOrder(readPersistedUiSettings()?.uiSettings?.queueHub?.panelOrder || [])
  return {
    ok: true,
    generatedAt: nowIso(),
    panelOrder,
    panels: [
      {
        id: "queued-performance-reports",
        title: "Queued Performance Reports",
        total: parentQueue.total,
        items: parentQueue.items,
      },
      {
        id: "unmatched-exercise-submissions",
        title: "Exercise Submissions (Unmatched eaglesId)",
        total: incomingQueue.total,
        items: incomingQueue.items.filter((item) => !normalizeText(item?.matchedStudentRefId)),
      },
      {
        id: "current-assignments-pending",
        title: "Current Assignments Not Yet Completed",
        total: Number.parseInt(String(dashboard?.assignments?.currentPendingStudents || 0), 10) || 0,
        items: Array.isArray(dashboard?.levelCompletion) ? dashboard.levelCompletion : [],
      },
      {
        id: "overdue-homework",
        title: "Overdue Homework",
        total: overdueItems.length,
        items: overdueItems.map((row) => ({
          id: normalizeText(row?.id),
          dueAt: row?.dueAt ? new Date(row.dueAt).toISOString() : "",
          assignmentName: normalizeText(row?.assignmentName),
          className: normalizeText(row?.className),
          studentRefId: normalizeText(row?.studentRefId),
          eaglesId: normalizeText(row?.student?.eaglesId),
          studentNumber: Number.parseInt(String(row?.student?.studentNumber || ""), 10) || null,
          fullName: normalizeText(row?.student?.profile?.fullName || row?.student?.profile?.englishName),
        })),
      },
      {
        id: "attendance-risk",
        title: "At-Risk Attendance",
        total: Number.parseInt(String(dashboard?.attendanceRiskWeek?.total || 0), 10) || 0,
        items: Array.isArray(dashboard?.attendanceRiskWeek?.students) ? dashboard.attendanceRiskWeek.students : [],
      },
      {
        id: "news-report-review",
        title: "News Report Week Sets",
        total: Number.parseInt(String(newsReviewQueue?.total || 0), 10) || 0,
        items: Array.isArray(newsReviewQueue?.items) ? newsReviewQueue.items : [],
      },
      {
        id: "pending-profile-submissions",
        title: "Pending Profile Submissions",
        total: submissions.length,
        items: submissions,
      },
    ],
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

  if (pathname === ADMIN_UI_SETTINGS_PATH) {
    assertCanManageSettings(rolePolicy)

    if (method === "GET") {
      const result = readPersistedUiSettings()
      sendJson(response, 200, {
        ok: true,
        ...result,
      })
      return true
    }

    if (method === "PUT") {
      const payload = await parseBody(request)
      const result = writePersistedUiSettings(payload, session?.username)
      sendJson(response, 200, {
        ok: true,
        ...result,
      })
      return true
    }
  }

  if (method === "GET" && pathname === ADMIN_RUNTIME_HEALTH_PATH) {
    const payload = await resolveAdminRuntimeHealthPayload()
    sendJson(response, 200, payload)
    return true
  }

  if (pathname === ADMIN_SERVICE_CONTROL_PATH) {
    assertCanManageUsers(rolePolicy)

    if (method === "GET") {
      const status = await getExerciseMailerServiceControlStatus()
      sendJson(response, 200, status)
      return true
    }

    if (method === "POST") {
      const payload = await parseBody(request)
      const action = normalizeLower(payload?.action || "restart")
      if (action !== "restart" && action !== "restart-exercise-mailer") {
        const error = new Error("Unsupported service-control action")
        error.statusCode = 400
        throw error
      }
      const result = await restartExerciseMailerServiceControl()
      sendJson(response, 200, result)
      return true
    }
  }

  if (method === "POST" && pathname === ADMIN_ASSIGNMENT_ANNOUNCEMENT_PREVIEW_CREATE_PATH) {
    const payload = await parseBody(request)
    const preview = createAssignmentAnnouncementPreview(payload)
    sendJson(response, 200, {
      ok: true,
      token: preview.token,
      url: buildAssignmentAnnouncementPreviewUrl(request, preview.token),
      path: `${ASSIGNMENT_ANNOUNCEMENT_PREVIEW_PATH}/${preview.token}`,
      expiresAt: new Date(preview.expiresAtMs).toISOString(),
      ttlMinutes: preview.ttlMinutes,
      assignmentTitle: preview.assignmentTitle,
      level: preview.level,
      dueAt: preview.dueAt,
    })
    return true
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

  if (method === "GET" && pathname === ADMIN_POINTS_SUMMARY_PATH) {
    assertStoreEnabled()
    const data = await getSchoolPointsYtdSummary({
      startDate: url.searchParams.get("startDate") || "",
      endDate: url.searchParams.get("endDate") || "",
    })
    sendJson(response, 200, data)
    return true
  }

  if (method === "GET" && pathname === ADMIN_POINTS_STUDENTS_PATH) {
    assertStoreEnabled()
    const data = await listStudentPointsSnapshots({
      query: url.searchParams.get("q") || "",
      level: url.searchParams.get("level") || "",
      take: url.searchParams.get("take") || "250",
      sortField: url.searchParams.get("sortField") || "totalPoints",
      sortDir: url.searchParams.get("sortDir") || "desc",
    })
    sendJson(response, 200, data)
    return true
  }

  if (method === "GET" && pathname === ADMIN_POINTS_LEDGER_PATH) {
    assertStoreEnabled()
    const studentRefId = normalizeText(url.searchParams.get("studentRefId") || "")
    if (!studentRefId) {
      const error = new Error("studentRefId is required")
      error.statusCode = 400
      throw error
    }
    const data = await listStudentPointsLedger(studentRefId, {
      take: url.searchParams.get("take") || "200",
      startDate: url.searchParams.get("startDate") || "",
      endDate: url.searchParams.get("endDate") || "",
    })
    sendJson(response, 200, data)
    return true
  }

  if (method === "POST" && pathname === ADMIN_POINTS_ADJUSTMENTS_PATH) {
    assertStoreEnabled()
    const payload = await parseBody(request)
    const studentRefId = normalizeText(payload?.studentRefId)
    if (!studentRefId) {
      const error = new Error("studentRefId is required")
      error.statusCode = 400
      throw error
    }
    const adjustment = await createStudentPointsAdjustment(studentRefId, payload, {
      adjustedByUsername: normalizeText(session?.username),
    })
    sendJson(response, 200, {
      ok: true,
      item: adjustment,
    })
    return true
  }

  const adminPointsStudentMatch = pathname.match(ADMIN_POINTS_STUDENT_PATH_RE)
  if (adminPointsStudentMatch && method === "PUT") {
    assertStoreEnabled()
    const studentRefId = decodeURIComponent(adminPointsStudentMatch[1])
    const payload = await parseBody(request)
    const result = await setStudentPointsTotal(studentRefId, payload, {
      adjustedByUsername: normalizeText(session?.username),
    })
    sendJson(response, 200, {
      ok: true,
      ...result,
    })
    return true
  }

  if (method === "GET" && pathname === ADMIN_QUEUE_HUB_PATH) {
    assertCanManageUsers(rolePolicy)
    const payload = await buildQueueHubPayload()
    sendJson(response, 200, payload)
    return true
  }

  if (method === "GET" && pathname === ADMIN_NEWS_REPORTS_PATH) {
    assertStoreEnabled()
    const data = await listStudentNewsReportsForReview({
      status: url.searchParams.get("status") || "submitted",
      level: url.searchParams.get("level") || "",
      studentRefId: url.searchParams.get("studentRefId") || "",
      dateFrom: url.searchParams.get("dateFrom") || "",
      dateTo: url.searchParams.get("dateTo") || "",
      query: url.searchParams.get("q") || "",
      take: url.searchParams.get("take") || "200",
    })
    sendJson(response, 200, data)
    return true
  }

  const newsReportMatch = pathname.match(ADMIN_NEWS_REPORT_PATH_RE)
  if (newsReportMatch && method === "POST") {
    assertStoreEnabled()
    assertCanManageUsers(rolePolicy)
    const reportId = decodeURIComponent(newsReportMatch[1])
    const payload = await parseBody(request)
    const result = await reviewStudentNewsReport(reportId, payload, {
      reviewedByUsername: normalizeText(session?.username),
    })
    sendJson(response, 200, {
      ok: true,
      ...result,
    })
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
      const fallbackEaglesId = normalizeText(incoming?.submittedStudentId)
      const requestedEaglesId = normalizeText(payload?.eaglesId || fallbackEaglesId)
      const eaglesId = requestedEaglesId && requestedEaglesId !== "(not provided)" ? requestedEaglesId : ""
      if (!eaglesId) {
        const error = new Error("eaglesId is required to create account")
        error.statusCode = 400
        throw error
      }

      const studentEmail = normalizeText(payload?.email || incoming?.submittedEmail)
      const fullName = normalizeText(payload?.fullName)
      const saved = await saveStudent({
        eaglesId,
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

  if (method === "GET" && pathname === ADMIN_PROFILE_SUBMISSIONS_PATH) {
    assertCanManageUsers(rolePolicy)
    const statusesParam = normalizeText(url.searchParams.get("statuses"))
    const statuses = statusesParam
      ? statusesParam.split(",").map((entry) => normalizeText(entry)).filter(Boolean)
      : [PARENT_PROFILE_QUEUE_STATUS_SUBMITTED]
    const submissions = await listParentProfileSubmissions({
      statuses,
      take: url.searchParams.get("take") || "50",
    })
    sendJson(response, 200, {
      ok: true,
      total: submissions.length,
      items: submissions,
    })
    return true
  }

  const profileSubmissionMatch = pathname.match(ADMIN_PROFILE_SUBMISSION_PATH_RE)
  if (profileSubmissionMatch && method === "PUT") {
    assertCanManageUsers(rolePolicy)
    const submissionId = decodeURIComponent(profileSubmissionMatch[1])
    const payload = await parseBody(request)
    const adminPatch = normalizeParentProfilePatch(payload?.patch || payload?.draftPayloadJson || {})
    const updated = await updateParentProfileSubmissionById(submissionId, {
      adminEditedPayloadJson: adminPatch,
      reviewedByUsername: normalizeText(session?.username),
      reviewedAt: nowIso(),
    })
    if (!updated) {
      const error = new Error("Profile submission not found")
      error.statusCode = 404
      throw error
    }
    sendJson(response, 200, {
      ok: true,
      item: updated,
    })
    return true
  }

  if (profileSubmissionMatch && method === "POST") {
    assertCanManageUsers(rolePolicy)
    const submissionId = decodeURIComponent(profileSubmissionMatch[1])
    const payload = await parseBody(request)
    const action = normalizeLower(payload?.action)
    const submission = await getParentProfileSubmissionById(submissionId)
    if (!submission) {
      const error = new Error("Profile submission not found")
      error.statusCode = 404
      throw error
    }

    if (action === "reject") {
      const rejectionReason = normalizeText(payload?.rejectionReason || payload?.reason)
      const updated = await updateParentProfileSubmissionById(submissionId, {
        status: PARENT_PROFILE_QUEUE_STATUS_REJECTED,
        rejectionReason,
        reviewedByUsername: normalizeText(session?.username),
        reviewedAt: nowIso(),
      })
      sendJson(response, 200, { ok: true, action: "reject", item: updated })
      return true
    }

    if (action === "approve") {
      const patchSource =
        submission.adminEditedPayloadJson && typeof submission.adminEditedPayloadJson === "object"
          ? submission.adminEditedPayloadJson
          : submission.draftPayloadJson
      const mergedPatch = normalizeParentProfilePatch(patchSource)
      const lockedFields = await listParentProfileFieldLocks(submission.studentRefId)
      const blockedFields = Object.keys(mergedPatch).filter((fieldKey) => lockedFields.includes(fieldKey))
      if (blockedFields.length) {
        const updated = await updateParentProfileSubmissionById(submissionId, {
          failurePoint: "lock-conflict",
          rejectionReason: `Locked fields: ${blockedFields.join(", ")}`,
          reviewedByUsername: normalizeText(session?.username),
          reviewedAt: nowIso(),
        })
        const error = new Error("Submission includes locked fields")
        error.statusCode = 409
        sendJson(response, 409, { ok: false, error: error.message, item: updated })
        return true
      }

      const writablePatch = {}
      Object.entries(mergedPatch).forEach(([key, value]) => {
        if (PARENT_PROFILE_IMMUTABLE_FIELDS.has(key)) return
        if (lockedFields.includes(key)) return
        if (!PARENT_PROFILE_EDITABLE_FIELDS.has(key)) return
        writablePatch[key] = value
      })

      try {
        const prisma = await getSharedPrismaClient()
        if (!prisma || !prisma.studentProfile) {
          const error = new Error("Student profile persistence unavailable")
          error.statusCode = 503
          throw error
        }
        const existing = await prisma.studentProfile.findUnique({
          where: { studentRefId: submission.studentRefId },
        })
        const diffPayload = buildProfileDiffSnapshot(existing || {}, writablePatch)
        const updateData = { ...writablePatch }
        updateData.normalizedFormPayload = {
          ...(existing?.normalizedFormPayload && typeof existing.normalizedFormPayload === "object"
            ? existing.normalizedFormPayload
            : {}),
          ...writablePatch,
        }
        updateData.rawFormPayload = {
          ...(existing?.rawFormPayload && typeof existing.rawFormPayload === "object" ? existing.rawFormPayload : {}),
          ...writablePatch,
        }
        if (!existing) {
          await prisma.studentProfile.create({
            data: {
              studentRefId: submission.studentRefId,
              sourceFormId: "parent-portal",
              sourceUrl: "parent-portal",
              ...updateData,
            },
          })
        } else {
          await prisma.studentProfile.update({
            where: { studentRefId: submission.studentRefId },
            data: updateData,
          })
        }
        const updated = await updateParentProfileSubmissionById(submissionId, {
          status: PARENT_PROFILE_QUEUE_STATUS_APPROVED,
          failurePoint: "",
          rejectionReason: "",
          diffPayloadJson: diffPayload,
          reviewedByUsername: normalizeText(session?.username),
          reviewedAt: nowIso(),
        })
        sendJson(response, 200, { ok: true, action: "approve", item: updated })
        return true
      } catch (error) {
        await updateParentProfileSubmissionById(submissionId, {
          failurePoint: "merge-write",
          rejectionReason: normalizeText(error?.message || error),
          reviewedByUsername: normalizeText(session?.username),
          reviewedAt: nowIso(),
        })
        throw error
      }
    }

    {
      const error = new Error("Unsupported profile submission action")
      error.statusCode = 400
      throw error
    }
  }

  if (method === "POST" && pathname === ADMIN_NOTIFY_EMAIL_PATH) {
    const payload = await parseBody(request)
    const deliveryMode = normalizeDeliveryMode(payload?.deliveryMode)
    const queueType = normalizeQueueType(payload?.queueType || NOTIFICATION_QUEUE_TYPE_ANNOUNCEMENT)
    const isTeacher = normalizeRoleName(session?.role) === "teacher"
    if (isTeacher) {
      const teacherQueueAllowed =
        deliveryMode === "weekend-batch" && queueType === NOTIFICATION_QUEUE_TYPE_PARENT_REPORT
      if (!teacherQueueAllowed) {
        const error = new Error("Forbidden")
        error.statusCode = 403
        throw error
      }
    } else if (!rolePolicy.canWrite) {
      const error = new Error("Forbidden")
      error.statusCode = 403
      throw error
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

  if (method === "GET" && pathname === ADMIN_NEXT_STUDENT_NUMBER_PATH) {
    assertStoreEnabled()
    const data = await getNextStudentNumber()
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

async function handleParentApiRequest(request, response, pathname, url) {
  const { method } = request
  const loginPath = `${PARENT_AUTH_PREFIX}/login`
  const logoutPath = `${PARENT_AUTH_PREFIX}/logout`
  const mePath = `${PARENT_AUTH_PREFIX}/me`

  if (method === "POST" && pathname === loginPath) {
    const payload = await parseBody(request)
    const parentsId = normalizeText(payload?.parentsId || payload?.username)
    const password = normalizeText(payload?.password)
    const principal = await verifyParentPortalCredentials(parentsId, password)
    if (!principal) {
      const error = new Error("Invalid parentsId or password")
      error.statusCode = 401
      throw error
    }

    const session = await PARENT_SESSION_STORE.createSession({
      username: principal.parentsId,
      role: "parent",
      parentsId: principal.parentsId,
      accountId: principal.accountId,
    })
    if (!session?.id) {
      const error = new Error("Unable to establish parent session")
      error.statusCode = 500
      throw error
    }
    response.setHeader("Set-Cookie", makeParentSessionCookieValue(session.id, PARENT_SESSION_TTL_SECONDS))
    sendJson(response, 200, {
      authenticated: true,
      user: {
        parentsId: principal.parentsId,
        role: "parent",
      },
    })
    return true
  }

  if (method === "POST" && pathname === logoutPath) {
    const sessionId = readParentSessionIdFromRequest(request)
    if (sessionId) await PARENT_SESSION_STORE.deleteSession(sessionId)
    clearParentSessionCookie(response)
    sendJson(response, 200, { ok: true, authenticated: false })
    return true
  }

  if (method === "GET" && pathname === mePath) {
    const session = await requireAuthenticatedParentSession(request, response)
    sendJson(response, 200, {
      authenticated: true,
      user: {
        parentsId: normalizeText(session?.parentsId || session?.username),
        role: "parent",
      },
    })
    return true
  }

  const session = await requireAuthenticatedParentSession(request, response)
  const parentContext = {
    parentsId: normalizeText(session?.parentsId || session?.username),
    parentAccountId: normalizeText(session?.accountId),
  }

  if (method === "GET" && pathname === PARENT_CHILDREN_PATH) {
    const children = await listParentLinkedStudents({
      parentsId: parentContext.parentsId,
      parentAccountId: parentContext.parentAccountId,
    })
    sendJson(response, 200, {
      ok: true,
      items: children.map((child) => ({
        eaglesId: child.eaglesId,
        eaglesRefId: child.eaglesRefId,
        studentNumber: child.studentNumber,
        fullName: child.fullName,
        englishName: child.englishName,
        currentGrade: child.currentGrade,
      })),
    })
    return true
  }

  if (method === "GET" && pathname === PARENT_DASHBOARD_PATH) {
    const payload = await buildParentDashboardPayload({
      parentsId: parentContext.parentsId,
      accountId: parentContext.parentAccountId,
    })
    sendJson(response, 200, payload)
    return true
  }

  const profilePathMatch = pathname.match(PARENT_CHILD_PROFILE_PATH_RE)
  if (profilePathMatch && method === "GET") {
    const requestedEaglesId = normalizeText(decodeURIComponent(profilePathMatch[1]))
    const children = await listParentLinkedStudents({
      parentsId: parentContext.parentsId,
      parentAccountId: parentContext.parentAccountId,
    })
    const child = children.find((entry) => normalizeLower(entry?.eaglesId) === normalizeLower(requestedEaglesId))
    if (!child) {
      const error = new Error("Child is not linked to this parent account")
      error.statusCode = 403
      throw error
    }
    const lockedFields = await listParentProfileFieldLocks(child.studentRefId)
    sendJson(response, 200, {
      ok: true,
      child: {
        eaglesId: child.eaglesId,
        eaglesRefId: child.eaglesRefId,
        studentNumber: child.studentNumber,
        fullName: child.fullName,
        englishName: child.englishName,
        currentGrade: child.currentGrade,
      },
      immutableFields: Array.from(PARENT_PROFILE_IMMUTABLE_FIELDS),
      lockedFields,
      profile: child.profile || {},
    })
    return true
  }

  const draftPathMatch = pathname.match(PARENT_CHILD_PROFILE_DRAFT_PATH_RE)
  if (draftPathMatch && method === "PUT") {
    const requestedEaglesId = normalizeText(decodeURIComponent(draftPathMatch[1]))
    const payload = await parseBody(request)
    const children = await listParentLinkedStudents({
      parentsId: parentContext.parentsId,
      parentAccountId: parentContext.parentAccountId,
    })
    const child = children.find((entry) => normalizeLower(entry?.eaglesId) === normalizeLower(requestedEaglesId))
    if (!child) {
      const error = new Error("Child is not linked to this parent account")
      error.statusCode = 403
      throw error
    }
    const patch = normalizeParentProfilePatch(payload?.patch || {})
    if (!Object.keys(patch).length) {
      const error = new Error("No editable changes detected in patch payload")
      error.statusCode = 400
      throw error
    }
    const lockedFields = await listParentProfileFieldLocks(child.studentRefId)
    const blockedFields = Object.keys(patch).filter((fieldKey) => lockedFields.includes(fieldKey))
    if (blockedFields.length) {
      const error = new Error(`Locked fields cannot be changed: ${blockedFields.join(", ")}`)
      error.statusCode = 403
      throw error
    }

    const diffPayload = buildProfileDiffSnapshot(child.profile || {}, patch)
    const draft = await saveParentProfileDraftSubmission({
      parentAccountId: parentContext.parentAccountId || `parents:${parentContext.parentsId}`,
      studentRefId: child.studentRefId,
      draftPayloadJson: patch,
      diffPayloadJson: diffPayload,
      comment: normalizeText(payload?.comment),
    })
    sendJson(response, 200, {
      ok: true,
      submissionId: draft.id,
      status: PARENT_PROFILE_QUEUE_STATUS_DRAFT,
      diff: diffPayload,
    })
    return true
  }

  const submitPathMatch = pathname.match(PARENT_CHILD_PROFILE_SUBMIT_PATH_RE)
  if (submitPathMatch && method === "POST") {
    const requestedEaglesId = normalizeText(decodeURIComponent(submitPathMatch[1]))
    const payload = await parseBody(request)
    const children = await listParentLinkedStudents({
      parentsId: parentContext.parentsId,
      parentAccountId: parentContext.parentAccountId,
    })
    const child = children.find((entry) => normalizeLower(entry?.eaglesId) === normalizeLower(requestedEaglesId))
    if (!child) {
      const error = new Error("Child is not linked to this parent account")
      error.statusCode = 403
      throw error
    }
    const submitted = await setParentProfileSubmissionSubmitted({
      parentAccountId: parentContext.parentAccountId || `parents:${parentContext.parentsId}`,
      studentRefId: child.studentRefId,
      comment: normalizeText(payload?.comment),
    })
    if (!submitted) {
      const error = new Error("No saved draft found to submit")
      error.statusCode = 400
      throw error
    }
    sendJson(response, 200, {
      ok: true,
      submissionId: submitted.id,
      status: PARENT_PROFILE_QUEUE_STATUS_SUBMITTED,
      notifications: {
        email: "received",
      },
    })
    return true
  }

  return false
}

async function handleStudentApiRequest(request, response, pathname, url) {
  const { method } = request
  const loginPath = `${STUDENT_AUTH_PREFIX}/login`
  const logoutPath = `${STUDENT_AUTH_PREFIX}/logout`
  const mePath = `${STUDENT_AUTH_PREFIX}/me`

  if (method === "POST" && pathname === loginPath) {
    const payload = await parseBody(request)
    const eaglesId = normalizeText(payload?.eaglesId || payload?.username)
    const password = normalizeText(payload?.password)
    const principal = await verifyStudentPortalCredentials(eaglesId, password)
    if (!principal) {
      const error = new Error("Invalid eaglesId or password")
      error.statusCode = 401
      throw error
    }

    const session = await STUDENT_SESSION_STORE.createSession({
      username: principal.eaglesId,
      role: "student",
      eaglesId: principal.eaglesId,
      studentRefId: principal.studentRefId,
      accountId: principal.accountId,
    })
    if (!session?.id) {
      const error = new Error("Unable to establish student session")
      error.statusCode = 500
      throw error
    }
    response.setHeader("Set-Cookie", makeStudentSessionCookieValue(session.id, STUDENT_SESSION_TTL_SECONDS))
    sendJson(response, 200, {
      authenticated: true,
      user: {
        eaglesId: principal.eaglesId,
        role: "student",
      },
    })
    return true
  }

  if (method === "POST" && pathname === logoutPath) {
    const sessionId = readStudentSessionIdFromRequest(request)
    if (sessionId) await STUDENT_SESSION_STORE.deleteSession(sessionId)
    clearStudentSessionCookie(response)
    sendJson(response, 200, { ok: true, authenticated: false })
    return true
  }

  if (method === "GET" && pathname === mePath) {
    const session = await requireAuthenticatedStudentSession(request, response)
    sendJson(response, 200, {
      authenticated: true,
      user: {
        eaglesId: normalizeText(session?.eaglesId || session?.username),
        role: "student",
      },
    })
    return true
  }

  const session = await requireAuthenticatedStudentSession(request, response)
  const studentRefId = await resolveStudentPortalSessionStudentRefId(session)
  if (!studentRefId) {
    const error = new Error("Student portal account is not linked to a student record")
    error.statusCode = 403
    throw error
  }

  if (method === "GET" && pathname === STUDENT_DASHBOARD_PATH) {
    const data = await buildStudentDashboardPayload({
      studentRefId,
      eaglesId: normalizeText(session?.eaglesId || session?.username),
    })
    sendJson(response, 200, data)
    return true
  }

  if (method === "GET" && pathname === STUDENT_NEWS_CALENDAR_PATH) {
    const data = await listStudentNewsCalendar(studentRefId, {
      days: url.searchParams.get("days") || "30",
    })
    sendJson(response, 200, data)
    return true
  }

  if (method === "GET" && pathname === STUDENT_NEWS_REPORTS_PATH) {
    const data = await listStudentNewsCalendar(studentRefId, {
      days: url.searchParams.get("days") || "30",
    })
    sendJson(response, 200, data)
    return true
  }

  if (method === "POST" && pathname === STUDENT_NEWS_REPORTS_PATH) {
    const payload = await parseBody(request)
    const result = await saveStudentNewsReport(studentRefId, payload)
    sendJson(response, 200, result)
    return true
  }

  return false
}

export async function handleStudentAdminRequest(request, response) {
  const method = normalizeText(request.method).toUpperCase()
  const host = normalizeText(request.headers.host) || "localhost"
  const url = new URL(request.url || "/", `http://${host}`)
  const pathname = url.pathname

  const previewMatch = pathname.match(ASSIGNMENT_ANNOUNCEMENT_PREVIEW_PATH_RE)
  if (method === "GET" && previewMatch) {
    const preview = readAssignmentAnnouncementPreview(previewMatch[1])
    if (!preview) {
      sendAssignmentAnnouncementPreviewExpired(response)
      return true
    }
    sendAssignmentAnnouncementPreview(response, preview)
    return true
  }

  const pageSlug = resolveAdminPageSlug(pathname)
  if (method === "GET" && pageSlug) {
    const html = injectAdminRuntimeConfig(fs.readFileSync(ADMIN_HTML_PATH, "utf8"), pageSlug)
    sendHtml(response, 200, html)
    return true
  }

  if (method === "GET" && pathname === ADMIN_POINTS_PAGE_PATH) {
    if (!fs.existsSync(ADMIN_POINTS_HTML_PATH)) {
      sendJson(response, 404, { error: "Student points page not found" })
      return true
    }
    const html = injectAdminPointsRuntimeConfig(fs.readFileSync(ADMIN_POINTS_HTML_PATH, "utf8"))
    sendHtml(response, 200, html)
    return true
  }

  if (method === "GET" && pathname === PARENT_PORTAL_PAGE_PATH) {
    if (!fs.existsSync(PARENT_PORTAL_HTML_PATH)) {
      sendJson(response, 404, { error: "Parent portal page not found" })
      return true
    }
    const html = injectParentRuntimeConfig(fs.readFileSync(PARENT_PORTAL_HTML_PATH, "utf8"))
    sendHtml(response, 200, html)
    return true
  }

  if (method === "GET" && pathname === STUDENT_PORTAL_PAGE_PATH) {
    if (!fs.existsSync(STUDENT_PORTAL_HTML_PATH)) {
      sendJson(response, 404, { error: "Student portal page not found" })
      return true
    }
    const html = injectStudentPortalRuntimeConfig(fs.readFileSync(STUDENT_PORTAL_HTML_PATH, "utf8"))
    sendHtml(response, 200, html)
    return true
  }

  if (isPathWithinPrefix(pathname, PARENT_API_PREFIX)) {
    allowCors(request, response)

    if (method === "OPTIONS") {
      response.writeHead(204)
      response.end()
      return true
    }

    try {
      const handled = await handleParentApiRequest(request, response, pathname, url)
      if (!handled) sendJson(response, 404, { error: "Parent endpoint not found" })
      return true
    } catch (error) {
      withError(response, request, error)
      return true
    }
  }

  if (isPathWithinPrefix(pathname, STUDENT_API_PREFIX)) {
    allowCors(request, response)

    if (method === "OPTIONS") {
      response.writeHead(204)
      response.end()
      return true
    }

    try {
      const handled = await handleStudentApiRequest(request, response, pathname, url)
      if (!handled) sendJson(response, 404, { error: "Student endpoint not found" })
      return true
    } catch (error) {
      withError(response, request, error)
      return true
    }
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
