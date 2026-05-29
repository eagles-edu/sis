// @ts-check

import fs from "node:fs"
import path from "node:path"

const SIS_CONFIG_FILE_NAME = "SIS_CONFIG.json"
const LEGACY_UI_SETTINGS_FILE_NAME = "runtime-data/admin-ui-settings.json"
const SIS_CONFIG_MIRROR_ID = "sis-config"
const DEFAULT_WEEKLY_MINIMUM_REPORTS = 5
const DEFAULT_ADMIN_SESSION_TTL_SECONDS = 28800
const DEFAULT_PARENT_SESSION_TTL_SECONDS = 28800
const DEFAULT_STUDENT_SESSION_TTL_SECONDS = 86400
const DEFAULT_SESSION_REDIS_CONNECT_TIMEOUT_MS = 5000
const DEFAULT_SCHOOL_LOGO_IMAGE_PATH = "web-asset/images/logo.svg"
const DEFAULT_LEVEL_TILE_IMAGE_PATH_BY_LEVEL = new Map(
  [
    ["Eggs & Chicks", "web-asset/images/eggs-chicks.svg"],
    ["Pre-A1 Starters", "web-asset/images/starters.svg"],
    ["A1 Movers", "web-asset/images/movers.svg"],
    ["A2 Flyers", "web-asset/images/flyers.svg"],
    ["A2 KET", "web-asset/images/ket.svg"],
    ["B1 PET", "web-asset/images/pet.svg"],
  ].map(([level, imagePath]) => [normalizeLower(level), imagePath]),
)
const DEFAULT_LEVEL_THEME_BY_LEVEL = new Map(
  [
    ["Eggs & Chicks", { color: "#e0162b", className: "panelbg-eggs-chicks" }],
    ["Pre-A1 Starters", { color: "#FCAB15", className: "panelbg-starters" }],
    ["A1 Movers", { color: "#913198", className: "panelbg-mov" }],
    ["A2 Flyers", { color: "#b5d570", className: "panelbg-fly" }],
    ["A2 KET", { color: "#038e9f", className: "panelbg-key" }],
    ["B1 PET", { color: "#cd1637", className: "panelbg-pet" }],
    ["B2+ IELTS", { color: "#b10128", className: "panelbg-ielts" }],
    ["C1+ TAYK", { color: "#980001", className: "panelbg-tayk" }],
    ["Private", { color: "#002786", className: "panelbg-private" }],
  ].map(([level, theme]) => [normalizeLower(level), theme]),
)
const DEFAULT_LEVEL_TILE_LABEL_BY_LEVEL = new Map(
  [
    ["Eggs & Chicks", "Eggs & Chicks"],
    ["Pre-A1 Starters", "Pre-A1 Starters"],
    ["A1 Movers", "A1 Movers"],
    ["A2 Flyers", "A2 Flyers"],
    ["A2 KET", "A2 KET"],
    ["B1 PET", "B1 PET"],
  ].map(([level, label]) => [normalizeLower(level), label]),
)

const DEFAULT_SCHOOL_PROFILE = Object.freeze({
  schoolName: "",
  bilingualTextVi: "",
  bilingualTextEn: "",
  motto: "",
  mission: "",
  values: "",
  address: "",
  phone: "",
  publicSite: "",
  privateLessonSite: "",
  webPresence: "",
  socialIm: "",
  businessTaxId: "",
  timeFormat: "",
  timeZone: "",
  googleMapsEmbedIframe: "",
  logoDataUrl: "",
})

/**
 * @typedef {Record<string, any>} PlainObject
 * @typedef {{ quarter: string, startDate: string, endDate: string }} SchoolSetupQuarter
 * @typedef {{
 *   startDate: string,
 *   endDate: string,
 *   schoolYear: string,
 *   quarters: SchoolSetupQuarter[],
 *   letterGradeRanges: PlainObject[],
 *   schoolSetupState: string,
 * }} SchoolSetupConfig
 * @typedef {{
 *   multiSchool: boolean,
 *   schoolSetup: SchoolSetupConfig,
 *   schoolProfile: PlainObject,
 *   newsReportValidation: PlainObject,
 *   queueHub: PlainObject,
 *   levelTileStylesByLevel: PlainObject,
 * }} UiSettingsConfig
 * @typedef {{
 *   databaseUrl: string,
 *   redisUrl: string,
 *   sessionDriver: string,
 *   adminSessionTtlSeconds: number,
 *   parentSessionTtlSeconds: number,
 *   studentSessionTtlSeconds: number,
 *   redisConnectTimeoutMs: number,
 * }} RuntimeConfig
 * @typedef {{
 *   weeklyMinimumReports: number,
 * }} NewsReportsConfig
 * @typedef {{
 *   uiSettings: UiSettingsConfig,
 *   runtime: RuntimeConfig,
 *   newsReports: NewsReportsConfig,
 *   environment: string,
 *   updatedAt: string,
 *   updatedBy: string,
 * }} SisConfigPayload
 * @typedef {{
 *   schoolSetupStoredQuarterCount: number,
 *   schoolSetupStoredQuartersPresent: boolean,
 *   schoolSetupStoredQuartersMissing: boolean,
 *   schoolSetupState: string,
 *   schoolSetupHasIssues: boolean,
 * }} SnapshotMeta
 * @typedef {SisConfigPayload & {
 *   filePath: string,
 *   source: string,
 *   meta: SnapshotMeta,
 * }} LoadedSisConfigSnapshot
 * @typedef {LoadedSisConfigSnapshot & {
 *   fileMtimeIso: string,
 *   legacyMtimeIso: string,
 * }} CachedSisConfigSnapshot
 * @typedef {{
 *   exists: boolean,
 *   raw: string | null,
 *   parsed: unknown | null,
 *   mtimeIso: string,
 *   error: unknown,
 * }} JsonFileSnapshot
 */

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function normalizeRuntimeEnvironment(value, fallback = process.env.NODE_ENV || "production") {
  const normalized = normalizeLower(value || fallback)
  if (!normalized) return "production"
  if (normalized === "dev") return "development"
  if (normalized === "prod" || normalized === "live") return "production"
  return normalized
}

