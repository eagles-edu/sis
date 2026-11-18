import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import { parse as parseDotenv } from "dotenv"
import {
  resolveStandardParentCredentials,
  STANDARD_PARENT_LOGIN,
} from "./helpers/standard-portal-credentials.mjs"

let chromium = null
try {
  ;({ chromium } = await import("playwright"))
} catch (error) {
  void error
}

const ENV_FILE = String(process.env.SIS_ENV_FILE || "").trim()
const ENV_VALUES = ENV_FILE && fs.existsSync(ENV_FILE)
  ? parseDotenv(fs.readFileSync(ENV_FILE))
  : {}
const RESOLVED_PARENT_CREDENTIALS = resolveStandardParentCredentials(ENV_VALUES)
const PARENT_USER = STANDARD_PARENT_LOGIN
const PARENT_PASSWORD = RESOLVED_PARENT_CREDENTIALS.pass || String(ENV_VALUES.STUDENT_PARENT_PASS || "")
const ORIGIN = String(process.env.PARENT_ACK_TEST_ORIGIN || "http://127.0.0.1:8788").trim()
const REPORT_ID = `ka093-parent-ack-retry-${Date.now()}`
const VIEWPORTS = [
  { name: "desktop", width: 1536, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]
const skipReason = !chromium
  ? "playwright package is not installed"
  : !PARENT_PASSWORD
    ? `parent ${STANDARD_PARENT_LOGIN} credentials are required from ${ENV_FILE || ".env.dev"}`
    : false

test(
  "authenticated parent acknowledgment stays pending after API failure and succeeds on retry",
  { skip: skipReason },
  async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      for (const viewport of VIEWPORTS) {
        const reportId = `${REPORT_ID}-${viewport.name}`
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        })
        try {
          const page = await context.newPage()
          let acknowledgementAttempts = 0
          let selectedEaglesId = ""
          await page.route(`${ORIGIN}/api/parent/children`, async (route) => {
            const response = await route.fetch()
            const payload = await response.json()
            selectedEaglesId = String(payload?.items?.[0]?.eaglesId || "").trim()
            await route.fulfill({ response, json: payload })
          })
          await page.route(`${ORIGIN}/api/parent/dashboard`, async (route) => {
            const response = await route.fetch()
            const payload = await response.json()
            const child = Array.isArray(payload?.children)
              ? payload.children.find((entry) => String(entry?.eaglesId || "").trim() === selectedEaglesId)
              : null
            assert.ok(child, `the exact ${STANDARD_PARENT_LOGIN} account must have a linked child`)
            const details = child.details && typeof child.details === "object" ? child.details : {}
            child.details = {
              ...details,
              reportArchive: [
                {
                  id: reportId,
                  className: "A2 Flyers",
                  schoolYear: "2026-2027",
                  quarter: "q2",
                  generatedAt: "2026-05-09T09:00:00.000Z",
                  workflowState: "published",
                  approvedAt: "2026-05-09T08:00:00.000Z",
                  comments: "Synthetic report used only in the browser response.",
                  finalArtifactVersion: 1,
                },
              ],
            }
            await route.fulfill({
              response,
              contentType: "application/json",
              body: JSON.stringify(payload),
            })
          })
          await page.route(`${ORIGIN}/api/parent/reports/${reportId}/acknowledge`, async (route) => {
            acknowledgementAttempts += 1
            if (acknowledgementAttempts === 1) {
              await route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({ error: "Temporary acknowledgement failure" }),
              })
              return
            }
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                ok: true,
                report: {
                  id: reportId,
                  metaPayload: {
                    parentReviewedAt: "2026-05-09T09:30:00.000Z",
                    parentReviewedByUsername: STANDARD_PARENT_LOGIN,
                  },
                },
              }),
            })
          })

          const portalUrl = new URL("/parent", ORIGIN)
          portalUrl.searchParams.set("apiOrigin", ORIGIN)
          await page.goto(portalUrl.toString(), { waitUntil: "domcontentloaded" })
          await page.locator("#parentsId").fill(PARENT_USER)
          await page.locator("#parentPassword").fill(PARENT_PASSWORD)
          await page.locator("#loginBtn").click()
          await page.waitForFunction(
            () => document.documentElement.dataset.parentAuthState === "authenticated",
            null,
            { timeout: 30000 },
          )
          await page.waitForFunction(
            () => !document.getElementById("portalCard")?.classList.contains("hidden"),
            null,
            { timeout: 30000 },
          )
          const consentAcknowledge = page.locator('#sisConsentPanel [data-sis-consent-action="acknowledge"]')
          if (await consentAcknowledge.isVisible().catch(() => false)) {
            await consentAcknowledge.click()
          }
          const reportRow = page.locator(`#performanceReportsList [data-report-id="${reportId}"]`)
          await reportRow.waitFor({ state: "visible", timeout: 30000 })
          await reportRow.locator(".report-archive-link").click()
          const acknowledgeButton = page.locator("#acknowledgePerformanceReportBtn")
          assert.equal(
            await acknowledgeButton.isEnabled(),
            true,
            `${viewport.name}: synthetic report should begin pending; status=${await page.locator("#performanceReportAckStatus").textContent()}`,
          )
          await acknowledgeButton.click()

          await page.getByText("Temporary acknowledgement failure", { exact: true }).waitFor({ state: "visible" })
          assert.match(
            String(await page.locator("#performanceReportAckStatus").textContent()),
            /Chờ phụ huynh xác nhận|pending/i,
            `${viewport.name}: failed acknowledgment must remain pending`,
          )
          assert.equal(await acknowledgeButton.isEnabled(), true, `${viewport.name}: failed acknowledgment must allow retry`)
          assert.equal(await reportRow.evaluate((node) => node.classList.contains("is-outstanding")), true)

          await acknowledgeButton.click()
          await page.waitForFunction(
            () => /Đã xác nhận lúc|Reviewed/i.test(document.getElementById("performanceReportAckStatus")?.textContent || ""),
            null,
            { timeout: 30000 },
          )
          assert.equal(await reportRow.evaluate((node) => node.classList.contains("is-outstanding")), false)
          assert.equal(acknowledgementAttempts, 2, `${viewport.name}: retry should issue a second acknowledgment request`)

          const layout = await page.evaluate(() => ({
            viewportWidth: document.documentElement.clientWidth,
            documentWidth: document.documentElement.scrollWidth,
            buttonPadding: getComputedStyle(document.getElementById("acknowledgePerformanceReportBtn")).paddingBlock,
          }))
          assert.equal(layout.documentWidth, layout.viewportWidth, `${viewport.name}: parent portal must not overflow horizontally`)
          assert.notEqual(layout.buttonPadding, "0px", `${viewport.name}: acknowledgment control must retain vertical padding`)
        } finally {
          await context.close()
        }
      }
    } finally {
      await browser.close()
    }
  },
)
