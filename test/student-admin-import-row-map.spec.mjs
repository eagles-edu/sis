import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"

import { mapImportRowToStudentPayload } from "../server/student-admin-store.mjs"

function readProfileFormRows() {
  const html = fs.readFileSync("web-asset/admin/student-admin.html", "utf8")
  const marker = "const PROFILE_FORM_FIELD_ROWS = ["
  const markerIndex = html.indexOf(marker)
  assert.ok(markerIndex >= 0, "PROFILE_FORM_FIELD_ROWS marker must exist")

  const openIndex = html.indexOf("[", markerIndex)
  let depth = 0
  let closeIndex = -1
  for (let i = openIndex; i < html.length; i += 1) {
    const ch = html[i]
    if (ch === "[") depth += 1
    if (ch === "]") {
      depth -= 1
      if (depth === 0) {
        closeIndex = i
        break
      }
    }
  }
  assert.ok(closeIndex > openIndex, "PROFILE_FORM_FIELD_ROWS array must close")

  const rows = vm.runInNewContext(html.slice(openIndex, closeIndex + 1))
  return Array.from(rows, (row) => ({
    key: String(row[0] || "").trim(),
    profileKey: String(row[9] || "").trim(),
  }))
}

test("mapImportRowToStudentPayload maps gender workbook column to genderSelections", () => {
  const mapped = mapImportRowToStudentPayload({
    eaglesId: "student001",
    studentNumber: "101",
    englishName: "Student One",
    gender: "female|male",
  })

  assert.equal(mapped.eaglesId, "student001")
  assert.equal(mapped.studentNumber, 101)
  assert.deepEqual(mapped.profile.genderSelections, ["female", "male"])
})

test("mapImportRowToStudentPayload accepts legacy sex alias for genderSelections", () => {
  const mapped = mapImportRowToStudentPayload({
    eaglesId: "student002",
    studentNumber: "102",
    fullNameStudent: "Student Two",
    sex: "male, non-binary",
  })

  assert.deepEqual(mapped.profile.genderSelections, ["male", "non-binary"])
})

test("mapImportRowToStudentPayload keeps fullName empty when only englishName is provided", () => {
  const mapped = mapImportRowToStudentPayload({
    eaglesId: "student003",
    studentNumber: "103",
    englishName: "Student Three",
  })

  assert.equal(mapped.profile.englishName, "Student Three")
  assert.equal(mapped.profile.fullName, "")
})

test("mapImportRowToStudentPayload keeps explicit fullName when provided", () => {
  const mapped = mapImportRowToStudentPayload({
    eaglesId: "student004",
    studentNumber: "104",
    fullNameStudent: "Pham Student",
    englishName: "Peter",
  })

  assert.equal(mapped.profile.fullName, "Pham Student")
  assert.equal(mapped.profile.englishName, "Peter")
})

test("mapImportRowToStudentPayload aligns workbook profile fields to persisted profile keys", () => {
  const fields = readProfileFormRows()
  const arrayProfileKeys = new Set([
    "genderSelections",
    "languagesAtHome",
    "learningDisorders",
    "covidShotHistory",
    "feverMedicineAllowed",
  ])
  const numericProfileKeys = new Set([
    "exercisePoints",
    "birthOrder",
    "siblingBrothers",
    "siblingSisters",
  ])
  const emailProfileKeys = new Set([
    "studentEmail",
    "motherEmail",
    "fatherEmail",
    "signatureEmail",
  ])

  const row = {
    eaglesId: "aligned001",
    studentNumber: "321",
  }

  fields.forEach((field) => {
    if (!field.key) return
    if (field.key === "eaglesId" || field.key === "studentNumber") return
    if (field.key === "classLevel") {
      row[field.key] = "Pre-A1 Starters"
      return
    }
    if (arrayProfileKeys.has(field.profileKey)) {
      row[field.key] = "A|B"
      return
    }
    if (numericProfileKeys.has(field.profileKey)) {
      row[field.key] = "7"
      return
    }
    if (emailProfileKeys.has(field.profileKey)) {
      row[field.key] = `${field.key}@example.com`
      return
    }
    row[field.key] = `v_${field.key}`
  })

  const mapped = mapImportRowToStudentPayload(row)
  assert.equal(mapped.eaglesId, "aligned001")
  assert.equal(mapped.studentNumber, 321)

  const missing = fields
    .filter((field) => Boolean(field.profileKey))
    .filter((field) => {
      const value = mapped.profile[field.profileKey]
      return value == null || value === "" || (Array.isArray(value) && value.length === 0)
    })
    .map((field) => `${field.key}->${field.profileKey}`)

  assert.deepEqual(missing, [])
})
