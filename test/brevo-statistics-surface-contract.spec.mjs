import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const html = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/student-admin.html"), "utf8")
const css = fs.readFileSync(path.resolve(rootDir, "web-asset/admin/student-admin.css"), "utf8")

test("Brevo statistics modal uses panel ladder surfaces and static semantic metric washes", () => {
  assert.match(html, /class="queue-modal-card brevo-statistics-modal-card"/)
  assert.match(html, /class="queue-modal-body brevo-statistics-modal-body"/)
  for (const [id, tone] of [
    ["brevoStats_requests", "blue"],
    ["brevoStats_delivered", "good"],
    ["brevoStats_softBounces", "purple"],
    ["brevoStats_hardBounces", "bad"],
    ["brevoStats_blocked", "bad"],
    ["brevoStats_spamReports", "bad"],
  ]) {
    assert.match(html, new RegExp(`stat-card stat-card--${tone} card[^>]*>[\\s\\S]*id="${id}"`))
  }
  assert.match(css, /\.brevo-statistics-modal-card\s*\{[\s\S]*background:\s*var\(--portal-surface-panel\)/)
  assert.match(css, /\.brevo-statistics-modal-body\s*\{[\s\S]*background:\s*var\(--portal-surface-panel\)/)
  assert.match(css, /html\[data-theme="dark"\][\s\S]*\.brevo-statistics-modal-card,[\s\S]*\.brevo-statistics-modal-body\s*\{[\s\S]*background:\s*var\(--portal-dark-surface-panel\)/)
  assert.match(css, /#brevoStatisticsModal \.stat-card \.stat-label\s*\{[\s\S]*font-size:\s*13px[\s\S]*font-weight:\s*800/)
  assert.match(css, /#brevoStatisticsModal \.stat-card > strong\s*\{[\s\S]*font-size:\s*clamp\([\s\S]*font-weight:\s*800/)
  assert.match(css, /html\[data-theme="dark"\][\s\S]*#brevoStatisticsModal \.stat-card \.stat-label\s*\{[\s\S]*color:\s*var\(--portal-dark-text-soft\)/)
  assert.match(css, /\.stat-card--blue\s*\{/) 
  assert.match(css, /\.stat-card--purple\s*\{/)
})
