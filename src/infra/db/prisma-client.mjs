// src/infra/db/prisma-client.mjs
// @ts-check

import { getConfiguredDatabaseUrlSync } from "../../modules/admin/sis-config-store.mjs"

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
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
  const maybeError = /** @type {{ message?: unknown } | null | undefined} */ (error)
  return normalizeLower(maybeError?.message || error)
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isOptionsObjectRequiredError(error) {
  const message = getErrorMessage(error)
  return (
    message.includes("needs to be constructed with a non-empty, valid `prismaclientoptions`") ||
    message.includes("needs to be constructed with a non-empty, valid prismaclientoptions")
  )
}

function isAdapterRequiredError(error) {
  const message = getErrorMessage(error)
  return (
    message.includes('engine type "client" requires either "adapter" or "accelerateurl"') ||
    message.includes("engine type client requires either adapter or accelerateurl")
  )
}

/**
 * @param {typeof import("@prisma/client").PrismaClient} PrismaClient
 * @param {string} databaseUrl
 * @returns {Promise<import("@prisma/client").PrismaClient>}
 */
async function createPrismaClientWithFallback(PrismaClient, databaseUrl = "") {
  try {
    return new PrismaClient()
  } catch (error) {
    if (!isOptionsObjectRequiredError(error)) throw error
  }

  try {
    return new PrismaClient({})
  } catch (error) {
    if (!isAdapterRequiredError(error)) throw error
  }

  const resolvedDatabaseUrl = normalizeText(databaseUrl || getConfiguredDatabaseUrlSync() || process.env.DATABASE_URL)
  if (!resolvedDatabaseUrl) {
    /** @type {Error & { statusCode?: number }} */
    const error = new Error("DATABASE_URL is required for Prisma adapter mode")
    error.statusCode = 500
    throw error
  }

  const [{ Pool }, { PrismaPg }] = await Promise.all([import("pg"), import("@prisma/adapter-pg")])
  const pool = new Pool({ connectionString: resolvedDatabaseUrl })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

/**
 * @type {Promise<import("@prisma/client").PrismaClient> | null}
 */
let sharedPrismaClientPromise = null

/**
 * @type {string}
 */
let sharedPrismaClientDatabaseUrl = ""

/**
 * @returns {Promise<import("@prisma/client").PrismaClient>}
 */
export async function getSharedPrismaClient() {
  const resolvedDatabaseUrl = normalizeText(getConfiguredDatabaseUrlSync() || process.env.DATABASE_URL)
  if (sharedPrismaClientPromise && sharedPrismaClientDatabaseUrl === resolvedDatabaseUrl) return sharedPrismaClientPromise

  if (sharedPrismaClientPromise && sharedPrismaClientDatabaseUrl !== resolvedDatabaseUrl) {
    try {
      const existingClient = await sharedPrismaClientPromise
      await existingClient.$disconnect()
    } catch (error) {
      void error
    } finally {
      sharedPrismaClientPromise = null
      sharedPrismaClientDatabaseUrl = ""
    }
  }

  sharedPrismaClientDatabaseUrl = resolvedDatabaseUrl
  sharedPrismaClientPromise = (async () => {
    const pkg = await import("@prisma/client")
    const PrismaClient = pkg?.PrismaClient
    if (typeof PrismaClient !== "function") {
      /** @type {Error & { statusCode?: number }} */
      const error = new Error("Unable to initialize Prisma client")
      error.statusCode = 500
      throw error
    }

    const prisma = await createPrismaClientWithFallback(PrismaClient, resolvedDatabaseUrl)
    await prisma.$connect()
    return prisma
  })()

  try {
    return await sharedPrismaClientPromise
  } catch (error) {
    sharedPrismaClientPromise = null
    throw error
  }
}
