const expectedNodeEnvironmentByFile = new Map([
  [".env.dev", "development"],
  [".env.test", "test"],
  [".env", "production"],
])

export function assertPrismaEnvironment() {
  const sisEnvironmentFile = String(process.env.SIS_ENV_FILE || "").trim()
  const dotenvConfigPath = String(process.env.DOTENV_CONFIG_PATH || "").trim()
  const nodeEnvironment = String(process.env.NODE_ENV || "").trim()
  const expectedNodeEnvironment = expectedNodeEnvironmentByFile.get(sisEnvironmentFile)

  if (
    !expectedNodeEnvironment ||
    dotenvConfigPath !== sisEnvironmentFile ||
    nodeEnvironment !== expectedNodeEnvironment
  ) {
    console.error(
      "Refusing database-backed test execution: set SIS_ENV_FILE and DOTENV_CONFIG_PATH to the same owned file, with its matching NODE_ENV (.env.dev/development, .env.test/test, or .env/production).",
    )
    process.exit(2)
  }
}

assertPrismaEnvironment()
