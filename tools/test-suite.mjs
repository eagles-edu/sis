import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT_DIR = process.cwd()
const TEST_DIR = path.resolve(ROOT_DIR, "test")

function isPlaywrightTest(fileName) {
  return fileName.endsWith(".playwright.spec.mjs")
}

function listTestFiles() {
  return fs
    .readdirSync(TEST_DIR)
    .filter((fileName) => fileName.endsWith(".spec.mjs"))
    .map((fileName) => path.join("test", fileName))
    .sort()
}

function buildFileList(mode) {
  const allFiles = listTestFiles()
  if (mode === "core") {
    return allFiles.filter((filePath) => !isPlaywrightTest(path.basename(filePath)))
  }
  if (mode === "playwright") {
    return allFiles.filter((filePath) => isPlaywrightTest(path.basename(filePath)))
  }
  if (mode === "dev") {
    return allFiles.filter((filePath) => !isPlaywrightTest(path.basename(filePath)))
  }
  return allFiles
}

const mode = (process.argv[2] || "all").trim()
if (!["all", "core", "dev", "playwright"].includes(mode)) {
  console.error(`usage: node tools/test-suite.mjs [all|core|dev|playwright] [--from <number>]`)
  process.exit(2)
}

const fromArgumentIndex = process.argv.indexOf("--from")
const positionalFrom = process.argv[3] && !process.argv[3].startsWith("-") ? process.argv[3] : ""
const fromText = fromArgumentIndex >= 0 ? process.argv[fromArgumentIndex + 1] : positionalFrom
const fromPosition = fromText ? Number.parseInt(fromText, 10) : 1
if (!Number.isInteger(fromPosition) || fromPosition < 1) {
  console.error(`usage: node tools/test-suite.mjs [all|core|dev|playwright] [--from <number>]`)
  process.exit(2)
}

const allFiles = buildFileList(mode)
if (fromPosition > allFiles.length) {
  console.error(`test start position ${fromPosition} is outside the ${allFiles.length}-file ${mode} suite`)
  process.exit(2)
}
const files = allFiles.slice(fromPosition - 1)
const DEFAULT_FILE_TIMEOUT_MS = 300000
const FILE_TIMEOUT_OVERRIDES = new Map([
  ["test/student-admin-ui.spec.mjs", 600000],
  ["test/portal-site-review.playwright.spec.mjs", 900000],
])

function resolveFileTimeoutMs(filePath) {
  const envTimeoutMs = Number.parseInt(process.env.SIS_TEST_FILE_TIMEOUT_MS || "", 10)
  if (Number.isFinite(envTimeoutMs) && envTimeoutMs > 0) {
    return envTimeoutMs
  }
  return FILE_TIMEOUT_OVERRIDES.get(filePath) || DEFAULT_FILE_TIMEOUT_MS
}

let exitCode = 0
for (const [index, filePath] of files.entries()) {
  const position = `${index + fromPosition}/${allFiles.length}`
  const fileTimeoutMs = resolveFileTimeoutMs(filePath)
  console.log(`[test-suite:${mode}] ${position} start ${filePath}`)
  const result = spawnSync(process.execPath, ["--test", filePath], {
    stdio: "inherit",
    env: process.env,
    timeout: fileTimeoutMs,
    killSignal: "SIGTERM",
  })
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      exitCode = 124
      console.error(
        `[test-suite:${mode}] ${position} timed out after ${fileTimeoutMs}ms ${filePath}`,
      )
      break
    }
    throw result.error
  }
  if (result.status !== 0) {
    exitCode = result.status ?? 1
    console.error(`[test-suite:${mode}] ${position} failed ${filePath} (exit ${exitCode})`)
    break
  }
  console.log(`[test-suite:${mode}] ${position} done ${filePath}`)
}

process.exit(exitCode)
