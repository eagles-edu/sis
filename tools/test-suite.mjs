import fs from "node:fs"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"

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
const summaryMode = process.argv.includes("--summary")
if (!["all", "core", "dev", "playwright"].includes(mode)) {
  console.error(
    `usage: node tools/test-suite.mjs [all|core|dev|playwright] [--from <number>] [--summary]`,
  )
  process.exit(2)
}

const fromArgumentIndex = process.argv.indexOf("--from")
const positionalFrom = process.argv[3] && !process.argv[3].startsWith("-") ? process.argv[3] : ""
const fromText = fromArgumentIndex >= 0 ? process.argv[fromArgumentIndex + 1] : positionalFrom
const fromPosition = fromText ? Number.parseInt(fromText, 10) : 1
if (!Number.isInteger(fromPosition) || fromPosition < 1) {
  console.error(
    `usage: node tools/test-suite.mjs [all|core|dev|playwright] [--from <number>] [--summary]`,
  )
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

function createSummaryFormatter(fileNumber, emit) {
  let buffer = ""
  let testNumber = 0
  let omittedInputLines = 0
  let skippingInput = false
  const useColor = !process.env.NO_COLOR
  const color = (code, text) => useColor ? `\u001b[${code}m${text}\u001b[0m` : text
  const processLine = (line) => {
    const trimmed = line.trim()
    if (skippingInput) {
      if (/^(expected|actual|operator|stack):|^at\s|^✖|^ℹ/.test(trimmed)) {
        emit(`  [omitted ${omittedInputLines} large input line(s)]`)
        skippingInput = false
        omittedInputLines = 0
      } else {
        omittedInputLines += 1
        return
      }
    }
    if (/(?:^|\s)(Input|Actual):\s*$/.test(trimmed)) {
      emit(color(33, line))
      skippingInput = true
      return
    }
    if (trimmed.startsWith("✔ ") || trimmed.startsWith("✖ ")) {
      testNumber += 1
      const mark = trimmed.startsWith("✔ ") ? "✔" : "✖"
      emit(color(mark === "✔" ? 32 : 31, `${fileNumber}.${testNumber} ${trimmed}`))
      return
    }
    if (trimmed.startsWith("ℹ ")) {
      emit(color(36, line))
      return
    }
    emit(line.length > 1200
      ? `${line.slice(0, 1200)} … [truncated ${line.length - 1200} characters]`
      : line)
  }
  return {
    feed(chunk) {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ""
      for (const line of lines) processLine(line)
    },
    finish() {
      if (buffer) processLine(buffer)
      if (skippingInput) emit(`  [omitted ${omittedInputLines} large input line(s)]`)
    },
  }
}

let exitCode = 0
if (summaryMode) {
  console.log(`[test-suite:${mode}:summary] running ${files.length} file(s)`)
  const interactiveProgress = Boolean(process.stdout.isTTY)
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  for (const [index, filePath] of files.entries()) {
    const position = `${index + fromPosition}/${allFiles.length}`
    const fileTimeoutMs = resolveFileTimeoutMs(filePath)
    const testArguments = ["--test", "--test-reporter=spec", filePath]
    let spinnerIndex = 0
    let spinner = null
    const clearSpinner = () => {
      if (spinner) process.stdout.write("\r\x1b[2K")
    }
    const writeSpinner = () => {
      process.stdout.write(`\r[test-suite:${mode}:summary] ${position} ${spinnerFrames[spinnerIndex]} ${filePath}`)
    }
    const setRunning = (running) => {
      if (!interactiveProgress) return
      if (running) {
        writeSpinner()
        spinner = setInterval(() => {
          spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length
          writeSpinner()
        }, 120)
      } else if (spinner) {
        clearInterval(spinner)
        spinner = null
        clearSpinner()
      }
    }
    if (!interactiveProgress) console.log(`[test-suite:${mode}:summary] ${position} running ${filePath}`)
    const formatter = createSummaryFormatter(index + fromPosition, (line) => {
      clearSpinner()
      process.stdout.write(`${line}\n`)
      if (spinner) writeSpinner()
    })
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, testArguments, {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      })
      let stdout = ""
      let stderr = ""
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        setRunning(false)
        resolve(value)
      }
      const timeout = setTimeout(() => {
        child.kill("SIGTERM")
        finish({ error: { code: "ETIMEDOUT" }, status: null, stdout, stderr })
      }, fileTimeoutMs)
      child.stdout.setEncoding("utf8")
      child.stderr.setEncoding("utf8")
      child.stdout.on("data", (chunk) => {
        stdout += chunk
        formatter.feed(chunk)
      })
      child.stderr.on("data", (chunk) => {
        stderr += chunk
        formatter.feed(chunk)
      })
      child.on("error", (error) => finish({ error, status: null, stdout, stderr }))
      child.on("close", (status) => finish({ status, stdout, stderr }))
      setRunning(true)
    })
    formatter.finish()
    if (result.error) {
      if (result.error.code === "ETIMEDOUT") {
        exitCode = 124
        console.error(`[test-suite:${mode}:summary] ${position} timed out after ${fileTimeoutMs}ms ${filePath}`)
        break
      }
      throw result.error
    }
    if (result.status !== 0) {
      exitCode = result.status ?? 1
      console.error(`[test-suite:${mode}:summary] ${position} failed ${filePath} (exit ${exitCode})`)
      break
    }
    console.log(`[test-suite:${mode}:summary] ${position} finished ${filePath}`)
  }
  process.exit(exitCode)
}

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
      console.error(`[test-suite:${mode}] ${position} timed out after ${fileTimeoutMs}ms ${filePath}`)
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
