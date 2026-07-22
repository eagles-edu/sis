import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const ROOT = process.cwd()

function read(relPath) {
  return fs.readFileSync(path.resolve(ROOT, relPath), "utf8")
}

function readPortalAssets(htmlPath, jsPath) {
  return `${read(htmlPath)}\n${read(jsPath)}`
}

const serverRoutes = read("server/student-admin-routes.mjs")
const reportCardPdf = read("server/student-report-card-pdf.mjs")
const parentPortal = readPortalAssets("web-asset/parent/parent-portal.html", "web-asset/parent/parent-portal.js")
const studentPortal = readPortalAssets("web-asset/student/student-portal.html", "web-asset/student/student-portal.js")
const adminScript = read("web-asset/admin/student-admin.js")

test("date-input pages declare Vietnam locale for native controls", () => {
  for (const relPath of [
    "web-asset/admin/student-admin.html",
    "web-asset/admin/grades-tabulator.html",
    "web-asset/admin/student-points.html",
    "web-asset/student/student-portal.html",
    "web-asset/parent/parent-portal.html",
  ]) {
    assert.match(read(relPath), /^<html lang="vi(?:-VN)?">/m)
  }
})

test("portal date helpers use VN dd/mm/yy display", () => {
  assert.match(
    serverRoutes,
    /function formatPortalDate\(value = ""\)[\s\S]*?new Intl\.DateTimeFormat\("vi-VN",\s*\{\s*day: "2-digit",\s*month: "2-digit",\s*year: "2-digit"/,
  )
  assert.match(
    parentPortal,
    /function formatPortalDate\(value\)[\s\S]*?new Intl\.DateTimeFormat\("vi-VN",\s*\{\s*day: "2-digit",\s*month: "2-digit",\s*year: "2-digit"/,
  )
  assert.match(
    parentPortal,
    /function formatPortalDateTime\(value\)[\s\S]*?return `\$\{day\}\/\$\{month\}\/\$\{year\} \$\{hour\}:\$\{minute\}:\$\{second\} \+07`/,
  )
  assert.match(
    studentPortal,
    /function formatPortalDate\(value\)[\s\S]*?new Intl\.DateTimeFormat\("vi-VN",\s*\{\s*day: "2-digit",\s*month: "2-digit",\s*year: "2-digit"/,
  )
  assert.match(
    studentPortal,
    /function formatPortalDateTime\(value\)[\s\S]*?return `\$\{day\}\/\$\{month\}\/\$\{year\} \$\{hour\}:\$\{minute\}:\$\{second\} \+07`/,
  )
  assert.match(
    adminScript,
    /function formatDate\(value\)[\s\S]*?new Intl\.DateTimeFormat\("vi-VN",\s*\{\s*day: "2-digit",\s*month: "2-digit",\s*year: "2-digit"/,
  )
  assert.match(
    adminScript,
    /function formatDateTime\(value\)[\s\S]*?return `\$\{day\}\/\$\{month\}\/\$\{year\} \$\{hour\}:\$\{minute\}:\$\{second\} \+07`/,
  )
  assert.match(
    reportCardPdf,
    /new Intl\.DateTimeFormat\("vi-VN",\s*\{\s*day: "2-digit",\s*month: "2-digit",\s*year: "2-digit"/,
  )
  assert.match(
    reportCardPdf,
    /return `\$\{day\}\/\$\{month\}\/\$\{year\}`/,
  )
  assert.match(parentPortal, /placeholder: "ví dụ: 17\/03\/11"/)
  assert.match(adminScript, /ví dụ: 17\/03\/11/)
})

test("sample VN date formatting is dd/mm/yy", () => {
  const sampleDate = new Date("2011-03-17T00:00:00+07:00")
  assert.equal(
    new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(sampleDate),
    "17/03/11",
  )

  const sampleDateTime = new Date("2011-03-17T14:05:06+07:00")
  const parts = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  }).formatToParts(sampleDateTime)
  const pick = (type) => parts.find((entry) => entry.type === type)?.value || ""
  assert.equal(
    `${pick("day")}/${pick("month")}/${pick("year")} ${pick("hour")}:${pick("minute")}:${pick("second")}`,
    "17/03/11 14:05:06",
  )
})
