// @ts-check
import crypto from "node:crypto"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { getConfiguredDatabaseUrlSync } from "./sis-config-store.mjs"

/**
 * @typedef {{
 *   username?: unknown,
 *   role?: unknown,
 *   password?: unknown,
 *   passwordHash?: unknown,
 * }} AdminUserPayload
 *
 * @typedef {{
 *   currentUsername?: unknown,
 * }} DeleteAdminUserOptions
 *
 * @typedef {{
 *   id: string,
 *   username: string,
 *   role: string,
 *   createdAt?: unknown,
 *   updatedAt?: unknown,
 * }} AdminUserEntity
 */

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
 * @param {boolean} condition
 * @param {number} statusCode
 * @param {string} message
 * @returns {asserts condition}
 */
function assertWithStatus(condition, statusCode, message) {
  if (condition) return
  /** @type {Error & { statusCode?: number }} */
  const error = new Error(message)
  error.statusCode = statusCode
  throw error
}

/**
 * @param {unknown} value
 * @returns {"admin" | "teacher"}
 */
function normalizeRole(value) {
  const role = normalizeLower(value)
  return role === "admin" ? "admin" : "teacher"
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeUsername(value) {
  return normalizeLower(value)
}

/**
 * @param {unknown} hashValue
 * @returns {{ saltHex: string, digestHex: string } | null}
 */
function parseScryptHash(hashValue) {
  const hashText = normalizeText(hashValue)
  const parts = hashText.split("$")
  if (parts.length !== 3 || parts[0] !== "scrypt") return null

  const saltHex = normalizeText(parts[1])
  const digestHex = normalizeText(parts[2])
  if (!saltHex || !digestHex) return null
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(digestHex)) return null
  if (saltHex.length % 2 !== 0 || digestHex.length % 2 !== 0) return null

  return {
    saltHex: saltHex.toLowerCase(),
    digestHex: digestHex.toLowerCase(),
  }
}

/**
 * @param {unknown} password
 * @returns {string}
 */
export function hashScryptPassword(password) {
  const normalizedPassword = normalizeText(password)
  assertWithStatus(normalizedPassword.length >= 8, 400, "password must be at least 8 characters")

  const saltHex = crypto.randomBytes(16).toString("hex")
  const digestHex = crypto
    .scryptSync(normalizedPassword, Buffer.from(saltHex, "hex"), 64)
    .toString("hex")
  return `scrypt$${saltHex}$${digestHex}`
}

/**
 * @param {AdminUserPayload} [payload]
 * @param {{ required?: boolean }} [options]
 * @returns {string}
 */
function resolvePasswordHash(payload = {}, { required = false } = {}) {
  const providedHash = normalizeText(payload.passwordHash)
  if (providedHash) {
    assertWithStatus(Boolean(parseScryptHash(providedHash)), 400, "passwordHash must use scrypt$<salt>$<digest>")
    return providedHash
  }

  const password = normalizeText(payload.password)
  if (!password) {
    if (required) {
      const error = new Error("password is required")
      error.statusCode = 400
      throw error
    }
    return ""
  }

  return hashScryptPassword(password)
}

/**
 * @param {unknown} password
 * @param {unknown} hashValue
 * @returns {boolean}
 */
export function verifyScryptPassword(password, hashValue) {
  const parsed = parseScryptHash(hashValue)
  if (!parsed) return false

  const expected = Buffer.from(parsed.digestHex, "hex")
  const derived = crypto.scryptSync(normalizeText(password), Buffer.from(parsed.saltHex, "hex"), expected.length)

  if (expected.length !== derived.length) return false
  return crypto.timingSafeEqual(expected, derived)
}

/**
 * @param {AdminUserEntity | null | undefined} user
 * @returns {{
 *   id: string,
 *   username: string,
 *   role: string,
 *   createdAt?: unknown,
 *   updatedAt?: unknown,
 * } | null}
 */
function mapAdminUser(user) {
  if (!user) return null
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

let prismaClientPromise = null

/**
 * @returns {boolean}
 */
function isStudentAdminStoreEnabled() {
  const hasDatabaseUrl = Boolean(normalizeText(getConfiguredDatabaseUrlSync() || process.env.DATABASE_URL))
  const envFlag = normalizeLower(process.env.STUDENT_ADMIN_STORE_ENABLED)
  if (!envFlag) return hasDatabaseUrl
  if (["false", "0", "no"].includes(envFlag)) return false
  if (["true", "1", "yes"].includes(envFlag)) return true
  return hasDatabaseUrl
}

/**
 * @returns {Promise<unknown>}
 */
async function getPrismaClient() {
  if (!isStudentAdminStoreEnabled()) {
    const error = new Error("Student admin store is disabled")
    error.statusCode = 503
    throw error
  }

  if (prismaClientPromise) return prismaClientPromise

  prismaClientPromise = getSharedPrismaClient()

  try {
    return await prismaClientPromise
  } catch (error) {
    prismaClientPromise = null
    throw error
  }
}

/**
 * @param {unknown} prisma
 * @param {string} [excludedUserId]
 * @returns {Promise<void>}
 */
async function ensureAdminRoleRemains(prisma, excludedUserId = "") {
  const count = await prisma.adminUser.count({
    where: {
      role: "admin",
      ...(excludedUserId
        ? {
            id: {
              not: excludedUserId,
            },
          }
        : {}),
    },
  })
  assertWithStatus(count > 0, 409, "At least one admin account is required")
}

/**
 * @returns {Promise<boolean>}
 */
export async function hasAdminUsersConfigured() {
  const prisma = await getPrismaClient()
  const count = await prisma.adminUser.count()
  return count > 0
}

/**
 * @param {unknown} username
 * @returns {Promise<{
 *   id: string,
 *   username: string,
 *   role: string,
 *   passwordHash: string,
 * } | null>}
 */
export async function findAdminUserForLogin(username) {
  const prisma = await getPrismaClient()
  const requestedUsername = normalizeUsername(username)
  if (!requestedUsername) return null

  const user = await prisma.adminUser.findUnique({
    where: {
      username: requestedUsername,
    },
  })

  if (!user) return null

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    passwordHash: user.passwordHash,
  }
}

