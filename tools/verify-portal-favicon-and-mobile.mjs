#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index]
  if (!value.startsWith("--")) continue
  args.set(value, process.argv[index + 1]?.startsWith("--") ? "" : process.argv[++index] || "")
}

const repoRoot = path.resolve(args.get("--repo-root") || process.cwd())
const runtimeRoot = args.get("--runtime-root") ? path.resolve(args.get("--runtime-root")) : ""
const publicRoot = args.get("--public-root") ? path.resolve(args.get("--public-root")) : ""
const origin = args.get("--origin") || ""

const portalPages = [
  "web-asset/admin/portal-hub.html",
  "web-asset/admin/student-admin.html",
  "web-asset/admin/grades-tabulator.html",
  "web-asset/admin/student-enrollment.html",
  "web-asset/admin/report-card.html",
  "web-asset/parent/parent-portal.html",
  "web-asset/student/student-portal.html",
]
const faviconFiles = ["favicon.ico", "favicon.png", "favicon.svg"]
const faviconUrls = faviconFiles.map((file) => `/web-asset/images/${file}?=v2`)
const mobileWidths = [320, 360, 375, 390, 430, 639]
const failures = []

function fail(message) {
  failures.push(message)
}

function assertFile(root, relativePath, label) {
  const target = path.join(root, relativePath)
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) fail(`${label} missing ${target}`)
}

for (const page of portalPages) {
  const sourcePath = path.join(repoRoot, page)
  if (!fs.existsSync(sourcePath)) {
    fail(`repo portal page missing ${sourcePath}`)
    continue
  }
  const html = fs.readFileSync(sourcePath, "utf8")
  for (const url of faviconUrls) {
    if (!html.includes(`href="${url}"`)) fail(`${page} missing favicon reference ${url}`)
  }
}

for (const file of faviconFiles) assertFile(repoRoot, `web-asset/images/${file}`, "repo favicon")
if (runtimeRoot) for (const file of faviconFiles) assertFile(runtimeRoot, `web-asset/images/${file}`, "runtime favicon")
if (publicRoot) {
  for (const file of faviconFiles) assertFile(publicRoot, `web-asset/images/${file}`, "public favicon")
  for (const file of faviconFiles) assertFile(publicRoot, file, "public root favicon")
}

if (origin) {
  const { chromium } = await import("playwright")
  const browser = await chromium.launch({ headless: true })
  try {
    for (const route of ["/", "/admin", "/parent", "/student"]) {
      for (const width of mobileWidths) {
        const page = await browser.newPage({ viewport: { width, height: 844 } })
        const failedRequests = []
        page.on("requestfailed", (request) => failedRequests.push(request.url()))
        try {
          await page.goto(String(new URL(route, origin)), { waitUntil: "networkidle" })
          const geometry = await page.evaluate(() => ({
            viewport: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
          }))
          if (geometry.viewport !== width || geometry.documentWidth > width + 1) {
            fail(`${route} overflows at ${width}px: ${JSON.stringify(geometry)}`)
          }
          for (const url of faviconUrls) {
            const response = await page.context().request.get(String(new URL(url, origin)))
            if (!response.ok()) fail(`${route} favicon ${url} returned ${response.status()}`)
          }
          if (failedRequests.length) fail(`${route} failed requests: ${failedRequests.join(", ")}`)
        } catch (error) {
          fail(`${route} browser check failed at ${width}px: ${error.message}`)
        } finally {
          await page.close()
        }
      }
    }
  } finally {
    await browser.close()
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`[favicon-mobile] ${failure}`)
  process.exit(1)
}

console.log(`[favicon-mobile] passed: ${portalPages.length} portal pages, ${faviconFiles.join(", ")} parity, 320px checks${origin ? ` on ${origin}` : ""}`)
