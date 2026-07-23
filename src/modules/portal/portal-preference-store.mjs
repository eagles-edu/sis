// @ts-check

import { createHash } from "node:crypto"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"

const CACHE_PREFIX = "sis:portal-preferences:v1"
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30
let redisClient = null
let redisConnectPromise = null

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function cacheKey(type, id) {
  return `${CACHE_PREFIX}:${text(type)}:${text(id)}`
}

function redisReady(client) {
  return Boolean(client && (client.isReady === undefined || client.isReady === true))
}

async function getRedis() {
  const url = text(process.env.REDIS_SESSION_URL || process.env.REDIS_URL)
  if (!url) return null
  if (redisReady(redisClient)) return redisClient
  if (redisConnectPromise) return redisConnectPromise
  redisConnectPromise = (async () => {
    try {
      const { createClient } = await import("redis")
      const client = createClient({ url })
      client.on("error", () => {})
      await client.connect()
      redisClient = client
      return client
    } catch (error) {
      void error
      return null
    } finally {
      redisConnectPromise = null
    }
  })()
  return redisConnectPromise
}

async function cacheRead(type, id) {
  try {
    const client = await getRedis()
    if (!redisReady(client)) return null
    const raw = await client.get(cacheKey(type, id))
    return raw ? safeObject(JSON.parse(raw)) : null
  } catch (error) {
    void error
    return null
  }
}

async function cacheWrite(type, id, payload) {
  try {
    const client = await getRedis()
    if (!redisReady(client)) return
    await client.set(cacheKey(type, id), JSON.stringify(payload), { EX: CACHE_TTL_SECONDS })
  } catch (error) {
    void error
  }
}

async function cacheDelete(type, id) {
  try {
    const client = await getRedis()
    if (!redisReady(client)) return
    await client.del(cacheKey(type, id))
  } catch (error) {
    void error
  }
}

export async function getPortalPreferences(principalType, principalId) {
  const type = text(principalType)
  const id = text(principalId)
  if (!type || !id) return { preferences: {}, migrationVersion: 0, source: "default" }
  const cached = await cacheRead(type, id)
  if (cached) return { preferences: safeObject(cached.payload), migrationVersion: Number(cached.version) || 1, source: "redis" }

  const prisma = await getSharedPrismaClient()
  const row = await prisma.portalPreference.findUnique({
    where: { principalType_principalId: { principalType: type, principalId: id } },
  })
  const result = {
    preferences: safeObject(row?.payloadJson),
    migrationVersion: Number(row?.migrationVersion) || 0,
    source: row ? "postgres" : "default",
  }
  await cacheWrite(type, id, { payload: result.preferences, version: result.migrationVersion })
  return result
}

export async function savePortalPreferences(principalType, principalId, payload, options = {}) {
  const type = text(principalType)
  const id = text(principalId)
  if (!type || !id) throw Object.assign(new Error("Preference principal is required"), { statusCode: 400 })
  const preferences = safeObject(payload)
  const migrationVersion = Math.max(1, Number(options.migrationVersion) || 1)
  const prisma = await getSharedPrismaClient()
  const row = await prisma.portalPreference.upsert({
    where: { principalType_principalId: { principalType: type, principalId: id } },
    create: { principalType: type, principalId: id, payloadJson: preferences, migrationVersion },
    update: { payloadJson: preferences, migrationVersion },
  })
  await cacheWrite(type, id, { payload: preferences, version: row.migrationVersion })
  return { preferences, migrationVersion: row.migrationVersion, updatedAt: row.updatedAt.toISOString(), source: "postgres" }
}

export async function mergePortalPreferences(principalType, principalId, incoming = {}, options = {}) {
  const current = await getPortalPreferences(principalType, principalId)
  const merged = { ...current.preferences, ...safeObject(incoming) }
  return savePortalPreferences(principalType, principalId, merged, {
    migrationVersion: Math.max(current.migrationVersion, Number(options.migrationVersion) || 1),
  })
}

export async function invalidatePortalPreferences(principalType, principalId) {
  await cacheDelete(text(principalType), text(principalId))
}

export function assetSha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
