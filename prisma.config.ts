/// <reference types="node" />

import fs from "node:fs"
import path from "node:path"
import dotenv from "dotenv"
import { defineConfig } from "prisma/config"

const explicitEnvPath = String(process.env.DOTENV_CONFIG_PATH || "").trim()
const sisEnvPath = String(process.env.SIS_ENV_FILE || "").trim()
if (!explicitEnvPath || !sisEnvPath) {
  throw new Error("Prisma environment is fail-closed: set SIS_ENV_FILE and DOTENV_CONFIG_PATH to the same environment file (.env.dev, .env.test, or .env).")
}

const resolvedExplicitEnvPath = path.resolve(process.cwd(), explicitEnvPath)
const resolvedSisEnvPath = path.resolve(process.cwd(), sisEnvPath)
if (resolvedExplicitEnvPath !== resolvedSisEnvPath) {
  throw new Error(`Prisma environment mismatch: SIS_ENV_FILE=${sisEnvPath} and DOTENV_CONFIG_PATH=${explicitEnvPath} must identify the same file.`)
}
const environmentFileName = path.basename(resolvedExplicitEnvPath)
const expectedNodeEnvironment = { ".env.dev": "development", ".env.test": "test", ".env": "production" }[environmentFileName]
if (!expectedNodeEnvironment) {
  throw new Error(`Unsupported Prisma environment file: ${environmentFileName}. Use only .env.dev, .env.test, or .env.`)
}
const nodeEnvironment = String(process.env.NODE_ENV || "").trim()
if (nodeEnvironment !== expectedNodeEnvironment) {
  throw new Error(`Prisma environment mismatch: NODE_ENV=${nodeEnvironment || "<missing>"} requires ${expectedNodeEnvironment} for ${environmentFileName}.`)
}
if (!fs.existsSync(resolvedExplicitEnvPath)) {
  throw new Error(`Prisma environment file not found: ${resolvedExplicitEnvPath}`)
}
const loaded = dotenv.config({ path: resolvedExplicitEnvPath, override: false })
if (loaded.error) throw loaded.error

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
})
