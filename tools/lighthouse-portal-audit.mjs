#!/usr/bin/env node
// @ts-check

import { spawn } from "node:child_process"
import process from "node:process"

const ORIGIN = String(process.env.LIGHTHOUSE_ORIGIN || "https://test.eagles.edu.vn").replace(/\/$/u, "")
const THRESHOLD = Number.parseInt(String(process.env.LIGHTHOUSE_MIN_PERF_SCORE || "100"), 10) || 100
const BEST_PRACTICES_THRESHOLD = Number.parseInt(String(process.env.LIGHTHOUSE_MIN_BEST_PRACTICES_SCORE || "100"), 10) || 100
const PRESET = String(process.env.LIGHTHOUSE_PRESET || "desktop").trim() || "desktop"
const TIMEOUT_MS = Number.parseInt(String(process.env.LIGHTHOUSE_TIMEOUT_MS || "240000"), 10) || 240000
const CHROME_FLAGS = process.env.LIGHTHOUSE_CHROME_FLAGS || "--headless=new --no-sandbox --disable-dev-shm-usage"
const ROUTES = String(process.env.LIGHTHOUSE_ROUTES || "/admin,/parent,/student").split(",").map((route) => route.trim()).filter(Boolean)

function runLighthouse(url) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "lighthouse", url, "--only-categories=performance,best-practices", `--preset=${PRESET}`, "--output=json", "--output-path=stdout", "--quiet", `--chrome-flags=${CHROME_FLAGS}`], { stdio: ["ignore", "pipe", "pipe"], env: process.env })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM") }, TIMEOUT_MS)
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8") })
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
    child.on("error", (error) => { clearTimeout(timer); reject(error) })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error(`timed out after ${TIMEOUT_MS}ms`))
      if (code !== 0) return reject(new Error(`lighthouse exited with code ${code}\n${stderr || stdout}`))
      try {
        const report = JSON.parse(stdout.trim())
        resolve({
          performance: Number(report.categories?.performance?.score || 0) * 100,
          bestPractices: Number(report.categories?.["best-practices"]?.score || 0) * 100,
        })
      } catch (error) {
        reject(new Error(`invalid Lighthouse JSON: ${error instanceof Error ? error.message : String(error)}`))
      }
    })
  })
}

async function main() {
  if (!ROUTES.length) throw new Error("LIGHTHOUSE_ROUTES must contain at least one route")
  console.log(`[lighthouse-portals] origin=${ORIGIN} performance-threshold=${THRESHOLD} best-practices-threshold=${BEST_PRACTICES_THRESHOLD} preset=${PRESET} routes=${ROUTES.length} clean-profile=default`)
  const failures = []
  for (const route of ROUTES) {
    const url = new URL(route, `${ORIGIN}/`).toString()
    const scores = await runLighthouse(url)
    const passed = scores.performance >= THRESHOLD && scores.bestPractices >= BEST_PRACTICES_THRESHOLD
    console.log(`${passed ? "PASS" : "FAIL"} ${url} performance=${scores.performance.toFixed(1)} target=${THRESHOLD} best-practices=${scores.bestPractices.toFixed(1)} target=${BEST_PRACTICES_THRESHOLD}`)
    if (!passed) failures.push(`${url}=performance:${scores.performance.toFixed(1)},best-practices:${scores.bestPractices.toFixed(1)}`)
  }
  if (failures.length) throw new Error(`Lighthouse portal thresholds failed: ${failures.join(", ")}`)
  console.log("[lighthouse-portals] all portal routes passed")
}

main().catch((error) => {
  console.error(`[lighthouse-portals] ${error.message}`)
  process.exitCode = 1
})
