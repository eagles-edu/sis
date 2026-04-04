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

  assert.match(chunk, /if \(status === "approved"\) return \{ label: "Approved", tone: "good" \};/)
  assert.match(chunk, /if \(status === "revision-requested"\) return \{ label: "Revise", tone: "revise" \};/)
  assert.match(
    chunk,
    /if \(status === "submitted" && item\?\.awaitingReReview === true\)\s*return \{ label: "Waiting", tone: "revise" \};/
  )
  assert.match(chunk, /if \(status === "submitted"\) return \{ label: "Submitted", tone: "warn" \};/)
  assert.doesNotMatch(chunk, /return \{ label: "Waiting", tone: "warn" \};/)
})
