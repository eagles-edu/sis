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
  const sharedTheme = readPortal("web-asset/shared/portal-theme.css")

  for (const html of [studentHtml, parentHtml]) {
    assert.match(html, /function formatQueueDateTimeTz7\(/)
    assert.match(html, /function formatQueueLatestSubmissionHtml\(/)
    assert.match(html, /queue-compact-datetime/)
    assert.match(html, /\$\{hour\}:\$\{minute\}:\$\{second\} \+7/)
  }

  assert.match(
    sharedTheme,
    /body\.(?:student|parent)-portal-page .*table\.news-queue-table td:nth-child\(3\) \.chip[\s\S]*?min-inline-size:\s*0;/i,
  )
  assert.match(
    sharedTheme,
    /body\.(?:student|parent)-portal-page .*queue-table-wrap table\.news-queue-table \.queue-row-btn[\s\S]*?min-height:\s*28px;/i,
  )
})

test("student and parent quarter tables keep late and missed status chips", () => {
  const studentHtml = readPortal("web-asset/student/student-portal.html")
  const parentHtml = readPortal("web-asset/parent/parent-portal.html")
  const sharedTheme = readPortal("web-asset/shared/portal-theme.min.css")

  for (const html of [studentHtml, parentHtml]) {
    assert.match(html, /\/\*\s*portal-critical-theme:start\s*\*\//)
    assert.match(html, /\.grade-tabulator-shell \.tabulator \.tabulator-row\.is-open \{\}/)
  }

  assert.match(sharedTheme, /body\.student-portal-page \.grade-tabulator-shell|body\.student-portal-page\.grade-tabulator-shell/)
  assert.match(sharedTheme, /body\.parent-portal-page \.grade-tabulator-shell|body\.parent-portal-page\.grade-tabulator-shell/)
  assert.match(sharedTheme, /body\.(?:student|parent)-portal-page \.grade-status-pill,/)
  assert.match(sharedTheme, /body\.(?:student|parent)-portal-page \.grade-status-pill\.is-good,/)
  assert.match(sharedTheme, /body\.(?:student|parent)-portal-page \.grade-status-pill\.is-warn,/)
  assert.match(sharedTheme, /body\.(?:student|parent)-portal-page \.grade-status-pill\.is-bad,/)
  assert.match(sharedTheme, /body\.(?:student|parent)-portal-page \.grade-status-pill\.is-late,/)
  assert.match(sharedTheme, /body\.(?:student|parent)-portal-page \.grade-status-stack,/)
  assert.match(sharedTheme, /body\.(?:student|parent)-portal-page \.grade-exercise-score,/)
  assert.match(sharedTheme, /body\.(?:student|parent)-portal-page \.grade-exercise-score\.is-open,/)
  assert.match(sharedTheme, /body\.(?:student|parent)-portal-page \.grade-exercise-score-sub,/)
  assert.match(sharedTheme, /body\.(?:student|parent)-portal-page \.grade-exercise-meta,/)
  assert.match(sharedTheme, /body\.(?:student|parent)-portal-page \.grade-exercise-comment,/)
  assert.match(sharedTheme, /tabulator-row\.is-open\{[^}]*box-shadow:inset 4px 0 0 (?:#a86400|var\(--portal-color-10fe7b83d5\))/)
  assert.match(sharedTheme, /tabulator-row\.is-completed\{[^}]*box-shadow:inset 4px 0 0 #1f7a47/)
  assert.match(sharedTheme, /tabulator-row\.is-late\{[^}]*box-shadow:inset 4px 0 0 #55389f/)
  assert.match(sharedTheme, /tabulator-row\.is-missed\{[^}]*box-shadow:inset 4px 0 0 #b23a2e/)
  assert.match(sharedTheme, /html\[data-theme="dark"\] body\.student-portal-page[\s\S]*--portal-grade-table-row-open-bg:/)
  assert.match(sharedTheme, /html\[data-theme="dark"\] body\.student-portal-page[\s\S]*--portal-grade-table-row-completed-bg:/)
  assert.match(sharedTheme, /html\[data-theme="dark"\] body\.student-portal-page[\s\S]*--portal-grade-table-row-late-bg:/)
  assert.match(sharedTheme, /html\[data-theme="dark"\] body\.student-portal-page[\s\S]*--portal-grade-table-row-missed-bg:/)
  assert.match(sharedTheme, /--portal-grade-table-row-completed-bg:color-mix\(in srgb,\s*#1f7a47 18%,var\(--portal-dark-card\) 82%\);/)
  assert.match(sharedTheme, /--portal-grade-table-row-even-bg:color-mix\(in srgb,\s*var\(--portal-dark-card\) 88%,#fff(?:fff)? 12%\);/)
  assert.match(sharedTheme, /--portal-grade-table-row-missed-bg:color-mix\(in srgb,\s*#b23a2e 18%,var\(--portal-dark-card\) 82%\);/)
  assert.doesNotMatch(sharedTheme, /color-mix\(in srgb,var\(--portal-dark-surface-(?:card|panel)\)/)
  assert.doesNotMatch(sharedTheme, /color-mix\(in srgb,#[0-9a-fA-F]{3,8} [^;]*var\(--portal-dark-surface-card\)/)
})
