// src/modules/admin/student-admin-queries.mjs
// @ts-check

import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { getConfiguredDatabaseUrlSync } from "./sis-config-store.mjs"
import {
  ENROLLMENT_STATUS_ACTIVE,
  ensureEnrollmentPeriodsBackfilled,
} from "./enrollment-periods.mjs"
import { getConfiguredSchoolYear } from "./school-setup-store.mjs"
import {
  canonicalizeLevel as canonicalizeCatalogLevel,
  resolveLevelVariants as resolveCatalogLevelVariants,
} from "./level-catalog.mjs"

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
 * @returns {number | null}
 */
function normalizePositiveInteger(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeLevelKey(value) {
  return normalizeLower(value).replace(/[^a-z0-9]/g, "")
}

/**
 * @typedef {{ canonical: string, aliases?: string[] }} LevelDefinition
 * @typedef {{ levels: string[], schools: string[] }} FilterPayload
 * @typedef {{
 *   backend: "redis" | "memory",
 *   configuredRedisUrl: boolean,
 *   hits: number,
 *   misses: number,
 *   writes: number,
 *   invalidations: number,
 *   lastHitAt: string | null,
 *   lastMissAt: string | null,
 *   lastWriteAt: string | null,
 *   lastInvalidateAt: string | null,
 *   lastError: string | null,
 * }} FilterCacheState
 * @typedef {{ value: FilterPayload, expiresAtMs: number }} FilterCacheEntry
 */

/** @type {LevelDefinition[]} */
const LEVEL_DEFINITIONS = [
  {
    canonical: "Eggs & Chicks",
    aliases: ["EggChic", "Eggs and Chicks", "Eggs Chicks"],
  },
  {
    canonical: "Pre-A1 Starters",
    aliases: ["Starters", "Pre A1 Starters"],
  },
  {
    canonical: "A1 Movers",
    aliases: ["Movers"],
  },
  {
    canonical: "A2 Flyers",
    aliases: ["Flyers"],
  },
  {
    canonical: "A2 KET",
    aliases: ["KET"],
  },
  {
    canonical: "B1 PET",
    aliases: ["PET"],
  },
  {
    canonical: "B2+ IELTS",
    aliases: ["IELTS", "B2 IELTS"],
  },
  {
    canonical: "C1+ TAYK",
    aliases: ["TAYK", "C1 TAYK"],
  },
  {
    canonical: "Private",
    aliases: ["Private Class", "1:1 Private"],
  },
]

const LEVEL_ALIAS_MAP = (() => {
  /** @type {Map<string, string>} */
  const map = new Map()
  LEVEL_DEFINITIONS.forEach((entry) => {
    const variants = [entry.canonical, ...(entry.aliases || [])]
    variants.forEach((variant) => {
      const key = normalizeLevelKey(variant)
      if (key) map.set(key, entry.canonical)
    })
  })
  return map
})()

/**
 * @param {unknown} value
 * @returns {string}
 */
function canonicalizeLevel(value) {
  return canonicalizeCatalogLevel(value)
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function resolveLevelVariants(value) {
  return resolveCatalogLevelVariants(value)
}

/**
 * @param {unknown[]} values
 * @returns {string[]}
 */
function normalizeFilterList(values) {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values.map((entry) => normalizeText(entry)).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  )
}

/**
 * @param {Partial<FilterPayload> | Record<string, unknown>} [payload]
 * @returns {FilterPayload}
 */
function normalizeFilterPayload(payload = {}) {
  return {
    levels: normalizeFilterList(/** @type {unknown[]} */ (payload.levels || [])),
    schools: normalizeFilterList(/** @type {unknown[]} */ (payload.schools || [])),
  }
}

const FILTER_CACHE_TTL_SECONDS = Math.max(
  30,
  Number.parseInt(String(process.env.STUDENT_ADMIN_FILTER_CACHE_TTL_SECONDS || "300"), 10) || 300
)
const FILTER_CACHE_KEY =
  normalizeText(process.env.STUDENT_ADMIN_FILTER_CACHE_KEY) || "sis:admin:filters:v1"
const FILTER_CACHE_URL = normalizeText(process.env.REDIS_CACHE_URL) || normalizeText(process.env.REDIS_URL)

/** @type {import("redis").RedisClientType | null} */
let filterCacheRedisClient = null
/** @type {Promise<import("redis").RedisClientType | null> | null} */
let filterCacheRedisConnectPromise = null
let filterCacheRedisDisabled = false
/** @type {FilterCacheEntry | null} */
let memoryFilterCacheEntry = null

/** @type {FilterCacheState} */
const FILTER_CACHE_STATE = {
  backend: FILTER_CACHE_URL ? "redis" : "memory",
  configuredRedisUrl: Boolean(FILTER_CACHE_URL),
  hits: 0,
  misses: 0,
  writes: 0,
  invalidations: 0,
  lastHitAt: null,
  lastMissAt: null,
  lastWriteAt: null,
  lastInvalidateAt: null,
  lastError: null,
}

/**
 * @returns {string}
 */
function nowIso() {
  return new Date().toISOString()
}

/**
 * @returns {boolean}
 */
function isStudentAdminQueriesEnabled() {
  const hasDatabaseUrl = Boolean(normalizeText(getConfiguredDatabaseUrlSync() || process.env.DATABASE_URL))
  const envFlag = normalizeLower(process.env.STUDENT_ADMIN_STORE_ENABLED)
  if (!envFlag) return hasDatabaseUrl
  if (["false", "0", "no"].includes(envFlag)) return false
  if (["true", "1", "yes"].includes(envFlag)) return true
  return hasDatabaseUrl
}

/**
 * @returns {Promise<import("@prisma/client").PrismaClient>}
 */
async function getPrismaClient() {
  if (!isStudentAdminQueriesEnabled()) {
    /** @type {Error & { statusCode?: number }} */
    const error = new Error("Student admin store is disabled")
    error.statusCode = 503
    throw error
  }
  return getSharedPrismaClient()
}

/**
 * @returns {Promise<import("redis").RedisClientType | null>}
 */
async function getFilterCacheRedisClient() {
  if (!FILTER_CACHE_URL || filterCacheRedisDisabled) return null
  if (filterCacheRedisClient) return filterCacheRedisClient
  if (filterCacheRedisConnectPromise) return filterCacheRedisConnectPromise

  filterCacheRedisConnectPromise = (async () => {
    try {
      const { createClient } = await import("redis")
      const client = createClient({ url: FILTER_CACHE_URL })
      client.on("error", (error) => {
        const maybeError = /** @type {{ message?: unknown } | null | undefined} */ (error)
        FILTER_CACHE_STATE.lastError = String(maybeError?.message || error)
      })
      await client.connect()
      filterCacheRedisClient = client
      FILTER_CACHE_STATE.backend = "redis"
      FILTER_CACHE_STATE.lastError = null
      return client
    } catch (error) {
      filterCacheRedisDisabled = true
      FILTER_CACHE_STATE.backend = "memory"
      const maybeError = /** @type {{ message?: unknown } | null | undefined} */ (error)
      FILTER_CACHE_STATE.lastError = String(maybeError?.message || error)
      console.warn(`student-admin filter cache falling back to memory: ${maybeError?.message || error}`)
      return null
    } finally {
      filterCacheRedisConnectPromise = null
    }
  })()

  return filterCacheRedisConnectPromise
}

/**
 * @returns {Promise<FilterPayload | null>}
 */
async function readCachedLevelAndSchoolFilters() {
  const now = Date.now()
  if (memoryFilterCacheEntry && memoryFilterCacheEntry.expiresAtMs > now) {
    FILTER_CACHE_STATE.hits += 1
    FILTER_CACHE_STATE.lastHitAt = nowIso()
    return normalizeFilterPayload(memoryFilterCacheEntry.value)
  }

  const client = await getFilterCacheRedisClient()
  if (client) {
    try {
      const raw = await client.get(FILTER_CACHE_KEY)
      FILTER_CACHE_STATE.lastError = null
      if (raw) {
        const parsed = normalizeFilterPayload(JSON.parse(raw))
        memoryFilterCacheEntry = {
          value: parsed,
          expiresAtMs: now + FILTER_CACHE_TTL_SECONDS * 1000,
        }
        FILTER_CACHE_STATE.hits += 1
        FILTER_CACHE_STATE.lastHitAt = nowIso()
        return normalizeFilterPayload(parsed)
      }
    } catch (error) {
      FILTER_CACHE_STATE.lastError = String(error?.message || error)
    }
  }

  FILTER_CACHE_STATE.misses += 1
  FILTER_CACHE_STATE.lastMissAt = nowIso()
  return null
}

/**
 * @param {Partial<FilterPayload> | Record<string, unknown>} [payload]
 * @returns {Promise<void>}
 */
async function writeCachedLevelAndSchoolFilters(payload = {}) {
  const normalized = normalizeFilterPayload(payload)
  memoryFilterCacheEntry = {
    value: normalized,
    expiresAtMs: Date.now() + FILTER_CACHE_TTL_SECONDS * 1000,
  }
  FILTER_CACHE_STATE.writes += 1
  FILTER_CACHE_STATE.lastWriteAt = nowIso()

  const client = await getFilterCacheRedisClient()
  if (!client) return

  try {
    await client.set(FILTER_CACHE_KEY, JSON.stringify(normalized), { EX: FILTER_CACHE_TTL_SECONDS })
    FILTER_CACHE_STATE.lastError = null
  } catch (error) {
    const maybeError = /** @type {{ message?: unknown } | null | undefined} */ (error)
    FILTER_CACHE_STATE.lastError = String(maybeError?.message || error)
  }
}

/**
 * @returns {Promise<void>}
 */
export async function closeStudentAdminFilterCache() {
  const client = filterCacheRedisClient
  const pendingConnect = filterCacheRedisConnectPromise
  filterCacheRedisClient = null
  filterCacheRedisConnectPromise = null

  if (!client && !pendingConnect) return

  let targetClient = client
  if (!targetClient && pendingConnect) {
    try {
      targetClient = await pendingConnect
    } catch (error) {
      void error
      targetClient = null
    }
  }

  if (!targetClient) return

  try {
    if (typeof targetClient.quit === "function") {
      await targetClient.quit()
    } else if (typeof targetClient.disconnect === "function") {
      targetClient.disconnect()
    }
  } catch (error) {
    void error
    if (typeof targetClient.disconnect === "function") {
      try {
        targetClient.disconnect()
      } catch (disconnectError) {
        void disconnectError
      }
    }
  }
}

/**
 * @returns {Promise<void>}
 */
export async function invalidateLevelAndSchoolFiltersCache() {
  memoryFilterCacheEntry = null
  FILTER_CACHE_STATE.invalidations += 1
  FILTER_CACHE_STATE.lastInvalidateAt = nowIso()

  const client = await getFilterCacheRedisClient()
  if (!client) return

  try {
    await client.del(FILTER_CACHE_KEY)
    FILTER_CACHE_STATE.lastError = null
  } catch (error) {
    const maybeError = /** @type {{ message?: unknown } | null | undefined} */ (error)
    FILTER_CACHE_STATE.lastError = String(maybeError?.message || error)
  }
}

/**
 * @returns {Promise<FilterPayload>}
 */
export async function listLevelAndSchoolFilters() {
  const cached = await readCachedLevelAndSchoolFilters()
  if (cached) return cached

  const prisma = await getPrismaClient()
  const schoolYear = getConfiguredSchoolYear()
  if (schoolYear) {
    await ensureEnrollmentPeriodsBackfilled({ prisma, schoolYear })
  }

  const [levels, schools] = await Promise.all([
    schoolYear
      ? prisma.studentEnrollmentPeriod.findMany({
          where: {
            schoolYear,
            status: ENROLLMENT_STATUS_ACTIVE,
            endedAt: null,
            level: { not: null },
          },
          select: { level: true },
          distinct: ["level"],
          orderBy: { level: "asc" },
        })
      : prisma.studentProfile.findMany({
          where: { currentGrade: { not: null } },
          select: { currentGrade: true },
          distinct: ["currentGrade"],
          orderBy: { currentGrade: "asc" },
        }),
    prisma.studentProfile.findMany({
      where: { schoolName: { not: null } },
      select: { schoolName: true },
      distinct: ["schoolName"],
      orderBy: { schoolName: "asc" },
    }),
  ])

  const payload = {
    levels: levels
      .map((entry) => canonicalizeLevel(entry.currentGrade || entry.level))
      .filter(Boolean),
    schools: schools
      .map((entry) => normalizeText(entry.schoolName))
      .filter(Boolean),
  }

  payload.levels = Array.from(new Set(payload.levels)).sort((a, b) => a.localeCompare(b))

  await writeCachedLevelAndSchoolFilters(payload)
  return payload
}

/**
 * @param {{ query?: string, take?: number }} [options]
 * @returns {Promise<{ total: number, items: string[] }>}
 */
export async function listExerciseTitles({ query = "", take = 200 } = {}) {
  const prisma = await getPrismaClient()
  const search = normalizeText(query)
  const limit = Math.max(1, Math.min(Number.parseInt(String(take), 10) || 200, 1000))
  const where = search
    ? {
        title: {
          contains: search,
          mode: "insensitive",
        },
      }
    : {}

  const rows = await prisma.exercise.findMany({
    where,
    select: { title: true },
    orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
    take: limit,
  })

  const titles = Array.from(
    new Set(
      rows
        .map((entry) => normalizeText(entry.title))
        .filter(Boolean)
    )
  )

  return {
    total: titles.length,
    items: titles,
  }
}

/**
 * @returns {FilterCacheState & { key: string, ttlSeconds: number }}
 */
export function getStudentAdminFilterCacheStatus() {
  return {
    backend: FILTER_CACHE_STATE.backend,
    configuredRedisUrl: FILTER_CACHE_STATE.configuredRedisUrl,
    key: FILTER_CACHE_KEY,
    ttlSeconds: FILTER_CACHE_TTL_SECONDS,
    hits: FILTER_CACHE_STATE.hits,
    misses: FILTER_CACHE_STATE.misses,
    writes: FILTER_CACHE_STATE.writes,
    invalidations: FILTER_CACHE_STATE.invalidations,
    lastHitAt: FILTER_CACHE_STATE.lastHitAt,
    lastMissAt: FILTER_CACHE_STATE.lastMissAt,
    lastWriteAt: FILTER_CACHE_STATE.lastWriteAt,
    lastInvalidateAt: FILTER_CACHE_STATE.lastInvalidateAt,
    lastError: FILTER_CACHE_STATE.lastError,
  }
}