/**
 * @param {string} text
 * @param {number} index
 * @returns {{ line: number, column: number }}
 */
function indexToLineColumn(text, index) {
  const source = normalizeText(text)
  const targetIndex = Math.max(0, Math.min(Number.isFinite(index) ? index : 0, source.length))
  let line = 1
  let column = 1
  for (let i = 0; i < targetIndex; i += 1) {
    if (source[i] === "\n") {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return { line, column }
}

/**
 * @param {string} raw
 * @param {string} keyName
 * @returns {{ line: number, column: number } | null}
 */
function findJsonStringValueLocation(raw, keyName) {
  const source = normalizeText(raw)
  const needle = `"${normalizeText(keyName)}"`
  if (!source || !needle) return null

  const keyIndex = source.indexOf(needle)
  if (keyIndex < 0) return null

  let cursor = keyIndex + needle.length
  while (cursor < source.length && /\s/u.test(source[cursor])) cursor += 1
  if (source[cursor] !== ":") return null

  cursor += 1
  while (cursor < source.length && /\s/u.test(source[cursor])) cursor += 1
  if (source[cursor] !== '"') return null

  return indexToLineColumn(source, cursor)
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isExamplePlaceholderHostname(hostname) {
  const normalized = normalizeLower(hostname)
  if (!normalized) return false
  return (
    normalized === "example" ||
    normalized.startsWith("example.") ||
    normalized.includes(".example.")
  )
}

/**
 * @param {{
 *   filePath?: string,
 *   raw?: string | null,
 *   databaseUrl?: string,
 *   source?: string,
 * }} options
 * @returns {void}
 */
function assertValidRuntimeDatabaseUrl({
  filePath = "",
  raw = "",
  databaseUrl = "",
  source = "file",
} = {}) {
  const urlText = normalizeText(databaseUrl)
  if (!urlText) return

  let parsedUrl
  try {
    parsedUrl = new URL(urlText)
  } catch (error) {
    void error
    return
  }

  if (!isExamplePlaceholderHostname(parsedUrl.hostname)) return

  const location = findJsonStringValueLocation(raw, "databaseUrl")
  const locationSuffix = location
    ? ` at ${filePath}:${location.line}:${location.column}`
    : filePath
      ? ` in ${filePath}`
      : ""
  const error = new Error(
    `Invalid databaseUrl${locationSuffix}: example.* hosts are not allowed (found host ${parsedUrl.hostname})`
  )
  error.statusCode = 500
  error.filePath = filePath
  error.line = location?.line || 0
  error.column = location?.column || 0
  error.source = source
  throw error
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || 0), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function nowIso() {
  return new Date().toISOString()
}

function backupStamp() {
  return nowIso()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-")
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function canonicalizeComparisonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeComparisonValue(entry))
  }

  if (!isPlainObject(value)) return value

  const normalized = {}
  for (const key of Object.keys(value).sort()) {
    normalized[key] = canonicalizeComparisonValue(value[key])
  }
  return normalized
}

function resolveSisConfigFilePath() {
  const explicitPath = normalizeText(process.env.SIS_CONFIG_FILE)
  if (explicitPath) {
    return path.resolve(process.cwd(), explicitPath)
  }

  const nodeEnv = normalizeRuntimeEnvironment(process.env.NODE_ENV)
  if (nodeEnv === "development") {
    return path.resolve(process.cwd(), "config", "sis-config.development.json")
  }
  if (nodeEnv === "test") {
    return path.resolve(process.cwd(), "config", "sis-config.test.json")
  }

  return path.resolve(process.cwd(), SIS_CONFIG_FILE_NAME)
}

function shouldPreferSisConfigFileOverDatabase() {
  const nodeEnv = normalizeRuntimeEnvironment(process.env.NODE_ENV)
  return Boolean(normalizeText(process.env.SIS_CONFIG_FILE)) || nodeEnv === "development" || nodeEnv === "test"
}

function resolveLegacyUiSettingsFilePath() {
  return path.resolve(
    process.cwd(),
    normalizeText(process.env.STUDENT_ADMIN_UI_SETTINGS_FILE) || LEGACY_UI_SETTINGS_FILE_NAME,
  )
}

/**
 * @param {unknown} value
 * @returns {PlainObject}
 */
function toPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? /** @type {PlainObject} */ (value) : {}
}

/**
 * @param {unknown} value
 * @returns {SchoolSetupQuarter[]}
 */
