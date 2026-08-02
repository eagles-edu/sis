import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const html = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/student-admin.html"), "utf8")
const css = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/student-admin.css"), "utf8")

test("Brevo statistics modal reuses Today Snapshot stat-card surfaces", () => {
  assert.match(html, /class="queue-modal-card"/)
  assert.match(html, /class="queue-modal-body"/)
  assert.doesNotMatch(html, /brevo-statistics-modal-(?:card|body)/)
  for (const [id, tone] of [
    ["brevoStats_requests", "blue"],
    ["brevoStats_delivered", "good"],
    ["brevoStats_opens", "good"],
    ["brevoStats_uniqueOpens", "good"],
    ["brevoStats_clicks", "good"],
    ["brevoStats_uniqueClicks", "good"],
    ["brevoStats_softBounces", "warn"],
    ["brevoStats_hardBounces", "bad"],
    ["brevoStats_blocked", "bad"],
    ["brevoStats_spamReports", "bad"],
  ]) {
    assert.match(html, new RegExp(`stat-card stat-card--${tone} card[^>]*>[\\s\\S]*id="${id}"`))
  }
  assert.doesNotMatch(css, /brevo-statistics-modal-(?:card|body)/)
  assert.doesNotMatch(css, /#brevoStatisticsModal \.stat-card/)
  assert.match(css, /\.stat-card\s*\{[\s\S]*--stat-card-label:/)
  assert.match(css, /\.stat-card--blue\s*\{/)
  assert.match(css, /\.stat-card--good\s*\{/)
  assert.match(css, /\.stat-card--warn\s*\{/)
})
