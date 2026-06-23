#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import process from "node:process"

let chromium = null
try {
  ({ chromium } = await import("playwright"))
} catch (error) {
  void error
}

const ROOT_DIR = process.cwd()
const OUTPUT_DIR = path.resolve(ROOT_DIR, "output/playwright")
const DEFAULT_ORIGIN = process.env.PW_ORIGIN || "http://127.0.0.1:8788"
const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_WAIT_MS = 1500
const DEFAULT_THEME = "light"

const CHROMIUM_EXECUTABLE_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean)

const ROLE_CONFIG = {
  admin: {
    defaultUser: process.env.STUDENT_ADMIN_USER || "admin",
    defaultPassword: process.env.STUDENT_ADMIN_PASS || "3825u2z",
    endpoint: "/api/admin/auth/login",
    cookieName: "student_admin_sid",
    cookieWaitPattern: /^student_admin_sid=([^;]+)/i,
    buildPayload(username, password) {
      return { username, password }
    },
    buildPath(pageSlug = "") {
      return pageSlug ? `/admin/${encodeURIComponent(pageSlug)}` : "/admin"
    },
    async waitForReady(page, timeoutMs) {
      await page.waitForFunction(() => {
        const app = globalThis.document.getElementById("app")
        return Boolean(app && !app.classList.contains("hidden"))
      }, undefined, { timeout: timeoutMs })
    },
  },
  parent: {
    defaultUser: process.env.STUDENT_PARENT_USER || "cmkramer001",
    defaultPassword: process.env.STUDENT_PARENT_PASS || "P1k@ch00",
    endpoint: "/api/parent/auth/login",
    cookieName: "parent_portal_sid",
    cookieWaitPattern: /^parent_portal_sid=([^;]+)/i,
    buildPayload(username, password) {
      return { parentsId: username, password }
    },
    buildPath() {
      return "/parent"
    },
    async waitForReady(page, timeoutMs) {
      await page.waitForFunction(() => {
        const root = globalThis.document.getElementById("portalCard")
        return Boolean(root && !root.classList.contains("hidden"))
      }, undefined, { timeout: timeoutMs })
    },
  },
  student: {
    defaultUser: process.env.STUDENT_STUDENT_USER || "kramer001",
    defaultPassword: process.env.STUDENT_STUDENT_PASS || "P1k@ch00",
    endpoint: "/api/student/auth/login",
    cookieName: "student_portal_sid",
    cookieWaitPattern: /^student_portal_sid=([^;]+)/i,
    buildPayload(username, password) {
      return { eaglesId: username, password }
    },
    buildPath() {
      return "/student"
    },
    async waitForReady(page, timeoutMs) {
      await page.waitForFunction(() => {
        const root = globalThis.document.getElementById("appPanel")
        return Boolean(root && !root.classList.contains("hidden"))
      }, undefined, { timeout: timeoutMs })
    },
  },
}

function usage() {
  console.log(`Usage:
  node tools/playwright-portal-flow.mjs [options]

Options:
  --role <admin|parent|student>   Portal role to automate. Default: admin
  --origin <url>                  Runtime origin. Default: ${DEFAULT_ORIGIN}
  --username <value>              Login username / parentsId / eaglesId
  --password <value>              Login password
  --page <slug>                   Admin page slug, for example: student-admin
  --path <path>                   Explicit path to open after login
  --theme <light|dark>            Local storage theme before page load. Default: ${DEFAULT_THEME}
  --headed                        Run with visible browser UI
  --trace                         Save Playwright trace zip
  --screenshot <name>             Screenshot file name inside output/playwright/
  --storage-state <name>          Storage state JSON file name inside output/playwright/
  --wait-ms <number>              Extra wait after page ready. Default: ${DEFAULT_WAIT_MS}
  --timeout-ms <number>           Navigation / ready timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --help                          Show this help
`)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function normalizeText(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function normalizeRole(value) {
  const role = normalizeText(value).toLowerCase()
  return role && ROLE_CONFIG[role] ? role : ""
}

function normalizeTheme(value) {
  return normalizeText(value).toLowerCase() === "dark" ? "dark" : "light"
}

function parseInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value || ""), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackValue
}