function normalizeSchoolSetupQuarters(value) {
  const entries = Array.isArray(value) ? value : []
  return entries
    .map((entry) => {
      const quarter = normalizeLower(entry?.quarter)
      const startDate = normalizeText(entry?.startDate).slice(0, 10)
      const endDate = normalizeText(entry?.endDate).slice(0, 10)
      if (!quarter || !startDate || !endDate) return null
      return { quarter, startDate, endDate }
    })
    .filter((entry) => entry !== null)
}

function defaultLevelTileStyle(levelName = "") {
  const normalized = normalizeLower(levelName)
  const theme = DEFAULT_LEVEL_THEME_BY_LEVEL.get(normalized) || null
  return {
    title: DEFAULT_LEVEL_TILE_LABEL_BY_LEVEL.get(normalized) || normalizeText(levelName),
    bgColor: normalizeText(theme?.color),
    imageDataUrl: DEFAULT_LEVEL_TILE_IMAGE_PATH_BY_LEVEL.get(normalized) || DEFAULT_SCHOOL_LOGO_IMAGE_PATH,
  }
}

function normalizeLevelTileStylesByLevel(source = {}) {
  const candidate = toPlainObject(source)
  const normalized = {}
  const knownLevels = Array.from(DEFAULT_LEVEL_TILE_LABEL_BY_LEVEL.values())
  Object.entries(candidate).forEach(([levelName, entry]) => {
    const levelKey = normalizeText(levelName)
    if (!levelKey) return
    const sourceEntry = toPlainObject(entry)
    const defaultEntry = defaultLevelTileStyle(levelKey)
    normalized[levelKey] = {
      ...sourceEntry,
      title: normalizeText(sourceEntry.title) || defaultEntry.title,
      bgColor: normalizeText(sourceEntry.bgColor) || defaultEntry.bgColor,
      imageDataUrl:
        normalizeText(sourceEntry.imageDataUrl || sourceEntry.imagePath || sourceEntry.imageUrl) ||
        defaultEntry.imageDataUrl,
    }
  })
  knownLevels.forEach((levelName) => {
    if (Object.prototype.hasOwnProperty.call(normalized, levelName)) return
    normalized[levelName] = defaultLevelTileStyle(levelName)
  })
  return normalized
}

function normalizeUiSettings(source = {}) {
  const candidate = toPlainObject(source)
  const schoolSetup = toPlainObject(candidate.schoolSetup)
  const levelTileStylesByLevel = normalizeLevelTileStylesByLevel(
    candidate.levelTileStylesByLevel ||
      candidate.levelTileStyleByLevel ||
      candidate.levelTileStyles ||
      {},
  )
  return {
    multiSchool: Boolean(candidate.multiSchool),
    schoolSetup: {
      startDate: normalizeText(schoolSetup.startDate).slice(0, 10),
      endDate: normalizeText(schoolSetup.endDate).slice(0, 10),
      schoolYear: normalizeText(schoolSetup.schoolYear),
      quarters: normalizeSchoolSetupQuarters(schoolSetup.quarters),
      letterGradeRanges: Array.isArray(schoolSetup.letterGradeRanges) ?
        schoolSetup.letterGradeRanges.map((entry) => ({ ...toPlainObject(entry) })) :
        [],
      schoolSetupState: normalizeText(schoolSetup.schoolSetupState) || "missing",
    },
    schoolProfile: (() => {
      const normalized = {
        ...DEFAULT_SCHOOL_PROFILE,
        ...toPlainObject(candidate.schoolProfile),
      }
      return {
        ...normalized,
        logoDataUrl:
          normalizeText(normalized.logoDataUrl) &&
          normalizeText(normalized.logoDataUrl) !== "data:image/png;base64,aaaa"
            ? normalizeText(normalized.logoDataUrl)
            : DEFAULT_SCHOOL_LOGO_IMAGE_PATH,
      }
    })(),
    newsReportValidation: toPlainObject(candidate.newsReportValidation),
    queueHub: toPlainObject(candidate.queueHub),
    levelTileStylesByLevel,
  }
}

function normalizeRuntimeConfig(source = {}) {
  const candidate = toPlainObject(source)
  return {
    databaseUrl: normalizeText(candidate.databaseUrl || process.env.DATABASE_URL),
    redisUrl: normalizeText(candidate.redisUrl || process.env.REDIS_SESSION_URL || process.env.REDIS_URL),
    sessionDriver: normalizeText(candidate.sessionDriver || process.env.STUDENT_ADMIN_SESSION_DRIVER) || "auto",
    adminSessionTtlSeconds: toPositiveInt(
      candidate.adminSessionTtlSeconds ?? process.env.STUDENT_ADMIN_SESSION_TTL_SECONDS,
      DEFAULT_ADMIN_SESSION_TTL_SECONDS,
    ),
    parentSessionTtlSeconds: toPositiveInt(
      candidate.parentSessionTtlSeconds ?? process.env.STUDENT_PARENT_SESSION_TTL_SECONDS,
      DEFAULT_PARENT_SESSION_TTL_SECONDS,
    ),
    studentSessionTtlSeconds: toPositiveInt(
      candidate.studentSessionTtlSeconds ?? process.env.STUDENT_STUDENT_SESSION_TTL_SECONDS,
      DEFAULT_STUDENT_SESSION_TTL_SECONDS,
    ),
    redisConnectTimeoutMs: toPositiveInt(
      candidate.redisConnectTimeoutMs ?? process.env.STUDENT_ADMIN_SESSION_REDIS_CONNECT_TIMEOUT_MS,
      DEFAULT_SESSION_REDIS_CONNECT_TIMEOUT_MS,
    ),
  }
}

