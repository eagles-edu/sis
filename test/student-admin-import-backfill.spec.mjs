import test from "node:test"
import assert from "node:assert/strict"

import { mergeImportPayloadForBackfill } from "../server/student-admin-store.mjs"

test("mergeImportPayloadForBackfill preserves existing values when import row is blank", () => {
  const existing = {
    id: "stu-1",
    eaglesId: "SIS-000101",
    studentNumber: 101,
    email: "existing@example.com",
    profile: {
      sourceFormId: "admin-manual",
      sourceUrl: "local-admin",
      fullName: "Existing Full",
      englishName: "Existing English",
      schoolName: "Existing School",
      motherPhone: "0900000000",
      languagesAtHome: ["Vietnamese"],
    },
  }

  const incoming = {
    eaglesId: "sis-000101",
    studentNumber: "",
    email: "",
    profile: {
      sourceFormId: "spreadsheet-import",
      sourceUrl: "local-import",
      fullName: "",
      englishName: "Updated English",
      schoolName: "",
      motherPhone: "",
      languagesAtHome: [],
      city: "Ho Chi Minh City",
    },
  }

  const merged = mergeImportPayloadForBackfill(incoming, existing)

  assert.equal(merged.eaglesId, "SIS-000101")
  assert.equal(merged.studentNumber, 101)
  assert.equal(merged.email, "existing@example.com")
  assert.equal(merged.profile.fullName, "Existing Full")
  assert.equal(merged.profile.englishName, "Updated English")
  assert.equal(merged.profile.schoolName, "Existing School")
  assert.equal(merged.profile.motherPhone, "0900000000")
  assert.deepEqual(merged.profile.languagesAtHome, ["Vietnamese"])
  assert.equal(merged.profile.city, "Ho Chi Minh City")
})

test("mergeImportPayloadForBackfill applies non-empty import values", () => {
  const existing = {
    eaglesId: "SIS-000102",
    studentNumber: 102,
    email: "old@example.com",
    profile: {
      fullName: "Older Name",
      exercisePoints: 4,
      languagesAtHome: ["Vietnamese"],
    },
  }

  const incoming = {
    eaglesId: "SIS-000102",
    studentNumber: 102,
    email: "new@example.com",
    profile: {
      fullName: "New Name",
      exercisePoints: 9,
      languagesAtHome: ["English", "Vietnamese"],
    },
  }

  const merged = mergeImportPayloadForBackfill(incoming, existing)

  assert.equal(merged.email, "new@example.com")
  assert.equal(merged.profile.fullName, "New Name")
  assert.equal(merged.profile.exercisePoints, 9)
  assert.deepEqual(merged.profile.languagesAtHome, ["English", "Vietnamese"])
})
