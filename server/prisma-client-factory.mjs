// server/prisma-client-factory.mjs

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function getErrorMessage(error) {
  return normalizeLower(error?.message || error)
}

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

async function createPrismaClientWithFallback(PrismaClient) {
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

  const databaseUrl = normalizeText(process.env.DATABASE_URL)
  if (!databaseUrl) {
    const error = new Error("DATABASE_URL is required for Prisma adapter mode")
    error.statusCode = 500
    throw error
  }

  const [{ Pool }, { PrismaPg }] = await Promise.all([import("pg"), import("@prisma/adapter-pg")])
  const pool = new Pool({ connectionString: databaseUrl })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

let sharedPrismaClientPromise = null

export async function getSharedPrismaClient() {
  if (sharedPrismaClientPromise) return sharedPrismaClientPromise

  sharedPrismaClientPromise = (async () => {
    const pkg = await import("@prisma/client")
    const PrismaClient = pkg?.PrismaClient
    if (typeof PrismaClient !== "function") {
      const error = new Error("Unable to initialize Prisma client")
      error.statusCode = 500
      throw error
    }

    const prisma = await createPrismaClientWithFallback(PrismaClient)
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
