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

function createStatusError(message, statusCode = 500, cause = null) {
  const error = new Error(message)
  error.statusCode = statusCode
  if (cause) error.cause = cause
  return error
}

function stringifyError(error) {
  if (!error) return ""
  const message = normalizeText(error?.message || error)
  if (message) return message
  return "unknown-error"
}

function nowIsoString() {
  return new Date().toISOString()
}

function isRedisClientReady(client) {
  if (!client || typeof client !== "object") return false
  if (typeof client.isReady === "boolean") return client.isReady
  if (typeof client.isOpen === "boolean") return client.isOpen
  return true
}

function isRedisAvailabilityError(error) {
  const message = normalizeLower(error?.message || error)
  if (!message) return false
  return (
    message.includes("redis-not-connected") ||
    message.includes("connection is closed") ||
    message.includes("socket closed") ||
    message.includes("econnrefused") ||
    message.includes("ecconnrefused") ||
    message.includes("econnreset") ||
    message.includes("nr_closed") ||
    message.includes("the client is closed") ||
    message.includes("socket hang up")
  )
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

  async function close() {}

  return {
    driver: "memory",
    getRuntimeStatus() {
      return {
        redisConnected: false,
        redisReady: false,
        lastRedisError: "",
        lastReconnectAt: "",
        reconnectAttempts: 0,
      }
    },
    createSession,
    getSession,
    touchSession,
    deleteSession,
    close,
  }
}

