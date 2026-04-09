#!/usr/bin/env node

import { spawn } from "node:child_process"

const DEFAULT_ORIGIN = process.env.LIGHTHOUSE_ORIGIN || "http://127.0.0.1:8788"
const SCORE_THRESHOLD = Number.parseInt(String(process.env.LIGHTHOUSE_MIN_PERF_SCORE || "90"), 10) || 90
const LIGHTHOUSE_TIMEOUT_MS =
  Number.parseInt(String(process.env.LIGHTHOUSE_TIMEOUT_MS || "240000"), 10) || 240000
const CHROME_FLAGS =
  process.env.LIGHTHOUSE_CHROME_FLAGS || "--headless=new --no-sandbox --disable-dev-shm-usage"
const LIGHTHOUSE_PRESET = String(process.env.LIGHTHOUSE_PRESET || "desktop").trim() || "desktop"

const ROUTES = [
  "/admin/students",
  "/admin/students/queue-hub",
  "/admin/students/attendance",
  "/admin/students/assignments",
  "/admin/students/grades-data",
]

function runCommand(args = [], timeoutMs = LIGHTHOUSE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })

    let stdout = ""
    let stderr = ""
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, timeoutMs)

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
    })

    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.on("close", (code) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new Error(`lighthouse command timed out after ${timeoutMs}ms`))
        return
      }
      if (code !== 0) {
        reject(new Error(`lighthouse exited with code ${code}\n${stderr || stdout}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function parseLighthouseJson(rawOutput = "") {
  const trimmed = String(rawOutput || "").trim()
  if (!trimmed) throw new Error("lighthouse output is empty")

  try {
    return JSON.parse(trimmed)
  } catch (error) {
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start < 0 || end <= start) {
      throw new Error(`unable to parse lighthouse JSON output: ${error.message}`, { cause: error })
    }
    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

function formatScore(score = 0) {
  return Number(score || 0).toFixed(1)
}

async function auditRoute(routePath = "") {
  const path = String(routePath || "")
  const url = new URL(path, DEFAULT_ORIGIN).toString()
  const args = [
    "--yes",
    "lighthouse",
    url,
    "--only-categories=performance",
    `--preset=${LIGHTHOUSE_PRESET}`,
    "--output=json",
    "--output-path=stdout",
    "--quiet",
    `--chrome-flags=${CHROME_FLAGS}`,
  ]
  const { stdout } = await runCommand(args)
  const report = parseLighthouseJson(stdout)
  const score = Number(report?.categories?.performance?.score || 0) * 100
  return {
    url,
    score,
  }
}

async function main() {
  console.log(
    `[lighthouse-admin] origin=${DEFAULT_ORIGIN} threshold=${SCORE_THRESHOLD} preset=${LIGHTHOUSE_PRESET} routes=${ROUTES.length}`,
  )

  const failures = []

  for (const route of ROUTES) {
    const result = await auditRoute(route)
    const pass = result.score >= SCORE_THRESHOLD
    console.log(
      `${pass ? "PASS" : "FAIL"} ${result.url} performance=${formatScore(result.score)} target=${SCORE_THRESHOLD}`,
    )
    if (!pass) failures.push(result)
  }

  if (failures.length) {
    const summary = failures
      .map((entry) => `${entry.url}=${formatScore(entry.score)}`)
      .join(", ")
    throw new Error(`Lighthouse performance threshold failed: ${summary}`)
  }

  console.log("[lighthouse-admin] all routes passed")
}

main().catch((error) => {
  console.error(`[lighthouse-admin] ${error.message}`)
  process.exitCode = 1
})