/**
 * @param {{ query?: unknown, role?: unknown }} [filters]
 * @returns {Promise<{
 *   total: number,
 *   items: Array<{
 *     id: string,
 *     username: string,
 *     role: string,
 *     createdAt?: unknown,
 *     updatedAt?: unknown,
 *   } | null>,
 * }>}
 */
export async function listAdminUsers({ query = "", role = "" } = {}) {
  const prisma = await getPrismaClient()
  const queryText = normalizeText(query)
  const normalizedRole = normalizeLower(role)
  const roleFilter = normalizedRole === "admin" || normalizedRole === "teacher" ? normalizedRole : ""

  const users = await prisma.adminUser.findMany({
    where: {
      AND: [
        roleFilter
          ? {
              role: roleFilter,
            }
          : {},
        queryText
          ? {
              username: {
                contains: queryText,
                mode: "insensitive",
              },
            }
          : {},
      ],
    },
    orderBy: [{ role: "asc" }, { username: "asc" }],
  })

  return {
    total: users.length,
    items: users.map((entry) => mapAdminUser(entry)),
  }
}

/**
 * @param {AdminUserPayload} [payload]
 * @returns {Promise<{ user: ReturnType<typeof mapAdminUser> }>}
 */
export async function createAdminUser(payload = {}) {
  const prisma = await getPrismaClient()

  const username = normalizeUsername(payload.username)
  const role = normalizeRole(payload.role)
  const passwordHash = resolvePasswordHash(payload, { required: true })

  assertWithStatus(Boolean(username), 400, "username is required")

  try {
    const user = await prisma.adminUser.create({
      data: {
        username,
        role,
        passwordHash,
      },
    })

    return {
      user: mapAdminUser(user),
    }
  } catch (error) {
    if (error && error.code === "P2002") {
      const conflict = new Error("username already exists")
      conflict.statusCode = 409
      throw conflict
    }
    throw error
  }
}

/**
 * @param {unknown} userId
 * @param {AdminUserPayload} [payload]
 * @returns {Promise<{ user: ReturnType<typeof mapAdminUser> }>}
 */
export async function updateAdminUserById(userId, payload = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(userId)
  assertWithStatus(Boolean(id), 400, "userId is required")

  const existing = await prisma.adminUser.findUnique({ where: { id } })
  assertWithStatus(Boolean(existing), 404, "Admin user not found")

  const nextRole = Object.prototype.hasOwnProperty.call(payload, "role")
    ? normalizeRole(payload.role)
    : existing.role

  if (existing.role === "admin" && nextRole !== "admin") {
    await ensureAdminRoleRemains(prisma, existing.id)
  }

  const data = {}

  if (Object.prototype.hasOwnProperty.call(payload, "username")) {
    const nextUsername = normalizeUsername(payload.username)
    assertWithStatus(Boolean(nextUsername), 400, "username is required")
    data.username = nextUsername
  }

  if (Object.prototype.hasOwnProperty.call(payload, "role")) {
    data.role = nextRole
  }

  const nextPasswordHash = resolvePasswordHash(payload, { required: false })
  if (nextPasswordHash) {
    data.passwordHash = nextPasswordHash
  }

  if (!Object.keys(data).length) {
    return {
      user: mapAdminUser(existing),
    }
  }

  try {
    const user = await prisma.adminUser.update({
      where: { id },
      data,
    })

    return {
      user: mapAdminUser(user),
    }
  } catch (error) {
    if (error && error.code === "P2002") {
      const conflict = new Error("username already exists")
      conflict.statusCode = 409
      throw conflict
    }
    throw error
  }
}

/**
 * @param {unknown} userId
 * @param {DeleteAdminUserOptions} [options]
 * @returns {Promise<{ deleted: true, id: string }>}
 */
export async function deleteAdminUserById(userId, options = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(userId)
  assertWithStatus(Boolean(id), 400, "userId is required")

  const existing = await prisma.adminUser.findUnique({ where: { id } })
  assertWithStatus(Boolean(existing), 404, "Admin user not found")

  const currentUsername = normalizeUsername(options.currentUsername)
  if (currentUsername && currentUsername === normalizeUsername(existing.username)) {
    const error = new Error("You cannot delete the active session account")
    error.statusCode = 409
    throw error
  }

  if (existing.role === "admin") {
    await ensureAdminRoleRemains(prisma, existing.id)
  }

  await prisma.adminUser.delete({ where: { id } })

  return {
    deleted: true,
    id,
  }
}
