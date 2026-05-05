import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const ROOT_DIR = process.cwd()

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8")
}

function sliceBetween(source, startPattern, endPattern, label) {
  const start = source.indexOf(startPattern)
  assert.ok(start >= 0, `${label}: missing start marker`)
  const end = source.indexOf(endPattern, start)
  assert.ok(end >= 0, `${label}: missing end marker`)
  return source.slice(start, end)
}

function assertIncludesAll(source, tokens, label) {
  for (const token of tokens) {
    assert.ok(source.includes(token), `${label}: missing ${token}`)
  }
}

function assertExcludesAll(source, tokens, label) {
  for (const token of tokens) {
    assert.ok(!source.includes(token), `${label}: still contains ${token}`)
  }
}

test("student-admin uses shared theme tokens for chart and support surfaces", () => {
  const source = readFile("web-asset/admin/student-admin.css")
  assertIncludesAll(
    source,
    [
      "var(--portal-data-label)",
      "var(--portal-support-message)",
      "var(--portal-chart-axis-label)",
      "var(--portal-chart-surface)",
      "var(--portal-chart-surface-soft)",
    ],
    "student-admin.css",
  )
})

test("student-points chart render uses shared portal tokens", () => {
  const source = readFile("web-asset/admin/student-points.html")
  assert.ok(
    source.includes('<link rel="stylesheet" href="/web-asset/shared/portal-theme.css">'),
    "student-points.html should load portal-theme.css",
  )
  const chartBlock = sliceBetween(
    source,
    "function renderChart(summary = {}) {",
    "function renderStudents(rows = []) {",
    "student-points.html renderChart",
  )
  assertIncludesAll(
    chartBlock,
    [
      "var(--portal-chart-axis-label)",
      "var(--portal-border)",
      "var(--tertiary-color)",
    ],
    "student-points.html renderChart",
  )
  assertExcludesAll(
    chartBlock,
    [
      "#5f7088",
      "#e1ebf8",
      "#cfe0f3",
      "#0d66c2",
    ],
    "student-points.html renderChart",
  )
})

test("grades-tabulator chart render uses shared portal tokens", () => {
  const source = readFile("web-asset/admin/grades-tabulator.html")
  assert.ok(
    source.includes('<link rel="stylesheet" href="/web-asset/shared/portal-theme.css">'),
    "grades-tabulator.html should load portal-theme.css",
  )
  const sparklineBlock = sliceBetween(
    source,
    "function buildDistributionSparklineSvg(entries = []) {",
    "function distributionModalElements() {",
    "grades-tabulator.html buildDistributionSparklineSvg",
  )
  assertIncludesAll(
    sparklineBlock,
    ["var(--accent)", "var(--line)"],
    "grades-tabulator.html buildDistributionSparklineSvg",
  )
  assertExcludesAll(
    sparklineBlock,
    [
      "#1d5ea0",
      "#2f75bc",
      "#d7e3f6",
    ],
    "grades-tabulator.html buildDistributionSparklineSvg",
  )
})
