import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

function readPortal(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8")
}

function extractChunk(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  assert.notEqual(end, -1, `missing marker: ${endMarker}`)
  return source.slice(start, end)
}

test("student modal chip mapper follows chips.md contract", () => {
  const html = readPortal("web-asset/student/student-portal.html")
  const chunk = extractChunk(
    html,
    "function newsViewerItemStatusChipModel(item = {}) {",
    "function setNewsViewerStatusChip(item = {}) {"
  )

  assert.match(chunk, /if \(status === "approved"\) return \{\s*label: "Approved",\s*tone: "good"\s*\};/)
  assert.match(chunk, /if \(status === "revision-requested"\) return \{\s*label: "Revise",\s*tone: "revise"\s*\};/)
  assert.match(
    chunk,
    /if \(status === "submitted" && item\?\.awaitingReReview === true\)\s*return \{\s*label: "Waiting",\s*tone: "revise"\s*\};/
  )
  assert.match(chunk, /if \(status === "submitted"\) return \{\s*label: "Submitted",\s*tone: "warn"\s*\};/)
  assert.doesNotMatch(chunk, /return \{ label: "Waiting", tone: "warn" \};/)
})

test("parent modal chip mapper follows chips.md contract", () => {
  const html = readPortal("web-asset/parent/parent-portal.html")
  const chunk = extractChunk(
    html,
    "function newsViewerItemStatusChipModel(item = {}) {",
    "function setNewsViewerStatusChip(item = {}) {"
  )

  assert.match(chunk, /if \(status === "approved"\) return \{\s*label: "Đã duyệt",\s*tone: "good"\s*\};/)
  assert.match(chunk, /if \(status === "revision-requested"\) return \{\s*label: "Cần sửa",\s*tone: "revise"\s*\};/)
  assert.match(
    chunk,
    /if \(status === "submitted" && item\?\.awaitingReReview === true\)\s*return \{\s*label: "Chờ duyệt",\s*tone: "revise"\s*\};/
  )
  assert.match(chunk, /if \(status === "submitted"\) return \{\s*label: "Đã nộp",\s*tone: "warn"\s*\};/)
  assert.doesNotMatch(chunk, /return \{ label: "Chờ duyệt", tone: "warn" \};/)
})

test("student and parent queue headers follow compact parity contract", () => {
  const studentHtml = readPortal("web-asset/student/student-portal.html")
  const parentHtml = readPortal("web-asset/parent/parent-portal.html")

  const studentQueueTable = extractChunk(studentHtml, '<table class="news-queue-table">', "</table>")
  const parentQueueTable = extractChunk(parentHtml, '<table class="news-queue-table">', "</table>")

  assert.match(
    studentQueueTable,
    /<th scope="col">Week Set<\/th>[\s\S]*?<th scope="col">#<\/th>[\s\S]*?<th scope="col">Status<\/th>[\s\S]*?<th scope="col">Latest Submission<\/th>[\s\S]*?<th scope="col">Open<\/th>/,
  )
  assert.match(
    parentQueueTable,
    /<th scope="col">Tuần báo cáo<\/th>[\s\S]*?<th scope="col">#<\/th>[\s\S]*?<th scope="col">Tình trạng<\/th>[\s\S]*?<th scope="col">Nộp gần nhất<\/th>[\s\S]*?<th scope="col">Mở<\/th>/,
  )
  for (const queueTable of [studentQueueTable, parentQueueTable]) {
    assert.doesNotMatch(queueTable, /<th scope="col">Student<\/th>/)
    assert.doesNotMatch(queueTable, /<th scope="col">Level<\/th>/)
    assert.doesNotMatch(queueTable, /<th scope="col">Reports<\/th>/)
  }
})