function parseArgs(argv) {
  const options = {
    headed: false,
    trace: false,
    role: "admin",
    origin: DEFAULT_ORIGIN,
    username: "",
    password: "",
    page: "",
    path: "",
    theme: DEFAULT_THEME,
    screenshot: "",
    storageState: "",
    waitMs: DEFAULT_WAIT_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === "--help") {
      usage()
      process.exit(0)
    }
    if (token === "--headed") {
      options.headed = true
      continue
    }
    if (token === "--trace") {
      options.trace = true
      continue
    }

    const nextValue = argv[index + 1]
    if (token === "--role") {
      options.role = normalizeRole(nextValue) || options.role
      index += 1
      continue
    }
    if (token === "--origin") {
      options.origin = normalizeText(nextValue) || options.origin
      index += 1
      continue
    }
    if (token === "--username") {
      options.username = normalizeText(nextValue)
      index += 1
      continue
    }
    if (token === "--password") {
      options.password = normalizeText(nextValue)
      index += 1
      continue
    }
    if (token === "--page") {
      options.page = normalizeText(nextValue)
      index += 1
      continue
    }
    if (token === "--path") {
      options.path = normalizeText(nextValue)
      index += 1
      continue
    }
    if (token === "--theme") {
      options.theme = normalizeTheme(nextValue)
      index += 1
      continue
    }
    if (token === "--screenshot") {
      options.screenshot = normalizeText(nextValue)
      index += 1
      continue
    }
    if (token === "--storage-state") {
      options.storageState = normalizeText(nextValue)
      index += 1
      continue
    }
    if (token === "--wait-ms") {
      options.waitMs = parseInteger(nextValue, DEFAULT_WAIT_MS)
      index += 1
      continue
    }
    if (token === "--timeout-ms") {
      options.timeoutMs = parseInteger(nextValue, DEFAULT_TIMEOUT_MS)
      index += 1
      continue
    }

    fail(`Unknown argument: ${token}`)
  }

  if (!ROLE_CONFIG[options.role]) {
    fail(`Unsupported role: ${options.role}`)
  }

  return options
}

function resolveChromiumExecutablePath() {
  if (!chromium) return ""
  try {
    const bundledPath = chromium.executablePath()
    if (bundledPath && fs.existsSync(bundledPath)) return bundledPath
  } catch (error) {
    void error
  }

  for (const candidatePath of CHROMIUM_EXECUTABLE_CANDIDATES) {
    if (fs.existsSync(candidatePath)) return candidatePath
  }

  return ""
}

function buildArtifactName(prefix, extension) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `${prefix}-${timestamp}.${extension}`
}

function resolveOutputPath(fileName, fallbackPrefix, extension) {
  const chosen = normalizeText(fileName) || buildArtifactName(fallbackPrefix, extension)
  return path.resolve(OUTPUT_DIR, chosen)
}

function installThemeInitScript(context, theme) {
  return context.addInitScript((themeValue) => {
    try {
      globalThis.localStorage.setItem("sis-theme", themeValue)
    } catch (error) {
      void error
    }
  }, theme)
}

async function checkRuntimeHealth(origin) {
  try {
    const response = await fetch(new URL("/healthz", origin), { redirect: "follow" })
    if (!response.ok) {
      console.warn(`[warn] healthz returned ${response.status} for ${origin}`)
      return
    }
    const text = await response.text()
    console.log(`[healthz] ${text.trim() || "ok"}`)
  } catch (error) {
    console.warn(`[warn] healthz check failed for ${origin}: ${error.message}`)
  }
}

