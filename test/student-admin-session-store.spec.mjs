import test from "node:test"
import assert from "node:assert/strict"

import { createStudentAdminSessionStore } from "../server/student-admin-session-store.mjs"

function createMockRedisClient(sharedCache = new Map()) {
  const cache = sharedCache
  const listeners = new Map()
  let connected = false
  let quitCalls = 0

  function readEntry(key) {
    const entry = cache.get(key)
    if (!entry) return null
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= Date.now()) {
      cache.delete(key)
      return null
    }
    return entry.value
  }

  return {
    get isReady() {
      return connected
    },
    get isOpen() {
      return connected
    },
    on(eventName, listener) {
      listeners.set(eventName, listener)
    },
    emit(eventName, payload) {
      const listener = listeners.get(eventName)
      if (typeof listener === "function") listener(payload)
    },
    forceDisconnect() {
      connected = false
      const listener = listeners.get("end")
      if (typeof listener === "function") listener()
    },
    async connect() {
      connected = true
      const ready = listeners.get("ready")
      if (typeof ready === "function") ready()
    },
    async set(key, value, options = {}) {
      if (!connected) throw new Error("redis-not-connected")
      const ttlSeconds = Number.isFinite(options.EX) ? Number(options.EX) : null
      cache.set(key, {
        value,
        expiresAtMs: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
      })
      return "OK"
    },
    async get(key) {
      if (!connected) throw new Error("redis-not-connected")
      return readEntry(key)
    },
    async del(key) {
      if (!connected) throw new Error("redis-not-connected")
      if (cache.has(key)) {
        cache.delete(key)
        return 1
      }
      return 0
    },
    async quit() {
      connected = false
      quitCalls += 1
    },
    state() {
      return {
        connected,
        quitCalls,
        listeners: Array.from(listeners.keys()),
      }
    },
  }
}

function createMockRedisFactory() {
  const cache = new Map()
  const clients = []
  return {
    async createClient() {
      const client = createMockRedisClient(cache)
      clients.push(client)
      return client
    },
    latestClient() {
      return clients.length ? clients[clients.length - 1] : null
    },
    totalClients() {
      return clients.length
    },
  }
}

test("session store uses memory driver when redis is not configured", async () => {
  const store = createStudentAdminSessionStore({
    driver: "auto",
    redisUrl: "",
    ttlSeconds: 120,
  })

  assert.equal(store.driver, "memory")
  const session = await store.createSession({ username: "memory-user", role: "admin" })
  const loaded = await store.getSession(session.id)
  assert.equal(loaded?.username, "memory-user")
  await store.close()
})

test("session store throws when redis driver is required without redis url", () => {
  assert.throws(
    () =>
      createStudentAdminSessionStore({
        driver: "redis",
        redisUrl: "",
      }),
    /requires REDIS_SESSION_URL or REDIS_URL/
  )
})

test("session store falls back to memory when redis auto-connect fails", async () => {
  const store = createStudentAdminSessionStore({
    driver: "auto",
    redisUrl: "redis://mock.local:6379/0",
    ttlSeconds: 120,
    createRedisClient: async () => ({
      on() {},
      async connect() {
        throw new Error("redis-connect-failed")
      },
    }),
  })

  const session = await store.createSession({ username: "fallback-user", role: "teacher" })
  assert.equal(store.driver, "memory")
  const loaded = await store.getSession(session.id)
  assert.equal(loaded?.username, "fallback-user")
  await store.close()
})

test("session store uses redis-backed driver when redis client is available", async () => {
  const redisClient = createMockRedisClient()
  const store = createStudentAdminSessionStore({
    driver: "redis",
    redisUrl: "redis://mock.local:6379/0",
    ttlSeconds: 120,
    keyPrefix: "test:session:",
    createRedisClient: async () => redisClient,
  })

  const created = await store.createSession({ username: "redis-user", role: "admin" })
  assert.equal(store.driver, "redis")

  const loaded = await store.getSession(created.id)
  assert.equal(loaded?.id, created.id)
  assert.equal(loaded?.username, "redis-user")

  const touched = await store.touchSession(created.id)
  assert.ok(touched)
  assert.ok(Number.isFinite(touched.updatedAt))
  assert.ok(touched.expiresAt >= created.expiresAt)

  const deleted = await store.deleteSession(created.id)
  assert.equal(deleted, true)
  const missing = await store.getSession(created.id)
  assert.equal(missing, null)

  await store.close()
  assert.equal(redisClient.state().quitCalls, 1)
})

test("session store surfaces connect errors when redis driver is required", async () => {
  const store = createStudentAdminSessionStore({
    driver: "redis",
    redisUrl: "redis://mock.local:6379/0",
    createRedisClient: async () => ({
      on() {},
      async connect() {
        throw new Error("required-redis-connect-failed")
      },
    }),
  })

  await assert.rejects(async () => {
    try {
      await store.createSession({ username: "must-fail", role: "admin" })
    } catch (error) {
      assert.equal(error?.statusCode, 503)
      throw error
    }
  }, /required-redis-connect-failed/)
  await store.close()
})

test("session store reconnects and keeps same session payload after transient redis disconnect", async () => {
  const factory = createMockRedisFactory()
  const store = createStudentAdminSessionStore({
    driver: "redis",
    redisUrl: "redis://mock.local:6379/0",
    ttlSeconds: 120,
    keyPrefix: "test:session:",
    createRedisClient: factory.createClient,
  })

  const created = await store.createSession({ username: "redis-reconnect-user", role: "admin" })
  assert.equal(factory.totalClients(), 1)

  const firstClient = factory.latestClient()
  firstClient.forceDisconnect()

  const loadedAfterReconnect = await store.getSession(created.id)
  assert.equal(loadedAfterReconnect?.id, created.id)
  assert.ok(factory.totalClients() >= 2)

  const runtimeStatus = store.getRuntimeStatus()
  assert.equal(runtimeStatus.redisConnected, true)
  assert.equal(runtimeStatus.redisReady, true)
  assert.ok(Number.isInteger(runtimeStatus.reconnectAttempts))
  assert.ok(runtimeStatus.reconnectAttempts >= 1)

  await store.close()
})