function normalizeNewsReportsConfig(source = {}) {
  const candidate = toPlainObject(source)
  return {
    weeklyMinimumReports: toPositiveInt(
      candidate.weeklyMinimumReports ?? candidate.weeklyMinimum ?? process.env.STUDENT_NEWS_WEEKLY_MINIMUM_REPORTS,
      DEFAULT_WEEKLY_MINIMUM_REPORTS,
    ),
  }
}

function normalizeSisConfigPayload(source = {}) {
  const candidate = toPlainObject(source)
  const legacyWrappedUiSettings =
    candidate.uiSettings && typeof candidate.uiSettings === "object" && !Array.isArray(candidate.uiSettings)
  const rawUiSettings = legacyWrappedUiSettings ? candidate.uiSettings : candidate.uiSettings || candidate
  return {
    uiSettings: normalizeUiSettings(rawUiSettings),
    runtime: normalizeRuntimeConfig(candidate.runtime || candidate.db || candidate.database || candidate),
    newsReports: normalizeNewsReportsConfig(candidate.newsReports || candidate.newsReportPolicy || candidate),
    environment: normalizeRuntimeEnvironment(candidate.environment),
    updatedAt: normalizeText(candidate.updatedAt),
    updatedBy: normalizeText(candidate.updatedBy),
  }
}

/**
 * @param {Partial<SisConfigPayload> | Partial<LoadedSisConfigSnapshot> | PlainObject} snapshot
 * @returns {string}
 */
function snapshotComparisonKey(snapshot = {}) {
  const source = toPlainObject(snapshot)
  return JSON.stringify({
    uiSettings: canonicalizeComparisonValue(normalizeUiSettings(source.uiSettings || {})),
    runtime: canonicalizeComparisonValue(normalizeRuntimeConfig(source.runtime || {})),
    newsReports: canonicalizeComparisonValue(normalizeNewsReportsConfig(source.newsReports || {})),
    environment: normalizeRuntimeEnvironment(source.environment),
    updatedAt: normalizeText(source.updatedAt),
    updatedBy: normalizeText(source.updatedBy),
  })
}

/**
 * @param {Partial<SisConfigPayload> | Partial<LoadedSisConfigSnapshot> | PlainObject} snapshot
 * @returns {string}
 */
function mirrorHealthComparisonKey(snapshot = {}) {
  const source = toPlainObject(snapshot)
  return JSON.stringify({
    uiSettings: canonicalizeComparisonValue(normalizeUiSettings(source.uiSettings || {})),
    runtime: canonicalizeComparisonValue(normalizeRuntimeConfig(source.runtime || {})),
    newsReports: canonicalizeComparisonValue(normalizeNewsReportsConfig(source.newsReports || {})),
    environment: normalizeRuntimeEnvironment(source.environment),
  })
}

/**
 * @param {Partial<SisConfigPayload> | Partial<LoadedSisConfigSnapshot> | PlainObject} snapshot
 * @returns {string}
 */
function rawSnapshotComparisonKey(snapshot = {}) {
  const source = toPlainObject(snapshot)
  return JSON.stringify({
    uiSettings: canonicalizeComparisonValue(toPlainObject(source.uiSettings || {})),
    runtime: canonicalizeComparisonValue(toPlainObject(source.runtime || {})),
    newsReports: canonicalizeComparisonValue(toPlainObject(source.newsReports || {})),
    environment: normalizeText(source.environment),
    updatedAt: normalizeText(source.updatedAt),
    updatedBy: normalizeText(source.updatedBy),
  })
}

/**
 * @param {Partial<SisConfigPayload> | Partial<LoadedSisConfigSnapshot> | PlainObject} snapshot
 * @returns {string}
 */
function rawLegacyEnvelopeComparisonKey(snapshot = {}) {
  const source = toPlainObject(snapshot)
  return JSON.stringify({
    uiSettings: canonicalizeComparisonValue(toPlainObject(source.uiSettings || source)),
    updatedAt: normalizeText(source.updatedAt),
    updatedBy: normalizeText(source.updatedBy) || null,
  })
}

/**
 * @param {Partial<UiSettingsConfig> | PlainObject} uiSettings
 * @returns {SnapshotMeta}
 */
function snapshotMetaFromUiSettings(uiSettings = {}) {
  const schoolSetup = toPlainObject(uiSettings.schoolSetup)
  const quarters = Array.isArray(schoolSetup.quarters) ? schoolSetup.quarters : []
  return {
    schoolSetupStoredQuarterCount: quarters.length,
    schoolSetupStoredQuartersPresent: quarters.length > 0,
    schoolSetupStoredQuartersMissing: quarters.length < 4,
    schoolSetupState: normalizeText(schoolSetup.schoolSetupState) || "missing",
    schoolSetupHasIssues: normalizeText(schoolSetup.schoolSetupState) !== "ok",
  }
}

/**
 * @param {string} filePath
 * @returns {JsonFileSnapshot}
 */
function parseJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { exists: false, raw: null, parsed: null, mtimeIso: "", error: null }
    }
    const stat = fs.statSync(filePath)
    const raw = fs.readFileSync(filePath, "utf8")
    const mtimeIso = new Date(stat.mtimeMs).toISOString()
    if (!normalizeText(raw)) {
      return { exists: true, raw: "", parsed: null, mtimeIso, error: null }
    }
    try {
      return {
        exists: true,
        raw,
        parsed: JSON.parse(raw),
        mtimeIso,
        error: null,
      }
    } catch (error) {
      return {
        exists: true,
        raw,
        parsed: null,
        mtimeIso,
        error,
      }
    }
  } catch (error) {
    return {
      exists: fs.existsSync(filePath),
      raw: null,
      parsed: null,
      mtimeIso: "",
      error,
    }
  }
}

/**
 * @param {string} filePath
 * @param {JsonFileSnapshot} snapshot
 * @returns {string}
 */
function backupCorruptJsonFileIfNeeded(filePath, snapshot) {
  if (!snapshot?.exists) return ""
  if (isPlainObject(snapshot.parsed) && !snapshot.error) return ""
  const backupPath = `${filePath}.BAK-${backupStamp()}-${process.pid}`
  fs.copyFileSync(filePath, backupPath)
  return backupPath
}

function writeJsonFileAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const encoded = JSON.stringify(value, null, 2)
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmpPath, encoded, "utf8")
  fs.renameSync(tmpPath, filePath)
}

function compareIsoValues(left = "", right = "") {
  const a = normalizeText(left)
  const b = normalizeText(right)
  if (a && b) return a.localeCompare(b)
  if (a) return 1
  if (b) return -1
  return 0
}

/**
 * @param {unknown} source
 * @param {string} filePath
 * @param {string} sourceKind
 * @returns {LoadedSisConfigSnapshot}
 */
function normalizeLoadedSnapshot(source = {}, filePath = "", sourceKind = "file") {
  const payload = normalizeSisConfigPayload(source)
  return {
    ...payload,
    filePath,
    source: sourceKind,
    meta: snapshotMetaFromUiSettings(payload.uiSettings),
  }
}

/**
 * @param {unknown} snapshot
 */
function legacyUiSettingsEnvelopeFromSnapshot(snapshot = {}) {
  const source = toPlainObject(snapshot)
  return {
    uiSettings: normalizeUiSettings(source.uiSettings || {}),
    updatedAt: normalizeText(source.updatedAt) || nowIso(),
    updatedBy: normalizeText(source.updatedBy) || null,
  }
}

/** @returns {LoadedSisConfigSnapshot} */
function buildDefaultSnapshot() {
  return normalizeLoadedSnapshot({
    uiSettings: {},
    runtime: {},
    newsReports: {},
    environment: normalizeRuntimeEnvironment(process.env.NODE_ENV),
    updatedAt: "",
    updatedBy: "",
  }, resolveSisConfigFilePath(), "default")
}

/** @type {CachedSisConfigSnapshot | null} */
let cachedSnapshot = null

/**
 * @param {CachedSisConfigSnapshot | null | undefined} cached
 * @returns {cached is CachedSisConfigSnapshot}
 */
function cachedSnapshotMatchesFiles(cached = null) {
  if (!cached || typeof cached !== "object") return false
  const filePath = resolveSisConfigFilePath()
  const legacyPath = resolveLegacyUiSettingsFilePath()
  const fileSnapshot = parseJsonFile(filePath)
  const legacySnapshot = parseJsonFile(legacyPath)
  return (
    normalizeText(cached.filePath) === filePath &&
    normalizeText(cached.fileMtimeIso) === normalizeText(fileSnapshot.mtimeIso) &&
    normalizeText(cached.legacyMtimeIso) === normalizeText(legacySnapshot.mtimeIso)
  )
}

/** @returns {Promise<LoadedSisConfigSnapshot | null>} */
async function readMirrorFromDatabase() {
  try {
    const { getSharedPrismaClient } = await import("../../infra/db/prisma-client.mjs")
    const prisma = await getSharedPrismaClient()
    const row = await prisma.sisConfigMirror.findUnique({
      where: { id: SIS_CONFIG_MIRROR_ID },
    })
    if (!row) return null
    const payload = row.payloadJson && typeof row.payloadJson === "object" ? row.payloadJson : {}
    return normalizeLoadedSnapshot({
      ...payload,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : normalizeText(row.updatedAt),
      updatedBy: normalizeText(row.updatedBy),
    }, resolveSisConfigFilePath(), "database")
  } catch (error) {
    void error
    return null
  }
}

/**
 * @returns {Promise<{
 *   file: {
 *     present: boolean,
 *     source: string,
 *     updatedAt: string,
 *     error: string,
 *   },
 *   db: {
 *     present: boolean,
 *     source: string,
 *     updatedAt: string,
 *     error: string,
 *   },
 *   synced: boolean,
 *   state: string,
 *   detail: string,
 * }>}
 */