async function loginAndAttachCookie(page, origin, options) {
  const roleConfig = ROLE_CONFIG[options.role]
  const username = options.username || roleConfig.defaultUser
  const password = options.password || roleConfig.defaultPassword
  if (!username || !password) {
    fail(`Missing credentials for role ${options.role}. Pass --username and --password.`)
  }

  let response = null
  let lastBody = ""
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(new URL(roleConfig.endpoint, origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(roleConfig.buildPayload(username, password)),
    })
    if (response.ok) break
    lastBody = await response.text().catch(() => "")
    if (![502, 503, 504].includes(response.status)) break
    await page.waitForTimeout(250 * (attempt + 1))
  }

  if (!response || !response.ok) {
    fail(
      `Login failed for ${options.role} at ${origin}: ${response?.status || "unknown"}${lastBody ? ` ${lastBody}` : ""}`,
    )
  }

  const setCookie = response.headers.get("set-cookie") || ""
  const match = setCookie.match(roleConfig.cookieWaitPattern)
  if (!match) {
    fail(`Login succeeded but no ${roleConfig.cookieName} cookie was returned.`)
  }

  await page.context().addCookies([
    {
      name: roleConfig.cookieName,
      value: match[1],
      url: origin,
    },
  ])
}

function buildDestinationUrl(origin, options) {
  const targetUrl = new URL(options.path || ROLE_CONFIG[options.role].buildPath(options.page), origin)
  if (!options.path) {
    targetUrl.searchParams.set("apiOrigin", origin)
  }
  return targetUrl.toString()
}

async function writeRunMetadata(metadata) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const metadataPath = resolveOutputPath("", `${metadata.role}-run`, "json")
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))
  return metadataPath
}

const options = parseArgs(process.argv.slice(2))
if (!chromium) {
  fail("playwright is not installed in this repo")
}

const executablePath = resolveChromiumExecutablePath()
const browser = await chromium.launch({
  headless: !options.headed,
  ...(executablePath ? { executablePath } : {}),
})

let context = null
try {
  await checkRuntimeHealth(options.origin)
  context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 960 },
  })
  await installThemeInitScript(context, options.theme)

  if (options.trace) {
    await context.tracing.start({ screenshots: true, snapshots: true })
  }

  const page = await context.newPage()
  page.setDefaultTimeout(options.timeoutMs)
  page.setDefaultNavigationTimeout(options.timeoutMs)

  await loginAndAttachCookie(page, options.origin, options)
  const destinationUrl = buildDestinationUrl(options.origin, options)
  console.log(`[open] ${destinationUrl}`)
  await page.goto(destinationUrl, { waitUntil: "domcontentloaded" })
  await ROLE_CONFIG[options.role].waitForReady(page, options.timeoutMs)

  if (options.waitMs > 0) {
    await page.waitForTimeout(options.waitMs)
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const screenshotPath = resolveOutputPath(
    options.screenshot,
    `${options.role}-${options.page || "home"}`,
    "png",
  )
  await page.screenshot({ path: screenshotPath, fullPage: true })

  let storageStatePath = ""
  if (options.storageState) {
    storageStatePath = resolveOutputPath(
      options.storageState,
      `${options.role}-storage-state`,
      "json",
    )
    await context.storageState({ path: storageStatePath })
  }

  let tracePath = ""
  if (options.trace) {
    tracePath = resolveOutputPath("", `${options.role}-trace`, "zip")
    await context.tracing.stop({ path: tracePath })
  }

  const metadataPath = await writeRunMetadata({
    role: options.role,
    origin: options.origin,
    destinationUrl,
    pageTitle: await page.title(),
    finalUrl: page.url(),
    screenshotPath,
    storageStatePath,
    tracePath,
    theme: options.theme,
    headed: options.headed,
    capturedAt: new Date().toISOString(),
  })

  console.log(`[ok] role=${options.role}`)
  console.log(`[ok] title=${await page.title()}`)
  console.log(`[ok] url=${page.url()}`)
  if (screenshotPath) console.log(`[artifact] screenshot=${screenshotPath}`)
  if (storageStatePath) console.log(`[artifact] storageState=${storageStatePath}`)
  if (tracePath) console.log(`[artifact] trace=${tracePath}`)
  console.log(`[artifact] metadata=${metadataPath}`)
} finally {
  if (context && options.trace) {
    try {
      await context.tracing.stop()
    } catch (error) {
      void error
    }
  }
  await browser.close()
}