test("student and parent queue compact chip/button and datetime helpers stay aligned", () => {
  const studentHtml = readPortal("web-asset/student/student-portal.html")
  const parentHtml = readPortal("web-asset/parent/parent-portal.html")

  for (const html of [studentHtml, parentHtml]) {
    assert.match(html, /function formatQueueDateTimeTz7\(/)
    assert.match(html, /function formatQueueLatestSubmissionHtml\(/)
    assert.match(html, /queue-compact-datetime/)
    assert.match(html, /\$\{hour\}:\$\{minute\}:\$\{second\} \+7/)
    assert.match(html, /table\.news-queue-table td:nth-child\(3\) \.chip[\s\S]*?min-inline-size:\s*0;/i)
    assert.match(html, /table\.news-queue-table \.queue-row-btn[\s\S]*?min-height:\s*28px;/i)
  }
})

test("student and parent quarter tables keep late and missed status chips", () => {
  const studentHtml = readPortal("web-asset/student/student-portal.html")
  const parentHtml = readPortal("web-asset/parent/parent-portal.html")
  const sharedTheme = readPortal("web-asset/shared/portal-theme.min.css")

  for (const html of [studentHtml, parentHtml]) {
    assert.doesNotMatch(html, /\.grade-status-pill\s*\{/)
    assert.doesNotMatch(html, /\.grade-status-pill\.is-good\s*\{/)
    assert.doesNotMatch(html, /\.grade-status-pill\.is-warn\s*\{/)
    assert.doesNotMatch(html, /\.grade-status-pill\.is-bad\s*\{/)
    assert.doesNotMatch(html, /\.grade-status-pill\.is-late\s*\{/)
    assert.doesNotMatch(html, /\.grade-status-stack\s*\{/)
    assert.doesNotMatch(html, /\.grade-exercise-score\s*\{/)
    assert.doesNotMatch(html, /\.grade-exercise-score\.is-open\s*\{/)
    assert.doesNotMatch(html, /\.grade-exercise-score-sub\s*\{/)
    assert.doesNotMatch(html, /\.grade-exercise-meta\s*\{/)
    assert.doesNotMatch(html, /\.grade-exercise-comment\s*\{/)
    assert.doesNotMatch(html, /\.grade-tabulator-shell \.tabulator \.tabulator-row\.is-open[\s\S]*?box-shadow:\s*inset 4px 0 0 #a86400;/)
    assert.doesNotMatch(html, /html\[data-theme="dark"\] \.grade-tabulator-shell \.tabulator \.tabulator-row\.is-open/)
  }

  assert.match(sharedTheme, /body\.student-portal-page \.grade-tabulator-shell|body\.student-portal-page\.grade-tabulator-shell/)
  assert.match(sharedTheme, /body\.parent-portal-page \.grade-tabulator-shell|body\.parent-portal-page\.grade-tabulator-shell/)
  assert.match(sharedTheme, /\.grade-status-pill,[^}]*\.grade-status-pill\.is-late[^}]*\{[^}]*color:var\(--portal-status-revise-text\)/)
  assert.match(sharedTheme, /\.grade-status-pill\.is-good[^}]*\{[^}]*background:var\(--ok\);[^}]*color:var\(--portal-primary-text-strong\)/)
  assert.match(sharedTheme, /\.grade-status-pill\.is-warn[^}]*\{[^}]*background:var\(--warn\);[^}]*color:var\(--portal-primary-text-strong\)/)
  assert.match(sharedTheme, /\.grade-status-pill\.is-bad[^}]*\{[^}]*background:var\(--err\);[^}]*color:var\(--portal-primary-text-strong\)/)
  assert.match(sharedTheme, /\.grade-status-pill\.is-late[^}]*\{[^}]*background:var\(--portal-status-revise-bg\);[^}]*color:var\(--portal-status-revise-text\)/)
  assert.match(sharedTheme, /\.grade-exercise-score[^}]*\{[^}]*background:var\(--portal-status-good-bg\);[^}]*border:1px solid var\(--portal-status-good-border\);[^}]*color:var\(--portal-status-good-text\)/)
  assert.match(sharedTheme, /\.grade-exercise-score\.is-open[^}]*\{[^}]*background:var\(--portal-surface-support\);[^}]*color:var\(--portal-grade-table-text\)/)
  assert.match(sharedTheme, /\.grade-exercise-score-sub[^}]*\{[^}]*font-size:\.72rem/)
  assert.match(sharedTheme, /\.grade-exercise-meta[^}]*\{[^}]*overflow-wrap:anywhere/)
  assert.match(sharedTheme, /\.grade-exercise-comment[^}]*\{[^}]*overflow-wrap:anywhere/)
  assert.match(sharedTheme, /tabulator-row\.is-open\{[^}]*box-shadow:inset 4px 0 0 #a86400/)
  assert.match(sharedTheme, /tabulator-row\.is-completed\{[^}]*box-shadow:inset 4px 0 0 #1f7a47/)
  assert.match(sharedTheme, /tabulator-row\.is-late\{[^}]*box-shadow:inset 4px 0 0 #55389f/)
  assert.match(sharedTheme, /tabulator-row\.is-missed\{[^}]*box-shadow:inset 4px 0 0 #b23a2e/)
  assert.match(sharedTheme, /html\[data-theme="dark"\] body\.student-portal-page[\s\S]*--portal-grade-table-row-open-bg:/)
  assert.match(sharedTheme, /html\[data-theme="dark"\] body\.student-portal-page[\s\S]*--portal-grade-table-row-completed-bg:/)
  assert.match(sharedTheme, /html\[data-theme="dark"\] body\.student-portal-page[\s\S]*--portal-grade-table-row-late-bg:/)
  assert.match(sharedTheme, /html\[data-theme="dark"\] body\.student-portal-page[\s\S]*--portal-grade-table-row-missed-bg:/)
})
