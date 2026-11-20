const MONITOR_ENVIRONMENTS = Object.freeze({
  development: Object.freeze({
    label: "dev",
    envFile: ".env.dev",
    origin: "http://127.0.0.1:8788",
    databaseName: "sis_dev",
  }),
  test: Object.freeze({
    label: "test",
    envFile: ".env.test",
    origin: "http://127.0.0.1:8786",
    databaseName: "sis-test",
  }),
})

export function resolveKeepaliveMonitorEnvironment(environment = process.env) {
  const nodeEnvironment = String(environment.NODE_ENV || "").trim()
  const context = MONITOR_ENVIRONMENTS[nodeEnvironment]
  const envFile = String(environment.SIS_ENV_FILE || "").trim()
  const dotenvConfigPath = String(environment.DOTENV_CONFIG_PATH || "").trim()
  if (!context || envFile !== context.envFile || dotenvConfigPath !== context.envFile) {
    throw new Error("Keep-alive monitors require a matching explicit dev or test environment")
  }
  return context
}

export async function assertKeepaliveMonitorDatabase(prisma, context) {
  const rows = await prisma.$queryRawUnsafe("SELECT current_database() AS name")
  if (String(rows?.[0]?.name || "") !== context.databaseName) {
    throw new Error("Keep-alive monitor database identity mismatch")
  }
  return true
}
