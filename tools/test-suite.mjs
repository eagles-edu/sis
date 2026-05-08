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
  console.error(`usage: node tools/test-suite.mjs [all|core|dev|playwright]`)
  process.exit(2)
}

const files = buildFileList(mode)
const fileTimeoutMs = Number.parseInt(process.env.SIS_TEST_FILE_TIMEOUT_MS || "180000", 10)
let exitCode = 0
for (const [index, filePath] of files.entries()) {
  const position = `${index + 1}/${files.length}`
  console.log(`[test-suite:${mode}] ${position} start ${filePath}`)
  const result = spawnSync(process.execPath, ["--test", filePath], {
    stdio: "inherit",
    env: process.env,
    timeout: Number.isFinite(fileTimeoutMs) && fileTimeoutMs > 0 ? fileTimeoutMs : 180000,
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
