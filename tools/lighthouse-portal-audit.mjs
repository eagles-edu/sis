#!/usr/bin/env node
// @ts-check

import { spawn } from "node:child_process"
import process from "node:process"

const ORIGIN = String(process.env.LIGHTHOUSE_ORIGIN || "https://test.eagles.edu.vn").replace(/\/$/u, "")
const THRESHOLD = Number.parseInt(String(process.env.LIGHTHOUSE_MIN_PERF_SCORE || "100"), 10) || 100
const PRESET = String(process.env.LIGHTHOUSE_PRESET || "desktop").trim() || "desktop"
const TIMEOUT_MS = Number.parseInt(String(process.env.LIGHTHOUSE_TIMEOUT_MS || "240000"), 10) || 240000
const CHROME_FLAGS = process.env.LIGHTHOUSE_CHROME_FLAGS || "--headless=new --no-sandbox --disable-dev-shm-usage"
const ROUTES = String(process.env.LIGHTHOUSE_ROUTES || "/admin,/parent,/student").split(",").map((route) => route.trim()).filter(Boolean)

function runLighthouse(url) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "lighthouse", url, "--only-categories=performance", `--preset=${PRESET}`, "--output=json", "--output-path=stdout", "--quiet", `--chrome-flags=${CHROME_FLAGS}`], { stdio: ["ignore", "pipe", "pipe"], env: process.env })
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
        resolve(Number(report.categories?.performance?.score || 0) * 100)
      } catch (error) {
        reject(new Error(`invalid Lighthouse JSON: ${error instanceof Error ? error.message : String(error)}`))
      }
    })
  })
}

async function main() {
  if (!ROUTES.length) throw new Error("LIGHTHOUSE_ROUTES must contain at least one route")
  console.log(`[lighthouse-portals] origin=${ORIGIN} threshold=${THRESHOLD} preset=${PRESET} routes=${ROUTES.length}`)
  const failures = []
  for (const route of ROUTES) {
    const url = new URL(route, `${ORIGIN}/`).toString()
    const score = await runLighthouse(url)
    const passed = score >= THRESHOLD
    console.log(`${passed ? "PASS" : "FAIL"} ${url} performance=${score.toFixed(1)} target=${THRESHOLD}`)
    if (!passed) failures.push(`${url}=${score.toFixed(1)}`)
  }
  if (failures.length) throw new Error(`Lighthouse performance threshold failed: ${failures.join(", ")}`)
  console.log("[lighthouse-portals] all portal routes passed")
}

main().catch((error) => {
  console.error(`[lighthouse-portals] ${error.message}`)
  process.exitCode = 1
})
