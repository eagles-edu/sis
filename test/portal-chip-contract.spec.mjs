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

  assert.match(chunk, /if \(status === "approved"\) return \{ label: "Approved", tone: "good" \};/)
  assert.match(chunk, /if \(status === "revision-requested"\) return \{ label: "Revise", tone: "revise" \};/)
  assert.match(
    chunk,
    /if \(status === "submitted" && item\?\.awaitingReReview === true\)\s*return \{ label: "Waiting", tone: "revise" \};/
  )
  assert.match(chunk, /if \(status === "submitted"\) return \{ label: "Submitted", tone: "warn" \};/)
  assert.doesNotMatch(chunk, /return \{ label: "Waiting", tone: "warn" \};/)
})

test("parent modal chip mapper follows chips.md contract", () => {
  const html = readPortal("web-asset/parent/parent-portal.html")
  const chunk = extractChunk(
    html,
    "function newsViewerItemStatusChipModel(item = {}) {",
    "function setNewsViewerStatusChip(item = {}) {"
  )

  assert.match(chunk, /if \(status === "approved"\) return \{ label: "Đã duyệt", tone: "good" \};/)
  assert.match(chunk, /if \(status === "revision-requested"\) return \{ label: "Cần sửa", tone: "revise" \};/)
  assert.match(
    chunk,
    /if \(status === "submitted" && item\?\.awaitingReReview === true\)\s*return \{ label: "Chờ duyệt", tone: "revise" \};/
  )
  assert.match(chunk, /if \(status === "submitted"\) return \{ label: "Đã nộp", tone: "warn" \};/)
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
    /<th scope="col">Tuần báo cáo<\/th>[\s\S]*?<th scope="col">#<\/th>[\s\S]*?<th scope="col">Trạng thái<\/th>[\s\S]*?<th scope="col">Nộp gần nhất<\/th>[\s\S]*?<th scope="col">Mở<\/th>/,
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
