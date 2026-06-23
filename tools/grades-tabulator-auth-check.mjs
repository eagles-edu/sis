#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import dotenv from "dotenv"
import { chromium } from "playwright"

dotenv.config({ path: path.resolve(process.cwd(), ".env.dev") })

const ORIGIN = process.env.PW_ORIGIN || process.env.EXERCISE_MAILER_ORIGIN || "http://127.0.0.1:8788"
const ADMIN_USER = process.env.STUDENT_ADMIN_USER || "admin"
const ADMIN_PASS = process.env.STUDENT_ADMIN_PASS || ""
const OUTPUT_DIR = path.resolve(process.cwd(), "output/playwright")
const SCREENSHOT_PATH = path.resolve(OUTPUT_DIR, `grades-tabulator-auth-${Date.now()}.png`)

function fail(message) {
  console.error(message)
  process.exit(1)
}

async function loginAdmin(page, origin) {
  if (!ADMIN_USER || !ADMIN_PASS) {
    fail("Missing admin credentials. Set STUDENT_ADMIN_USER and STUDENT_ADMIN_PASS in .env.dev.")
  }

  const response = await fetch(new URL("/api/admin/auth/login", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    fail(`Admin login failed with ${response.status}${body ? `: ${body}` : ""}`)
  }

  const setCookie = response.headers.get("set-cookie") || ""
  const match = setCookie.match(/^student_admin_sid=([^;]+)/i)
  if (!match) {
    fail("Admin login succeeded but no student_admin_sid cookie was returned.")
  }

  await page.context().addCookies([
    {
      name: "student_admin_sid",
      value: match[1],
      url: origin,
    },
  ])
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1120 } })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.setDefaultNavigationTimeout(30000)

  await loginAdmin(page, ORIGIN)

  const targetUrl = new URL("/web-asset/admin/grades-tabulator.html", ORIGIN)
  targetUrl.searchParams.set("apiOrigin", ORIGIN)
  await page.goto(targetUrl.toString(), { waitUntil: "domcontentloaded" })

  await page.waitForFunction(() => {
    const status = document.getElementById("statusLine")?.textContent || ""
    const cells = document.querySelectorAll(".exercise-cell")
    return cells.length > 0 && !/Login required/i.test(status)
  }, undefined, { timeout: 30000 })

  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true })

  const summary = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll(".exercise-cell"))
    const sample = cells[0] || null
    const modalExpand = document.getElementById("distributionModalExpand")
    const resetColumns = document.getElementById("resetColumnsBtn")
    return {
      title: document.title,
      url: location.href,
      status: document.getElementById("statusLine")?.textContent || "",
      cellCount: cells.length,
      sampleText: sample?.textContent?.trim() || "",
      sampleClasses: sample ? Array.from(sample.classList) : [],
      resetText: resetColumns?.textContent?.trim() || "",
      resetColor: resetColumns ? getComputedStyle(resetColumns).color : "",
      resetBackground: resetColumns ? getComputedStyle(resetColumns).backgroundColor : "",
      modalText: modalExpand?.textContent?.trim() || "",
      modalLabel: modalExpand?.getAttribute("aria-label") || "",
    }
  })

  console.log(JSON.stringify({ origin: ORIGIN, screenshotPath: SCREENSHOT_PATH, summary }, null, 2))
  await browser.close()
}

await main().catch((error) => {
  console.error(error)
  process.exit(1)
})
