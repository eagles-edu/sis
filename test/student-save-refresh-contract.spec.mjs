import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import test from "node:test"

const source = fs.readFileSync(new URL("../web-asset/admin/student-admin.js", import.meta.url), "utf8")
const saveStudent = source.slice(source.indexOf("async function saveStudent()"), source.indexOf("let pendingDeleteStudentConfirmation"))
const setProfileMode = source.slice(source.indexOf("function setProfileMode("), source.indexOf("function setProfileLayoutStatus("))
const loadFamilyIds = source.slice(source.indexOf("async function loadFamilyIds("), source.indexOf("async function loadFilters("))
const renderProfileFormLayout = source.slice(source.indexOf("function renderProfileFormLayout("), source.indexOf("function profileFormSectionSubtitle("))
const loadStudents = source.slice(source.indexOf("async function loadStudents("), source.indexOf("async function clearTopControls("))
const liveNameSearch = source.slice(source.indexOf("const liveNameSearch ="), source.indexOf('bindById("searchQ"'))
const adminHtml = fs.readFileSync(new URL("../web-asset/admin/student-admin.html", import.meta.url), "utf8")
const adminMinCss = fs.readFileSync(new URL("../web-asset/admin/student-admin.min.css", import.meta.url), "utf8")
const adminMinJs = fs.readFileSync(new URL("../web-asset/admin/student-admin.min.js", import.meta.url), "utf8")

function assetVersion(content) {
  return `sha256-${crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)}`
}

test("student save avoids unrelated admin refreshes", () => {
  assert.match(saveStudent, /refreshRelated:\s*false/)
  assert.doesNotMatch(saveStudent, /await loadFilters\(\)/)
  assert.doesNotMatch(saveStudent, /loadStudentDetail\(/)
  assert.doesNotMatch(saveStudent, /await loadStudents\(/)
  assert.match(saveStudent, /setProfileMode\("info"\)[\s\S]*void loadStudents\(/)
  assert.match(saveStudent, /if \(state\.studentSaveBusy\) return/)
})

test("student detail hydration does not recurse through profile mode", () => {
  assert.doesNotMatch(setProfileMode, /fillStudentForm\(/)
  assert.doesNotMatch(loadFamilyIds, /fillStudentForm\(/)
  assert.match(loadFamilyIds, /profileInputHasValue/)
  assert.match(renderProfileFormLayout, /preservedValues\.forEach/)
})

test("admin application asset URLs change with generated content", () => {
  const cssVersion = assetVersion(adminMinCss)
  const jsVersion = assetVersion(adminMinJs)
  assert.equal(adminHtml.match(new RegExp(`student-admin\\.min\\.css\\?v=${cssVersion}`, "g"))?.length, 2)
  assert.equal(adminHtml.match(new RegExp(`student-admin\\.min\\.js\\?v=${jsVersion}`, "g"))?.length, 1)
  assert.doesNotMatch(adminHtml, /student-admin\.min\.(?:css|js)\?v=20260801-sivb/)
})

test("live student results query the complete roster without unrelated refreshes", () => {
  assert.match(liveNameSearch, /loadStudents\(\{ refreshRelated: false \}\)/)
  assert.match(loadStudents, /const requestId = \+\+state\.studentRosterRequestId/)
  assert.match(loadStudents, /if \(requestId !== state\.studentRosterRequestId\) return/)
})