function createRedisBackedStore({
  redisUrl,
  ttlSeconds,
  keyPrefix,
  required,
  fallbackStore,
  createRedisClient,
  redisConnectTimeoutMs,
}) {
  let redisClient = null
  let redisConnectPromise = null
  let usingFallback = false
  const runtimeStatus = {
    redisConnected: false,
    redisReady: false,
    lastRedisError: "",
    lastReconnectAt: "",
    reconnectAttempts: 0,
  }

  const keyFor = (id) => `${keyPrefix}${id}`

  function markRedisError(error) {
    runtimeStatus.lastRedisError = stringifyError(error)
    runtimeStatus.redisConnected = false
    runtimeStatus.redisReady = false
  }

  function markRedisReady(client) {
    runtimeStatus.redisConnected = true
    runtimeStatus.redisReady = isRedisClientReady(client)
    runtimeStatus.lastRedisError = ""
  }

  function markRedisReconnectAttempt() {
    runtimeStatus.reconnectAttempts += 1
    runtimeStatus.lastReconnectAt = nowIsoString()
    runtimeStatus.redisConnected = false
    runtimeStatus.redisReady = false
  }

  function createRedisUnavailableError(error, operation = "redis session operation") {
    const message = `Redis session store unavailable during ${operation}: ${stringifyError(error)}`
    return createStatusError(message, 503, error)
  }

  function bindRedisClientEvents(client) {
    if (!client || typeof client.on !== "function") return
    client.on("error", (error) => {
      markRedisError(error)
      if (!required) {
        console.warn(`student-admin session redis error: ${stringifyError(error)}`)
      }
    })
    client.on("ready", () => {
      markRedisReady(client)
    })
    client.on("end", () => {
      runtimeStatus.redisConnected = false
      runtimeStatus.redisReady = false
    })
    client.on("reconnecting", () => {
      markRedisReconnectAttempt()
    })
  }

  async function ensureRedisClient() {
    if (usingFallback) return null
    if (redisClient && isRedisClientReady(redisClient)) return redisClient
    if (redisClient && !isRedisClientReady(redisClient)) {
      redisClient = null
      if (required) markRedisReconnectAttempt()
    }
    if (redisConnectPromise) return redisConnectPromise

    redisConnectPromise = (async () => {
      try {
        if (required) {
          markRedisReconnectAttempt()
        }
        const client = await createRedisClient(redisUrl, redisConnectTimeoutMs)
        if (!client || typeof client.connect !== "function") {
          throw new Error("Redis client factory returned an invalid client")
        }
        bindRedisClientEvents(client)
        await client.connect()
        redisClient = client
        markRedisReady(client)
        return client
      } catch (error) {
        markRedisError(error)
        if (required) {
          throw createStatusError(
            `Redis session store unavailable during connect: ${stringifyError(error)}`,
            503,
            error,
          )
        }
        console.warn(`student-admin session store falling back to memory: ${error.message}`)
        usingFallback = true
        return null
      } finally {
        redisConnectPromise = null
      }
    })()

    return redisConnectPromise
  }

  async function close() {
    await Promise.resolve(fallbackStore?.close?.())

    let client = redisClient
    if (!client && redisConnectPromise) {
      try {
        client = await redisConnectPromise
      } catch (error) {
        void error
      }
    }

    redisClient = null
    redisConnectPromise = null
    runtimeStatus.redisConnected = false
    runtimeStatus.redisReady = false

    if (!client) return

    try {
      if (typeof client.quit === "function") {
        await client.quit()
      } else if (typeof client.disconnect === "function") {
        client.disconnect()
      }
    } catch (error) {
      if (typeof client.disconnect === "function") {
        try {
          client.disconnect()
        } catch (disconnectError) {
          void disconnectError
        }
      }
      if (required) throw error
    }
  }

  async function executeRedisOperation(operationName, operation, fallbackOperation) {
    const useFallback = typeof fallbackOperation === "function"

    const run = async () => {
      const client = await ensureRedisClient()
      if (!client) {
        if (useFallback) return fallbackOperation()
        return null
      }
      return operation(client)
    }

    try {
      return await run()
    } catch (error) {
      if (!isRedisAvailabilityError(error)) throw error
      markRedisError(error)
      redisClient = null

      try {
        return await run()
      } catch (retryError) {
        markRedisError(retryError)
        redisClient = null
        if (!required && useFallback) {
          usingFallback = true
          return fallbackOperation()
        }
        throw createRedisUnavailableError(retryError, operationName)
      }
    }
  }

  async function createSession(principal) {
    const sessionId = crypto.randomBytes(32).toString("base64url")
    const session = makeSessionPayload(sessionId, principal, ttlSeconds)
    return executeRedisOperation(
      "createSession",
      async (client) => {
        await client.set(keyFor(sessionId), JSON.stringify(session), { EX: ttlSeconds })
        return session
      },
      () => fallbackStore.createSession(principal),
    )
  }

  async function getSession(sessionId) {
    const id = normalizeText(sessionId)
    if (!id) return null
    return executeRedisOperation(
      "getSession",
      async (client) => {
        const raw = await client.get(keyFor(id))
        return parseSessionJson(raw)
      },
      () => fallbackStore.getSession(id),
    )
  }

  async function touchSession(sessionId) {
    const id = normalizeText(sessionId)
    if (!id) return null
    return executeRedisOperation(
      "touchSession",
      async (client) => {
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
      },
      () => fallbackStore.touchSession(id),
    )
  }

  async function deleteSession(sessionId) {
    const id = normalizeText(sessionId)
    if (!id) return false
    return executeRedisOperation(
      "deleteSession",
      async (client) => {
        const count = await client.del(keyFor(id))
        return count > 0
      },
      () => fallbackStore.deleteSession(id),
    )
  }

  return {
    get driver() {
      return usingFallback ? "memory" : "redis"
    },
    getRuntimeStatus() {
      return {
        redisConnected: runtimeStatus.redisConnected,
        redisReady: runtimeStatus.redisReady,
        lastRedisError: runtimeStatus.lastRedisError,
        lastReconnectAt: runtimeStatus.lastReconnectAt,
        reconnectAttempts: runtimeStatus.reconnectAttempts,
      }
    },
    createSession,
    getSession,
    touchSession,
    deleteSession,
    close,
  }
}

function defaultCreateRedisClient(redisUrl, connectTimeoutMs) {
  return import("redis").then(({ createClient }) =>
    createClient({
      url: redisUrl,
      socket: {
        connectTimeout: connectTimeoutMs,
        reconnectStrategy(retries) {
          const jitter = Math.floor(Math.random() * 100)
          const delay = Math.min((2 ** retries) * 50, 3000)
          return delay + jitter
        },
      },
    })
  )
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
  const redisConnectTimeoutMs = toPositiveInt(
    options.redisConnectTimeoutMs ?? process.env.STUDENT_ADMIN_SESSION_REDIS_CONNECT_TIMEOUT_MS,
    3000
  )
  const createRedisClient =
    typeof options.createRedisClient === "function" ? options.createRedisClient : defaultCreateRedisClient

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
    createRedisClient,
    redisConnectTimeoutMs,
  })
}
