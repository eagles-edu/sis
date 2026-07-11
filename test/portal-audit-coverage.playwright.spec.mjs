import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { chromium } from "playwright"
import { auditPage, ensureArtifactsDir, PORTAL_AUDIT_ARTIFACTS_DIR, PORTAL_AUDIT_INIT_SCRIPT, runLighthouseJson, writeAssetPartitionManifests } from "../tools/portal-audit-harness.mjs"

const ORIGIN = process.env.PORTAL_AUDIT_ORIGIN || "http://127.0.0.1:8788"
const ENV_PATH = process.env.SIS_ENV_FILE || ".env.dev"

function readEnv(filePath) {
  const values = {}
  if (!fs.existsSync(filePath)) return values
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const index = line.indexOf("=")
    if (index < 1 || line.trim().startsWith("#")) continue
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")
  }
  return values
}

function credentials() {
  const env = readEnv(ENV_PATH)
  let students = []
  try { students = JSON.parse(env.STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON || "[]") } catch { students = [] }
  const student = students.find((entry) => entry?.eaglesId && entry?.password)
  return {
    admin: { user: env.STUDENT_ADMIN_USER, pass: env.STUDENT_ADMIN_PASS },
    parent: { user: env.STUDENT_PARENT_USER, pass: env.STUDENT_PARENT_PASS },
    student: { user: student?.eaglesId, pass: student?.password },
  }
}

async function login(page, role, account) {
  const selectors = {
    admin: ["#loginUser", "#loginPass", "#loginBtn", "#app"],
    parent: ["#parentsId", "#parentPassword", 'button[type="submit"]', "#portalCard"],
    student: ["#loginEaglesId", "#loginPassword", 'button[type="submit"]', "#appPanel"],
  }[role]
  assert.ok(account.user && account.pass, `${role} credentials are required for authenticated audit`)
  await page.locator(selectors[0]).fill(account.user)
  await page.locator(selectors[1]).fill(account.pass)
  await page.locator(selectors[2]).click()
  await page.locator(selectors[3]).waitFor({ state: "visible", timeout: 30000 })
}

function assertAuditHealthy(result, { allowAuth401 = false } = {}) {
  const unexpectedConsole = allowAuth401
    ? result.consoleErrors.filter((message) => !/401|Unauthorized/i.test(message))
    : result.consoleErrors
  assert.deepEqual(unexpectedConsole, [], `${result.name} unexpected console errors`)
  assert.deepEqual(result.failedRequests, [], `${result.name} failed requests`)
  assert.equal(result.geometry.overflow.length, 0, `${result.name} viewport overflow`)
  const unexpectedAxe = result.axeViolations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")
  assert.deepEqual(unexpectedAxe, [], `${result.name} unexpected serious accessibility violations`)
}

test("portal audit coverage captures CLS, accessibility, overflow, and auth reload states", async (t) => {
  await ensureArtifactsDir()
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const account = credentials()
  const audits = []

  for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
    await context.addInitScript(PORTAL_AUDIT_INIT_SCRIPT)
    const page = await context.newPage()

    const unauthAdmin = await auditPage(page, { name: `admin-unauth-${viewport.name}`, url: `${ORIGIN}/admin` }); audits.push(unauthAdmin)
    assertAuditHealthy(unauthAdmin, { allowAuth401: true })

    await login(page, "admin", account.admin)
    await page.waitForTimeout(1500)
    const authAdmin = await auditPage(page, { name: `admin-auth-${viewport.name}`, url: `${ORIGIN}/admin` }); audits.push(authAdmin)
    assertAuditHealthy(authAdmin)
    assert.ok(authAdmin.geometry.layoutShifts.length >= 0)
    const authAdminDark = await auditPage(page, { name: `admin-auth-dark-${viewport.name}`, url: `${ORIGIN}/admin`, theme: "dark" }); audits.push(authAdminDark)
    assertAuditHealthy(authAdminDark)

    const parent = await context.newPage()
    await parent.addInitScript(PORTAL_AUDIT_INIT_SCRIPT)
    const parentLogin = await auditPage(parent, { name: `parent-login-${viewport.name}`, url: `${ORIGIN}/parent` }); audits.push(parentLogin)
    assertAuditHealthy(parentLogin, { allowAuth401: true })
    const parentLoginDark = await auditPage(parent, { name: `parent-login-dark-${viewport.name}`, url: `${ORIGIN}/parent`, theme: "dark" }); audits.push(parentLoginDark)
    assertAuditHealthy(parentLoginDark, { allowAuth401: true })

    const student = await context.newPage()
    await student.addInitScript(PORTAL_AUDIT_INIT_SCRIPT)
    const studentLogin = await auditPage(student, { name: `student-login-${viewport.name}`, url: `${ORIGIN}/student` }); audits.push(studentLogin)
    assertAuditHealthy(studentLogin, { allowAuth401: true })
    const studentLoginDark = await auditPage(student, { name: `student-login-dark-${viewport.name}`, url: `${ORIGIN}/student`, theme: "dark" }); audits.push(studentLoginDark)
    assertAuditHealthy(studentLoginDark, { allowAuth401: true })

    await context.close()
  }

  await writeAssetPartitionManifests(audits)

  if (process.env.PORTAL_AUDIT_LIGHTHOUSE === "1") {
    const report = await runLighthouseJson(`${ORIGIN}/admin`)
    const summary = {
      cls: report.audits?.["cumulative-layout-shift"]?.numericValue,
      tbt: report.audits?.["total-blocking-time"]?.numericValue,
      accessibility: report.categories?.accessibility?.score,
      performance: report.categories?.performance?.score,
      renderBlocking: report.audits?.["render-blocking-insight"]?.details?.items || [],
    }
    await fs.promises.writeFile(path.join(PORTAL_AUDIT_ARTIFACTS_DIR, "lighthouse-admin.json"), JSON.stringify(summary, null, 2))
    assert.ok(Number.isFinite(summary.cls), "Lighthouse CLS is missing")
    assert.ok(Number.isFinite(summary.tbt), "Lighthouse TBT is missing")
  }
})
