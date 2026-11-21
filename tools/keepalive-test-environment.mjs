import fs from "node:fs"
import { parse as parseDotenv } from "dotenv"

import {
  buildNoExternalMessageTestEnvironment,
  OUTBOUND_MESSAGE_ENV_KEYS,
} from "./run-keepalive-nightly-smoke.mjs"

const ENVIRONMENT_CONFIGS = new Map([
  ["development:.env.dev", { environment: "dev", envFile: ".env.dev", nodeEnv: "development", databaseName: "sis_dev" }],
  ["test:.env.test", { environment: "test", envFile: ".env.test", nodeEnv: "test", databaseName: "sis-test" }],
])

/**
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {{ environment: string, envFile: string, nodeEnv: string, databaseName: string, values: NodeJS.ProcessEnv, noExternalMessagesEnforced: boolean } | null}
 */
export function readKeepaliveTestEnvironment(environment = process.env) {
  const nodeEnv = String(environment.NODE_ENV || "").trim()
  const envFile = String(environment.SIS_ENV_FILE || "").trim()
  const dotenvConfigPath = String(environment.DOTENV_CONFIG_PATH || "").trim()
  if (dotenvConfigPath !== envFile) return null

  const config = ENVIRONMENT_CONFIGS.get(`${nodeEnv}:${envFile}`)
  if (!config || !fs.existsSync(envFile)) return null

  return buildKeepaliveTestContext(environment, parseDotenv(fs.readFileSync(envFile)))
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @param {Record<string, string>} environmentFileValues
 * @returns {{ environment: string, envFile: string, nodeEnv: string, databaseName: string, values: NodeJS.ProcessEnv, noExternalMessagesEnforced: boolean } | null}
 */
export function buildKeepaliveTestContext(environment, environmentFileValues) {
  const nodeEnv = String(environment.NODE_ENV || "").trim()
  const envFile = String(environment.SIS_ENV_FILE || "").trim()
  const dotenvConfigPath = String(environment.DOTENV_CONFIG_PATH || "").trim()
  if (dotenvConfigPath !== envFile) return null

  const config = ENVIRONMENT_CONFIGS.get(`${nodeEnv}:${envFile}`)
  if (!config) return null

  const values = {
    ...environment,
    ...environmentFileValues,
    SIS_ENV_FILE: config.envFile,
    DOTENV_CONFIG_PATH: config.envFile,
    NODE_ENV: config.nodeEnv,
  }
  const noExternalMessagesEnforced = config.environment === "test"
  return {
    ...config,
    values: noExternalMessagesEnforced ? buildNoExternalMessageTestEnvironment(values) : values,
    noExternalMessagesEnforced,
  }
}

/**
 * @param {{ values: NodeJS.ProcessEnv, noExternalMessagesEnforced: boolean } | null} context
 * @param {NodeJS.ProcessEnv} [overrides]
 * @returns {boolean}
 */
export function applyKeepaliveTestEnvironment(context, overrides = {}) {
  if (!context) return false
  if (context.noExternalMessagesEnforced) {
    for (const key of OUTBOUND_MESSAGE_ENV_KEYS) delete process.env[key]
  }
  Object.assign(process.env, context.values, overrides)
  return true
}
