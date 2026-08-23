import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
const migration = fs.readFileSync(new URL("../prisma/migrations/20260726110000_allow_multiple_student_news_reports_per_day/migration.sql", import.meta.url), "utf8")
const submissions = fs.readFileSync(new URL("../src/modules/admin/student-news-submissions.mjs", import.meta.url), "utf8")
const fallback = fs.readFileSync(new URL("../src/modules/admin/student-news-fallback.mjs", import.meta.url), "utf8")
const studentJs = fs.readFileSync(new URL("../web-asset/student/student-portal.js", import.meta.url), "utf8")
const studentHtml = fs.readFileSync(new URL("../web-asset/student/student-portal.html", import.meta.url), "utf8")

test("student news schema permits independent same-day report instances", () => {
  assert.match(schema, /reportSequence\s+Int\s+@default\(1\)/)
  assert.match(schema, /@@unique\(\[studentRefId, reportDate, reportSequence\]\)/)
  assert.match(migration, /DROP INDEX IF EXISTS "StudentNewsReport_studentRefId_reportDate_key"/)
  assert.match(migration, /StudentNewsReport_studentRefId_reportDate_reportSequence_key/)
  assert.match(submissions, /reportId: normalizeText\(payload\?\.reportId\)/)
  assert.match(submissions, /nextStudentNewsReportSequence\(/)
  assert.match(submissions, /studentNewsReport\.create\(/)
  assert.match(submissions, /where: \{ id: existingId \}/)
  assert.match(fallback, /reportSequence: Math\.max\(1, Number\(entry\?\.reportSequence\) \|\| 1\)/)
  assert.match(fallback, /sequence:\$\{normalized\.reportSequence\}/)
})

test("student Check feedback follows the codified field-order directive", () => {
  assert.match(studentJs, /11\/12\. Sentence review/)
  assert.match(studentJs, /Review errors under 11 and\/or 12 in the report\./)
  assert.match(studentHtml, /id="newsSentenceFeedback-actionWhy"/)
  assert.match(studentHtml, /id="newsSentenceFeedback-biasAssessment"/)
  assert.match(studentHtml, /id="newsSentenceFeedback-newsViewerActionWhy"/)
  assert.match(studentHtml, /id="newsSentenceFeedback-newsViewerBiasAssessment"/)
  assert.match(studentJs, /viewerItem: true/)
  assert.match(studentJs, /loadStudentData\(\{\s*preserveValidation: true,\s*preserveForm: options\?\.viewerItem === true,\s*\}\)/)
  assert.match(studentJs, /loadStudentData\(\{ preserveForm: true, preserveValidation: true \}\)/)
  assert.match(studentJs, /openNewsWeekSetModalByReportId\(t\(payload\?\.reportId\)/)
})

test("student report persistence keeps report identity and exact syllabication", () => {
  assert.match(studentJs, /reportId: t\(state\.newsReportId\)/)
  assert.match(studentJs, /reportSequence: Number\(state\.newsReportSequence\) \|\| null/)
  assert.match(studentJs, /function normalizeSyllabication\(value\) \{[\s\S]*\.normalize\("NFC"\)[\s\S]*replace\(\[?\/\[\\p\{Pd\}/)
  assert.match(studentJs, /if \(options\?\.preserveForm !== true\)/)
  assert.match(studentJs, /Object\.prototype\.hasOwnProperty\.call\(report, fieldId\)/)
})
