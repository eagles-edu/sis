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
    message.includes("needs to be constructed with a non-empty, valid prismaclientoptions") ||
    message.includes("prismaclient was instantiated without any options")
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
  const resolvedDatabaseUrl = normalizeText(databaseUrl || getConfiguredDatabaseUrlSync() || process.env.DATABASE_URL)

  // Prisma 7's client engine requires an adapter, but throws that error only
  // when the first query connects. Prefer the adapter whenever a database URL
  // is configured so initialization is valid in both eager and lazy paths.
  if (resolvedDatabaseUrl) {
    const { PrismaPg } = await import("@prisma/adapter-pg")
    const adapter = new PrismaPg({ connectionString: resolvedDatabaseUrl })
    return new PrismaClient({ adapter })
  }

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

  /** @type {Error & { statusCode?: number }} */
  const error = new Error("DATABASE_URL is required for Prisma adapter mode")
  error.statusCode = 500
  throw error
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

/**
 * Close the process-shared client and clear the cached promise.
 *
 * @returns {Promise<void>}
 */
export async function closeSharedPrismaClient() {
  const clientPromise = sharedPrismaClientPromise
  sharedPrismaClientPromise = null
  sharedPrismaClientDatabaseUrl = ""
  if (!clientPromise) return
  try {
    const client = await clientPromise
    await client.$disconnect()
  } catch (error) {
    void error
  }
}
