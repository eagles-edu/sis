#!/usr/bin/env node
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

import { globSync } from "glob"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function isRedisAuthError(error) {
  const message = normalizeText(error?.message || error).toLowerCase()
  if (!message) return false
  return (
    message.includes("noauth") ||
    message.includes("wrongpass") ||
    message.includes("authentication required") ||
    message.includes("auth failed") ||
    message.includes("invalid username-password pair")
  )
}

function formatError(error) {
  const message = normalizeText(error?.message || error)
  if (!message) return "unknown error"
  return message
}

async function loadEnvFile() {
  const envFile = normalizeText(process.env.SIS_ENV_FILE || process.env.DOTENV_CONFIG_PATH) || ".env"
  const resolvedPath = path.resolve(envFile)
  const envFileExists = await fs
    .access(resolvedPath)
    .then(() => true)
    .catch(() => false)

  if (!envFileExists) return { envFile, loaded: false }

  const dotenv = await import("dotenv")
  const result = dotenv.config({ path: resolvedPath })
  if (result.error) {
    throw new Error(`Unable to load env file ${envFile}: ${formatError(result.error)}`)
  }

  return { envFile, loaded: true }
}

async function preflightRedis(redisUrl, connectTimeoutMs = 1200) {
  const { createClient } = await import("redis")
  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: connectTimeoutMs,
      reconnectStrategy() {
        return false
      },
    },
  })

  try {
    await client.connect()
    await client.ping()
  } finally {
    try {
      if (typeof client.quit === "function") {
        await client.quit()
      } else if (typeof client.disconnect === "function") {
        client.disconnect()
      }
    } catch (error) {
      void error
      if (typeof client.disconnect === "function") {
        try {
          client.disconnect()
        } catch (disconnectError) {
          void disconnectError
        }
      }
    }
  }
}

async function main() {
  const { envFile, loaded } = await loadEnvFile()
  const redisUrl = normalizeText(process.env.REDIS_SESSION_URL) || normalizeText(process.env.REDIS_URL)

  if (!redisUrl) {
    console.error(
      `test:redis requires REDIS_SESSION_URL or REDIS_URL in the environment${loaded ? ` or ${envFile}` : ""}.`,
    )
    process.exit(1)
  }

  try {
    await preflightRedis(redisUrl)
  } catch (error) {
    if (isRedisAuthError(error)) {
      console.error(
        `Redis authentication failed before running test:redis using ${loaded ? envFile : "the environment"}: ${formatError(error)}`,
      )
      console.error(
        "Set REDIS_SESSION_URL to an authenticated URL, for example redis://:PASSWORD@127.0.0.1:6379/0",
      )
    } else {
      console.error(
        `Redis preflight failed before running test:redis using ${loaded ? envFile : "the environment"}: ${formatError(error)}`,
      )
    }
    process.exit(1)
  }

  const specFiles = globSync("test/*.spec.mjs", {
    absolute: false,
    nodir: true,
  })

  if (!specFiles.length) {
    console.error("test:redis could not find any test/*.spec.mjs files.")
    process.exit(1)
  }

  const env = {
    ...process.env,
    STUDENT_ADMIN_SESSION_DRIVER: "redis",
    STUDENT_ADMIN_SESSION_REDIS_CONNECT_TIMEOUT_MS:
      normalizeText(process.env.STUDENT_ADMIN_SESSION_REDIS_CONNECT_TIMEOUT_MS) || "1200",
    REDIS_SESSION_URL: redisUrl,
    NODE_ENV: normalizeText(process.env.NODE_ENV) || "test",
  }

  const child = spawn(process.execPath, ["--test", ...specFiles], {
    env,
    stdio: "inherit",
  })

  const suiteTimeoutMs = 10 * 60 * 1000
  const timeout = setTimeout(() => {
    child.kill("SIGTERM")
  }, suiteTimeoutMs)

  child.on("error", (error) => {
    clearTimeout(timeout)
    console.error(`test:redis failed to start: ${formatError(error)}`)
    process.exit(1)
  })

  child.on("exit", (code, signal) => {
    clearTimeout(timeout)
    if (signal) {
      process.exit(signal === "SIGTERM" ? 124 : 1)
    }
    process.exit(code ?? 1)
  })
}

main().catch((error) => {
  console.error(`test:redis failed: ${formatError(error)}`)
  process.exit(1)
})