export async function getSisConfigMirrorHealthSnapshot() {
  const filePath = resolveSisConfigFilePath()
  const fileSnapshot = parseJsonFile(filePath)
  const fileLoaded = fileSnapshot.parsed ? normalizeLoadedSnapshot(fileSnapshot.parsed, filePath, "file") : null
  const dbSnapshot = await readMirrorFromDatabase()

  const filePresent = Boolean(fileLoaded)
  const dbPresent = Boolean(dbSnapshot)
  const fileVsDbSynced =
    filePresent && dbPresent &&
    mirrorHealthComparisonKey(fileLoaded) === mirrorHealthComparisonKey(dbSnapshot)

  const state =
    filePresent && dbPresent ?
      (fileVsDbSynced ? "ok" : "error")
    : filePresent || dbPresent ?
      "warn"
    : "error"

  const fileLabel = filePresent ? "present" : fileSnapshot.error ? "missing" : "missing"
  const dbLabel = dbPresent ? "present" : "missing"
  const detail = `json=${fileLabel} | db=${dbLabel} | sync=${filePresent && dbPresent ? (fileVsDbSynced ? "in-sync" : "out-of-sync") : "out-of-sync"}`

  return {
    file: {
      present: filePresent,
      source: fileLoaded?.source || "missing",
      updatedAt: normalizeText(fileLoaded?.updatedAt),
      error: normalizeText(fileSnapshot.error?.message || fileSnapshot.error),
    },
    db: {
      present: dbPresent,
      source: dbSnapshot?.source || "missing",
      updatedAt: normalizeText(dbSnapshot?.updatedAt),
      error: "",
    },
    synced: fileVsDbSynced,
    state,
    detail,
  }
}

/**
 * @param {Partial<LoadedSisConfigSnapshot> | Partial<SisConfigPayload>} snapshot
 * @returns {Promise<void>}
 */
async function upsertMirrorToDatabase(snapshot = {}) {
  const source = toPlainObject(snapshot)
  try {
    const { getSharedPrismaClient } = await import("../../infra/db/prisma-client.mjs")
    const prisma = await getSharedPrismaClient()
    const payload = {
      uiSettings: normalizeUiSettings(source.uiSettings || {}),
      runtime: normalizeRuntimeConfig(source.runtime || {}),
      newsReports: normalizeNewsReportsConfig(source.newsReports || {}),
      environment: normalizeRuntimeEnvironment(source.environment),
      updatedAt: normalizeText(source.updatedAt) || nowIso(),
      updatedBy: normalizeText(source.updatedBy) || null,
    }
    assertValidRuntimeDatabaseUrl({
      filePath: resolveSisConfigFilePath(),
      databaseUrl: payload.runtime.databaseUrl || "",
      source: source.source || "database",
    })
    await prisma.sisConfigMirror.upsert({
      where: { id: SIS_CONFIG_MIRROR_ID },
      create: {
        id: SIS_CONFIG_MIRROR_ID,
        payloadJson: payload,
        updatedBy: payload.updatedBy,
      },
      update: {
        payloadJson: payload,
        updatedBy: payload.updatedBy,
      },
    })
    await prisma.$executeRaw`
      UPDATE "SisConfigMirror"
      SET "updatedAt" = ${new Date(payload.updatedAt)}
      WHERE "id" = ${SIS_CONFIG_MIRROR_ID}
    `
  } catch (error) {
    void error
  }
}

/**
 * @param {Partial<LoadedSisConfigSnapshot> | Partial<SisConfigPayload>} snapshot
 * @returns {Promise<CachedSisConfigSnapshot>}
 */
async function writeSnapshotFiles(snapshot = {}) {
  const source = toPlainObject(snapshot)
  const normalized = normalizeLoadedSnapshot(source, resolveSisConfigFilePath(), source.source || "file")
  assertValidRuntimeDatabaseUrl({
    filePath: resolveSisConfigFilePath(),
    databaseUrl: normalized.runtime.databaseUrl || "",
    source: source.source || "file",
  })
  const currentFileState = parseJsonFile(resolveSisConfigFilePath())
  const currentLegacyState = parseJsonFile(resolveLegacyUiSettingsFilePath())
  backupCorruptJsonFileIfNeeded(resolveSisConfigFilePath(), currentFileState)
  backupCorruptJsonFileIfNeeded(resolveLegacyUiSettingsFilePath(), currentLegacyState)
  writeJsonFileAtomic(resolveSisConfigFilePath(), {
    uiSettings: normalized.uiSettings,
    runtime: normalized.runtime,
    newsReports: normalized.newsReports,
    environment: normalized.environment,
    updatedAt: normalized.updatedAt || nowIso(),
    updatedBy: normalized.updatedBy || null,
  })
  writeJsonFileAtomic(resolveLegacyUiSettingsFilePath(), legacyUiSettingsEnvelopeFromSnapshot(normalized))
  await upsertMirrorToDatabase(normalized)
  const fileState = parseJsonFile(resolveSisConfigFilePath())
  const legacyState = parseJsonFile(resolveLegacyUiSettingsFilePath())
  cachedSnapshot = {
    ...normalized,
    source: "file",
    fileMtimeIso: fileState.mtimeIso,
    legacyMtimeIso: legacyState.mtimeIso,
  }
  return cachedSnapshot
}

/**
 * Loads the SIS config from disk, repairs it from the DB mirror when needed,
 * and keeps the DB mirror aligned with the newest valid snapshot.
 *
 * @param {{ refresh?: boolean }} [options]
 * @returns {Promise<CachedSisConfigSnapshot>}
 */
