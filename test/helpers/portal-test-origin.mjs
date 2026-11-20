const ENVIRONMENTS = Object.freeze({
  development: {
    file: ".env.dev",
    localOrigin: "http://127.0.0.1:8788",
    allowedOverrides: new Set(["http://127.0.0.1:8788"]),
  },
  test: {
    file: ".env.test",
    localOrigin: "http://127.0.0.1:8786",
    allowedOverrides: new Set(["http://127.0.0.1:8786", "https://test.eagles.edu.vn"]),
  },
})

export function resolvePortalTestOrigin({ environment = process.env, overrideName = "" } = {}) {
  const nodeEnvironment = String(environment.NODE_ENV || "").trim()
  const ownedEnvironment = ENVIRONMENTS[nodeEnvironment]
  const envFile = String(environment.SIS_ENV_FILE || "").trim()
  const dotenvConfigPath = String(environment.DOTENV_CONFIG_PATH || "").trim()
  if (!ownedEnvironment || envFile !== ownedEnvironment.file || dotenvConfigPath !== ownedEnvironment.file) {
    throw new Error("Portal browser tests require a matching explicit dev or test environment")
  }

  const override = overrideName ? String(environment[overrideName] || "").trim() : ""
  if (!override) return ownedEnvironment.localOrigin
  let normalized
  try {
    normalized = new URL(override).origin
  } catch {
    throw new Error("Portal browser test origin is invalid")
  }
  if (!ownedEnvironment.allowedOverrides.has(normalized)) {
    throw new Error("Portal browser test origin does not belong to the selected environment")
  }
  return normalized
}
