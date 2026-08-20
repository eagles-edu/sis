import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import test from "node:test"

const config = fs.readFileSync("prisma.config.ts", "utf8")
const agents = fs.readFileSync("AGENTS.md", "utf8")
const sop = fs.readFileSync("docs/sop.md", "utf8")

test("Prisma environment loading is explicit and fail-closed", () => {
  assert.doesNotMatch(config, /dotenv\/config/u)
  assert.match(config, /DOTENV_CONFIG_PATH/u)
  assert.match(config, /SIS_ENV_FILE/u)
  assert.match(config, /must identify the same file/u)
  assert.match(config, /expectedNodeEnvironment/u)
  assert.match(config, /Use only \.env\.dev, \.env\.test, or \.env/u)
  assert.match(agents, /every Prisma command must receive `SIS_ENV_FILE` and `DOTENV_CONFIG_PATH`/u)
  assert.match(sop, /`prisma\.config\.ts` rejects missing, mismatched, unsupported, or cross-environment values/u)
})

test("Prisma refuses absent or mismatched environment selectors", () => {
  const missing = { ...process.env }
  delete missing.SIS_ENV_FILE
  delete missing.DOTENV_CONFIG_PATH
  delete missing.NODE_ENV
  const missingResult = spawnSync("npx", ["prisma", "migrate", "status"], { cwd: process.cwd(), env: missing, encoding: "utf8" })
  assert.notEqual(missingResult.status, 0)
  assert.match(`${missingResult.stdout}${missingResult.stderr}`, /Prisma environment is fail-closed/u)

  const mismatched = { ...process.env, SIS_ENV_FILE: ".env.dev", DOTENV_CONFIG_PATH: ".env.test", NODE_ENV: "test" }
  const mismatchedResult = spawnSync("npx", ["prisma", "migrate", "status"], { cwd: process.cwd(), env: mismatched, encoding: "utf8" })
  assert.notEqual(mismatchedResult.status, 0)
  assert.match(`${mismatchedResult.stdout}${mismatchedResult.stderr}`, /Prisma environment mismatch/u)
})