export async function ensureSisConfigLoaded(options = {}) {
  if (!options.refresh && cachedSnapshot && cachedSnapshotMatchesFiles(cachedSnapshot)) {
    return cachedSnapshot
  }

  const filePath = resolveSisConfigFilePath()
  const legacyPath = resolveLegacyUiSettingsFilePath()
  const fileSnapshot = parseJsonFile(filePath)
  const legacySnapshot = parseJsonFile(legacyPath)
  const dbSnapshot = await readMirrorFromDatabase()
  const legacyParsed = toPlainObject(legacySnapshot.parsed)
  const fileParsed = toPlainObject(fileSnapshot.parsed)
  const dbParsed = toPlainObject(dbSnapshot)
  const preferSisConfigFile = shouldPreferSisConfigFileOverDatabase()

  assertValidRuntimeDatabaseUrl({
    filePath,
    raw: fileSnapshot.raw,
    databaseUrl: toPlainObject(fileParsed.runtime).databaseUrl || "",
    source: "file",
  })
  if (legacySnapshot.parsed) {
    assertValidRuntimeDatabaseUrl({
      filePath: legacyPath,
      raw: legacySnapshot.raw,
      databaseUrl: toPlainObject(legacyParsed.runtime).databaseUrl || "",
      source: "legacy",
    })
  }
  if (!preferSisConfigFile && dbSnapshot) {
    assertValidRuntimeDatabaseUrl({
      filePath,
      databaseUrl: toPlainObject(dbParsed.runtime).databaseUrl || "",
      source: "database",
    })
  }

  const fileLoaded = fileSnapshot.parsed ? normalizeLoadedSnapshot(fileSnapshot.parsed, filePath, "file") : null
  const legacyLoaded = legacySnapshot.parsed ?
    normalizeLoadedSnapshot({
      uiSettings: legacyParsed.uiSettings || legacySnapshot.parsed,
      updatedAt: legacyParsed.updatedAt || legacySnapshot.mtimeIso,
      updatedBy: legacyParsed.updatedBy || "",
    }, legacyPath, "legacy") :
    null

  let latest = null
  if (preferSisConfigFile) {
    latest = fileLoaded || legacyLoaded || buildDefaultSnapshot()
  } else {
    const candidates = [fileLoaded, dbSnapshot].filter(Boolean)
    latest = candidates[0] || null
    for (const candidate of candidates.slice(1)) {
      if (!latest) {
        latest = candidate
        continue
      }
      if (compareIsoValues(candidate.updatedAt, latest.updatedAt) > 0) {
        latest = candidate
        continue
      }
      if (!normalizeText(latest.updatedAt) && normalizeText(candidate.updatedAt)) {
        latest = candidate
      }
    }
    if (!latest) {
      latest = legacyLoaded || buildDefaultSnapshot()
    }
  }

  const snapshot = normalizeLoadedSnapshot({
    uiSettings: latest.uiSettings || {},
    runtime: latest.runtime || {},
    newsReports: latest.newsReports || {},
    environment: latest.environment || normalizeRuntimeEnvironment(process.env.NODE_ENV),
    updatedAt: latest.updatedAt || nowIso(),
    updatedBy: latest.updatedBy || "",
  }, filePath, latest.source || "file")

  const latestSourceIsDatabase = latest.source === "database"
  const fileMatchesSnapshot = !fileSnapshot.parsed || rawSnapshotComparisonKey(fileSnapshot.parsed) === snapshotComparisonKey(snapshot)
  const legacyMatchesSnapshot = !legacySnapshot.parsed || rawLegacyEnvelopeComparisonKey(legacySnapshot.parsed) === rawLegacyEnvelopeComparisonKey(legacyUiSettingsEnvelopeFromSnapshot(snapshot))
  const dbMatchesSnapshot = !dbSnapshot || rawSnapshotComparisonKey({
    uiSettings: dbSnapshot.uiSettings,
    runtime: dbSnapshot.runtime,
    newsReports: dbSnapshot.newsReports,
    updatedAt: dbSnapshot.updatedAt,
    updatedBy: dbSnapshot.updatedBy,
  }) === snapshotComparisonKey(snapshot)
  const fileNeedsWrite =
    !fileSnapshot.exists ||
    fileSnapshot.error ||
    (!preferSisConfigFile && latestSourceIsDatabase) ||
    !fileMatchesSnapshot ||
    (fileLoaded && compareIsoValues(snapshot.updatedAt, fileLoaded.updatedAt) > 0)
  const legacyNeedsWrite =
    !legacySnapshot.exists ||
    legacySnapshot.error ||
    (!preferSisConfigFile && latestSourceIsDatabase) ||
    latest.source === "file" ||
    !legacyMatchesSnapshot ||
    (legacyLoaded && compareIsoValues(snapshot.updatedAt, legacyLoaded.updatedAt) > 0)

  backupCorruptJsonFileIfNeeded(filePath, fileSnapshot)
  backupCorruptJsonFileIfNeeded(legacyPath, legacySnapshot)

  if (fileNeedsWrite) {
    writeJsonFileAtomic(filePath, {
      uiSettings: snapshot.uiSettings,
      runtime: snapshot.runtime,
      newsReports: snapshot.newsReports,
      environment: snapshot.environment,
      updatedAt: snapshot.updatedAt,
      updatedBy: snapshot.updatedBy || null,
    })
  }

  if (legacyNeedsWrite) {
    writeJsonFileAtomic(legacyPath, legacyUiSettingsEnvelopeFromSnapshot(snapshot))
  }

  const mirrorNeedsWrite =
    !dbSnapshot ||
    (!preferSisConfigFile && latestSourceIsDatabase) ||
    latest.source === "file" ||
    (preferSisConfigFile && latest.source === "legacy") ||
    fileNeedsWrite ||
    legacyNeedsWrite ||
    !dbMatchesSnapshot ||
    compareIsoValues(snapshot.updatedAt, dbSnapshot.updatedAt) !== 0
  if (mirrorNeedsWrite) {
    await upsertMirrorToDatabase(snapshot)
  }

  cachedSnapshot = {
    ...snapshot,
    source: latest.source || "file",
    filePath,
    fileMtimeIso: parseJsonFile(filePath).mtimeIso,
    legacyMtimeIso: parseJsonFile(legacyPath).mtimeIso,
    meta: snapshotMetaFromUiSettings(snapshot.uiSettings),
  }
  return cachedSnapshot
}

