// server/student-admin-session-store.mjs

import crypto from "node:crypto"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(normalizeText(value), 10)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  return fallback
}

function makeSessionPayload(id, principal, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + ttlSeconds
  return {
    id,
    username: normalizeText(principal?.username),
    role: normalizeLower(principal?.role) || "admin",
    createdAt: now,
    updatedAt: now,
    expiresAt,
  }
}

function parseSessionJson(raw) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    if (!parsed.id || !parsed.username || !parsed.role) return null
    if (!Number.isFinite(parsed.expiresAt)) return null
    const now = Math.floor(Date.now() / 1000)
    if (parsed.expiresAt <= now) return null
    return parsed
  } catch (error) {
    void error
    return null
  }
}

function createMemoryStore(ttlSeconds) {
  const sessions = new Map()

  function cleanupExpired() {
    const now = Math.floor(Date.now() / 1000)
    for (const [id, session] of sessions.entries()) {
      if (!session || !Number.isFinite(session.expiresAt) || session.expiresAt <= now) {
        sessions.delete(id)
      }
    }
  }

  async function createSession(principal) {
    cleanupExpired()
    const id = crypto.randomBytes(32).toString("base64url")
    const session = makeSessionPayload(id, principal, ttlSeconds)
    sessions.set(id, session)
    return session
  }

  async function getSession(id) {
    cleanupExpired()
    const key = normalizeText(id)
    if (!key) return null
    const session = sessions.get(key)
    if (!session) return null
    if (session.expiresAt <= Math.floor(Date.now() / 1000)) {
      sessions.delete(key)
      return null
    }
    return { ...session }
  }

  async function touchSession(id) {
    cleanupExpired()
    const key = normalizeText(id)
    if (!key) return null
    const session = sessions.get(key)
    if (!session) return null
    const now = Math.floor(Date.now() / 1000)
    const updated = {
      ...session,
      updatedAt: now,
      expiresAt: now + ttlSeconds,
    }
    sessions.set(key, updated)
    return { ...updated }
  }

  async function deleteSession(id) {
    const key = normalizeText(id)
    if (!key) return false
    return sessions.delete(key)
  }

  return {
    driver: "memory",
    createSession,
    getSession,
    touchSession,
    deleteSession,
  }
}

function createRedisBackedStore({
  redisUrl,
  ttlSeconds,
  keyPrefix,
  required,
  fallbackStore,
}) {
  let redisClient = null
  let redisConnectPromise = null
  let usingFallback = false

  const keyFor = (id) => `${keyPrefix}${id}`

  async function ensureRedisClient() {
    if (usingFallback) return null
    if (redisClient) return redisClient
    if (redisConnectPromise) return redisConnectPromise

    redisConnectPromise = (async () => {
      try {
        const { createClient } = await import("redis")
        const client = createClient({ url: redisUrl })
        client.on("error", (error) => {
          if (!required) {
            console.warn(`student-admin session redis error: ${error.message}`)
          }
        })
        await client.connect()
        redisClient = client
        return client
      } catch (error) {
        if (required) throw error
        console.warn(`student-admin session store falling back to memory: ${error.message}`)
        usingFallback = true
        return null
      } finally {
        redisConnectPromise = null
      }
    })()

    return redisConnectPromise
  }

  async function createSession(principal) {
    const sessionId = crypto.randomBytes(32).toString("base64url")
    const session = makeSessionPayload(sessionId, principal, ttlSeconds)
    const client = await ensureRedisClient()

    if (!client) return fallbackStore.createSession(principal)

    await client.set(keyFor(sessionId), JSON.stringify(session), { EX: ttlSeconds })
    return session
  }

  async function getSession(sessionId) {
    const id = normalizeText(sessionId)
    if (!id) return null
    const client = await ensureRedisClient()
    if (!client) return fallbackStore.getSession(id)

    const raw = await client.get(keyFor(id))
    return parseSessionJson(raw)
  }

  async function touchSession(sessionId) {
    const id = normalizeText(sessionId)
    if (!id) return null
    const client = await ensureRedisClient()
    if (!client) return fallbackStore.touchSession(id)

    const raw = await client.get(keyFor(id))
    const existing = parseSessionJson(raw)
    if (!existing) return null
    const now = Math.floor(Date.now() / 1000)
    const updated = {
      ...existing,
      updatedAt: now,
      expiresAt: now + ttlSeconds,
    }
    await client.set(keyFor(id), JSON.stringify(updated), { EX: ttlSeconds })
    return updated
  }

  async function deleteSession(sessionId) {
    const id = normalizeText(sessionId)
    if (!id) return false
    const client = await ensureRedisClient()
    if (!client) return fallbackStore.deleteSession(id)

    const count = await client.del(keyFor(id))
    return count > 0
  }

  return {
    get driver() {
      return usingFallback ? "memory" : "redis"
    },
    createSession,
    getSession,
    touchSession,
    deleteSession,
  }
}

export function createStudentAdminSessionStore(options = {}) {
  const ttlSeconds = toPositiveInt(
    options.ttlSeconds ?? process.env.STUDENT_ADMIN_SESSION_TTL_SECONDS,
    8 * 60 * 60
  )
  const driver = normalizeLower(options.driver ?? process.env.STUDENT_ADMIN_SESSION_DRIVER) || "auto"
  const redisUrl =
    normalizeText(options.redisUrl ?? process.env.REDIS_SESSION_URL) ||
    normalizeText(process.env.REDIS_URL)
  const keyPrefix =
    normalizeText(options.keyPrefix ?? process.env.STUDENT_ADMIN_SESSION_KEY_PREFIX) ||
    "sis:admin:session:"

  const memoryStore = createMemoryStore(ttlSeconds)

  if (driver === "memory") return memoryStore

  if (!redisUrl) {
    if (driver === "redis") {
      throw new Error("STUDENT_ADMIN_SESSION_DRIVER=redis requires REDIS_SESSION_URL or REDIS_URL")
    }
    return memoryStore
  }

  return createRedisBackedStore({
    redisUrl,
    ttlSeconds,
    keyPrefix,
    required: driver === "redis",
    fallbackStore: memoryStore,
  })
}