export function getSisConfigSnapshotSync() {
  const fileSnapshot = parseJsonFile(resolveSisConfigFilePath())
  const legacySnapshot = parseJsonFile(resolveLegacyUiSettingsFilePath())
  const legacyParsed = toPlainObject(legacySnapshot.parsed)
  const fileParsed = toPlainObject(fileSnapshot.parsed)

  if (fileSnapshot.parsed) {
    assertValidRuntimeDatabaseUrl({
      filePath: resolveSisConfigFilePath(),
      raw: fileSnapshot.raw,
      databaseUrl: toPlainObject(fileParsed.runtime).databaseUrl || "",
      source: "file",
    })
  }
  if (legacySnapshot.parsed) {
    assertValidRuntimeDatabaseUrl({
      filePath: resolveLegacyUiSettingsFilePath(),
      raw: legacySnapshot.raw,
      databaseUrl: toPlainObject(legacyParsed.runtime).databaseUrl || "",
      source: "legacy",
    })
  }
  if (
    cachedSnapshot
    && normalizeText(cachedSnapshot.filePath) === resolveSisConfigFilePath()
    && normalizeText(cachedSnapshot.fileMtimeIso) === normalizeText(fileSnapshot.mtimeIso)
    && normalizeText(cachedSnapshot.legacyMtimeIso) === normalizeText(legacySnapshot.mtimeIso)
  ) {
    return cachedSnapshot
  }
  if (fileSnapshot.parsed) {
    cachedSnapshot = {
      ...normalizeLoadedSnapshot(fileSnapshot.parsed, resolveSisConfigFilePath(), "file"),
      fileMtimeIso: fileSnapshot.mtimeIso,
      legacyMtimeIso: legacySnapshot.mtimeIso,
    }
    return cachedSnapshot
  }
  if (legacySnapshot.parsed) {
    cachedSnapshot = {
      ...normalizeLoadedSnapshot({
        uiSettings: legacyParsed.uiSettings || legacySnapshot.parsed,
        updatedAt: legacyParsed.updatedAt || legacySnapshot.mtimeIso,
        updatedBy: legacyParsed.updatedBy || "",
      }, resolveSisConfigFilePath(), "legacy"),
      fileMtimeIso: fileSnapshot.mtimeIso,
      legacyMtimeIso: legacySnapshot.mtimeIso,
    }
    return cachedSnapshot
  }
  cachedSnapshot = {
    ...buildDefaultSnapshot(),
    fileMtimeIso: fileSnapshot.mtimeIso,
    legacyMtimeIso: legacySnapshot.mtimeIso,
  }
  return cachedSnapshot
}

export function getRuntimeConfigSync() {
  return getSisConfigSnapshotSync().runtime
}

export function getNewsReportsConfigSync() {
  return getSisConfigSnapshotSync().newsReports
}

export function getConfiguredDatabaseUrlSync() {
  const runtime = getRuntimeConfigSync()
  return normalizeText(runtime.databaseUrl)
}

export function getWeeklyMinimumReportsSync() {
  const newsReports = getNewsReportsConfigSync()
  return toPositiveInt(newsReports.weeklyMinimumReports, DEFAULT_WEEKLY_MINIMUM_REPORTS)
}

export async function saveSisConfigSnapshot(payload = {}, updatedByUsername = "") {
  const current = await ensureSisConfigLoaded({ refresh: true })
  const source = toPlainObject(payload)
  const next = normalizeLoadedSnapshot({
    uiSettings: source.uiSettings || current.uiSettings,
    runtime: source.runtime || current.runtime,
    newsReports: source.newsReports || current.newsReports,
    environment: source.environment || current.environment,
    updatedAt: nowIso(),
    updatedBy: normalizeText(updatedByUsername) || normalizeText(source.updatedBy) || current.updatedBy,
  }, resolveSisConfigFilePath(), "file")
  return writeSnapshotFiles(next)
}

export async function saveSisConfigFromUiSettings(uiSettings = {}, updatedByUsername = "") {
  return saveSisConfigSnapshot({ uiSettings }, updatedByUsername)
}

export async function saveSisConfigFromRuntime(runtime = {}, updatedByUsername = "") {
  return saveSisConfigSnapshot({ runtime }, updatedByUsername)
}

export async function saveSisConfigFromNewsReports(newsReports = {}, updatedByUsername = "") {
  return saveSisConfigSnapshot({ newsReports }, updatedByUsername)
}
